import { canOpenReplayFromSessionFields } from './replayAvailability.js';
import { SESSION_LIVE_INGEST_WINDOW_MS } from './sessionEvidence.js';

export {
    SESSION_LIVE_INGEST_WINDOW_MS,
    loadSessionWorkAggregate,
    type SessionWorkAggregate,
} from './sessionEvidence.js';

export type SessionPresentationState = {
    effectiveStatus: string;
    isLiveIngest: boolean;
    isBackgroundProcessing: boolean;
    canOpenReplay: boolean;
    hasPendingWork: boolean;
    hasPendingReplayWork: boolean;
    isIdle: boolean;
    isSdkPaused: boolean;
    shouldFinalize: boolean;
};

type DeriveSessionPresentationStateInput = {
    status?: string | null;
    platform?: string | null;
    replayAvailable?: boolean | null;
    replayRetentionState?: string | null;
    recordingDeleted?: boolean | null;
    isReplayExpired?: boolean | null;
    lastIngestActivityAt?: Date | string | null;
    startedAt?: Date | string | null;
    /** Server-resolved session end; recording is closed even if workers keep bumping lastIngestActivityAt. */
    endedAt?: Date | string | null;
    /** One-shot mobile pause state. Paused SDKs intentionally emit no heartbeat. */
    sdkPausedAt?: Date | string | null;
    hasPendingWork?: boolean;
    /**
     * Work that should be shown as user-visible background processing. This is
     * intentionally narrower than hasPendingWork so an orphaned pending events
     * preflight can still block detail caching without making a ready replay look busy.
     */
    hasPendingProcessingWork?: boolean;
    hasPendingReplayWork?: boolean;
    /** Visitor started a newer session; do not treat stale ingest touches on this row as "live". */
    supersededByNewerVisitorSession?: boolean;
    /**
     * Web sessions can go quiet for more than the live-ingest badge window and
     * still be resumed by the same tab. Keep finalization separate from "not live".
     */
    maxSessionDurationMs?: number;
    now?: Date;
};

function toFiniteNumber(value: unknown): number | null {
    if (value === null || value === undefined) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function toDateOrNull(value: unknown): Date | null {
    if (!value) return null;
    const parsed = value instanceof Date ? value : new Date(String(value));
    return Number.isFinite(parsed.getTime()) ? parsed : null;
}

export function deriveSessionPresentationState(
    input: DeriveSessionPresentationStateInput
): SessionPresentationState {
    const now = input.now ?? new Date();
    const lastIngestActivityAt = toDateOrNull(input.lastIngestActivityAt);
    const startedAt = toDateOrNull(input.startedAt);
    const cutoffMs = now.getTime() - SESSION_LIVE_INGEST_WINDOW_MS;
    const liveClockMs = lastIngestActivityAt?.getTime() ?? 0;
    const hasPendingWork = Boolean(input.hasPendingWork);
    const hasPendingProcessingWork = input.hasPendingProcessingWork ?? hasPendingWork;
    const hasPendingReplayWork = Boolean(input.hasPendingReplayWork);
    const canOpenReplay = canOpenReplayFromSessionFields(input);
    const status = input.status === 'pending' ? 'processing' : (input.status ?? 'processing');
    const hardTerminal = status === 'failed' || status === 'deleted';
    const superseded = Boolean(input.supersededByNewerVisitorSession);
    const recordingClosed = toDateOrNull(input.endedAt) != null;
    const isWebSession = input.platform === 'web';
    const defaultMaxSessionDurationMs = isWebSession ? 30 * 60_000 : SESSION_LIVE_INGEST_WINDOW_MS;
    const maxSessionDurationMs = Math.max(
        SESSION_LIVE_INGEST_WINDOW_MS,
        toFiniteNumber(input.maxSessionDurationMs) ?? defaultMaxSessionDurationMs,
    );
    const maxSessionWindowElapsed = Boolean(
        startedAt
        && now.getTime() - startedAt.getTime() >= maxSessionDurationMs
    );
    const isSdkPaused = Boolean(
        toDateOrNull(input.sdkPausedAt)
        && !recordingClosed
        && !hardTerminal
        && !superseded
        && !maxSessionWindowElapsed
    );
    const isLiveIngest =
        !superseded
        && !isSdkPaused
        && !recordingClosed
        && !hardTerminal
        && status !== 'ready'
        && status !== 'completed'
        && liveClockMs > cutoffMs;
    const isIngestQuiescent = !isSdkPaused && (superseded || recordingClosed || liveClockMs <= cutoffMs);
    const isIdle = isIngestQuiescent;
    const canFinalizeIdleSession =
        !isWebSession
        || recordingClosed
        || superseded
        || maxSessionWindowElapsed;
    const shouldFinalize =
        status !== 'completed'
        && !hasPendingReplayWork
        && isIngestQuiescent
        && canFinalizeIdleSession
        && (status === 'ready' || !hardTerminal);

    let effectiveStatus = status;
    if (effectiveStatus !== 'failed' && effectiveStatus !== 'deleted' && effectiveStatus !== 'completed') {
        if (shouldFinalize) {
            effectiveStatus = 'ready';
        } else if (isLiveIngest || isSdkPaused || hasPendingReplayWork || effectiveStatus === 'processing') {
            effectiveStatus = 'processing';
        }
    }

    return {
        effectiveStatus,
        isLiveIngest,
        isBackgroundProcessing: !isLiveIngest && hasPendingProcessingWork,
        canOpenReplay,
        hasPendingWork,
        hasPendingReplayWork,
        isIdle,
        isSdkPaused,
        shouldFinalize,
    };
}
