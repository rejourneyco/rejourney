/** Keep only a bounded lookahead of downloads alive while consuming in source order. */
export async function* prefetchInOrder<T, R>(
    items: readonly T[], concurrency: number, load: (item: T) => Promise<R>,
): AsyncGenerator<{ item: T; value: R; index: number }> {
    type Outcome = { ok: true; value: R } | { ok: false; error: unknown };
    const pending = new Map<number, Promise<Outcome>>();
    let next = 0;
    const fill = () => {
        while (next < items.length && pending.size < Math.max(1, concurrency)) {
            const index = next++;
            // Handle rejection immediately, including reads ahead of a failed/abandoned item.
            pending.set(index, Promise.resolve().then(() => load(items[index])).then(
                (value): Outcome => ({ ok: true, value }),
                (error): Outcome => ({ ok: false, error }),
            ));
        }
    };
    fill();
    try {
        for (let index = 0; index < items.length; index++) {
            const result = await pending.get(index)!;
            pending.delete(index);
            if (!result.ok) throw result.error;
            yield { item: items[index], value: result.value, index };
            fill();
        }
    } finally { pending.clear(); }
}
