const DAY_MS = 86_400_000;

/** Resume oldest missing days first; bound each run so a long outage cannot monopolize the worker. */
export function pendingRollupDates(lastComplete: string | null, now = new Date(), limit = 7): Date[] {
    const yesterday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - DAY_MS;
    const previous = lastComplete && /^\d{4}-\d{2}-\d{2}$/.test(lastComplete)
        ? Date.parse(`${lastComplete}T00:00:00Z`) : NaN;
    const first = Number.isFinite(previous) ? previous + DAY_MS : yesterday;
    const dates: Date[] = [];
    for (let day = first; day <= yesterday && dates.length < limit; day += DAY_MS) dates.push(new Date(day));
    return dates;
}

/** Calendar days, not just occupied buckets: absence of sessions is a real zero. */
export function calendarDateKeys(first: string, last: string): string[] {
    const keys: string[] = [];
    const end = Date.parse(`${last}T00:00:00Z`);
    for (let day = Date.parse(`${first}T00:00:00Z`); day <= end; day += DAY_MS) {
        keys.push(new Date(day).toISOString().slice(0, 10));
    }
    return keys;
}
