import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

const { state, fakeDb, fakeRedis } = vi.hoisted(() => {
    let dialect: { sqlToQuery: (query: SQL) => { sql: string; params: unknown[] } } | undefined;
    const state = {
        render: (query: unknown) => dialect!.sqlToQuery(query as SQL),
        setDialect: (value: typeof dialect) => { dialect = value; },
        projects: [] as string[],
        issuesByProject: new Map<string, string[]>(),
        eventIds: new Map<string, string[]>(),
        stats: new Map<string, { user_count: number; identities: number }>(),
        redis: new Map<string, string>(),
        statements: [] as string[],
        transactions: [] as string[][],
        rekeyedBatches: [] as string[][],
        recounts: [] as Array<{ issueId: string; offset: number }>,
        rekeyFailures: 0,
        onRekey: undefined as undefined | (() => void),
    };
    const execute = async (query: unknown, log: string[]) => {
        const { sql, params } = state.render(query);
        log.push(sql);
        state.statements.push(sql);
        if (sql.includes('SELECT DISTINCT project_id FROM issues')) {
            return { rows: state.projects.map((project_id) => ({ project_id })) };
        }
        if (sql.includes('SELECT i.id FROM issues i')) {
            return { rows: (state.issuesByProject.get(params[0] as string) ?? []).map((id) => ({ id })) };
        }
        if (sql.includes('SELECT i.user_count')) {
            const stats = state.stats.get(params[0] as string);
            return { rows: stats ? [stats] : [] };
        }
        if (sql.includes('UPDATE issue_events')) {
            if (state.rekeyFailures > 0) {
                state.rekeyFailures -= 1;
                throw Object.assign(new Error('lock timeout'), { cause: { code: '55P03' } });
            }
            const ids = params.filter((param) => typeof param === 'string' && param.startsWith('event-')) as string[];
            state.rekeyedBatches.push(ids);
            state.onRekey?.();
            return { rows: [], rowCount: ids.length };
        }
        if (sql.includes('UPDATE issues')) {
            const offset = params.find((param) => typeof param === 'number') as number;
            state.recounts.push({ issueId: params[0] as string, offset });
            return { rows: [], rowCount: 1 };
        }
        if (sql.includes('SELECT id FROM issue_events')) {
            const [issueId, cursor, , limit] = params as [string, string | null, string | null, number];
            const ids = (state.eventIds.get(issueId) ?? []).filter((id) => cursor === null || id > cursor).slice(0, limit);
            return { rows: ids.map((id) => ({ id })) };
        }
        return { rows: [] };
    };
    const fakeDb = {
        execute: (query: unknown) => execute(query, []),
        transaction: async <T>(fn: (tx: any) => Promise<T>): Promise<T> => {
            const log: string[] = [];
            state.transactions.push(log);
            return fn({ execute: (query: unknown) => execute(query, log) });
        },
    };
    const fakeRedis = {
        get: async (key: string) => state.redis.get(key) ?? null,
        set: async (key: string, value: string, ...args: unknown[]) => {
            if (args.includes('NX') && state.redis.has(key)) return null;
            state.redis.set(key, value);
            return 'OK';
        },
        del: async (key: string) => (state.redis.delete(key) ? 1 : 0),
    };
    return { state, fakeDb, fakeRedis };
});

vi.mock('../db/client.js', () => ({ db: fakeDb }));
vi.mock('../db/redis.js', () => ({ getRedis: () => fakeRedis }));
vi.mock('../logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import {
    ISSUE_EVENT_BATCH_SIZE,
    ISSUE_IDENTITY_VERSION,
    regradeIssueIdentity,
    rekeyEventBatch,
} from '../services/issueIdentityRegrade.js';

const doneKey = `stats:issue-identity:${ISSUE_IDENTITY_VERSION}`;
const eventIds = (count: number) => Array.from({ length: count }, (_, i) => `event-${String(i).padStart(5, '0')}`);
const signal = () => new AbortController().signal;

beforeEach(() => {
    state.setDialect(new PgDialect());
    state.projects = ['project-1'];
    state.issuesByProject = new Map([['project-1', ['issue-1']]]);
    state.eventIds = new Map([['issue-1', eventIds(1100)]]);
    state.stats = new Map([['issue-1', { user_count: 40, identities: 30 }]]);
    state.redis = new Map();
    state.statements = [];
    state.transactions = [];
    state.rekeyedBatches = [];
    state.recounts = [];
    state.rekeyFailures = 0;
    state.onRekey = undefined;
});

