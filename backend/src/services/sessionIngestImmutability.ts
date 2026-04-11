import { ApiError } from '../middleware/errorHandler.js';

/** Minimal session row shape for ingest immutability checks */
export type SessionIngestGuardRow = {
    status: string;
    recordingDeleted?: boolean | null;
    isReplayExpired?: boolean | null;
};

/**
 * When true, the session must not accept new ingest work (presigns, relay bytes,
 * fault rows, or mutating /session/end). Hard stops only: terminal status or
 * retention-purged recording. `ready` is reopenable.
 */
export function isSessionIngestImmutable(session: SessionIngestGuardRow): boolean {
    if (session.status === 'failed' || session.status === 'deleted') {
        return true;
    }
    if (session.recordingDeleted || session.isReplayExpired) {
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
