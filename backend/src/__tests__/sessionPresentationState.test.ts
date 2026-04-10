import { describe, expect, it } from 'vitest';
import { deriveSessionPresentationState } from '../services/sessionPresentationState.js';

describe('sessionPresentationState', () => {
    it('does not mark server-finalized sessions as live ingest when explicitEndedAt is null', () => {
        const startedAt = new Date(Date.now() - 3600_000);
        const state = deriveSessionPresentationState({
            status: 'ready',
            replayAvailable: true,
            recordingDeleted: false,
            isReplayExpired: false,
            explicitEndedAt: null,
            finalizedAt: new Date(),
            lastIngestActivityAt: new Date(),
            replayAvailableAt: startedAt,
            startedAt,
            hasPendingWork: false,
            hasPendingReplayWork: false,
        });

        expect(state.isLiveIngest).toBe(false);
    });

    it('finalizes on ingest quiescence even when replay just became available', () => {
        const now = new Date('2026-04-08T12:05:00.000Z');
        const lastIngest = new Date('2026-04-08T12:00:00.000Z');
        const replayAvailableAt = new Date('2026-04-08T12:04:55.000Z');
        const state = deriveSessionPresentationState({
            status: 'processing',
            replayAvailable: true,
            recordingDeleted: false,
            isReplayExpired: false,
            explicitEndedAt: null,
            finalizedAt: null,
            lastIngestActivityAt: lastIngest,
            replayAvailableAt,
            startedAt: new Date('2026-04-08T11:55:00.000Z'),
            hasPendingWork: false,
            hasPendingReplayWork: false,
            now,
        });

        expect(state.shouldFinalize).toBe(true);
        expect(state.isIdle).toBe(true);
    });
});
