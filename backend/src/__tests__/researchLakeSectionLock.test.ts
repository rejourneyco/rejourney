import { beforeEach, describe, expect, it, vi } from 'vitest';

const queries: Array<{ text: string; values?: unknown[] }> = [];
let acquired = true;
let released = 0;
const client = {
    query: vi.fn(async (text: string, values?: unknown[]) => {
        queries.push({ text, values });
        if (text.includes('pg_try_advisory_xact_lock')) return { rows: [{ acquired }] };
        return { rows: [] };
    }),
    release: vi.fn(() => { released += 1; }),
};

vi.mock('../db/client.js', () => ({
    pool: { connect: vi.fn(async () => client) },
}));
vi.mock('../logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { withResearchLakeSectionLock } from '../services/researchLakeSectionLock.js';

describe('research lake section lock', () => {
    beforeEach(() => {
        queries.length = 0;
        released = 0;
        acquired = true;
        client.query.mockClear();
        client.release.mockClear();
    });

    it('runs the section inside a transaction-scoped advisory lock and always releases the client', async () => {
        const outcome = await withResearchLakeSectionLock('research-lake:test', 'skip', async () => 42);
        expect(outcome).toEqual({ skipped: false, result: 42 });
        expect(queries[0]?.text).toBe('BEGIN');
        expect(queries[1]?.text).toContain('pg_try_advisory_xact_lock(hashtextextended($1, 0))');
        expect(queries[1]?.values).toEqual(['research-lake:test']);
        expect(queries.at(-1)?.text).toBe('ROLLBACK');
        expect(released).toBe(1);
    });

    it('skips without running the section when another worker holds it', async () => {
        acquired = false;
        const fn = vi.fn(async () => 'never');
        const outcome = await withResearchLakeSectionLock('research-lake:test', 'skip', fn);
        expect(outcome).toEqual({ skipped: true });
        expect(fn).not.toHaveBeenCalled();
        expect(queries.some((q) => q.text.includes('pg_advisory_xact_lock(') && !q.text.includes('pg_try_'))).toBe(false);
        expect(queries.at(-1)?.text).toBe('ROLLBACK');
        expect(released).toBe(1);
    });

    it('waits for the sibling to commit in wait mode, then still reports skipped', async () => {
        acquired = false;
        const fn = vi.fn(async () => 'never');
        const outcome = await withResearchLakeSectionLock('research-lake:test', 'wait', fn);
        expect(outcome).toEqual({ skipped: true });
        expect(fn).not.toHaveBeenCalled();
        expect(queries.some((q) => q.text.includes('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))'))).toBe(true);
        expect(released).toBe(1);
    });

    it('releases the client when the section throws', async () => {
        await expect(withResearchLakeSectionLock('research-lake:test', 'skip', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
        expect(queries.at(-1)?.text).toBe('ROLLBACK');
        expect(released).toBe(1);
    });
});
