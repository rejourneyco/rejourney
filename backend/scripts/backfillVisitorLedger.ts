/**
 * Backfill the pseudonymous visitor ledger from existing, unscrubbed sessions.
 *
 * For every session that still carries an identity but no visitor_session_ordinal,
 * this script:
 *   1. derives the visitor identity with the same device-first ladder as ingest,
 *   2. computes the HMAC visitor key in Node (the secret never reaches SQL),
 *   3. upserts project_visitors (first/last seen, session count, expires_at),
 *   4. stamps sessions.visitor_key and visitor_session_ordinal ranked by started_at.
 *
 * Idempotent: only rows with visitor_session_ordinal IS NULL are touched, and the
 * ordinal is offset by any count the ledger already holds, so it is safe to run
 * before and again after VISITOR_LEDGER_WRITE_ENABLED is switched on.
 *
 * Usage:
 *   node --import tsx scripts/backfillVisitorLedger.ts [--project=<uuid>] [--batch=5000] [--dry-run]
 */

import { pool } from '../src/db/client.js';
import { logger } from '../src/logger.js';
import {
    VISITOR_IDENTITY_SQL,
    computeVisitorKey,
    resolveEffectiveVisitorRetentionDays,
} from '../src/services/visitorLedger.js';

function parseOption(name: string): string | null {
    const valueArg = process.argv.find((arg) => arg.startsWith(`${name}=`));
    if (!valueArg) return null;
    return valueArg.slice(name.length + 1);
}

const DRY_RUN = process.argv.includes('--dry-run');
const ONLY_PROJECT = parseOption('--project');
const BATCH = Math.max(100, Math.min(Number(parseOption('--batch') ?? 5000) || 5000, 20_000));

type ProjectRow = {
    id: string;
    window_days: number | string | null;
    retention_days: number | string | null;
};

type IdentityRow = { identity: string };

async function loadProjects(): Promise<ProjectRow[]> {
    const result = await pool.query<ProjectRow>(
        `
        SELECT p.id,
               t.visitor_identity_retention_days AS window_days,
               COALESCE(rp.retention_days, 7) AS retention_days
        FROM projects p
        INNER JOIN teams t ON t.id = p.team_id
        LEFT JOIN retention_policies rp ON rp.tier = t.retention_tier
        WHERE p.deleted_at IS NULL
          AND ($1::uuid IS NULL OR p.id = $1::uuid)
        ORDER BY p.id
        `,
        [ONLY_PROJECT],
    );
    return result.rows;
}

async function loadIdentityChunk(projectId: string, cursor: string | null): Promise<string[]> {
    const result = await pool.query<IdentityRow>(
        `
        SELECT DISTINCT ${VISITOR_IDENTITY_SQL} AS identity
        FROM sessions
        WHERE project_id = $1
          AND identity_scrubbed_at IS NULL
          AND visitor_session_ordinal IS NULL
          AND ${VISITOR_IDENTITY_SQL} IS NOT NULL
          AND ($2::text IS NULL OR ${VISITOR_IDENTITY_SQL} > $2::text)
        ORDER BY 1
        LIMIT $3
        `,
        [projectId, cursor, BATCH],
    );
    return result.rows.map((row) => row.identity);
}

