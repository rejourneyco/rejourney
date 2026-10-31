import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';

const mocks = vi.hoisted(() => ({
    selectResults: [] as unknown[][],
    executed: [] as unknown[],
    deletes: 0,
    set: vi.fn(async (..._args: unknown[]): Promise<string | null> => 'OK'),
    evalScript: vi.fn(async () => 1),
}));

// A drizzle query chain that resolves to the next queued select result.
function chain(): any {
    const result = mocks.selectResults.shift() ?? [];
    const builder: any = {};
    for (const method of ['from', 'where', 'orderBy', 'groupBy', 'leftJoin', 'limit']) builder[method] = vi.fn(() => builder);
    builder.then = (resolve: (value: unknown) => unknown, reject: (err: unknown) => unknown) => Promise.resolve(result).then(resolve, reject);
    return builder;
}

vi.mock('../db/client.js', async () => {
    const schema = await import('../db/schema.js');
    const client = {
        select: vi.fn(() => chain()),
        execute: vi.fn(async (query: unknown) => {
            mocks.executed.push(query);
            return [];
        }),
        delete: vi.fn(() => {
            mocks.deletes += 1;
            return { where: vi.fn(async () => undefined) };
        }),
    };
    return { ...schema, db: client, dbRead: client };
});
vi.mock('../db/redis.js', () => ({
    getRedis: () => ({ set: mocks.set, eval: mocks.evalScript, get: vi.fn(async () => null), del: vi.fn(async () => 1) }),
}));
vi.mock('../services/clickhouseRevenueEventsSink.js', () => ({
    buildClickHouseRevenueEventRow: vi.fn((row: unknown) => row),
    writeRevenueEventsToClickHouse: vi.fn(async () => undefined),
}));

const { refreshRecentCustomEventRevenue } = await import('../services/revenueSources.js');
const dialect = new PgDialect();

function connection(status = 'connected') {
    return {
        id: 'connection-1',
        projectId: 'project-1',
        provider: 'custom_events',
        status,
        customEventConfig: { revenueEventName: 'purchase_completed', revenueAmountProperty: 'amount', revenueCurrencyProperty: 'currency', defaultCurrency: 'usd', amountUnit: 'major' },
    };
}

beforeEach(() => {
    mocks.selectResults.length = 0;
    mocks.executed.length = 0;
    mocks.deletes = 0;
    mocks.set.mockReset();
    mocks.set.mockResolvedValue('OK');
    mocks.evalScript.mockClear();
});

describe('refreshRecentCustomEventRevenue', () => {
    it('imports only recent sessions without deleting existing revenue', async () => {
        mocks.selectResults.push([connection()], []);

        expect(await refreshRecentCustomEventRevenue('project-1')).toBe(true);

        expect(mocks.set).toHaveBeenCalledWith('revenue:refresh-import:project-1', '1', 'EX', 60, 'NX');
        // The import holds the per-project lock that full and scheduled syncs also take, then releases it.
        expect(mocks.set).toHaveBeenCalledWith('lock:revenue-custom-events:project-1', expect.any(String), 'PX', expect.any(Number), 'NX');
        expect(mocks.evalScript).toHaveBeenCalledTimes(1);
        expect(mocks.deletes).toBe(0);
        const { sql, params } = dialect.sqlToQuery(mocks.executed[0] as SQL);
        expect(sql).toContain('s.started_at >=');
        // Re-importing unchanged purchases writes nothing.
        expect(sql).toContain('IS DISTINCT FROM');
        const since = params.find((param): param is Date => param instanceof Date);
        expect(Date.now() - (since?.getTime() ?? 0)).toBeGreaterThan(5.9 * 60 * 60 * 1000);
        expect(Date.now() - (since?.getTime() ?? 0)).toBeLessThan(6.1 * 60 * 60 * 1000);
    });

    it('runs at most once a minute per project', async () => {
        mocks.set.mockResolvedValue(null);

        expect(await refreshRecentCustomEventRevenue('project-1')).toBe(false);
        expect(mocks.set).toHaveBeenCalledTimes(1);
        expect(mocks.executed).toEqual([]);
    });

    it('skips while another import holds the project', async () => {
        mocks.set.mockResolvedValueOnce('OK').mockResolvedValueOnce(null);

        expect(await refreshRecentCustomEventRevenue('project-1')).toBe(false);
        expect(mocks.executed).toEqual([]);
        expect(mocks.evalScript).not.toHaveBeenCalled();
    });

    it('leaves a running full or scheduled sync alone', async () => {
        mocks.selectResults.push([connection('syncing')]);

        expect(await refreshRecentCustomEventRevenue('project-1')).toBe(false);
        expect(mocks.executed).toEqual([]);
        expect(mocks.evalScript).toHaveBeenCalledTimes(1);
    });

    it('never throws when the throttle is unavailable', async () => {
        mocks.set.mockRejectedValue(new Error('redis down'));

        expect(await refreshRecentCustomEventRevenue('project-1')).toBe(false);
        expect(mocks.executed).toEqual([]);
    });
});
