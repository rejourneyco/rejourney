import { describe, expect, it } from 'vitest';
import { setBoundedMapEntry } from '../utils/boundedMap.js';

describe('setBoundedMapEntry', () => {
    it('evicts the oldest entry when the bound is reached', () => {
        const map = new Map<string, number>();
        setBoundedMapEntry(map, 'a', 1, 2);
        setBoundedMapEntry(map, 'b', 2, 2);
        setBoundedMapEntry(map, 'c', 3, 2);

        expect([...map.entries()]).toEqual([['b', 2], ['c', 3]]);
    });

    it('refreshes the eviction order for an existing key', () => {
        const map = new Map<string, number>();
        setBoundedMapEntry(map, 'a', 1, 2);
        setBoundedMapEntry(map, 'b', 2, 2);
        setBoundedMapEntry(map, 'a', 3, 2);
        setBoundedMapEntry(map, 'c', 4, 2);

        expect([...map.entries()]).toEqual([['a', 3], ['c', 4]]);
    });

    it('rejects an invalid bound', () => {
        expect(() => setBoundedMapEntry(new Map(), 'a', 1, 0)).toThrow(RangeError);
    });
});