async function applyChunk(projectId: string, identities: string[], effectiveDays: number): Promise<{ sessions: number; visitors: number }> {
    const keys = identities.map((identity) => computeVisitorKey(projectId, identity));
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Rank every unassigned session of these identities by started_at and roll the
        // per-visitor aggregates into the ledger, offsetting by any existing count.
        const ledger = await client.query<{ visitors: number | string }>(
            `
            WITH pairs AS (
                SELECT * FROM unnest($2::text[], $3::text[]) AS p(identity, visitor_key)
            ),
            ranked AS (
                SELECT s.id,
                       p.visitor_key,
                       s.started_at,
                       row_number() OVER (PARTITION BY p.visitor_key ORDER BY s.started_at, s.id) AS rn
                FROM sessions s
                INNER JOIN pairs p ON p.identity = ${VISITOR_IDENTITY_SQL.replace(/\b(device_id|anonymous_hash|anonymous_display_id|user_display_id)\b/g, 's.$1')}
                WHERE s.project_id = $1
                  AND s.identity_scrubbed_at IS NULL
                  AND s.visitor_session_ordinal IS NULL
            ),
            agg AS (
                SELECT visitor_key,
                       min(started_at) AS first_seen_at,
                       max(started_at) AS last_seen_at,
                       count(*)::int AS session_count
                FROM ranked
                GROUP BY visitor_key
            ),
            upserted AS (
                INSERT INTO project_visitors (project_id, visitor_key, first_seen_at, last_seen_at, session_count, expires_at)
                SELECT $1, a.visitor_key, a.first_seen_at, a.last_seen_at, a.session_count,
                       a.last_seen_at + ($4::int * INTERVAL '1 day')
                FROM agg a
                ON CONFLICT (project_id, visitor_key) DO UPDATE SET
                    first_seen_at = LEAST(project_visitors.first_seen_at, EXCLUDED.first_seen_at),
                    last_seen_at = GREATEST(project_visitors.last_seen_at, EXCLUDED.last_seen_at),
                    session_count = project_visitors.session_count + EXCLUDED.session_count,
                    expires_at = GREATEST(project_visitors.last_seen_at, EXCLUDED.last_seen_at) + ($4::int * INTERVAL '1 day'),
                    updated_at = NOW()
                RETURNING visitor_key, session_count - (SELECT session_count FROM agg WHERE agg.visitor_key = project_visitors.visitor_key) AS prior_count
            ),
            stamped AS (
                UPDATE sessions s
                SET visitor_key = r.visitor_key,
                    visitor_session_ordinal = u.prior_count + r.rn,
                    updated_at = NOW()
                FROM ranked r
                INNER JOIN upserted u ON u.visitor_key = r.visitor_key
                WHERE s.id = r.id
                  AND s.visitor_session_ordinal IS NULL
                RETURNING s.id
            )
            SELECT (SELECT count(*) FROM upserted) AS visitors, (SELECT count(*) FROM stamped) AS sessions
            `,
            [projectId, identities, keys, effectiveDays],
        );

        if (DRY_RUN) {
            await client.query('ROLLBACK');
        } else {
            await client.query('COMMIT');
        }

        const row = ledger.rows[0] as unknown as { visitors: number | string; sessions: number | string } | undefined;
        return { visitors: Number(row?.visitors ?? 0), sessions: Number(row?.sessions ?? 0) };
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        client.release();
    }
}

async function main(): Promise<void> {
    const projectsToProcess = await loadProjects();
    logger.info({ projects: projectsToProcess.length, batch: BATCH, dryRun: DRY_RUN }, 'Starting visitor ledger backfill');

    let totalSessions = 0;
    let totalVisitors = 0;

    for (const project of projectsToProcess) {
        const effectiveDays = resolveEffectiveVisitorRetentionDays(project.window_days, project.retention_days);
        let cursor: string | null = null;
        let projectSessions = 0;
        let projectVisitors = 0;

        while (true) {
            const identities = await loadIdentityChunk(project.id, cursor);
            if (identities.length === 0) break;

            const applied = await applyChunk(project.id, identities, effectiveDays);
            projectSessions += applied.sessions;
            projectVisitors += applied.visitors;
            cursor = identities[identities.length - 1];

            // In dry-run nothing is stamped, so the same chunk would be returned forever
            // unless we page by cursor; the cursor above already guarantees progress.
            if (identities.length < BATCH) break;
        }

        totalSessions += projectSessions;
        totalVisitors += projectVisitors;
        logger.info(
            { projectId: project.id, effectiveDays, sessions: projectSessions, visitors: projectVisitors, dryRun: DRY_RUN },
            'Backfilled project visitor ledger',
        );
    }

    logger.info({ totalSessions, totalVisitors, dryRun: DRY_RUN }, 'Visitor ledger backfill completed');
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        logger.error({ err }, 'Visitor ledger backfill failed');
        process.exit(1);
    });
