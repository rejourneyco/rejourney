/**
 * Person identity: who a session belongs to, for user counts.
 *
 * Apps often start recording before sign-in, so a person's first sessions carry
 * no user id and later ones do. Keying on the user id alone counts that person
 * twice; keying on the device alone splits one user across their devices. A
 * session's person key is therefore:
 *
 *   its own user id
 *   else the user id most recently seen on its device (within the same data set)
 *   else its anonymous id (anonymous_hash, then anonymous_display_id)
 *   else its device id
 *   else the session id (nothing identifies it).
 *
 * Use the SQL builders for queries and createPersonResolver for rows already in
 * memory; both apply the same rule.
 */

import { sql, type SQL } from 'drizzle-orm';

/** Columns, as SQL expressions over one sessions row, that the person key reads. */
export interface PersonKeyColumns {
    projectId: SQL;
    userId: SQL;
    deviceId: SQL;
    anonymousHash: SQL;
    anonymousDisplayId: SQL;
    sessionId: SQL;
}

/** Columns of the `sessions` table under the given alias. */
export function sessionPersonColumns(alias: string): PersonKeyColumns {
    const col = (name: string) => sql.raw(`${alias}.${name}`);
    return {
        projectId: col('project_id'),
        userId: col('user_display_id'),
        deviceId: col('device_id'),
        anonymousHash: col('anonymous_hash'),
        anonymousDisplayId: col('anonymous_display_id'),
        sessionId: col('id'),
    };
}

/**
 * CTE body (use as `device_user AS (...)`) mapping each project's device to the user
 * id most recently seen on it among sessions matching `where` (sessions aliased
 * `dus`). Keyed by project too: apps from one vendor can share an iOS device id.
 */
export function deviceUserCteSql(where: SQL): SQL {
    return sql`
        SELECT DISTINCT ON (dus.project_id, nullif(trim(dus.device_id), ''))
            dus.project_id AS project_id,
            nullif(trim(dus.device_id), '') AS device,
            nullif(trim(dus.user_display_id), '') AS user_id
        FROM sessions dus
        WHERE ${where}
          AND nullif(trim(dus.device_id), '') IS NOT NULL
          AND nullif(trim(dus.user_display_id), '') IS NOT NULL
        ORDER BY dus.project_id, nullif(trim(dus.device_id), ''), dus.started_at DESC`;
}

/**
 * Person key for one row. `deviceUserId` is the mapped user id for the row's
 * device (e.g. `du.user_id` from a LEFT JOIN on the device_user CTE).
 */
export function personKeySql(columns: PersonKeyColumns, deviceUserId: SQL): SQL {
    return sql`coalesce(
        nullif(trim(${columns.userId}), ''),
        ${deviceUserId},
        nullif(trim(${columns.anonymousHash}), ''),
        nullif(trim(${columns.anonymousDisplayId}), ''),
        nullif(trim(${columns.deviceId}), ''),
        ${columns.sessionId}::text
    )`;
}

/** Join condition for the device_user CTE (aliased `du`). */
export function deviceUserJoinSql(columns: PersonKeyColumns): SQL {
    return sql`du.project_id = ${columns.projectId} AND du.device = nullif(trim(${columns.deviceId}), '')`;
}

export interface PersonIdentityRow {
    /** Scopes the device map; rows from different projects never share a person. */
    projectId?: string | null;
    userDisplayId?: string | null;
    deviceId?: string | null;
    anonymousHash?: string | null;
    anonymousDisplayId?: string | null;
    /** Session id, the last resort when nothing else identifies the row. */
    sessionId?: string | null;
    /** Used to pick the latest user id per device; rows without it count as oldest. */
    startedAt?: Date | string | number | null;
}

function clean(value: string | null | undefined): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
}

function timeOf(value: PersonIdentityRow['startedAt']): number {
    if (value == null) return Number.NEGATIVE_INFINITY;
    const time = value instanceof Date ? value.getTime() : typeof value === 'number' ? value : Date.parse(value);
    return Number.isFinite(time) ? time : Number.NEGATIVE_INFINITY;
}

function deviceKey(projectId: string | null | undefined, device: string): string {
    return `${projectId ?? ''}\u0000${device}`;
}

/**
 * Builds the device → latest user id map from `rows` and returns a function giving
 * each row's person key (null only when the row carries no identity at all).
 */
export function createPersonResolver(rows: Iterable<PersonIdentityRow>): (row: PersonIdentityRow) => string | null {
    const latestByDevice = new Map<string, { userId: string; at: number }>();
    for (const row of rows) {
        const device = clean(row.deviceId);
        const userId = clean(row.userDisplayId);
        if (!device || !userId) continue;
        const at = timeOf(row.startedAt);
        const key = deviceKey(row.projectId, device);
        const current = latestByDevice.get(key);
        if (!current || at >= current.at) latestByDevice.set(key, { userId, at });
    }
    return (row) => {
        const device = clean(row.deviceId);
        return clean(row.userDisplayId)
            ?? (device ? latestByDevice.get(deviceKey(row.projectId, device))?.userId ?? null : null)
            ?? clean(row.anonymousHash)
            ?? clean(row.anonymousDisplayId)
            ?? device
            ?? clean(row.sessionId);
    };
}
