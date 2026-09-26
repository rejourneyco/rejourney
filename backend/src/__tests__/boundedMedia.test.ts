import { describe, expect, it, vi } from 'vitest';
import { ByteBudgetCache } from '../utils/byteBudgetCache.js';
import { prefetchInOrder } from '../utils/prefetchInOrder.js';

describe('bounded export media', () => {
    it('holds only the lookahead while a consumer is paused and preserves source indexes', async () => {
        const load = vi.fn(async (item: number) => Buffer.alloc(item));
        const iterator = prefetchInOrder([1, 2, 3, 4, 5], 2, load);
        expect((await iterator.next()).value).toMatchObject({ item: 1, index: 0 });
        await Promise.resolve();
        expect(load).toHaveBeenCalledTimes(2);
        const rest = [];
        for await (const row of iterator) rest.push([row.item, row.index, row.value.length]);
        expect(rest).toEqual([[2, 1, 2], [3, 2, 3], [4, 3, 4], [5, 4, 5]]);
    });
    it('propagates read failures without starting the rest of the archive', async () => {
        const load = vi.fn(async (item: number) => { if (item === 2) throw new Error('read failed'); return item; });
        const iterator = prefetchInOrder([1, 2, 3, 4, 5], 2, load);
        await iterator.next();
        await expect(iterator.next()).rejects.toThrow('read failed');
        expect(load.mock.calls.length).toBeLessThanOrEqual(3);
    });
    it('evicts by bytes, replaces accurately, and never retains oversized media', () => {
        const cache = new ByteBudgetCache<Buffer>(10, b => b.length);
        cache.set('a', Buffer.alloc(6)).set('b', Buffer.alloc(6));
        expect([...cache.keys()]).toEqual(['b']);
        cache.set('b', Buffer.alloc(3)).set('c', Buffer.alloc(7));
        expect([...cache.keys()]).toEqual(['b', 'c']);
        cache.set('huge', Buffer.alloc(11));
        expect(cache.has('huge')).toBe(false);
        cache.delete('c');
        cache.set('d', Buffer.alloc(7));
        expect([...cache.keys()]).toEqual(['b', 'd']);
        cache.clear();
        cache.set('e', Buffer.alloc(10));
        expect([...cache.keys()]).toEqual(['e']);
    });
});