describe('regradeIssueIdentity', () => {
    it('does nothing once the version marker is set', async () => {
        state.redis.set(doneKey, '2026-11-01T00:00:00.000Z');

        await expect(regradeIssueIdentity({ signal: signal() })).resolves.toBe(true);
        expect(state.statements).toEqual([]);
    });

    it('re-keys events in primary-key batches of 500, each in its own lock-limited transaction', async () => {
        await expect(regradeIssueIdentity({ signal: signal() })).resolves.toBe(true);

        expect(ISSUE_EVENT_BATCH_SIZE).toBe(500);
        expect(state.rekeyedBatches.map((batch) => batch.length)).toEqual([500, 500, 100]);
        expect(state.rekeyedBatches.flat()).toEqual(eventIds(1100));
        const rekeyTransactions = state.transactions.filter((log) => log.some((sql) => sql.includes('UPDATE issue_events')));
        expect(rekeyTransactions).toHaveLength(3);
        for (const log of rekeyTransactions) {
            expect(log[0]).toContain("SET LOCAL lock_timeout = '2s'");
            expect(log.filter((sql) => sql.includes('UPDATE'))).toHaveLength(1);
        }

        // The recount keeps the stored count's share for unidentified events.
        expect(state.recounts).toEqual([{ issueId: 'issue-1', offset: 10 }]);
        expect(state.redis.get(`${doneKey}:project-1`)).toBe('1');
        expect(state.redis.has(doneKey)).toBe(true);
        expect(state.redis.has(`${doneKey}:offset:issue-1`)).toBe(false);
    });

    it('retries a locked batch, then skips it and leaves the project for the next run', async () => {
        state.rekeyFailures = 3;

        await expect(regradeIssueIdentity({ signal: signal() })).resolves.toBe(false);

        expect(state.rekeyedBatches.map((batch) => batch[0])).toEqual(['event-00500', 'event-01000']);
        expect(state.recounts).toHaveLength(1);
        expect(state.redis.has(`${doneKey}:project-1`)).toBe(false);
        expect(state.redis.has(doneKey)).toBe(false);
        expect(state.redis.get(`${doneKey}:offset:issue-1`)).toBe('10');
    });

    it('succeeds when a locked batch frees up within the retries', async () => {
        state.rekeyFailures = 2;

        await expect(regradeIssueIdentity({ signal: signal() })).resolves.toBe(true);
        expect(state.rekeyedBatches.flat()).toEqual(eventIds(1100));
    });

    it('stops at the next batch when the lease is lost, without recounting', async () => {
        const controller = new AbortController();
        state.onRekey = () => controller.abort();

        await expect(regradeIssueIdentity({ signal: controller.signal })).resolves.toBe(false);

        expect(state.rekeyedBatches).toHaveLength(1);
        expect(state.recounts).toEqual([]);
        expect(state.redis.has(`${doneKey}:project-1`)).toBe(false);
        expect(state.redis.get(`${doneKey}:offset:issue-1`)).toBe('10');
    });

    it('resumes with the offset captured before the interrupted rewrite', async () => {
        state.redis.set(`${doneKey}:offset:issue-1`, '10');
        // Half the events were already re-keyed, so the visible identities changed.
        state.stats.set('issue-1', { user_count: 40, identities: 25 });

        await expect(regradeIssueIdentity({ signal: signal() })).resolves.toBe(true);

        expect(state.statements.some((sql) => sql.includes('SELECT i.user_count'))).toBe(false);
        expect(state.recounts).toEqual([{ issueId: 'issue-1', offset: 10 }]);
    });

    it('skips projects already finished by an earlier pass', async () => {
        state.projects = ['project-1', 'project-2'];
        state.issuesByProject.set('project-2', ['issue-2']);
        state.eventIds.set('issue-2', eventIds(3));
        state.stats.set('issue-2', { user_count: 3, identities: 3 });
        state.redis.set(`${doneKey}:project-1`, '1');

        await expect(regradeIssueIdentity({ signal: signal() })).resolves.toBe(true);

        expect(state.recounts.map((row) => row.issueId)).toEqual(['issue-2']);
    });
});

describe('rekeyEventBatch', () => {
    it('keys events by their live session person key and never touches scrubbed sessions', async () => {
        const log: string[] = [];
        const tx = { execute: async (query: unknown) => { log.push(state.render(query).sql); return { rowCount: 2 }; } };

        await expect(rekeyEventBatch(tx as any, 'project-1', ['event-1', 'event-2'])).resolves.toBe(2);

        const [statement] = log;
        expect(statement).toContain('s.identity_scrubbed_at IS NULL');
        expect(statement).toContain('JOIN sessions s ON s.id = b.session_id');
        expect(statement).toContain('AND e.session_id = keyed.session_id');
        expect(statement).toContain('AND keyed.person IS NOT NULL');
        expect(statement).toContain('e.user_id IS DISTINCT FROM keyed.person');
        // Own user id, then the device's latest user id, then anonymous ids, then device.
        const order = ['bs.user_display_id', 'du.user_id', 'bs.anonymous_hash', 'bs.anonymous_display_id', 'bs.device_id'];
        const coalesce = statement.slice(statement.indexOf('coalesce('));
        const positions = order.map((column) => coalesce.indexOf(column));
        expect(positions.every((position) => position >= 0)).toBe(true);
        expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    });
});
