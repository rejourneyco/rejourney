/**
 * Real-Postgres test harness without Docker.
 *
 * Gives a test an isolated, in-memory PostgreSQL (PGlite: Postgres compiled to
 * WebAssembly, running in this process) with tables created from the repo's
 * own drizzle definitions, plus a small two-tenant seed.
 *
 *   const harness = await createPgliteHarness();          // the MCP tables + seed
 *   const rows = await harness.db.select().from(sessions);
 *   await harness.reset();                                 // back to the seed between tests
 *   await harness.close();
 *
 * How the schema gets there: the repo's `drizzle/` folder has no baseline
 * migration (fresh databases are created with `drizzle-kit push`, see
 * scripts/applyDatabaseSchema.ts), so migrations cannot be replayed from empty.
 * Instead the DDL is generated from `src/db/schema.ts` with drizzle-kit's
 * programmatic API (the same diff engine `push` uses) and executed.
 *
 * Known limits of PGlite (see the spike report): one connection, so no
 * cross-connection concurrency; `statement_timeout` is not enforced; the
 * server version follows the PGlite release, not production.
 */
import { createRequire } from 'node:module';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import * as schema from '../../db/schema.js';

// drizzle-kit 1.0.0-beta.9's ESM build of this entry fails to load
// ("Identifier 'createRequire' has already been declared"); its CJS build works.
const require = createRequire(import.meta.url);
const drizzleKit = require('drizzle-kit/api-postgres') as typeof import('drizzle-kit/api-postgres');

/** The tables the MCP tools read. Their foreign keys only point at each other. */
export const MCP_TABLES = {
    users: schema.users,
    teams: schema.teams,
    teamMembers: schema.teamMembers,
    projects: schema.projects,
    sessions: schema.sessions,
    sessionMetrics: schema.sessionMetrics,
    recordingArtifacts: schema.recordingArtifacts,
    crashes: schema.crashes,
    anrs: schema.anrs,
    errors: schema.errors,
    issues: schema.issues,
    issueEvents: schema.issueEvents,
    mcpOAuthRecords: schema.mcpOAuthRecords,
    mcpGrants: schema.mcpGrants,
    mcpCallLog: schema.mcpCallLog,
    mcpUsagePeriods: schema.mcpUsagePeriods,
} as const;

export type PgliteTableSet = 'mcp' | 'all';

/**
 * Timeout for hooks and tests that start a PGlite instance. Starting the
 * WebAssembly Postgres takes about 1.5 s on an idle machine but is CPU-bound:
 * under a loaded test run it exceeded vitest's 10 s default hook timeout.
 */
export const PGLITE_START_TIMEOUT_MS = 120_000;

const ddlCache = new Map<PgliteTableSet, Promise<string[]>>();

/** CREATE statements for a table set, generated once per process from the drizzle definitions. */
export function schemaStatements(tables: PgliteTableSet): Promise<string[]> {
    let statements = ddlCache.get(tables);
    if (!statements) {
        statements = (async () => {
            const source = tables === 'all' ? schema : MCP_TABLES;
            const empty = await drizzleKit.generateDrizzleJson({});
            const target = await drizzleKit.generateDrizzleJson(source as Record<string, unknown>);
            return drizzleKit.generateMigration(empty, target);
        })();
        ddlCache.set(tables, statements);
    }
    return statements;
}

export interface PgliteSeed {
    userA: { id: string; email: string };
    userB: { id: string; email: string };
    teamA: { id: string; projectId: string; sessionIds: string[] };
    teamB: { id: string; projectId: string; sessionIds: string[] };
}

export const PGLITE_SEED: PgliteSeed = {
    userA: { id: '00000000-0000-4000-8000-0000000000a1', email: 'alice@team-a.example.test' },
    userB: { id: '00000000-0000-4000-8000-0000000000b1', email: 'bob@team-b.example.test' },
    teamA: {
        id: '00000000-0000-4000-8000-0000000000a2',
        projectId: '00000000-0000-4000-8000-0000000000a3',
        sessionIds: ['session_a_1', 'session_a_2', 'session_a_3'],
    },
    teamB: {
        id: '00000000-0000-4000-8000-0000000000b2',
        projectId: '00000000-0000-4000-8000-0000000000b3',
        sessionIds: ['session_b_1', 'session_b_2'],
    },
};

