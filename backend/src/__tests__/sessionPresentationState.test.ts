import { describe, expect, it } from 'vitest';
import { deriveSessionPresentationState, SESSION_LIVE_INGEST_WINDOW_MS } from '../services/sessionPresentationState.js';

describe('sessionPresentationState', () => {
    it('stops live ingest shortly after 60 seconds of inactivity', () => {
        const now = new Date('2026-04-08T12:05:00.000Z');
        const recent = deriveSessionPresentationState({
            status: 'processing',
            platform: 'ios',
            replayAvailable: false,
            lastIngestActivityAt: new Date(now.getTime() - 59_000),
            startedAt: new Date('2026-04-08T11:55:00.000Z'),
            hasPendingWork: false,
            hasPendingReplayWork: false,
            now,
        });
        const stale = deriveSessionPresentationState({
            status: 'processing',
            platform: 'ios',
            replayAvailable: false,
            lastIngestActivityAt: new Date(now.getTime() - 61_000),
            startedAt: new Date('2026-04-08T11:55:00.000Z'),
            hasPendingWork: false,
            hasPendingReplayWork: false,
            now,
        });

        expect(SESSION_LIVE_INGEST_WINDOW_MS).toBe(60_000);
        expect(recent.isLiveIngest).toBe(true);
        expect(stale.isLiveIngest).toBe(false);
        expect(stale.shouldFinalize).toBe(true);
    });

    it('ages web live ingest out after 60s without finalizing before the max session window', () => {
        const now = new Date('2026-04-08T12:05:00.000Z');
        const state = deriveSessionPresentationState({
            status: 'processing',
            platform: 'web',
            replayAvailable: true,
            recordingDeleted: false,
            isReplayExpired: false,
            lastIngestActivityAt: new Date(now.getTime() - 61_000),
            startedAt: new Date(now.getTime() - 5 * 60_000),
            hasPendingWork: false,
            hasPendingReplayWork: false,
            maxSessionDurationMs: 30 * 60_000,
            now,
        });

        expect(state.isLiveIngest).toBe(false);
        expect(state.isIdle).toBe(true);
        expect(state.shouldFinalize).toBe(false);
        expect(state.effectiveStatus).toBe('processing');
    });

    it('finalizes stale web sessions once the max session window has elapsed', () => {
        const now = new Date('2026-04-08T12:31:00.000Z');
        const state = deriveSessionPresentationState({
            status: 'processing',
            platform: 'web',
            replayAvailable: true,
            recordingDeleted: false,
            isReplayExpired: false,
            lastIngestActivityAt: new Date('2026-04-08T12:01:00.000Z'),
            startedAt: new Date('2026-04-08T12:00:00.000Z'),
            hasPendingWork: false,
            hasPendingReplayWork: false,
            maxSessionDurationMs: 30 * 60_000,
            now,
        });

        expect(state.isLiveIngest).toBe(false);
        expect(state.shouldFinalize).toBe(true);
        expect(state.effectiveStatus).toBe('ready');
    });

    it('does not mark ready sessions as live ingest even with recent lastIngestActivityAt', () => {
        const startedAt = new Date(Date.now() - 3600_000);
        const state = deriveSessionPresentationState({
            status: 'ready',
            replayAvailable: true,
            recordingDeleted: false,
            isReplayExpired: false,
            lastIngestActivityAt: new Date(),
            startedAt,
            hasPendingWork: false,
            hasPendingReplayWork: false,
        });

        expect(state.isLiveIngest).toBe(false);
    });

    it('finalizes on ingest quiescence even when replay is available', () => {
        const now = new Date('2026-04-08T12:05:00.000Z');
        const lastIngest = new Date(now.getTime() - SESSION_LIVE_INGEST_WINDOW_MS - 60_000);
        const state = deriveSessionPresentationState({
            status: 'processing',
            platform: 'ios',
            replayAvailable: true,
            recordingDeleted: false,
            isReplayExpired: false,
            lastIngestActivityAt: lastIngest,
            startedAt: new Date('2026-04-08T11:55:00.000Z'),
            hasPendingWork: false,
            hasPendingReplayWork: false,
            now,
        });

        expect(state.shouldFinalize).toBe(true);
        expect(state.isIdle).toBe(true);
    });

    it('maps pending status to processing for presentation', () => {
        const now = new Date();
        const state = deriveSessionPresentationState({
            status: 'pending',
            replayAvailable: false,
            lastIngestActivityAt: now,
            startedAt: new Date(now.getTime() - 60_000),
            hasPendingWork: true,
            hasPendingReplayWork: false,
            now,
        });

        expect(state.effectiveStatus).toBe('processing');
    });

    it('does not mutate completed sessions toward processing', () => {
        const state = deriveSessionPresentationState({
            status: 'completed',
            replayAvailable: true,
            lastIngestActivityAt: new Date(Date.now() - 3600_000),
            startedAt: new Date(Date.now() - 7200_000),
            hasPendingWork: false,
            hasPendingReplayWork: false,
        });

        expect(state.effectiveStatus).toBe('completed');
        expect(state.shouldFinalize).toBe(false);
    });

    it('treats superseded sessions as ingest-quiescent so recent lastIngestActivityAt does not show live', () => {
        const now = new Date('2026-04-08T12:05:00.000Z');
        const state = deriveSessionPresentationState({
            status: 'processing',
            replayAvailable: true,
            recordingDeleted: false,
            isReplayExpired: false,
            lastIngestActivityAt: now,
            startedAt: new Date('2026-04-08T11:55:00.000Z'),
            hasPendingWork: false,
            hasPendingReplayWork: false,
            supersededByNewerVisitorSession: true,
            now,
        });

        expect(state.isLiveIngest).toBe(false);
        expect(state.shouldFinalize).toBe(true);
        expect(state.effectiveStatus).toBe('ready');
    });

    it('does not show live ingest when endedAt is set even if lastIngestActivityAt was just bumped', () => {
        const now = new Date('2026-04-08T12:05:00.000Z');
        const state = deriveSessionPresentationState({
            status: 'processing',
            replayAvailable: true,
            recordingDeleted: false,
            isReplayExpired: false,
            lastIngestActivityAt: now,
            startedAt: new Date('2026-04-08T11:55:00.000Z'),
            endedAt: new Date('2026-04-08T12:00:00.000Z'),
            hasPendingWork: true,
            hasPendingReplayWork: false,
            now,
        });

        expect(state.isLiveIngest).toBe(false);
        expect(state.isBackgroundProcessing).toBe(true);
        expect(state.shouldFinalize).toBe(true);
        expect(state.effectiveStatus).toBe('ready');
    });

    it('does not show background processing for only non-processing pending work', () => {
        const now = new Date('2026-04-08T12:05:00.000Z');
        const state = deriveSessionPresentationState({
            status: 'ready',
            replayAvailable: true,
            recordingDeleted: false,
            isReplayExpired: false,
            lastIngestActivityAt: new Date(now.getTime() - 2 * SESSION_LIVE_INGEST_WINDOW_MS),
            startedAt: new Date('2026-04-08T12:00:00.000Z'),
            endedAt: new Date('2026-04-08T12:01:00.000Z'),
            hasPendingWork: true,
            hasPendingProcessingWork: false,
            hasPendingReplayWork: false,
            now,
        });

        expect(state.hasPendingWork).toBe(true);
        expect(state.isBackgroundProcessing).toBe(false);
        expect(state.canOpenReplay).toBe(true);
    });
});
