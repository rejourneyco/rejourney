/**
 * Visitor ledger
 *
 * Pseudonymous, bounded memory of "have we seen this visitor before" that outlives
 * the per-session identity scrub. Without it a returning visitor whose earlier
 * sessions were scrubbed is re-counted as a brand-new user (on a 7-day tier, a
 * weekly visitor is "new" every week).
 *
 * What is stored per (project, visitor): an HMAC of the device/user identifier
 * under a server-side secret, first/last seen, and a session count. No raw ids.
 * Rows expire on a sliding inactivity window (teams.visitor_identity_retention_days,
 * never shorter than the session retention) and are deleted by the retention worker
 * or on erasure request. This is the standard analytics pattern: user-level retention
 * that resets on activity, with the visitor record kept while any session survives.
 *
 * Every write here is best-effort: ingest must never fail because of the ledger.
 */

import { createHmac } from 'crypto';
import { pool } from '../db/client.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { setBoundedMapEntry } from '../utils/boundedMap.js';

export const VISITOR_KEY_HEX_LENGTH = 40;
export const DEFAULT_VISITOR_IDENTITY_RETENTION_DAYS = 90;
export const MIN_VISITOR_IDENTITY_RETENTION_DAYS = 0;
export const MAX_VISITOR_IDENTITY_RETENTION_DAYS = 365;

/**
 * SQL twin of resolveVisitorIdentity(). Device-first, matching the archive,
 * Smart Capture and expression-index precedence; anonymous_hash is vestigial but
 * kept for legacy rows; RN anon_* ids live in anonymous_display_id.
 */
export const VISITOR_IDENTITY_SQL =
    "coalesce(nullif(trim(device_id), ''), nullif(trim(anonymous_hash), ''), nullif(trim(anonymous_display_id), ''), nullif(trim(user_display_id), ''))";

export interface VisitorIdentityColumns {
    deviceId?: string | null;
    anonymousHash?: string | null;
    anonymousDisplayId?: string | null;
    userDisplayId?: string | null;
}

export function resolveVisitorIdentity(row: VisitorIdentityColumns | null | undefined): string | null {
    if (!row) return null;
    for (const candidate of [row.deviceId, row.anonymousHash, row.anonymousDisplayId, row.userDisplayId]) {
        if (typeof candidate !== 'string') continue;
        const trimmed = candidate.trim();
        if (trimmed) return trimmed;
    }
    return null;
}

let warnedAboutFallbackSecret = false;

/**
 * Every process that touches the ledger (ingest API, upload API, ingest workers,
 * dashboard API for erasure, the backfill job) must derive the same key, so the
 * only fallback is JWT_SECRET, the one secret provisioned to every workload.
 * SHARE_LINK_SECRET and RESEARCH_LAKE_HASH_SECRET are deliberately excluded: in
 * production they reach only some deployments, and a chain including them would
 * make ingest pods and workers disagree on who a visitor is.
 */
export function resolveVisitorKeySecret(): string {
    if (config.VISITOR_KEY_SECRET) return config.VISITOR_KEY_SECRET;
    const fallback = config.JWT_SECRET;
    if (!warnedAboutFallbackSecret) {
        warnedAboutFallbackSecret = true;
        logger.warn(
            'VISITOR_KEY_SECRET is not set; deriving visitor keys from a fallback secret. Rotating that secret orphans existing project_visitors rows.',
        );
    }
    return fallback;
}

export function computeVisitorKey(projectId: string, identity: string): string {
    return createHmac('sha256', resolveVisitorKeySecret())
        .update(`visitor:${projectId}:${identity}`)
        .digest('hex')
        .slice(0, VISITOR_KEY_HEX_LENGTH);
}

export function normalizeVisitorIdentityRetentionDays(value: unknown): number {
    const numeric = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(numeric)) return DEFAULT_VISITOR_IDENTITY_RETENTION_DAYS;
    return Math.min(MAX_VISITOR_IDENTITY_RETENTION_DAYS, Math.max(MIN_VISITOR_IDENTITY_RETENTION_DAYS, Math.trunc(numeric)));
}

/**
 * The ledger row must never expire before the last unscrubbed session of the visitor,
 * so the effective window is the larger of the team's inactivity window and the
 * session retention period.
 */
export function resolveEffectiveVisitorRetentionDays(
    windowDays: unknown,
    sessionRetentionDays: unknown,
): number {
    const window = normalizeVisitorIdentityRetentionDays(windowDays);
    const sessionNumeric = typeof sessionRetentionDays === 'number' ? sessionRetentionDays : Number(sessionRetentionDays);
    const session = Number.isFinite(sessionNumeric) ? Math.max(0, Math.trunc(sessionNumeric)) : 0;
    return Math.max(1, window, session);
}

export function isVisitorLedgerWriteEnabled(): boolean {
    return config.VISITOR_LEDGER_WRITE_ENABLED === true;
}

