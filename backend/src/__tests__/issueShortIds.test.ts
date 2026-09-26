import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

// A fake database whose transactions really serialize on pg_advisory_xact_lock keys and
// whose reads yield, so concurrent inserts interleave the way they do in production.
const { rows, statements, fakeDb } = vi.hoisted(() => {
    // Hoisted code runs before imports resolve, so the dialect is created on first use.
    let dialect: PgDialect | undefined;
    const render = (query: unknown) => (dialect ??= new PgDialect()).sqlToQuery(query as SQL);
    const rows: Array<Record<string, any>> = [];
    const statements: string[] = [];
    const locks = new Map<string, Promise<void>>();
    const tick = () => new Promise((resolve) => setTimeout(resolve, 1));
    const fakeDb = {
        transaction: async <T>(fn: (tx: any) => Promise<T>): Promise<T> => {
            const held: Array<() => void> = [];
            const tx = {
                execute: async (query: unknown) => {
                    const { sql, params } = render(query);
                    statements.push(sql);
                    if (!sql.includes('pg_advisory_xact_lock')) return;
                    const key = String(params[0]);
                    const previous = locks.get(key) ?? Promise.resolve();
                    let release!: () => void;
                    const current = new Promise<void>((resolve) => { release = resolve; });
                    locks.set(key, previous.then(() => current));
                    await previous;
                    held.push(release);
                },
                select: (fields: Record<string, unknown>) => ({
                    from: () => ({
                        where: async (condition: unknown) => {
                            statements.push(render(fields.number).sql);
                            const projectId = render(condition).params[0];
                            await tick();
                            const numbers = rows
                                .filter((row) => row.projectId === projectId)
                                .map((row) => /-([0-9]+)$/.exec(row.shortId)?.[1])
                                .filter((value): value is string => value !== undefined)
                                .map(Number);
                            return [{ number: numbers.length ? String(Math.max(...numbers)) : null }];
                        },
                    }),
                }),
                insert: () => ({
                    values: (values: Record<string, any>) => ({
                        onConflictDoNothing: () => ({
                            returning: async () => {
                                await tick();
                                if (rows.some((row) => row.projectId === values.projectId && row.fingerprint === values.fingerprint)) return [];
                                rows.push(values);
                                return [{ id: `issue-${rows.length}` }];
                            },
                        }),
                    }),
                }),
            };
            try { return await fn(tx); } finally { held.forEach((release) => release()); }
        },
    };
    return { rows, statements, fakeDb };
});

vi.mock('../db/client.js', async () => ({ ...(await vi.importActual<object>('../db/schema.js')), db: fakeDb }));
vi.mock('../logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { insertIssueWithShortId, issueShortIdPrefix } from '../services/issueTracker.js';

const issue = (fingerprint: string, projectId = 'project-1') => ({ projectId, fingerprint, issueType: 'error', title: fingerprint }) as any;

describe('issue short IDs', () => {
    beforeEach(() => {
        rows.length = 0;
        statements.length = 0;
    });

    it('gives issues created at the same time distinct numbers', async () => {
        const created = await Promise.all(['a', 'b', 'c', 'd'].map((fingerprint) => insertIssueWithShortId(issue(fingerprint), 'MATRIX')));
        expect(created.map((row) => row?.shortId).sort()).toEqual(['MATRIX-1', 'MATRIX-2', 'MATRIX-3', 'MATRIX-4']);
        expect(statements[0]).toBe('select pg_advisory_xact_lock(hashtextextended($1, 0))');
        expect(statements).toContain(`max(substring("issues"."short_id" from '-([0-9]+)$')::bigint)`);
    });

    it('continues after the highest number, not the row count, and across renames', async () => {
        rows.push(
            { projectId: 'project-1', fingerprint: 'x', shortId: 'OLD-NAME-7' },
            { projectId: 'project-1', fingerprint: 'y', shortId: 'MATRIX-2' },
            { projectId: 'project-2', fingerprint: 'z', shortId: 'OTHER-40' },
        );
        expect((await insertIssueWithShortId(issue('new'), 'MATRIX'))?.shortId).toBe('MATRIX-8');
        expect((await insertIssueWithShortId(issue('new', 'project-2'), 'OTHER'))?.shortId).toBe('OTHER-41');
    });

    it('returns null for a fingerprint the project already has', async () => {
        rows.push({ projectId: 'project-1', fingerprint: 'dup', shortId: 'MATRIX-1' });
        expect(await insertIssueWithShortId(issue('dup'), 'MATRIX')).toBeNull();
        expect(rows).toHaveLength(1);
    });

    it('derives the prefix from the project name', () => {
        expect(issueShortIdPrefix('Matrix - Unity Arcade Lab')).toBe('MATRIX---UNITY-ARCAD');
        expect(issueShortIdPrefix(null)).toBe('PROJECT');
    });
});
