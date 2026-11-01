/**
 * User counts keyed by person (see personIdentity) against real PostgreSQL. Run with
 * PERSON_IDENTITY_TEST_DATABASE_URL pointing at a disposable database that has the
 * schema pushed (`DATABASE_URL=... npx drizzle-kit push --force`); rows are written
 * as a fixture and removed afterwards.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Raw timestamp columns parse in local time; production runs in UTC.
vi.hoisted(() => { process.env.TZ = 'UTC'; });

const url = process.env.PERSON_IDENTITY_TEST_DATABASE_URL;
const today = new Date().toISOString().slice(0, 10);

vi.mock('../db/client.js', async () => {
    const schema = await import('../db/schema.js');
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const pg = (await import('pg')).default;
    const pool = new pg.Pool({ connectionString: process.env.PERSON_IDENTITY_TEST_DATABASE_URL || 'postgres://localhost:1/none', max: 4 });
    const db = drizzle({ client: pool, schema });
    return { ...schema, db, dbRead: db, pool };
});
vi.mock('../db/redis.js', () => ({
    getRedis: () => ({
        get: async (key: string) => (key === 'stats:daily_rollup:last_rolled_up_date' ? new Date().toISOString().slice(0, 10) : null),
        set: async () => 'OK',
        del: async () => 1,
    }),
}));
vi.mock('../db/clickhouse.js', () => ({ getClickHouseClient: vi.fn(), isClickHouseReadsEnabled: () => false }));
vi.mock('../db/s3.js', () => ({ deleteFromS3: vi.fn(), downloadFromS3ForArtifact: vi.fn(), uploadToS3: vi.fn() }));
vi.mock('../services/engagementSegments.js', () => ({ gradeEngagementByCountry: vi.fn(async () => new Map()), gradeEngagementByDay: vi.fn(async () => []) }));

import { pool } from '../db/client.js';
import insightsRoutes from '../routes/dashboardInsights.js';
import overviewRoutes from '../routes/dashboardOverview.js';
import analyticsRoutes from '../routes/analytics.js';
import stabilityRoutes from '../routes/stability.js';
import anrRoutes from '../routes/anrs.js';

const USER = '00000000-0000-4000-8000-0000000000a1';
const TEAM = '00000000-0000-4000-8000-0000000000b1';
const PROJECT = '00000000-0000-4000-8000-0000000000c1';

function at(daysAgo: number, hour = 12): string {
    const date = new Date(`${today}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() - daysAgo);
    date.setUTCHours(hour);
    return date.toISOString();
}

type RouteStack = { stack: Array<{ route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: Function }> } }> };

async function call(router: unknown, path: string, query: Record<string, string>, params: Record<string, string> = {}): Promise<any> {
    const layer = (router as RouteStack).stack.find((candidate) => candidate.route?.path === path && candidate.route.methods.get);
    if (!layer?.route) throw new Error(`route ${path} not found`);
    const handler = layer.route.stack[layer.route.stack.length - 1].handle;
    return new Promise((resolve, reject) => {
        const res = { setHeader: () => undefined, json: resolve, status: () => res };
        const req = { query, params, user: { id: USER }, headers: {}, get: () => undefined };
        handler(req, res, (err?: unknown) => (err ? reject(err) : reject(new Error('next() without response'))));
    });
}

describe.skipIf(!url)('person-keyed user counts (PostgreSQL)', () => {
    beforeAll(async () => {
        await pool.query(`
            INSERT INTO users (id, email) VALUES ('${USER}', 'person-identity@test.local');
            INSERT INTO teams (id, owner_user_id) VALUES ('${TEAM}', '${USER}');
            INSERT INTO team_members (team_id, user_id) VALUES ('${TEAM}', '${USER}');
            INSERT INTO projects (id, team_id, name, public_key) VALUES ('${PROJECT}', '${TEAM}', 'Person test', 'pk_person_identity');
        `);
        // Alice records on dev-a before (s1) and after (s2) signing in; Bob is signed in;
        // Carol never signs in; a web visitor has no device at all.
        const rows: Array<[string, string, string, string | null, string | null, string | null]> = [
            ['pi-s1', at(3), 'ios', null, 'dev-a', null],
            ['pi-s2', at(2), 'ios', 'alice', 'dev-a', null],
            ['pi-s3', at(1), 'ios', 'bob', 'dev-b', null],
            ['pi-s4', at(1), 'ios', null, 'dev-c', null],
            ['pi-w1', at(1), 'web', null, null, 'anon-web'],
        ];
        for (const [id, startedAt, platform, user, device, anon] of rows) {
            await pool.query(
                `INSERT INTO sessions (id, project_id, started_at, platform, user_display_id, device_id, anonymous_hash,
                    geo_country, geo_city, geo_latitude, geo_longitude, replay_available, status)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, 'US', 'Austin', 30.2, -97.7, true, 'ready')`,
                [id, PROJECT, startedAt, platform, user, device, anon],
            );
            await pool.query('INSERT INTO session_metrics (session_id) VALUES ($1)', [id]);
        }
        // The same crash and ANR hit Alice before and after sign-in.
        for (const sessionId of ['pi-s1', 'pi-s2']) {
            const timestamp = sessionId === 'pi-s1' ? at(3, 13) : at(2, 13);
            await pool.query(`INSERT INTO crashes (project_id, session_id, timestamp, exception_name, reason, stack_trace)
                VALUES ($1, $2, $3, 'NSInternalInconsistencyException', 'boom', 'frame A\nframe B')`, [PROJECT, sessionId, timestamp]);
            await pool.query(`INSERT INTO anrs (project_id, session_id, timestamp, duration_ms, thread_state)
                VALUES ($1, $2, $3, 5000, 'main\n  at com.example.Slow.run')`, [PROJECT, sessionId, timestamp]);
            await pool.query(`INSERT INTO errors (project_id, session_id, timestamp, error_type, error_name, message)
                VALUES ($1, $2, $3, 'js', 'TypeError', 'x is undefined')`, [PROJECT, sessionId, timestamp]);
        }
    });

    afterAll(async () => {
        await pool.query(`
            DELETE FROM errors WHERE project_id = '${PROJECT}';
            DELETE FROM anrs WHERE project_id = '${PROJECT}';
            DELETE FROM crashes WHERE project_id = '${PROJECT}';
            DELETE FROM session_metrics WHERE session_id LIKE 'pi-%';
            DELETE FROM sessions WHERE project_id = '${PROJECT}';
            DELETE FROM projects WHERE id = '${PROJECT}';
            DELETE FROM team_members WHERE team_id = '${TEAM}';
            DELETE FROM teams WHERE id = '${TEAM}';
            DELETE FROM users WHERE id = '${USER}';
        `);
        await pool.end();
    });

    it('retention cohorts count a pre-sign-in session as its user', async () => {
        const body = await call(insightsRoutes, '/retention-cohorts', { projectId: PROJECT, timeRange: '30d' });
        expect(body.rows.reduce((sum: number, row: { users: number }) => sum + row.users, 0)).toBe(4);
    });

    it('live trends count DAU and MAU by person', async () => {
        const body = await call(insightsRoutes, '/trends', { projectId: PROJECT, timeRange: '7d', platform: 'ios' });
        const byDate = new Map(body.daily.map((day: { date: string }) => [day.date, day]));
        expect((byDate.get(at(3).slice(0, 10)) as any).dau).toBe(1);
        expect((byDate.get(at(1).slice(0, 10)) as any).dau).toBe(2);
        expect((byDate.get(today) as any).mau).toBe(3);
    });

    it('geo issues count unique users by person', async () => {
        const body = await call(analyticsRoutes, '/geo-issues', { projectId: PROJECT, timeRange: '30d' });
        expect(body.countries[0].uniqueUsers).toBe(4);
    });

    it('top users group pre- and post-sign-in sessions under the user', async () => {
        const body = await call(overviewRoutes, '/general/heavy', { projectId: PROJECT, timeRange: '30d', section: 'topUsers' });
        expect(body.topUsers).toHaveLength(4);
        const alice = body.topUsers.find((row: any) => row.latestSession.userId === 'alice');
        expect(alice.sessionCount).toBe(2);
        expect(alice.latestSession.id).toBe('pi-s2');
        // First appeared counts the pre-sign-in session.
        expect(new Date(alice.userFirstSeenAt).toISOString()).toBe(at(3));
    });

    it('session preview first-seen follows the person', async () => {
        const body = await call(overviewRoutes, '/general/heavy', { projectId: PROJECT, timeRange: '30d', section: 'sessions' });
        const s2 = body.sessions.find((row: any) => row.id === 'pi-s2');
        const s1 = body.sessions.find((row: any) => row.id === 'pi-s1');
        expect(new Date(s2.userFirstSeenAt).toISOString()).toBe(at(3));
        expect(s1.userFirstSeenAt).toBe(s2.userFirstSeenAt);
    });

    it('errors and crashes overview count one impacted person', async () => {
        const errorsBody = await call(overviewRoutes, '/errors', { projectId: PROJECT, timeRange: '30d' });
        expect(errorsBody.summary.users).toBe(1);
        const crashesBody = await call(overviewRoutes, '/crashes', { projectId: PROJECT, timeRange: '30d' });
        expect(crashesBody.summary.users).toBe(1);
    });

    it('ANR list counts one user per person and reports distinct totals', async () => {
        const body = await call(anrRoutes, '/projects/:projectId/anrs', { timeRange: '30d' }, { projectId: PROJECT });
        expect(body.anrs[0].userCount).toBe(1);
        expect(body.totalUsers).toBe(1);
    });

    it('stability issues and session health count people', async () => {
        const body = await call(stabilityRoutes, '/projects/:projectId/stability/issues', { timeRange: '30d', types: 'crash' }, { projectId: PROJECT });
        expect(body.issues[0].userCount).toBe(1);
        expect(body.summary.users).toBe(1);
        expect(body.summary.totalUsers).toBe(4);
        expect(body.summary.crashFreeUsers).toBe(3);
    });
});
