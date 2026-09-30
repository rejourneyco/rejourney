/** Identifier-free durable counts, backed by bounded visitor-ledger participation. */
import type { PoolClient } from 'pg';
import { computeVisitorKey } from './visitorLedger.js';
import { pool } from '../db/client.js';

type QueryClient = Pick<PoolClient, 'query'>;

// A 30-day window includes the target day and the preceding 29 UTC days.
// Completeness is independent for DAU and MAU: a recent day can have intact
// identities even when part of its monthly window has already expired.
export const ACTIVITY_SNAPSHOT_SQL = `
WITH base AS MATERIALIZED (
    SELECT s.started_at::date AS day, s.platform, pv.id AS visitor_id,
        coalesce(nullif(trim(user_display_id), ''), nullif(trim(anonymous_hash), ''),
            nullif(trim(anonymous_display_id), ''), nullif(trim(device_id), ''),
            CASE WHEN identity_scrubbed_at IS NULL THEN s.id END) AS user_key,
        identity_scrubbed_at IS NOT NULL AS scrubbed,
        coalesce(nullif(app_version, ''), 'Unknown') AS version, geo_country AS country
    FROM sessions s LEFT JOIN project_visitors pv ON pv.project_id = s.project_id AND pv.visitor_key = s.visitor_key AND pv.expires_at > now()
    WHERE s.project_id = $1 AND started_at >= $2::date - interval '29 days'
      AND started_at < $2::date + interval '1 day'
), scopes AS (
    SELECT unnest(ARRAY['all', 'mobile', 'ios', 'android', 'web']) AS platform
), scoped AS MATERIALIZED (
    SELECT scopes.platform AS scope, base.* FROM base JOIN scopes ON
        scopes.platform = 'all' OR scopes.platform = base.platform OR
        (scopes.platform = 'mobile' AND base.platform IN ('ios', 'android'))
), counts AS (
    SELECT scopes.platform,
        count(DISTINCT user_key) FILTER (WHERE day = $2::date)::int AS dau,
        count(DISTINCT user_key)::int AS mau,
        count(*) FILTER (WHERE scrubbed AND day = $2::date) = 0 AS dau_complete,
        count(*) FILTER (WHERE scrubbed) = 0 AS mau_complete,
        count(*) FILTER (WHERE day = $2::date AND (scrubbed OR visitor_id IS NULL)) = 0 AS membership_complete
    FROM scopes LEFT JOIN scoped ON scoped.scope = scopes.platform GROUP BY scopes.platform
), membership AS (
    SELECT scopes.platform, count(DISTINCT a.identity_key)::int AS mau FROM scopes
    LEFT JOIN visitor_activity_days a ON a.project_id = $1
      AND a.date BETWEEN $2::date - 29 AND $2::date
      AND (scopes.platform = 'all' OR scopes.platform = a.platform OR
        (scopes.platform = 'mobile' AND a.platform IN ('ios', 'android')))
    GROUP BY scopes.platform
), covered AS (
    SELECT counts.*, membership.mau AS membership_mau,
        -- Temporary participation covers current windows only. An old rerun
        -- must not mistake pruned participation for complete historical data.
        ($2::date >= (now() AT TIME ZONE 'UTC')::date - 2
         AND counts.membership_complete AND NOT EXISTS (
            SELECT 1 FROM scoped b WHERE b.scope = counts.platform AND b.day < $2::date
              AND NOT EXISTS (SELECT 1 FROM activity_snapshots a WHERE a.project_id = $1
                AND a.platform = counts.platform AND a.date = b.day AND a.membership_complete)
         )) AS membership_window_complete
    FROM counts JOIN membership USING (platform)
), versions AS (
    SELECT scope, version, count(DISTINCT user_key)::int AS n FROM scoped
    WHERE day = $2::date GROUP BY scope, version
), countries AS (
    SELECT scope, country, count(DISTINCT user_key)::int AS n FROM scoped
    WHERE day = $2::date AND country IS NOT NULL GROUP BY scope, country
)
INSERT INTO activity_snapshots AS existing
    (project_id, date, platform, dau, mau, dau_complete, mau_complete, membership_complete, version_dau, country_dau)
SELECT $1, $2::date, platform, dau,
    CASE WHEN mau_complete THEN mau ELSE greatest(mau, membership_mau) END,
    dau_complete, mau_complete OR membership_window_complete, membership_complete,
    coalesce((SELECT jsonb_object_agg(version, n) FROM versions WHERE scope = covered.platform), '{}'::jsonb),
    coalesce((SELECT jsonb_object_agg(country, n) FROM countries WHERE scope = covered.platform), '{}'::jsonb)
FROM covered ORDER BY platform
ON CONFLICT (project_id, date, platform) DO UPDATE SET
    dau = CASE WHEN excluded.dau_complete THEN excluded.dau ELSE existing.dau END,
    mau = CASE WHEN excluded.mau_complete THEN excluded.mau WHEN existing.mau_complete THEN existing.mau ELSE greatest(existing.mau, excluded.mau) END,
    version_dau = CASE WHEN excluded.dau_complete THEN excluded.version_dau ELSE existing.version_dau END,
    country_dau = CASE WHEN excluded.dau_complete THEN excluded.country_dau ELSE existing.country_dau END,
    dau_complete = existing.dau_complete OR excluded.dau_complete,
    mau_complete = existing.mau_complete OR excluded.mau_complete,
    membership_complete = existing.membership_complete OR excluded.membership_complete,
    updated_at = now()
`;

