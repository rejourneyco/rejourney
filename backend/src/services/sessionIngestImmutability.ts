import { ApiError } from '../middleware/errorHandler.js';

/** Minimal session row shape for ingest immutability checks */
export type SessionIngestGuardRow = {
    status: string;
    finalizedAt?: Date | null;
    explicitEndedAt?: Date | null;
};

/**
 * When true, the session must not accept new ingest work (presigns, relay bytes,
 * fault rows, or mutating /session/end). Aligns with dashboard "no live ingest":
 * explicit client end, server finalization, or terminal status.
 */
export function isSessionIngestImmutable(session: SessionIngestGuardRow): boolean {
    if (session.status === 'failed' || session.status === 'deleted') {
        return true;
    }
    if (session.status === 'ready') {
        return true;
    }
    if (session.finalizedAt != null) {
        return true;
    }
    if (session.explicitEndedAt != null) {
        return true;
    }
    return false;
}

export function assertSessionAcceptsNewIngestWork(session: SessionIngestGuardRow): void {
    if (!isSessionIngestImmutable(session)) {
        return;
    }
    throw ApiError.conflict('Session is closed to ingest; no new uploads or mutations are accepted.');
}
