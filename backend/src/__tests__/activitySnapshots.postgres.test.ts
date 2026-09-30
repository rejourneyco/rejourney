/** Run against a disposable PostgreSQL database with ACTIVITY_TEST_DATABASE_URL. */
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import pg from 'pg';
const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../db/client.js', () => ({ pool: { query: mocks.query } }));
vi.mock('../services/retentionAudit.js', () => ({ beginRetentionDeletionLog: vi.fn(), finalizeRetentionDeletionLog: vi.fn() }));
vi.mock('../logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn() } }));
vi.mock('../services/visitorLedger.js', () => ({ computeVisitorKey: (_project: string, identity: string) => identity.padEnd(40, '_') }));
import { scrubSessionIdentityRows } from '../services/sessionIdentityScrub.js';
import { snapshotActivityDay } from '../services/activitySnapshots.js';

const url = process.env.ACTIVITY_TEST_DATABASE_URL;
describe.skipIf(!url)('activity snapshots PostgreSQL regression', () => {
    it('preserves exact scoped counts after expiry and historical reruns', async () => {
        const client = new pg.Client({ connectionString: url });
        await client.connect();
        try {
            await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
            await client.query('CREATE SCHEMA activity_snapshot_test');
            await client.query('SET LOCAL search_path TO activity_snapshot_test');
            await client.query(`
                CREATE TABLE projects (id uuid PRIMARY KEY);
                CREATE TABLE project_visitors (id uuid PRIMARY KEY, project_id uuid REFERENCES projects(id) ON DELETE CASCADE, visitor_key varchar, expires_at timestamp);
                CREATE TABLE sessions (visitor_key varchar, id varchar PRIMARY KEY, project_id uuid, started_at timestamp,
                    platform varchar, user_display_id varchar, anonymous_hash varchar,
                    anonymous_display_id varchar, device_id varchar, identity_scrubbed_at timestamp,
                    app_version varchar, geo_country varchar, geo_city varchar, geo_region varchar,
                    geo_latitude double precision, geo_longitude double precision, geo_timezone varchar,
                    events jsonb, metadata jsonb, raw_events_deleted_at timestamp, identity_scrub_version integer,
                    updated_at timestamp);
                INSERT INTO projects VALUES ('00000000-0000-0000-0000-000000000001');
                INSERT INTO sessions (id,project_id,started_at,platform,user_display_id,app_version,geo_country) VALUES
                    ('a1','00000000-0000-0000-0000-000000000001','2026-09-01','ios','alice','v1','US'),
                    ('a2','00000000-0000-0000-0000-000000000001','2026-09-02','ios','alice','v1','US'),
                    ('b1','00000000-0000-0000-0000-000000000001','2026-09-02','android','bob','v2','CA'),
                    ('c1','00000000-0000-0000-0000-000000000001','2026-09-02','web','charlie','v1','US'),
                    ('old','00000000-0000-0000-0000-000000000001','2026-08-03','ios','expired-window','v1','US');
            `);
            await client.query(readFileSync(new URL('../../drizzle/20260930120000_activity_snapshots/migration.sql', import.meta.url), 'utf8'));
            const project = '00000000-0000-0000-0000-000000000001';
            const read = async () => (await client.query(`SELECT dau,mau,dau_complete,mau_complete,version_dau,country_dau
                FROM activity_snapshots WHERE platform='mobile' AND date='2026-09-02'`)).rows[0];
            await snapshotActivityDay(project, '2026-09-02', client);
            const before = await read();
            expect(before).toEqual({ dau: 2, mau: 2, dau_complete: true, mau_complete: true,
                version_dau: { v1: 1, v2: 1 }, country_dau: { US: 1, CA: 1 } });
            expect((await client.query("SELECT dau,mau FROM activity_snapshots WHERE platform='all'")).rows[0]).toEqual({ dau: 3, mau: 3 });
            await client.query("UPDATE sessions SET user_display_id=NULL,identity_scrubbed_at=now() WHERE platform='ios'");
            await snapshotActivityDay(project, '2026-09-02', client);
            expect(await read()).toEqual(before);
            await snapshotActivityDay(project, '2026-09-03', client);
            expect((await client.query("SELECT dau_complete,mau_complete FROM activity_snapshots WHERE platform='mobile' AND date='2026-09-03'")).rows[0])
                .toEqual({ dau_complete: true, mau_complete: false });
            // A seven-day session tier must still have exact current MAU while
            // its existing 90-day visitor ledger is retained.
            await client.query('DELETE FROM sessions; DELETE FROM activity_snapshots');
            await client.query(`
                INSERT INTO project_visitors VALUES
                    ('00000000-0000-0000-0000-000000000002', '${project}', 'alice-key', now() + interval '90 days'),
                    ('00000000-0000-0000-0000-000000000003', '${project}', 'bob-key', now() + interval '90 days');
                INSERT INTO sessions (id, project_id, started_at, platform, user_display_id, visitor_key) VALUES
                    ('old-alice', '${project}', current_date - 20, 'ios', 'alice', 'alice-key'),
                    ('old-bob', '${project}', current_date - 20, 'ios', 'bob', 'bob-key'),
                    ('new-alice', '${project}', current_date - 1, 'ios', 'alice', 'alice-key');
            `);
            const dates = (await client.query("SELECT (current_date - 20)::text AS old, (current_date - 1)::text AS recent")).rows[0];
            await snapshotActivityDay(project, dates.old, client);
            await client.query("UPDATE sessions SET user_display_id = NULL, visitor_key = NULL, identity_scrubbed_at = now() WHERE id LIKE 'old-%'");
            await snapshotActivityDay(project, dates.recent, client);
            expect((await client.query("SELECT dau,mau,mau_complete FROM activity_snapshots WHERE date=$1 AND platform='mobile'", [dates.recent])).rows[0])
                .toEqual({ dau: 1, mau: 2, mau_complete: true });
            await client.query("DELETE FROM project_visitors WHERE visitor_key='bob-key'");
            expect((await client.query("SELECT count(*)::int AS n FROM visitor_activity_days WHERE identity_key LIKE 'bob%' ")).rows[0].n).toBe(0);
            // Erasing by a session's anonymous alias must remove participation
            // even though the stored analytics hash came from its identified ID.
            await client.query("UPDATE sessions SET anonymous_display_id='alternate-id' WHERE id='new-alice'");
            mocks.query.mockImplementation(async (query: string, params: unknown[]) =>
                query.includes('removed_participation') ? client.query(query, params) : { rows: [], rowCount: 0 });
            const erased = await scrubSessionIdentityRows(['new-alice']);
            expect(erased.scrubbed).toBe(1);
            expect((await client.query('SELECT count(*)::int AS n FROM visitor_activity_days')).rows[0].n).toBe(0);
            expect((await client.query("SELECT user_display_id,anonymous_display_id FROM sessions WHERE id='new-alice'")).rows[0])
                .toEqual({ user_display_id: null, anonymous_display_id: null });
            // Project deletion still removes the durable aggregates.
            await client.query('DELETE FROM projects');
            expect((await client.query('SELECT * FROM activity_snapshots')).rowCount).toBe(0);
        } finally {
            await client.query('ROLLBACK');
            await client.end();
        }
    });
});
