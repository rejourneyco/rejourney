/**
 * Map items through an async function with at most `concurrency` calls in
 * flight. Results are returned in input order regardless of completion order,
 * so callers can prefetch a sorted list and consume it sequentially.
 */
export async function mapWithConcurrency<T, R>(
    items: readonly T[],
    concurrency: number,
    fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
    const results: R[] = new Array(items.length);
    let next = 0;
    const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length || 1)) }, async () => {
        while (next < items.length) {
            const index = next;
            next += 1;
            results[index] = await fn(items[index], index);
        }
    });
    await Promise.all(workers);
    return results;
}