// ---------------------------------------------------------------------------
// Per-project window cache (project -> team window days). A team's window only
// changes from the team settings route, which invalidates this cache.
// ---------------------------------------------------------------------------
type WindowCacheEntry = { days: number; expiresAt: number };
const _windowByProject = new Map<string, WindowCacheEntry>();
const WINDOW_CACHE_TTL_MS = 30 * 60 * 1000;
const WINDOW_CACHE_MAX_ENTRIES = 10_000;

export async function getProjectVisitorIdentityWindowDays(projectId: string): Promise<number> {
    const now = Date.now();
    const cached = _windowByProject.get(projectId);
    if (cached && cached.expiresAt > now) return cached.days;

    let days = DEFAULT_VISITOR_IDENTITY_RETENTION_DAYS;
    try {
        const result = await pool.query<{ days: number | string | null }>(
            `SELECT t.visitor_identity_retention_days AS days
             FROM projects p
             INNER JOIN teams t ON t.id = p.team_id
             WHERE p.id = $1
             LIMIT 1`,
            [projectId],
        );
        const raw = result.rows[0]?.days;
        if (raw !== null && raw !== undefined) {
            days = normalizeVisitorIdentityRetentionDays(raw);
        }
    } catch (err) {
        logger.warn({ err, projectId }, 'Failed to load visitor identity window; using default');
    }

    setBoundedMapEntry(_windowByProject, projectId, { days, expiresAt: now + WINDOW_CACHE_TTL_MS }, WINDOW_CACHE_MAX_ENTRIES);
    return days;
}

export function invalidateProjectVisitorWindowCache(projectId: string): void {
    _windowByProject.delete(projectId);
}

