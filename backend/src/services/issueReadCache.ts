/** Brief, bounded cache for read-only issue payloads. Authorization stays in the
 * route and runs on every request, including cache hits. Pending reads coalesce;
 * invalidation detaches them so an older response cannot repopulate the cache. */
export class IssueReadCache {
    private readonly entries = new Map<string, { promise: Promise<unknown>; expiresAt: number }>();

    constructor(private readonly ttlMs = 10_000, private readonly maxEntries = 128, private readonly now = Date.now) {}

    clear(): void {
        this.entries.clear();
    }

    async read<T>(key: string, load: () => Promise<T>): Promise<T> {
        const existing = this.entries.get(key);
        if (existing && existing.expiresAt > this.now()) return existing.promise as Promise<T>;
        this.entries.delete(key);
        while (this.entries.size >= this.maxEntries) {
            this.entries.delete(this.entries.keys().next().value!);
        }
        const entry = { promise: Promise.resolve().then(load), expiresAt: Infinity };
        this.entries.set(key, entry);
        try {
            const value = await entry.promise;
            entry.expiresAt = this.now() + this.ttlMs;
            return value;
        } catch (error) {
            if (this.entries.get(key) === entry) this.entries.delete(key);
            throw error;
        }
    }
}
