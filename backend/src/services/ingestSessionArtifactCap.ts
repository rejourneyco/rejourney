import { claimSessionArtifactCapLog, incrementSessionArtifactCount } from '../db/redis.js';
import { logger } from '../logger.js';

/**
 * Hard ceiling on upload registrations for one session. Normal sessions register
 * roughly 50-600 artifacts; this only stops runaway clients (one production
 * session reached 2.2 million artifact rows because nothing bounded it).
 */
export const MAX_ARTIFACTS_PER_SESSION = 20_000;

/**
 * Longest a session may keep registering uploads, measured from when this
 * backend first stored the session row (`sessions.created_at`).
 *
 * It is deliberately NOT measured from `started_at`: that is the client's own
 * clock (the timestamp inside the session id) and is legitimately old for
 * sessions recorded offline and uploaded days later, or sent from a device whose
 * clock is behind. Those uploads must still be accepted.
 */
export const MAX_SESSION_INGEST_AGE_MS = 48 * 60 * 60 * 1000;

/**
 * TTL of the per-session counter, restarted on every counted presign. Keeping it
 * equal to the age limit means a counter can only expire after 48 h of silence,
 * by which time the age limit itself rejects the session, so a session can
 * never get a fresh count allowance.
 */
export const SESSION_ARTIFACT_COUNTER_TTL_SECONDS = MAX_SESSION_INGEST_AGE_MS / 1000;

export type SessionArtifactCapReason = 'session_artifact_cap_exceeded' | 'session_max_age_exceeded';

export type SessionArtifactCapDecision =
    | { allowed: true; count: number | null }
    | { allowed: false; reason: SessionArtifactCapReason; count: number | null; message: string };

type CheckSessionArtifactCapParams = {
    projectId: string;
    sessionId: string;
    /** `sessions.created_at` from the row the route already holds; skipped when absent. */
    sessionCreatedAt?: Date | string | null;
    route: string;
    kind?: string | null;
    now?: Date;
};

function toTimeMs(value: Date | string | null | undefined): number | null {
    if (!value) return null;
    const ms = value instanceof Date ? value.getTime() : new Date(String(value)).getTime();
    return Number.isFinite(ms) ? ms : null;
}

async function logCapTrippedOnce(
    params: CheckSessionArtifactCapParams,
    reason: SessionArtifactCapReason,
    details: Record<string, unknown>,
): Promise<void> {
    const shouldLog = await claimSessionArtifactCapLog(
        params.projectId,
        params.sessionId,
        SESSION_ARTIFACT_COUNTER_TTL_SECONDS,
    );
    if (!shouldLog) return;

    logger.warn(
        {
            event: 'ingest.session_artifact_cap_tripped',
            projectId: params.projectId,
            sessionId: params.sessionId,
            route: params.route,
            kind: params.kind ?? null,
            reason,
            maxArtifactsPerSession: MAX_ARTIFACTS_PER_SESSION,
            maxSessionIngestAgeMs: MAX_SESSION_INGEST_AGE_MS,
            ...details,
        },
        'ingest.session_artifact_cap_tripped',
    );
}

/**
 * Decide whether a session may register one more upload.
 *
 * Call once per presign, after the session row is known and every other skip
 * reason has been ruled out. Rejections are answered by the routes with the same
 * `skipUpload: true` body the SDKs already treat as "drop this chunk, do not
 * retry". If Redis is unavailable the count check is skipped (fail open).
 */
export async function checkSessionArtifactCap(
    params: CheckSessionArtifactCapParams,
): Promise<SessionArtifactCapDecision> {
    const nowMs = (params.now ?? new Date()).getTime();
    const createdAtMs = toTimeMs(params.sessionCreatedAt);

    if (createdAtMs !== null && nowMs - createdAtMs > MAX_SESSION_INGEST_AGE_MS) {
        await logCapTrippedOnce(params, 'session_max_age_exceeded', { sessionAgeMs: nowMs - createdAtMs });
        return {
            allowed: false,
            reason: 'session_max_age_exceeded',
            count: null,
            message: 'Session upload window exceeded - no further uploads are accepted for this session',
        };
    }

    const count = await incrementSessionArtifactCount(
        params.projectId,
        params.sessionId,
        SESSION_ARTIFACT_COUNTER_TTL_SECONDS,
    );
    if (count === null || count <= MAX_ARTIFACTS_PER_SESSION) {
        return { allowed: true, count };
    }

    await logCapTrippedOnce(params, 'session_artifact_cap_exceeded', { artifactCount: count });
    return {
        allowed: false,
        reason: 'session_artifact_cap_exceeded',
        count,
        message: 'Session upload limit reached - no further uploads are accepted for this session',
    };
}
