import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    redis: {
        set: vi.fn(async () => 'OK' as string | null),
        get: vi.fn(async () => null as string | null),
        eval: vi.fn(async () => 1 as number),
    },
    getRedis: vi.fn(),
}));

vi.mock('../db/redis.js', () => ({ getRedis: mocks.getRedis }));
vi.mock('../logger.js', () => ({
    logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { acquireLock } = await import('../services/distributedLock.js');

describe('acquireLock', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getRedis.mockReturnValue(mocks.redis);
        mocks.redis.set.mockResolvedValue('OK');
        mocks.redis.eval.mockResolvedValue(1);
    });

    it('acquires with NX + PX so only one holder can win the key', async () => {
        const result = await acquireLock('k', 30_000);

        expect(result.outcome).toBe('acquired');
        const [key, token, px, ttl, nx] = mocks.redis.set.mock.calls[0] as unknown as unknown[];
        expect(key).toBe('k');
        expect(px).toBe('PX');
        expect(ttl).toBe(30_000);
        expect(nx).toBe('NX');
        expect(String(token)).not.toHaveLength(0);
    });

    it('reports held_by_other when the key already exists', async () => {
        mocks.redis.set.mockResolvedValue(null);

        await expect(acquireLock('k', 30_000)).resolves.toEqual({ outcome: 'held_by_other' });
    });

    it('degrades to unavailable when Redis errors, so callers proceed unfenced', async () => {
        mocks.redis.set.mockRejectedValue(new Error('redis down'));

        await expect(acquireLock('k', 30_000)).resolves.toEqual({ outcome: 'unavailable' });
    });

    it('degrades to unavailable when the client cannot be constructed', async () => {
        mocks.getRedis.mockImplementation(() => { throw new Error('no client'); });

        await expect(acquireLock('k', 30_000)).resolves.toEqual({ outcome: 'unavailable' });
    });

    it('reports ownership only while our own token is the stored value', async () => {
        const result = await acquireLock('k', 30_000);
        if (result.outcome !== 'acquired') throw new Error('expected acquired');
        const token = String((mocks.redis.set.mock.calls[0] as unknown as unknown[])[1]);

        mocks.redis.get.mockResolvedValue(token);
        await expect(result.lock.isStillOwned()).resolves.toBe(true);

        // Lease expired and a different pod took over.
        mocks.redis.get.mockResolvedValue('someone-elses-token');
        await expect(result.lock.isStillOwned()).resolves.toBe(false);
    });

    it('fails closed on an unreadable ownership check', async () => {
        const result = await acquireLock('k', 30_000);
        if (result.outcome !== 'acquired') throw new Error('expected acquired');

        mocks.redis.get.mockRejectedValue(new Error('redis down'));

        await expect(result.lock.isStillOwned()).resolves.toBe(false);
    });

    it('releases through a token-compared script rather than a blind DEL', async () => {
        const result = await acquireLock('k', 30_000);
        if (result.outcome !== 'acquired') throw new Error('expected acquired');
        const token = String((mocks.redis.set.mock.calls[0] as unknown as unknown[])[1]);

        await result.lock.release();

        const [script, numKeys, key, arg] = mocks.redis.eval.mock.calls.at(-1) as unknown as unknown[];
        expect(String(script)).toContain('redis.call("del", KEYS[1])');
        expect(String(script)).toContain('redis.call("get", KEYS[1]) == ARGV[1]');
        expect(numKeys).toBe(1);
        expect(key).toBe('k');
        expect(arg).toBe(token);
    });

    it('release is idempotent and never throws when Redis is down', async () => {
        const result = await acquireLock('k', 30_000);
        if (result.outcome !== 'acquired') throw new Error('expected acquired');

        mocks.redis.eval.mockRejectedValue(new Error('redis down'));
        await expect(result.lock.release()).resolves.toBeUndefined();

        const callsAfterFirst = mocks.redis.eval.mock.calls.length;
        await expect(result.lock.release()).resolves.toBeUndefined();
        expect(mocks.redis.eval.mock.calls.length).toBe(callsAfterFirst);
    });

    it('treats a released lock as no longer owned without touching Redis', async () => {
        const result = await acquireLock('k', 30_000);
        if (result.outcome !== 'acquired') throw new Error('expected acquired');

        await result.lock.release();
        mocks.redis.get.mockClear();

        await expect(result.lock.isStillOwned()).resolves.toBe(false);
        expect(mocks.redis.get).not.toHaveBeenCalled();
    });

    it('renews on a schedule inside the TTL and stops once the lease is lost', async () => {
        vi.useFakeTimers();
        try {
            const result = await acquireLock('k', 30_000);
            if (result.outcome !== 'acquired') throw new Error('expected acquired');
            mocks.redis.eval.mockClear();

            // Renewal runs at ttl/3.
            await vi.advanceTimersByTimeAsync(10_000);
            const renewCall = mocks.redis.eval.mock.calls.at(-1) as unknown as unknown[];
            expect(String(renewCall[0])).toContain('pexpire');

            // A renewal that reports 0 means another holder owns the key now.
            mocks.redis.eval.mockResolvedValue(0);
            await vi.advanceTimersByTimeAsync(10_000);
            const afterLoss = mocks.redis.eval.mock.calls.length;

            await vi.advanceTimersByTimeAsync(30_000);
            expect(mocks.redis.eval.mock.calls.length).toBe(afterLoss);
        } finally {
            vi.useRealTimers();
        }
    });
});