/** Participation uses the same HMAC secret and deletion boundary as the existing
 * visitor ledger. It expires independently after 31 days, and FK cascade removes
 * it immediately when the ledger is erased/expired. Raw IDs never leave memory.
 */
async function captureActivityDay(projectId: string, date: string, client: QueryClient): Promise<void> {
    // Older days can be counted directly while raw identities still exist, but
    // must not resurrect expired participation during a historic backfill.
    if (Date.parse(`${date}T00:00:00Z`) < Date.now() - 31 * 86_400_000) return;
    const { rows } = await client.query<{ visitor_id: string; identity: string; platform: string }>(`
        SELECT DISTINCT pv.id AS visitor_id, coalesce(nullif(trim(s.user_display_id), ''),
            nullif(trim(s.anonymous_hash), ''), nullif(trim(s.anonymous_display_id), ''),
            nullif(trim(s.device_id), ''), s.id) AS identity, coalesce(s.platform, 'unknown') AS platform
        FROM sessions s JOIN project_visitors pv ON pv.project_id = s.project_id AND pv.visitor_key = s.visitor_key
        WHERE s.project_id = $1 AND s.started_at >= $2::date AND s.started_at < $2::date + interval '1 day'
          AND s.identity_scrubbed_at IS NULL AND pv.expires_at > now()
    `, [projectId, date]);
    for (let offset = 0; offset < rows.length; offset += 1000) {
        const values = rows.slice(offset, offset + 1000).map(row => ({
            visitor_id: row.visitor_id, platform: row.platform,
            identity_key: computeVisitorKey(projectId, row.identity),
        }));
        await client.query(`INSERT INTO visitor_activity_days (visitor_id, project_id, date, platform, identity_key)
            SELECT v.visitor_id, $1, $2::date, v.platform, v.identity_key
            FROM jsonb_to_recordset($3::jsonb) AS v(visitor_id uuid, platform text, identity_key text)
            JOIN project_visitors pv ON pv.id = v.visitor_id AND pv.expires_at > now()
            ON CONFLICT DO NOTHING`, [projectId, date, JSON.stringify(values)]);
    }
}

export async function pruneExpiredActivityDays(): Promise<void> {
    await pool.query("DELETE FROM visitor_activity_days WHERE date < (now() AT TIME ZONE 'UTC')::date - 31");
}

export async function snapshotActivityDay(projectId: string, date: string, client?: QueryClient): Promise<void> {
    if (!client) {
        const connection = await pool.connect();
        try {
            // Participation and counts must see the same sessions, including
            // when a late upload commits while this snapshot is running.
            await connection.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
            await connection.query("SET LOCAL TIME ZONE 'UTC'");
            await connection.query("SET LOCAL statement_timeout = '120s'");
            await snapshotActivityDay(projectId, date, connection);
            await connection.query('COMMIT');
        } catch (error) {
            await connection.query('ROLLBACK');
            throw error;
        } finally {
            connection.release();
        }
        return;
    }
    await captureActivityDay(projectId, date, client);
    await client.query(ACTIVITY_SNAPSHOT_SQL, [projectId, date]);
}

