import { beforeEach, describe, expect, it, vi } from 'vitest';

const { store, slots } = vi.hoisted(() => ({ store: new Map<string, string>(), slots: new Set<string>() }));

vi.mock('../db/redis.js', () => ({
    getRedis: () => ({
        get: async (key: string) => store.get(key) ?? null,
        set: async (key: string, _value: string, _ex: string, _ttl: number, nx: string) => {
            if (nx === 'NX' && slots.has(key)) return null;
            slots.add(key);
            return 'OK';
        },
    }),
}));

import { readRefreshableCache, REFRESH_MIN_INTERVAL_SECONDS } from '../services/dashboardRefreshCache.js';

const request = (refresh: boolean) => ({ get: (name: string) => (refresh && name.toLowerCase() === 'x-dashboard-refresh' ? '1' : undefined) }) as any;

describe('dashboard refresh cache', () => {
    beforeEach(() => {
        store.clear();
        slots.clear();
        store.set('analytics:k', '{"cached":true}');
    });

    it('serves the cache to ordinary loads', async () => {
        await expect(readRefreshableCache(request(false), 'analytics:k')).resolves.toBe('{"cached":true}');
        expect(slots.size).toBe(0);
    });

    it('lets one refresh per key recompute, then serves the cache until the slot expires', async () => {
        await expect(readRefreshableCache(request(true), 'analytics:k')).resolves.toBeNull();
        expect(slots.has('refresh-slot:analytics:k')).toBe(true);
        await expect(readRefreshableCache(request(true), 'analytics:k')).resolves.toBe('{"cached":true}');
        // Other keys have their own slot.
        await expect(readRefreshableCache(request(true), 'analytics:other')).resolves.toBeNull();
        expect(REFRESH_MIN_INTERVAL_SECONDS).toBe(30);
    });
});
