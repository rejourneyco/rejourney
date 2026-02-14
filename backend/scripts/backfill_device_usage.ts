import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import pg from 'pg';

type BackfillStats = {
    rollup_rows: string;
    total_sessions_started: string;
    total_minutes_recorded: string;
    rows_to_insert: string;
    rows_to_update: string;
};

function loadEnv(): void {
    const cwd = process.cwd();
    const candidates = [
        path.resolve(cwd, '.env.local'),
        path.resolve(cwd, '.env'),
        path.resolve(cwd, '../.env.local'),
        path.resolve(cwd, '../.env'),
    ];

    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            dotenv.config({ path: candidate });
        }
    }
}

function getArgs(): { dryRun: boolean } {
    const args = new Set(process.argv.slice(2));
    return {
        dryRun: args.has('--dry-run'),
    };
}

const rollupCte = `
WITH session_rollup AS (
    SELECT
        s.device_id,
        s.project_id,
        (s.started_at AT TIME ZONE 'UTC')::date AS period,
        COUNT(*)::int AS sessions_started,
        COALESCE(
            SUM(
                CASE
                    WHEN s.duration_seconds IS NULL OR s.duration_seconds <= 0 THEN 0
                    ELSE CEIL(s.duration_seconds / 60.0)::int
                END
            ),
            0
        )::int AS minutes_recorded
    FROM sessions s
    WHERE s.device_id IS NOT NULL
      AND s.device_id <> ''
    GROUP BY s.device_id, s.project_id, (s.started_at AT TIME ZONE 'UTC')::date
)
`;

const statsQuery = `
${rollupCte}
SELECT
    COUNT(*)::bigint AS rollup_rows,
    COALESCE(SUM(sr.sessions_started), 0)::bigint AS total_sessions_started,
    COALESCE(SUM(sr.minutes_recorded), 0)::bigint AS total_minutes_recorded,
    COALESCE(SUM(CASE WHEN du.device_id IS NULL THEN 1 ELSE 0 END), 0)::bigint AS rows_to_insert,
    COALESCE(SUM(CASE
        WHEN du.device_id IS NOT NULL
         AND (du.sessions_started <> sr.sessions_started OR du.minutes_recorded <> sr.minutes_recorded)
        THEN 1
        ELSE 0
    END), 0)::bigint AS rows_to_update
FROM session_rollup sr
LEFT JOIN device_usage du
    ON du.device_id = sr.device_id
   AND du.project_id = sr.project_id
   AND du.period = sr.period;
`;

const upsertQuery = `
${rollupCte}
INSERT INTO device_usage (
    device_id,
    project_id,
    period,
    bytes_uploaded,
    minutes_recorded,
    sessions_started,
    request_count
)
SELECT
    sr.device_id,
    sr.project_id,
    sr.period,
    0::bigint,
    sr.minutes_recorded,
    sr.sessions_started,
    0
FROM session_rollup sr
ON CONFLICT (device_id, project_id, period)
DO UPDATE SET
    minutes_recorded = EXCLUDED.minutes_recorded,
    sessions_started = EXCLUDED.sessions_started;
`;

async function main(): Promise<void> {
    loadEnv();
    const { dryRun } = getArgs();
    const databaseUrl = process.env.DATABASE_URL;

    if (!databaseUrl) {
        console.error('DATABASE_URL is required');
        process.exit(1);
    }

    const { Pool } = pg;
    const pool = new Pool({
        connectionString: databaseUrl,
        max: 5,
        idleTimeoutMillis: 10_000,
        connectionTimeoutMillis: 5_000,
    });

    try {
        const before = await pool.query<BackfillStats>(statsQuery);
        const stats = before.rows[0];

        console.log('Device usage backfill preview');
        console.log(`rollup rows: ${stats.rollup_rows}`);
        console.log(`sessions_started total: ${stats.total_sessions_started}`);
        console.log(`minutes_recorded total: ${stats.total_minutes_recorded}`);
        console.log(`rows to insert: ${stats.rows_to_insert}`);
        console.log(`rows to update: ${stats.rows_to_update}`);

        if (dryRun) {
            console.log('Dry run complete. No writes were made.');
            return;
        }

        await pool.query('BEGIN');
        await pool.query(upsertQuery);
        await pool.query('COMMIT');

        const after = await pool.query<BackfillStats>(statsQuery);
        const afterStats = after.rows[0];

        console.log('Backfill complete.');
        console.log(`rows now needing insert: ${afterStats.rows_to_insert}`);
        console.log(`rows now needing update: ${afterStats.rows_to_update}`);
    } catch (err) {
        await pool.query('ROLLBACK').catch(() => undefined);
        console.error('Backfill failed:', err);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

main().catch((err) => {
    console.error('Unexpected failure:', err);
    process.exit(1);
});

