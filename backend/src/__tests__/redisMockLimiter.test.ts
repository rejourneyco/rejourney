/**
 * Can `ioredis-mock` stand in for Redis (no server on this machine) for the
 * operations an MCP rate limiter, concurrency semaphore and credit counter
 * need? It is an in-process implementation of the `ioredis` client API, the
 * library `src/db/redis.ts` uses, with Lua `EVAL` support.
 */
import RedisMock from 'ioredis-mock';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../logger.js', () => ({
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { checkRateLimitWithClient } from '../db/redis.js';

/**
 * Atomically spends `ARGV[1]` credits against a limit of `ARGV[2]`, giving the
 * counter a TTL of `ARGV[3]` ms when it is first created. Returns
 * {1, total} when the spend fits and {0, current} when it would overshoot.
 */
const SPEND_CREDITS_SCRIPT = `
local current = tonumber(redis.call('get', KEYS[1]) or '0')
local cost = tonumber(ARGV[1])
if current + cost > tonumber(ARGV[2]) then
    return {0, current}
end
local total = redis.call('incrby', KEYS[1], cost)
if total == cost then
    redis.call('pexpire', KEYS[1], ARGV[3])
end
return {1, total}
`;

/** Takes one of `ARGV[1]` concurrency slots, with a safety TTL so a crashed holder cannot leak it. */
const ACQUIRE_SLOT_SCRIPT = `
local held = redis.call('incr', KEYS[1])
if held > tonumber(ARGV[1]) then
    redis.call('decr', KEYS[1])
    return 0
end
redis.call('pexpire', KEYS[1], ARGV[2])
return 1
`;

const redis = new RedisMock();

beforeEach(async () => {
    await redis.flushall();
});

describe('ioredis-mock as an in-process Redis substitute', () => {
    it('INCRBY, EXPIRE, PEXPIRE and TTL behave like Redis', async () => {
        expect(await redis.incrby('mcp:credits:team-a', 5)).toBe(5);
        expect(await redis.incrby('mcp:credits:team-a', 3)).toBe(8);
        expect(await redis.ttl('mcp:credits:team-a')).toBe(-1);

        expect(await redis.expire('mcp:credits:team-a', 60)).toBe(1);
        const ttl = await redis.ttl('mcp:credits:team-a');
        expect(ttl).toBeGreaterThan(55);
        expect(ttl).toBeLessThanOrEqual(60);

        expect(await redis.pexpire('mcp:credits:team-a', 1500)).toBe(1);
        const pttl = await redis.pttl('mcp:credits:team-a');
        expect(pttl).toBeGreaterThan(1000);
        expect(pttl).toBeLessThanOrEqual(1500);
    });

    it('keys really expire', async () => {
        await redis.incrby('mcp:short', 1);
        await redis.pexpire('mcp:short', 30);
        expect(await redis.get('mcp:short')).toBe('1');
        await new Promise((resolve) => setTimeout(resolve, 60));
        expect(await redis.get('mcp:short')).toBeNull();
        // A fresh window starts from zero.
        expect(await redis.incrby('mcp:short', 1)).toBe(1);
    });

    it('pipelines and MULTI/EXEC work as the repo uses them (INCRBY + EXPIRE)', async () => {
        const pipeline = redis.pipeline();
        pipeline.incrby('mcp:bytes:project-a', 1024);
        pipeline.expire('mcp:bytes:project-a', 120);
        const results = await pipeline.exec();
        expect(results).toEqual([[null, 1024], [null, 1]]);

        const transaction = await redis.multi().incrby('mcp:bytes:project-a', 1).pttl('mcp:bytes:project-a').exec();
        expect(transaction?.[0]).toEqual([null, 1025]);
        expect(Number(transaction?.[1][1])).toBeGreaterThan(0);
    });

    it("runs the repo's own Lua rate limiter (checkRateLimitWithClient) unchanged", async () => {
        const key = 'rate:mcp:user-a';
        const windowMs = 60_000;
        const now = 1_800_000_000_000;

        const first = await checkRateLimitWithClient(redis, key, windowMs, 3, now, 'call-1');
        const second = await checkRateLimitWithClient(redis, key, windowMs, 3, now + 1, 'call-2');
        const third = await checkRateLimitWithClient(redis, key, windowMs, 3, now + 2, 'call-3');
        const fourth = await checkRateLimitWithClient(redis, key, windowMs, 3, now + 3, 'call-4');

        expect([first.allowed, second.allowed, third.allowed, fourth.allowed]).toEqual([true, true, true, false]);
        expect([first.remaining, second.remaining, third.remaining, fourth.remaining]).toEqual([2, 1, 0, 0]);

        // The script set a TTL on the key (PEXPIRE inside EVAL).
        const pttl = await redis.pttl(key);
        expect(pttl).toBeGreaterThan(0);
        expect(pttl).toBeLessThanOrEqual(windowMs);

        // Sliding window: once the old entries fall out of the window the caller is allowed again.
        const later = await checkRateLimitWithClient(redis, key, windowMs, 3, now + windowMs + 10, 'call-5');
        expect(later.allowed).toBe(true);
        expect(later.remaining).toBe(2);
    });

    it('a Lua credit counter cannot be overshot by parallel calls', async () => {
        const key = 'mcp:credits:team-a:2026-11';
        const limit = 25;
        const spend = () => redis.eval(SPEND_CREDITS_SCRIPT, 1, key, '1', String(limit), '60000') as Promise<[number, number]>;

        const outcomes = await Promise.all(Array.from({ length: 100 }, spend));

        expect(outcomes.filter(([accepted]) => accepted === 1)).toHaveLength(limit);
        expect(outcomes.filter(([accepted]) => accepted === 0)).toHaveLength(100 - limit);
        expect(await redis.get(key)).toBe(String(limit));
        expect(await redis.pttl(key)).toBeGreaterThan(0);

        // A multi-credit call that does not fit is refused whole, leaving the counter untouched.
        await redis.set(key, '23', 'KEEPTTL');
        expect(await redis.eval(SPEND_CREDITS_SCRIPT, 1, key, '4', String(limit), '60000')).toEqual([0, 23]);
        expect(await redis.eval(SPEND_CREDITS_SCRIPT, 1, key, '2', String(limit), '60000')).toEqual([1, 25]);
    });

    it('a Lua concurrency semaphore holds its cap and frees slots', async () => {
        const key = 'mcp:inflight:user-a';
        const acquire = () => redis.eval(ACQUIRE_SLOT_SCRIPT, 1, key, '4', '20000') as Promise<number>;

        const attempts = await Promise.all(Array.from({ length: 10 }, acquire));
        expect(attempts.filter((result) => result === 1)).toHaveLength(4);
        expect(await redis.get(key)).toBe('4');

        await redis.decr(key);
        expect(await acquire()).toBe(1);
        expect(await acquire()).toBe(0);
    });

    it('separate client instances share one keyspace, like separate pods', async () => {
        const other = new RedisMock();
        await redis.incrby('mcp:shared', 2);
        expect(await other.incrby('mcp:shared', 3)).toBe(5);
    });
});
