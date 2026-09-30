/** Sequential, bounded initialization of still-recoverable historical activity. */
import { pool } from '../src/db/client.js';
import { snapshotActivityDay } from '../src/services/activitySnapshots.js';
import { calendarDateKeys } from '../src/utils/rollupCalendar.js';

const days = Math.max(1, Math.min(366, Number(process.env.ACTIVITY_BACKFILL_DAYS || 90)));
const client = await pool.connect();
try {
    const { rows } = await client.query<{ project_id: string; first_date: string; end_date: string }>(`
        SELECT s.project_id, greatest(min(s.started_at)::date, (now() AT TIME ZONE 'UTC')::date - $1::int)::text AS first_date,
            ((now() AT TIME ZONE 'UTC')::date - 1)::text AS end_date
        FROM sessions s JOIN projects p ON p.id = s.project_id
        WHERE p.deleted_at IS NULL AND s.identity_scrubbed_at IS NULL
        GROUP BY s.project_id
    `, [days]);
    let completed = 0;
    for (const project of rows) {
        for (const date of calendarDateKeys(project.first_date, project.end_date)) {
            // Transaction-local settings are required behind PgBouncer.
            await client.query('BEGIN');
            try {
                await client.query("SET LOCAL statement_timeout = '120s'");
                await client.query("SET LOCAL TIME ZONE 'UTC'");
                await snapshotActivityDay(project.project_id, date, client);
                await client.query('COMMIT');
            } catch (error) {
                await client.query('ROLLBACK');
                throw error;
            }
            completed++;
            if (completed % 25 === 0) console.log(JSON.stringify({ completedDays: completed }));
        }
    }
    console.log(JSON.stringify({ complete: true, projects: rows.length, completedDays: completed }));
} finally {
    client.release();
    await pool.end();
}
