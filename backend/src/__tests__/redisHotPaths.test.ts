import { describe, expect, it, vi } from 'vitest';
import {
    checkRateLimit,
    checkRateLimitStrict,
    checkRateLimitWithClient,
    deleteRedisKeyWithoutBlocking,
    getRedis,
} from '../db/redis.js';

describe('Redis hot-path helpers', () => {
    it('checks a sliding-window rate limit atomically in one Lua call', async () => {
        const client = {
            eval: vi.fn(async () => 3),
        };

        const result = await checkRateLimitWithClient(
            client as never,
            'rate:ingest:project-1',
            60_000,
            3,
            100_000,
            'request-1',
        );

        expect(result).toEqual({ allowed: true, remaining: 0, resetAt: 160_000 });
        expect(client.eval).toHaveBeenCalledWith(
            expect.stringContaining("redis.call('zremrangebyscore'"),
            1,
            'rate:ingest:project-1',
            '40000',
            '100000',
            'request-1',
            '60000',
        );
    });

    it('denies the first request above the exact atomic limit', async () => {
        const client = { eval: vi.fn(async () => 4) };

        await expect(checkRateLimitWithClient(
            client as never,
            'rate:ingest:project-1',
            60_000,
            3,
            100_000,
            'request-4',
        )).resolves.toEqual({ allowed: false, remaining: 0, resetAt: 160_000 });
    });

    it('propagates script failures to the middleware policy layer', async () => {
        const client = { eval: vi.fn(async () => { throw new Error('READONLY replica'); }) };

        await expect(checkRateLimitWithClient(
            client as never,
            'rate:otp:test@example.com',
            60_000,
            3,
        )).rejects.toThrow('READONLY replica');
    });

    it('keeps direct abuse checks fail-open when a Redis command fails', async () => {
        const now = vi.spyOn(Date, 'now').mockReturnValue(100_000);
        const evalCall = vi.spyOn(getRedis(), 'eval').mockRejectedValueOnce(new Error('READONLY replica'));

        await expect(checkRateLimit(
            'abuse:signup:ip:127.0.0.1:short',
            60_000,
            3,
        )).resolves.toEqual({ allowed: true, remaining: 3, resetAt: 160_000 });

        expect(evalCall).toHaveBeenCalledTimes(1);
        now.mockRestore();
    });

    it('exposes command failures to middleware through the strict wrapper', async () => {
        const evalCall = vi.spyOn(getRedis(), 'eval').mockRejectedValueOnce(new Error('Redis command timed out'));

        await expect(checkRateLimitStrict(
            'rate:ingest:project-1',
            60_000,
            3,
        )).rejects.toThrow('Redis command timed out');

        expect(evalCall).toHaveBeenCalledTimes(1);
    });

    it('unlinks large values so Redis reclaims memory off the main thread', async () => {
        const client = {
            unlink: vi.fn(async () => 1),
            del: vi.fn(async () => 1),
        };

        await expect(deleteRedisKeyWithoutBlocking(client as never, 'artifact:buf:1')).resolves.toBe(1);
        expect(client.unlink).toHaveBeenCalledWith('artifact:buf:1');
        expect(client.del).not.toHaveBeenCalled();
    });

    it('falls back to DEL only for Redis versions without UNLINK', async () => {
        const client = {
            unlink: vi.fn(async () => { throw new Error("ERR unknown command 'unlink'"); }),
            del: vi.fn(async () => 1),
        };

        await expect(deleteRedisKeyWithoutBlocking(client as never, 'artifact:buf:1')).resolves.toBe(1);
        expect(client.del).toHaveBeenCalledWith('artifact:buf:1');
    });

    it('does not hide operational UNLINK failures', async () => {
        const client = {
            unlink: vi.fn(async () => { throw new Error('READONLY replica'); }),
            del: vi.fn(async () => 1),
        };

        await expect(deleteRedisKeyWithoutBlocking(client as never, 'artifact:buf:1'))
            .rejects.toThrow('READONLY replica');
        expect(client.del).not.toHaveBeenCalled();
    });
});
