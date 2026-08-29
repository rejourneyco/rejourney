import { and, eq, isNotNull, isNull, lt, notInArray, or } from 'drizzle-orm';
import { db, sessions } from '../db/client.js';
import { normalizeClientEpochMsForSession } from './sessionClock.js';

const MAX_PAUSE_ID_LENGTH = 64;
const PAUSE_ID_PATTERN = /^[A-Za-z0-9._:-]+$/;

export type SdkPauseTransition = {
    occurredAt: Date;
    pauseId: string;
    paused: boolean;
};

export function sessionAcceptsSdkPauseTransition(session: {
    explicitEndedAt?: Date | string | null;
    isReplayExpired?: boolean | null;
    recordingDeleted?: boolean | null;
    status?: string | null;
}): boolean {
    return !session.explicitEndedAt
        && session.status !== 'failed'
        && session.status !== 'deleted'
        && session.status !== 'completed'
        && session.recordingDeleted !== true
        && session.isReplayExpired !== true;
}

export function normalizeSdkPauseId(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim();
    if (!normalized || normalized.length > MAX_PAUSE_ID_LENGTH || !PAUSE_ID_PATTERN.test(normalized)) {
        return null;
    }
    return normalized;
}

function parsePayload(value: unknown): Record<string, unknown> {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        return value as Record<string, unknown>;
    }
    if (typeof value !== 'string') return {};
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? parsed as Record<string, unknown>
            : {};
    } catch {
        return {};
    }
}

export function extractSdkPauseTransitionFromEvent(event: any): SdkPauseTransition | null {
    if (String(event?.type || '').toLowerCase() !== 'custom') return null;
    const name = String(event?.name || '').toLowerCase();
    if (name !== 'sdk_paused' && name !== 'sdk_resumed') return null;

    const pauseId = normalizeSdkPauseId(parsePayload(event?.payload).pauseId);
    const occurredAt = new Date(Number(event?.timestamp));
    if (!pauseId || !Number.isFinite(occurredAt.getTime()) || occurredAt.getTime() <= 0) return null;

    return {
        occurredAt,
        pauseId,
        paused: name === 'sdk_paused',
    };
}

export function shouldApplySdkPauseTransition(
    existingUpdatedAt: Date | string | null | undefined,
    incomingOccurredAt: Date,
    tie?: {
        existingPaused: boolean;
        incomingPaused: boolean;
        samePauseId: boolean;
    },
): boolean {
    const existing = existingUpdatedAt instanceof Date
        ? existingUpdatedAt
        : existingUpdatedAt
            ? new Date(existingUpdatedAt)
            : null;
    if (!existing || !Number.isFinite(existing.getTime())) return true;
    const incomingMs = incomingOccurredAt.getTime();
    const existingMs = existing.getTime();
    if (incomingMs > existingMs) return true;
    // Date.now()/currentTimeMillis can legitimately produce the same value for
    // an immediate pause/resume pair. Let the matching resume win that tie so
    // production cannot remain paused until the recording-duration cap.
    return incomingMs === existingMs
        && tie?.existingPaused === true
        && tie.incomingPaused === false
        && tie.samePauseId === true;
}

export function normalizeSdkPauseTransition(params: {
    occurredAt: unknown;
    pauseId: unknown;
    paused: unknown;
    serverNow?: Date;
    session: { metadata?: unknown; startedAt?: Date | string | null };
}): SdkPauseTransition | null {
    const pauseId = normalizeSdkPauseId(params.pauseId);
    if (!pauseId || typeof params.paused !== 'boolean') return null;

    const serverNow = params.serverNow ?? new Date();
    const normalized = normalizeClientEpochMsForSession(params.occurredAt, params.session, serverNow);
    const occurredAtMs = normalized.value ?? serverNow.getTime();
    const startedAtMs = new Date(params.session.startedAt ?? 0).getTime();
    const boundedMs = Number.isFinite(startedAtMs)
        ? Math.max(startedAtMs, occurredAtMs)
        : occurredAtMs;

    return { occurredAt: new Date(boundedMs), pauseId, paused: params.paused };
}

/**
 * Apply a last-write-wins pause transition. The strict timestamp comparison
 * makes delayed pause uploads unable to overwrite a newer resume. Reopening a
 * worker-finalized `ready` row is intentional: ready sessions remain mutable,
 * while failed/deleted/retention-purged rows remain immutable. Those guards
 * are repeated in the atomic update because a worker can process a durable
 * fallback event after the session changed state.
 */
export async function applySdkPauseTransition(
    sessionId: string,
    transition: SdkPauseTransition,
    serverNow = new Date(),
): Promise<boolean> {
    const timestampOrder = transition.paused
        ? or(
            isNull(sessions.sdkPauseStateUpdatedAt),
            lt(sessions.sdkPauseStateUpdatedAt, transition.occurredAt),
        )
        : or(
            isNull(sessions.sdkPauseStateUpdatedAt),
            lt(sessions.sdkPauseStateUpdatedAt, transition.occurredAt),
            and(
                eq(sessions.sdkPauseStateUpdatedAt, transition.occurredAt),
                eq(sessions.sdkPauseId, transition.pauseId),
                isNotNull(sessions.sdkPausedAt),
            ),
        );
    const updated = await db.update(sessions)
        .set({
            sdkPausedAt: transition.paused ? transition.occurredAt : null,
            sdkPauseId: transition.paused ? transition.pauseId : null,
            sdkPauseStateUpdatedAt: transition.occurredAt,
            lastIngestActivityAt: serverNow,
            status: 'processing',
            endedAt: null,
            durationSeconds: null,
            finalizedAt: null,
            closeSource: null,
            updatedAt: serverNow,
        })
        .where(and(
            eq(sessions.id, sessionId),
            isNull(sessions.explicitEndedAt),
            notInArray(sessions.status, ['failed', 'deleted', 'completed']),
            eq(sessions.recordingDeleted, false),
            eq(sessions.isReplayExpired, false),
            timestampOrder,
        ))
        .returning({ id: sessions.id });

    return updated.length > 0;
}

export async function closeSdkPauseState(
    sessionId: string,
    explicitEndedAt: Date,
    serverNow = new Date(),
): Promise<void> {
    await db.update(sessions)
        .set({
            explicitEndedAt,
            sdkPausedAt: null,
            sdkPauseId: null,
            sdkPauseStateUpdatedAt: new Date(Math.max(explicitEndedAt.getTime(), serverNow.getTime())),
            updatedAt: serverNow,
        })
        .where(eq(sessions.id, sessionId));
}