function toIsoTimestamp(value: Date | string | number | null | undefined): string | null {
    if (value === null || value === undefined) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function epochMsToDate(value: unknown): Date {
    const numeric = typeof value === 'number' ? value : Number(value);
    return new Date(Number.isFinite(numeric) ? numeric : Date.now());
}

export interface AssignSessionVisitorParams {
    sessionId: string;
    projectId: string;
    identity: string | null | undefined;
    startedAt: Date | string | number | null | undefined;
    effectiveRetentionDays: number;
}

export interface AssignSessionVisitorResult {
    visitorKey: string;
    ordinal: number;
    firstSeenAt: Date;
}

/**
 * Atomically upsert the visitor ledger row and stamp the session with its visitor
 * key and lifetime ordinal.
 *
 * The session row is locked and re-checked (`visitor_session_ordinal IS NULL`) inside
 * the same statement, so concurrent presign / batch-complete / artifact-processor
 * races increment the ledger exactly once per session. Already-scrubbed sessions are
 * never re-keyed. Returns null (and never throws) when disabled, when there is no
 * identity, when the session was already assigned, or on any database error.
 */
export async function assignSessionVisitor(
    params: AssignSessionVisitorParams,
): Promise<AssignSessionVisitorResult | null> {
    if (!isVisitorLedgerWriteEnabled()) return null;
    const identity = typeof params.identity === 'string' ? params.identity.trim() : '';
    if (!identity) return null;

    const startedAtIso = toIsoTimestamp(params.startedAt) ?? new Date().toISOString();
    const retentionDays = Math.max(1, Math.trunc(Number(params.effectiveRetentionDays) || 1));
    const visitorKey = computeVisitorKey(params.projectId, identity);

    try {
        const result = await pool.query<{ ordinal: number | string; first_seen_ms: number | string }>(
            `
            WITH target AS (
                SELECT s.id
                FROM sessions s
                WHERE s.id = $1
                  AND s.project_id = $2
                  AND s.visitor_session_ordinal IS NULL
                  AND s.identity_scrubbed_at IS NULL
                FOR UPDATE OF s
            ),
            ledger AS (
                INSERT INTO project_visitors (project_id, visitor_key, first_seen_at, last_seen_at, session_count, expires_at)
                SELECT $2, $3, $4::timestamp, $4::timestamp, 1, $4::timestamp + ($5::int * INTERVAL '1 day')
                FROM target
                ON CONFLICT (project_id, visitor_key) DO UPDATE SET
                    first_seen_at = LEAST(project_visitors.first_seen_at, EXCLUDED.first_seen_at),
                    last_seen_at = GREATEST(project_visitors.last_seen_at, EXCLUDED.last_seen_at),
                    session_count = project_visitors.session_count + 1,
                    expires_at = GREATEST(project_visitors.last_seen_at, EXCLUDED.last_seen_at) + ($5::int * INTERVAL '1 day'),
                    updated_at = NOW()
                RETURNING session_count, first_seen_at
            )
            UPDATE sessions s
            SET visitor_key = $3,
                visitor_session_ordinal = ledger.session_count,
                updated_at = NOW()
            FROM ledger
            WHERE s.id = $1
            RETURNING s.visitor_session_ordinal AS ordinal,
                      (EXTRACT(EPOCH FROM ledger.first_seen_at) * 1000)::bigint AS first_seen_ms
            `,
            [params.sessionId, params.projectId, visitorKey, startedAtIso, retentionDays],
        );

        const row = result.rows[0];
        if (!row) return null;
        return {
            visitorKey,
            ordinal: Number(row.ordinal),
            firstSeenAt: epochMsToDate(row.first_seen_ms),
        };
    } catch (err) {
        logger.warn({ err, sessionId: params.sessionId, projectId: params.projectId }, 'Failed to assign session visitor');
        return null;
    }
}

export interface SessionVisitorRow extends VisitorIdentityColumns {
    id: string;
    projectId: string;
    startedAt: Date | string | number | null | undefined;
    retentionDays?: number | null;
    visitorSessionOrdinal?: number | null;
}

/**
 * Assign from an already-loaded session row (ingest hot path). Resolves the team's
 * window from cache; no-op when the row already carries an ordinal or has no identity.
 */
export async function assignSessionVisitorForRow(row: SessionVisitorRow): Promise<AssignSessionVisitorResult | null> {
    if (!isVisitorLedgerWriteEnabled()) return null;
    if (row.visitorSessionOrdinal !== null && row.visitorSessionOrdinal !== undefined) return null;
    const identity = resolveVisitorIdentity(row);
    if (!identity) return null;

    const windowDays = await getProjectVisitorIdentityWindowDays(row.projectId);
    return assignSessionVisitor({
        sessionId: row.id,
        projectId: row.projectId,
        identity,
        startedAt: row.startedAt,
        effectiveRetentionDays: resolveEffectiveVisitorRetentionDays(windowDays, row.retentionDays),
    });
}

/**
 * Assign for a session known only by id (identity back-fill paths outside the
 * lifecycle hot path). One extra read; best-effort like everything else here.
 */
export async function assignSessionVisitorById(
    sessionId: string,
    projectId: string,
): Promise<AssignSessionVisitorResult | null> {
    if (!isVisitorLedgerWriteEnabled()) return null;
    try {
        const result = await pool.query<{
            id: string;
            project_id: string;
            started_ms: number | string;
            retention_days: number | string | null;
            visitor_session_ordinal: number | null;
            device_id: string | null;
            anonymous_hash: string | null;
            anonymous_display_id: string | null;
            user_display_id: string | null;
        }>(
            `SELECT id, project_id,
                    (EXTRACT(EPOCH FROM started_at) * 1000)::bigint AS started_ms,
                    retention_days, visitor_session_ordinal,
                    device_id, anonymous_hash, anonymous_display_id, user_display_id
             FROM sessions
             WHERE id = $1 AND project_id = $2 AND identity_scrubbed_at IS NULL
             LIMIT 1`,
            [sessionId, projectId],
        );
        const row = result.rows[0];
        if (!row) return null;
        return assignSessionVisitorForRow({
            id: row.id,
            projectId: row.project_id,
            startedAt: epochMsToDate(row.started_ms),
            retentionDays: row.retention_days === null ? null : Number(row.retention_days),
            visitorSessionOrdinal: row.visitor_session_ordinal,
            deviceId: row.device_id,
            anonymousHash: row.anonymous_hash,
            anonymousDisplayId: row.anonymous_display_id,
            userDisplayId: row.user_display_id,
        });
    } catch (err) {
        logger.warn({ err, sessionId, projectId }, 'Failed to load session for visitor assignment');
        return null;
    }
}

export interface VisitorLedgerExpiryResult {
    deleted: number;
    reachedProcessingCap: boolean;
}

function coerceLimit(limit: number): number {
    return Math.max(1, Math.min(Math.trunc(limit) || 1, 1000));
}

/**
 * Delete ledger rows whose sliding window elapsed. Sessions referencing them are
 * already identity-scrubbed (the effective window is never shorter than session
 * retention), so nothing on `sessions` needs to change here.
 */
export async function expireVisitorLedgerBatch(limit = 100): Promise<VisitorLedgerExpiryResult> {
    const batchLimit = coerceLimit(limit);
    const result = await pool.query<{ id: string }>(
        `
        WITH due AS (
            SELECT id
            FROM project_visitors
            WHERE expires_at < NOW()
            ORDER BY expires_at, id
            LIMIT $1
            FOR UPDATE SKIP LOCKED
        )
        DELETE FROM project_visitors pv
        USING due
        WHERE pv.id = due.id
        RETURNING pv.id
        `,
        [batchLimit],
    );
    const deleted = result.rows.length;
    if (deleted > 0) {
        logger.info({ deleted }, 'Expired visitor ledger rows');
    }
    return { deleted, reachedProcessingCap: deleted >= batchLimit };
}

/**
 * Recompute expires_at for every ledger row of a team after its window changed.
 */
export async function resyncTeamVisitorLedgerExpiry(teamId: string, effectiveRetentionDays: number): Promise<number> {
    const days = Math.max(1, Math.trunc(Number(effectiveRetentionDays) || 1));
    const result = await pool.query(
        `
        UPDATE project_visitors pv
        SET expires_at = pv.last_seen_at + ($2::int * INTERVAL '1 day'),
            updated_at = NOW()
        FROM projects p
        WHERE p.id = pv.project_id
          AND p.team_id = $1
        `,
        [teamId, days],
    );
    return result.rowCount ?? 0;
}