/** Called inside the expiry transaction, before any identities are cleared.
 * Save all completed windows affected by this batch, including monthly windows
 * ending after the expiring day. Each affected window gets one final recount before its first expiry; this
 * includes sessions uploaded after the regular daily rollup.
 */
export async function snapshotBeforeIdentityExpiry(sessionIds: string[], client: QueryClient): Promise<void> {
    const { rows } = await client.query<{ project_id: string; date: string }>(`
        SELECT DISTINCT s.project_id, to_char(d.day, 'YYYY-MM-DD') AS date
        FROM sessions s CROSS JOIN LATERAL generate_series(
            s.started_at::date,
            least(s.started_at::date + 29, (now() AT TIME ZONE 'UTC')::date - 1), interval '1 day'
        ) d(day)
        WHERE s.id = ANY($1::varchar[]) AND NOT EXISTS (
            SELECT 1 FROM activity_snapshots a WHERE a.project_id = s.project_id
              AND a.date = d.day::date AND a.platform = 'all' AND a.identity_frozen
        ) ORDER BY s.project_id, date
    `, [sessionIds]);
    for (const row of rows) {
        await snapshotActivityDay(row.project_id, row.date, client);
        await client.query('UPDATE activity_snapshots SET identity_frozen = true WHERE project_id = $1 AND date = $2::date',
            [row.project_id, row.date]);
    }
}

type ActivityRow = {
    project_id: string; date: string; dau: number; mau: number;
    dau_complete: boolean; mau_complete: boolean;
    version_dau: Record<string, number>; country_dau: Record<string, number>;
};
export type ActivityCounts = {
    dau: number; mau: number; dauComplete: boolean; mauComplete: boolean;
    appVersionDauBreakdown: Record<string, number>; countryDauBreakdown: Record<string, number>;
};

export function combineActivitySnapshots(rows: ActivityRow[], projectCount: number): Map<string, ActivityCounts> {
    const grouped = new Map<string, ActivityRow[]>();
    for (const row of rows) grouped.set(row.date, [...(grouped.get(row.date) ?? []), row]);
    const result = new Map<string, ActivityCounts>();
    for (const [date, days] of grouped) {
        // Never substitute an incomplete project selection for the whole chart.
        if (new Set(days.map(day => day.project_id)).size !== projectCount) continue;
        const counts: ActivityCounts = { dau: 0, mau: 0, dauComplete: true, mauComplete: true,
            appVersionDauBreakdown: {}, countryDauBreakdown: {} };
        for (const day of days) {
            counts.dau += Number(day.dau); counts.mau += Number(day.mau);
            counts.dauComplete &&= day.dau_complete; counts.mauComplete &&= day.mau_complete;
            for (const [key, n] of Object.entries(day.version_dau)) {
                counts.appVersionDauBreakdown[key] = (counts.appVersionDauBreakdown[key] ?? 0) + Number(n);
            }
            for (const [key, n] of Object.entries(day.country_dau)) {
                counts.countryDauBreakdown[key] = (counts.countryDauBreakdown[key] ?? 0) + Number(n);
            }
        }
        result.set(date, counts);
    }
    return result;
}

export async function readActivitySnapshots(projectIds: string[], platform: string, start: string | undefined, end: string): Promise<Map<string, ActivityCounts>> {
    const { rows } = await pool.query<ActivityRow>(`
        SELECT project_id, date::text, dau, mau, dau_complete, mau_complete, version_dau, country_dau
        FROM activity_snapshots WHERE project_id = ANY($1::uuid[]) AND platform = $2
          AND ($3::date IS NULL OR date >= $3::date) AND date <= $4::date
    `, [projectIds, platform, start ?? null, end]);
    return combineActivitySnapshots(rows, projectIds.length);
}
