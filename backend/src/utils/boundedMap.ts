/**
 * Insert into an insertion-ordered Map while enforcing a hard memory bound.
 * Re-inserting an existing key refreshes its eviction order.
 */
export function setBoundedMapEntry<K, V>(
    map: Map<K, V>,
    key: K,
    value: V,
    maxEntries: number,
): void {
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) {
        throw new RangeError('maxEntries must be a positive safe integer');
    }

    map.delete(key);
    map.set(key, value);

    while (map.size > maxEntries) {
        const oldest = map.keys().next();
        if (oldest.done) break;
        map.delete(oldest.value);
    }
}