export type PgliteDb = PgliteDatabase<typeof schema>;

/** Two teams, one owner each, one project each, a few sessions with metrics. */
export async function seedTwoTenants(db: PgliteDb): Promise<PgliteSeed> {
    const seed = PGLITE_SEED;
    const baseTime = Date.UTC(2026, 10, 1, 12, 0, 0);

    await db.insert(schema.users).values([
        { id: seed.userA.id, email: seed.userA.email, displayName: 'Alice' },
        { id: seed.userB.id, email: seed.userB.email, displayName: 'Bob' },
    ]);
    await db.insert(schema.teams).values([
        { id: seed.teamA.id, ownerUserId: seed.userA.id, name: 'Team A' },
        { id: seed.teamB.id, ownerUserId: seed.userB.id, name: 'Team B' },
    ]);
    await db.insert(schema.teamMembers).values([
        { teamId: seed.teamA.id, userId: seed.userA.id, role: 'owner' },
        { teamId: seed.teamB.id, userId: seed.userB.id, role: 'owner' },
    ]);
    await db.insert(schema.projects).values([
        { id: seed.teamA.projectId, teamId: seed.teamA.id, name: 'Team A app', platform: 'ios', publicKey: 'pk_test_team_a' },
        { id: seed.teamB.projectId, teamId: seed.teamB.id, name: 'Team B app', platform: 'android', publicKey: 'pk_test_team_b' },
    ]);

    const sessionRows = [
        ...seed.teamA.sessionIds.map((id, index) => ({ id, projectId: seed.teamA.projectId, platform: 'ios', index })),
        ...seed.teamB.sessionIds.map((id, index) => ({ id, projectId: seed.teamB.projectId, platform: 'android', index })),
    ];
    await db.insert(schema.sessions).values(
        sessionRows.map((row) => ({
            id: row.id,
            projectId: row.projectId,
            platform: row.platform,
            appVersion: '1.0.0',
            status: 'ready',
            startedAt: new Date(baseTime + row.index * 60_000),
        })),
    );
    await db.insert(schema.sessionMetrics).values(
        sessionRows.map((row) => ({ sessionId: row.id, totalEvents: 10 + row.index, crashCount: row.index === 0 ? 1 : 0 })),
    );

    return seed;
}

export interface PgliteHarnessOptions {
    /** `'mcp'` (default): the tables the MCP tools read. `'all'`: the whole schema (about 2 s). */
    tables?: PgliteTableSet;
    /** Insert the two-tenant seed. Defaults to true; requires the MCP tables. */
    seed?: boolean;
}

export interface PgliteHarness {
    /** Raw PGlite client, for SQL the query builder does not cover (roles, EXPLAIN, …). */
    client: PGlite;
    db: PgliteDb;
    seed: PgliteSeed;
    /** Empties every table and re-applies the seed. */
    reset(): Promise<void>;
    close(): Promise<void>;
}

export async function createPgliteHarness(options: PgliteHarnessOptions = {}): Promise<PgliteHarness> {
    const tables = options.tables ?? 'mcp';
    const withSeed = options.seed ?? true;

    const client = new PGlite();
    for (const statement of await schemaStatements(tables)) {
        await client.exec(statement);
    }
    const db = drizzle({ client, schema });
    if (withSeed) await seedTwoTenants(db);

    return {
        client,
        db,
        seed: PGLITE_SEED,
        async reset() {
            const existing = await client.query<{ tablename: string }>(
                "select tablename from pg_tables where schemaname = 'public'",
            );
            if (existing.rows.length > 0) {
                const names = existing.rows.map((row) => `"${row.tablename}"`).join(', ');
                await client.exec(`truncate table ${names} restart identity cascade`);
            }
            if (withSeed) await seedTwoTenants(db);
        },
        async close() {
            await client.close();
        },
    };
}
