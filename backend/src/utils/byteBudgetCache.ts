/** A disposable cache: oversized entries are processed normally but never retained. */
export class ByteBudgetCache<T> extends Map<string, T> {
    private bytes = 0;
    constructor(private readonly budget: number, private readonly sizeOf: (value: T) => number) { super(); }
    override set(key: string, value: T): this {
        this.delete(key);
        const size = this.sizeOf(value);
        if (size > this.budget) return this;
        while (this.bytes + size > this.budget && this.size > 0) {
            this.delete(this.keys().next().value!);
        }
        super.set(key, value);
        this.bytes += size;
        return this;
    }
    override delete(key: string): boolean {
        if (!this.has(key)) return false;
        this.bytes -= this.sizeOf(this.get(key)!);
        return super.delete(key);
    }
    override clear(): void { super.clear(); this.bytes = 0; }
}
