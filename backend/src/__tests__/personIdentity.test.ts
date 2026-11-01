import { describe, expect, it } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { createPersonResolver, deviceUserCteSql, personKeySql, sessionPersonColumns } from '../services/personIdentity.js';

describe('person identity', () => {
    it('merges pre-sign-in sessions into the user signed in on that device', () => {
        const rows = [
            { sessionId: 's1', deviceId: 'dev-a', startedAt: '2026-10-31T08:00:00Z' },
            { sessionId: 's2', deviceId: 'dev-a', userDisplayId: 'user-1', startedAt: '2026-10-31T08:05:00Z' },
            { sessionId: 's3', deviceId: 'dev-b', userDisplayId: 'user-1', startedAt: '2026-10-31T09:00:00Z' },
            { sessionId: 's4', deviceId: 'dev-c', startedAt: '2026-10-31T09:00:00Z' },
            { sessionId: 's5', anonymousHash: 'anon-1' },
            { sessionId: 's6' },
        ];
        const resolve = createPersonResolver(rows);
        expect(rows.map(resolve)).toEqual(['user-1', 'user-1', 'user-1', 'dev-c', 'anon-1', 's6']);
        expect(new Set(rows.map(resolve)).size).toBe(4);
    });

    it('attributes anonymous sessions to the most recent user on a shared device', () => {
        const resolve = createPersonResolver([
            { deviceId: 'dev', userDisplayId: 'old', startedAt: 1 },
            { deviceId: 'dev', userDisplayId: 'new', startedAt: 2 },
        ]);
        expect(resolve({ deviceId: ' dev ' })).toBe('new');
        expect(resolve({ deviceId: 'dev', userDisplayId: 'old' })).toBe('old');
    });

    it('never maps a device across projects', () => {
        const resolve = createPersonResolver([
            { projectId: 'app-a', deviceId: 'ios-vendor-id', userDisplayId: 'user-1', startedAt: 1 },
        ]);
        expect(resolve({ projectId: 'app-a', deviceId: 'ios-vendor-id' })).toBe('user-1');
        expect(resolve({ projectId: 'app-b', deviceId: 'ios-vendor-id' })).toBe('ios-vendor-id');
    });

    it('builds the same rule in SQL', () => {
        const columns = sessionPersonColumns('s');
        const query = new PgDialect().sqlToQuery(sql`WITH device_user AS (${deviceUserCteSql(sql`dus.project_id = ${'p1'}`)})
            SELECT ${personKeySql(columns, sql`du.user_id`)} FROM sessions s LEFT JOIN device_user du ON du.device = nullif(trim(s.device_id), '')`);
        expect(query.sql).toMatch(/coalesce\(\s*nullif\(trim\(s\.user_display_id\), ''\),\s*du\.user_id,\s*nullif\(trim\(s\.anonymous_hash\), ''\)/);
        expect(query.sql).toContain('DISTINCT ON (dus.project_id, nullif(trim(dus.device_id), \'\'))');
        expect(query.sql).toContain('ORDER BY dus.project_id, nullif(trim(dus.device_id), \'\'), dus.started_at DESC');
        expect(query.params).toEqual(['p1']);
    });
});
