import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    acquireRedisLease,
    releaseRedisLease,
    renewRedisLease,
    startRedisLeaseRenewal,
} from '../services/redisLease.js';

describe('redisLease', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('acquires a lease with an owner token and expiry', async () => {
        const client = {
            set: vi.fn(async () => 'OK'),
            eval: vi.fn(),
        };

        const lease = await acquireRedisLease(client, 'lock:test', 30_000, 'owner-a');

        expect(lease).toEqual({
            key: 'lock:test',
            token: 'owner-a',
            ttlMs: 30_000,
            confirmedAtMs: expect.any(Number),
        });
        expect(client.set).toHaveBeenCalledWith('lock:test', 'owner-a', 'PX', 30_000, 'NX');
    });

    it('returns null when another owner already holds the lease', async () => {
        const client = {
            set: vi.fn(async () => null),
            eval: vi.fn(),
        };

        await expect(acquireRedisLease(client, 'lock:test', 30_000, 'owner-b')).resolves.toBeNull();
    });

    it('starts already aborted when the acquisition response consumed the conservative TTL', async () => {
        vi.useFakeTimers();
        const client = {
            set: vi.fn(() => new Promise<string>((resolve) => {
                setTimeout(() => resolve('OK'), 30_000);
            })),
            eval: vi.fn(),
        };
        const acquisition = acquireRedisLease(client, 'lock:test', 30_000, 'owner-a');
        await vi.advanceTimersByTimeAsync(30_000);
        const lease = await acquisition;
        expect(lease).not.toBeNull();

        const onLeaseLost = vi.fn();
        const renewal = startRedisLeaseRenewal(client, lease!, {
            intervalMs: 5_000,
            onLeaseLost,
        });

        expect(renewal.signal.aborted).toBe(true);
        expect(onLeaseLost).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(30_000);
        expect(client.eval).not.toHaveBeenCalled();
    });

    it('renews and releases only through token-checking Lua scripts', async () => {
        const client = {
            set: vi.fn(),
            eval: vi.fn()
                .mockResolvedValueOnce(1)
                .mockResolvedValueOnce(1),
        };
        const lease = { key: 'lock:test', token: 'owner-a', ttlMs: 30_000, confirmedAtMs: Date.now() };

        await expect(renewRedisLease(client, lease)).resolves.toBe(true);
        await expect(releaseRedisLease(client, lease)).resolves.toBe(true);

        expect(client.eval.mock.calls[0]).toEqual([
            expect.stringContaining("redis.call('pexpire'"),
            1,
            'lock:test',
            'owner-a',
            '30000',
        ]);
        expect(client.eval.mock.calls[1]).toEqual([
            expect.stringContaining("redis.call('del'"),
            1,
            'lock:test',
            'owner-a',
        ]);
    });

    it('renews a long-running lease on an unrefed interval', async () => {
        vi.useFakeTimers();
        const client = {
            set: vi.fn(),
            eval: vi.fn(async () => 1),
        };
        const lease = { key: 'lock:test', token: 'owner-a', ttlMs: 30_000, confirmedAtMs: Date.now() };
        const renewal = startRedisLeaseRenewal(client, lease, { intervalMs: 5_000 });

        await vi.advanceTimersByTimeAsync(5_000);
        expect(client.eval).toHaveBeenCalledTimes(1);
        expect(renewal.signal.aborted).toBe(false);

        renewal.stop();
        await vi.advanceTimersByTimeAsync(10_000);
        expect(client.eval).toHaveBeenCalledTimes(1);
    });

    it('aborts once and stops renewing after definitive token loss', async () => {
        vi.useFakeTimers();
        const client = {
            set: vi.fn(),
            eval: vi.fn(async () => 0),
        };
        const onLeaseLost = vi.fn();
        const lease = { key: 'lock:test', token: 'owner-a', ttlMs: 30_000, confirmedAtMs: Date.now() };
        const renewal = startRedisLeaseRenewal(client, lease, {
            intervalMs: 5_000,
            onLeaseLost,
        });

        await vi.advanceTimersByTimeAsync(5_000);
        expect(renewal.signal.aborted).toBe(true);
        expect(onLeaseLost).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(20_000);
        expect(client.eval).toHaveBeenCalledTimes(1);
        expect(onLeaseLost).toHaveBeenCalledTimes(1);
    });

    it('keeps renewing after an indeterminate Redis transport error', async () => {
        vi.useFakeTimers();
        const client = {
            set: vi.fn(),
            eval: vi.fn()
                .mockRejectedValueOnce(new Error('connection reset'))
                .mockResolvedValueOnce(1),
        };
        const onError = vi.fn();
        const lease = { key: 'lock:test', token: 'owner-a', ttlMs: 30_000, confirmedAtMs: Date.now() };
        const renewal = startRedisLeaseRenewal(client, lease, {
            intervalMs: 5_000,
            onError,
        });

        await vi.advanceTimersByTimeAsync(5_000);
        expect(onError).toHaveBeenCalledTimes(1);
        expect(renewal.signal.aborted).toBe(false);

        await vi.advanceTimersByTimeAsync(5_000);
        expect(client.eval).toHaveBeenCalledTimes(2);
        expect(renewal.signal.aborted).toBe(false);
        renewal.stop();
    });

    it('extends the watchdog from the start of the last successful renewal', async () => {
        vi.useFakeTimers();
        const neverSettles = new Promise<number>(() => {});
        const client = {
            set: vi.fn(),
            eval: vi.fn()
                .mockResolvedValueOnce(1)
                .mockImplementation(() => neverSettles),
        };
        const onLeaseLost = vi.fn();
        const lease = { key: 'lock:test', token: 'owner-a', ttlMs: 30_000, confirmedAtMs: Date.now() };
        const renewal = startRedisLeaseRenewal(client, lease, {
            intervalMs: 10_000,
            onLeaseLost,
        });

        await vi.advanceTimersByTimeAsync(10_000);
        expect(client.eval).toHaveBeenCalledTimes(1);

        // The second attempt hangs. The first successful attempt began at 10s,
        // so its conservative confirmed deadline is 40s rather than the
        // original acquisition deadline at 30s.
        await vi.advanceTimersByTimeAsync(20_000);
        expect(client.eval).toHaveBeenCalledTimes(2);
        expect(renewal.signal.aborted).toBe(false);

        await vi.advanceTimersByTimeAsync(9_999);
        expect(renewal.signal.aborted).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        expect(renewal.signal.aborted).toBe(true);
        expect(onLeaseLost).toHaveBeenCalledTimes(1);
    });

    it('fails closed at the last confirmed expiry after repeated transport errors', async () => {
        vi.useFakeTimers();
        const client = {
            set: vi.fn(),
            eval: vi.fn(async () => {
                throw new Error('partitioned');
            }),
        };
        const onError = vi.fn();
        const onLeaseLost = vi.fn();
        const lease = { key: 'lock:test', token: 'owner-a', ttlMs: 30_000, confirmedAtMs: Date.now() };
        const renewal = startRedisLeaseRenewal(client, lease, {
            intervalMs: 5_000,
            onError,
            onLeaseLost,
        });

        await vi.advanceTimersByTimeAsync(29_999);
        expect(renewal.signal.aborted).toBe(false);
        expect(onError).toHaveBeenCalledTimes(5);

        await vi.advanceTimersByTimeAsync(1);
        expect(renewal.signal.aborted).toBe(true);
        expect(onLeaseLost).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(30_000);
        expect(client.eval).toHaveBeenCalledTimes(5);
        expect(onLeaseLost).toHaveBeenCalledTimes(1);
    });

    it('fails closed when a renewal hangs and ignores its late completion', async () => {
        vi.useFakeTimers();
        let finishRenewal: ((result: number) => void) | undefined;
        const client = {
            set: vi.fn(),
            eval: vi.fn(() => new Promise<number>((resolve) => {
                finishRenewal = resolve;
            })),
        };
        const onLeaseLost = vi.fn();
        const lease = { key: 'lock:test', token: 'owner-a', ttlMs: 30_000, confirmedAtMs: Date.now() };
        const renewal = startRedisLeaseRenewal(client, lease, {
            intervalMs: 5_000,
            onLeaseLost,
        });

        await vi.advanceTimersByTimeAsync(5_000);
        expect(client.eval).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(25_000);
        expect(renewal.signal.aborted).toBe(true);
        expect(onLeaseLost).toHaveBeenCalledTimes(1);

        finishRenewal?.(1);
        await Promise.resolve();
        await Promise.resolve();
        expect(renewal.signal.aborted).toBe(true);
        expect(onLeaseLost).toHaveBeenCalledTimes(1);
        expect(client.eval).toHaveBeenCalledTimes(1);
    });

    it('ignores a pending renewal result after an explicit stop', async () => {
        vi.useFakeTimers();
        let finishRenewal: ((result: number) => void) | undefined;
        const client = {
            set: vi.fn(),
            eval: vi.fn(() => new Promise<number>((resolve) => {
                finishRenewal = resolve;
            })),
        };
        const onLeaseLost = vi.fn();
        const lease = { key: 'lock:test', token: 'owner-a', ttlMs: 30_000, confirmedAtMs: Date.now() };
        const renewal = startRedisLeaseRenewal(client, lease, {
            intervalMs: 5_000,
            onLeaseLost,
        });

        await vi.advanceTimersByTimeAsync(5_000);
        renewal.stop();
        finishRenewal?.(0);
        await Promise.resolve();
        await Promise.resolve();

        expect(renewal.signal.aborted).toBe(false);
        expect(onLeaseLost).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(60_000);
        expect(client.eval).toHaveBeenCalledTimes(1);
    });
});
