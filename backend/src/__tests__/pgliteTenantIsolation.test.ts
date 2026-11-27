/**
 * Example integration test on the PGlite harness: tenant isolation checked at
 * the SQL level against a real (in-process) PostgreSQL, using the repo's own
 * drizzle table definitions. No Docker, no network.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { projects, sessionMetrics, sessions, teamMembers } from '../db/schema.js';
import { PGLITE_START_TIMEOUT_MS, createPgliteHarness, schemaStatements } from './helpers/pgliteHarness.js';
import type { PgliteHarness } from './helpers/pgliteHarness.js';

let harness: PgliteHarness;

beforeAll(async () => {
    harness = await createPgliteHarness();
}, PGLITE_START_TIMEOUT_MS);

afterAll(async () => {
    await harness.close();
});

beforeEach(async () => {
    await harness.reset();
});

/** The project ids a user may read: the projects of the teams they belong to. */
async function projectIdsForUser(userId: string): Promise<string[]> {
    const rows = await harness.db
        .select({ id: projects.id })
        .from(projects)
        .innerJoin(teamMembers, eq(teamMembers.teamId, projects.teamId))
        .where(eq(teamMembers.userId, userId));
    return rows.map((row) => row.id);
}

describe('PGlite harness', () => {
    it('runs a real PostgreSQL with the seeded tenants', async () => {
        const version = await harness.client.query<{ version: string }>('select version()');
        expect(version.rows[0].version).toMatch(/^PostgreSQL \d+/);

        const all = await harness.db.select({ id: sessions.id }).from(sessions);
        expect(all).toHaveLength(harness.seed.teamA.sessionIds.length + harness.seed.teamB.sessionIds.length);
    });

    it("a query scoped to team A's project ids returns none of team B's sessions", async () => {
        const { teamA, teamB, userA } = harness.seed;
        const projectIds = await projectIdsForUser(userA.id);
        expect(projectIds).toEqual([teamA.projectId]);

        const rows = await harness.db
            .select({ id: sessions.id, projectId: sessions.projectId, crashCount: sessionMetrics.crashCount })
            .from(sessions)
            .innerJoin(sessionMetrics, eq(sessionMetrics.sessionId, sessions.id))
            .where(inArray(sessions.projectId, projectIds));

        expect(rows.map((row) => row.id).sort()).toEqual([...teamA.sessionIds].sort());
        expect(rows.every((row) => row.projectId === teamA.projectId)).toBe(true);
        for (const foreignSessionId of teamB.sessionIds) {
            expect(rows.map((row) => row.id)).not.toContain(foreignSessionId);
        }
    });

    it("asking for team B's session by id under team A's scope finds nothing", async () => {
        const { teamB, userA } = harness.seed;
        const projectIds = await projectIdsForUser(userA.id);

        const rows = await harness.db
            .select({ id: sessions.id })
            .from(sessions)
            .where(and(eq(sessions.id, teamB.sessionIds[0]), inArray(sessions.projectId, projectIds)));

        expect(rows).toEqual([]);
    });

    it('removing a member removes their project scope at once', async () => {
        const { teamA, userA } = harness.seed;
        await harness.db.delete(teamMembers).where(and(eq(teamMembers.teamId, teamA.id), eq(teamMembers.userId, userA.id)));
        expect(await projectIdsForUser(userA.id)).toEqual([]);
    });

    it('reset() restores the seed, so tests cannot leak rows into each other', async () => {
        // The previous test deleted a membership; beforeEach reset it.
        expect(await projectIdsForUser(harness.seed.userA.id)).toEqual([harness.seed.teamA.projectId]);
    });

    it('enforces real constraints (foreign keys, unique indexes)', async () => {
        await expect(
            harness.db.insert(sessions).values({ id: 'orphan', projectId: '00000000-0000-4000-8000-00000000dead' }),
        ).rejects.toThrow();
        await expect(
            harness.db.insert(projects).values({ teamId: harness.seed.teamB.id, name: 'Duplicate key', publicKey: 'pk_test_team_a' }),
        ).rejects.toThrow();
    });

    it('gives every harness its own database', async () => {
        const other = await createPgliteHarness();
        try {
            await other.db.delete(sessionMetrics);
            await other.db.delete(sessions);
            expect(await other.db.select({ id: sessions.id }).from(sessions)).toEqual([]);
            expect((await harness.db.select({ id: sessions.id }).from(sessions)).length).toBeGreaterThan(0);
        } finally {
            await other.close();
        }
    }, PGLITE_START_TIMEOUT_MS);

    it('supports a least-privilege role with row-level security (a second lock under the code)', async () => {
        const { teamA, teamB } = harness.seed;
        await harness.client.exec(`
            create role mcp_reader nologin;
            grant select on projects, sessions, session_metrics to mcp_reader;
            alter table sessions enable row level security;
            create policy mcp_sessions_by_project on sessions for select to mcp_reader
                using (project_id = any (string_to_array(current_setting('app.mcp_project_ids', true), ',')::uuid[]));
        `);
        try {
            await harness.client.exec(`set role mcp_reader; set app.mcp_project_ids = '${teamA.projectId}';`);

            // Even an unscoped query sees only the granted project's rows.
            const visible = await harness.client.query<{ id: string }>('select id from sessions order by id');
            expect(visible.rows.map((row) => row.id)).toEqual([...teamA.sessionIds].sort());
            expect(visible.rows.map((row) => row.id)).not.toContain(teamB.sessionIds[0]);

            // Tables outside the grant are unreadable whatever the code does.
            await expect(harness.client.query('select email from users')).rejects.toThrow(/permission denied for table users/);
            await expect(harness.client.query("update sessions set status = 'x'")).rejects.toThrow(/permission denied/);
        } finally {
            await harness.client.exec(`
                reset role;
                reset app.mcp_project_ids;
                drop policy mcp_sessions_by_project on sessions;
                alter table sessions disable row level security;
                revoke all on projects, sessions, session_metrics from mcp_reader;
                drop role mcp_reader;
            `);
        }
    });

    it('can create the whole production schema, GIN indexes included', async () => {
        const statements = await schemaStatements('all');
        expect(statements.filter((statement) => /USING gin/i.test(statement)).length).toBeGreaterThan(0);

        const full = await createPgliteHarness({ tables: 'all', seed: false });
        try {
            const tables = await full.client.query<{ count: number }>(
                "select count(*)::int as count from information_schema.tables where table_schema = 'public'",
            );
            const gin = await full.client.query<{ count: number }>(
                "select count(*)::int as count from pg_indexes where schemaname = 'public' and indexdef ilike '%using gin%'",
            );
            expect(tables.rows[0].count).toBeGreaterThan(40);
            expect(gin.rows[0].count).toBeGreaterThan(0);
        } finally {
            await full.close();
        }
    }, PGLITE_START_TIMEOUT_MS);
});
