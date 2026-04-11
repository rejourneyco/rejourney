import { describe, expect, it } from 'vitest';
import {
    computeSessionDurationSeconds,
    durationSecondsForDisplay,
    hasStoredClosedTiming,
    resolveAuthoritativeSessionClose,
    resolveStoredOrDerivedSessionDurationSeconds,
    resolveReportedSessionEndedAt,
    selectSessionEndedAt,
} from '../services/sessionTiming.js';

describe('sessionTiming', () => {
    it('uses a stable fallback when /session/end omits endedAt', () => {
        const fallbackEndedAt = new Date('2026-03-26T03:01:08.476Z');

        const endedAt = resolveReportedSessionEndedAt(undefined, fallbackEndedAt);

        expect(endedAt.toISOString()).toBe('2026-03-26T03:01:08.476Z');
    });

    it('prefers persisted endedAt over late lastIngestActivityAt when selecting session end', () => {
        const endedAt = selectSessionEndedAt({
            startedAt: new Date('2026-03-26T03:00:58.176Z'),
            latestReplayEndMs: null,
            persistedEndedAt: new Date('2026-03-26T03:01:07.240Z'),
            lastIngestActivityAt: new Date('2026-03-26T03:45:41.702Z'),
            maxRecordingMinutes: 10,
        });

        expect(endedAt.toISOString()).toBe('2026-03-26T03:01:07.240Z');
    });

    it('prefers replay end over persisted endedAt when replay is later', () => {
        const startedAt = new Date('2026-03-26T03:00:58.176Z');
        const persistedEndedAt = new Date('2026-03-26T03:01:07.240Z');
        const replayLaterMs = persistedEndedAt.getTime() + 60_000;
        const endedAt = selectSessionEndedAt({
            startedAt,
            latestReplayEndMs: replayLaterMs,
            persistedEndedAt,
            lastIngestActivityAt: new Date('2026-03-26T03:45:41.702Z'),
            maxRecordingMinutes: 10,
        });

        expect(endedAt.toISOString()).toBe(new Date(replayLaterMs).toISOString());
    });

    it('computes playable duration after background time is removed', () => {
        const durationSeconds = computeSessionDurationSeconds(
            new Date('2026-03-26T03:00:58.176Z'),
            new Date('2026-03-26T03:01:08.176Z'),
            3,
        );

        expect(durationSeconds).toBe(7);
    });

    it('detects when a session already has sticky close timing', () => {
        expect(hasStoredClosedTiming({
            endedAt: new Date('2026-04-09T00:00:13.000Z'),
            durationSeconds: 13,
        })).toBe(true);
        expect(hasStoredClosedTiming({
            endedAt: new Date('2026-04-09T00:00:13.000Z'),
            durationSeconds: 0,
        })).toBe(false);
        expect(hasStoredClosedTiming({
            endedAt: null,
            durationSeconds: 13,
        })).toBe(false);
    });

    it('derives duration from timestamps when the stored duration is zero', () => {
        const durationSeconds = resolveStoredOrDerivedSessionDurationSeconds({
            durationSeconds: 0,
            startedAt: new Date('2026-03-26T03:00:58.176Z'),
            endedAt: new Date('2026-03-26T03:01:08.176Z'),
            lastIngestActivityAt: new Date('2026-03-26T03:01:08.176Z'),
            backgroundTimeSeconds: 3,
        });

        expect(durationSeconds).toBe(7);
    });

    it('keeps the stored duration when it is already populated', () => {
        const durationSeconds = resolveStoredOrDerivedSessionDurationSeconds({
            durationSeconds: 42,
            startedAt: new Date('2026-03-26T03:00:58.176Z'),
            endedAt: new Date('2026-03-26T03:01:08.176Z'),
            lastIngestActivityAt: new Date('2026-03-26T03:01:08.176Z'),
            backgroundTimeSeconds: 3,
        });

        expect(durationSeconds).toBe(42);
    });

    it('uses latestReplayEndMs instead of late lastIngestActivityAt when duration is unset', () => {
        const startedAt = new Date('2026-03-26T03:00:58.176Z');
        const replayEndMs = new Date('2026-03-26T03:01:08.176Z').getTime();
        const durationSeconds = resolveStoredOrDerivedSessionDurationSeconds({
            durationSeconds: null,
            startedAt,
            endedAt: null,
            lastIngestActivityAt: new Date('2026-03-26T03:45:00.000Z'),
            backgroundTimeSeconds: 0,
            latestReplayEndMs: replayEndMs,
        });

        expect(durationSeconds).toBe(10);
    });

    it('returns zero playable duration when nothing is closed and there is no replay end yet', () => {
        const durationSeconds = resolveStoredOrDerivedSessionDurationSeconds({
            durationSeconds: null,
            startedAt: new Date('2026-03-26T03:00:58.176Z'),
            endedAt: null,
            lastIngestActivityAt: new Date('2026-03-26T03:45:00.000Z'),
            backgroundTimeSeconds: 0,
            latestReplayEndMs: null,
        });

        expect(durationSeconds).toBe(0);
    });

    it('uses reported endedAt from /session/end when no close anchor', () => {
        const resolvedClose = resolveAuthoritativeSessionClose({
            startedAt: new Date('2026-04-09T00:00:00.000Z'),
            reportedEndedAt: '2026-04-09T00:00:30.000Z',
            totalBackgroundTimeMs: 4_000,
            maxRecordingMinutes: 10,
        });

        expect(resolvedClose.endedAt.toISOString()).toBe('2026-04-09T00:00:30.000Z');
        expect(resolvedClose.backgroundTimeSeconds).toBe(4);
        expect(resolvedClose.durationSeconds).toBe(26);
        expect(resolvedClose.source).toBe('reported');
    });

    it('lets close anchors override reported endedAt', () => {
        const resolvedClose = resolveAuthoritativeSessionClose({
            startedAt: new Date('2026-04-09T00:00:00.000Z'),
            closeAnchorAtMs: new Date('2026-04-09T00:00:12.000Z').getTime(),
            reportedEndedAt: '2026-04-09T00:00:35.000Z',
            maxRecordingMinutes: 10,
        });

        expect(resolvedClose.endedAt.toISOString()).toBe('2026-04-09T00:00:12.000Z');
        expect(resolvedClose.source).toBe('close_anchor');
        expect(resolvedClose.usedReportedEndedAt).toBe(false);
    });

    it('trims background accumulated after a background-timeout close anchor', () => {
        const resolvedClose = resolveAuthoritativeSessionClose({
            startedAt: new Date('2026-04-09T00:00:00.000Z'),
            closeAnchorAtMs: new Date('2026-04-09T00:00:13.000Z').getTime(),
            reportedEndedAt: '2026-04-09T00:01:33.000Z',
            totalBackgroundTimeMs: 80_000,
            maxRecordingMinutes: 10,
        });

        expect(resolvedClose.endedAt.toISOString()).toBe('2026-04-09T00:00:13.000Z');
        expect(resolvedClose.backgroundTimeSeconds).toBe(0);
        expect(resolvedClose.durationSeconds).toBe(13);
    });

    it('falls back to replay end then ingest when /session/end sends no times', () => {
        const resolvedClose = resolveAuthoritativeSessionClose({
            startedAt: new Date('2026-04-09T00:00:00.000Z'),
            lastIngestActivityAt: new Date('2026-04-09T00:00:07.000Z'),
            latestReplayEndMs: new Date('2026-04-09T00:00:22.000Z').getTime(),
            maxRecordingMinutes: 10,
        });

        expect(resolvedClose.endedAt.toISOString()).toBe('2026-04-09T00:00:22.000Z');
        expect(resolvedClose.source).toBe('replay_end');
    });

    it('falls back safely to ingest activity when replay is absent', () => {
        const resolvedClose = resolveAuthoritativeSessionClose({
            startedAt: new Date('2026-04-09T00:00:00.000Z'),
            lastIngestActivityAt: new Date('2026-04-09T00:00:07.000Z'),
            maxRecordingMinutes: 10,
        });

        expect(resolvedClose.endedAt.toISOString()).toBe('2026-04-09T00:00:07.000Z');
        expect(resolvedClose.source).toBe('ingest_activity');
    });

    it('uses recording policy upper bound when there is no ingest or replay evidence', () => {
        const startedAt = new Date('2026-04-09T00:00:00.000Z');
        const resolvedClose = resolveAuthoritativeSessionClose({
            startedAt,
            maxRecordingMinutes: 10,
        });

        expect(resolvedClose.source).toBe('recording_cap');
        expect(resolvedClose.endedAt.toISOString()).toBe(
            new Date(startedAt.getTime() + 10 * 60 * 1000 + 120_000).toISOString(),
        );
    });

    it('prefers shorter replay-based duration when ended_at is far past replay content', () => {
        const startedAt = new Date('2026-04-10T18:00:00.000Z');
        const replayEndMs = new Date('2026-04-10T18:00:35.000Z').getTime();
        const endedAt = new Date('2026-04-10T18:12:00.000Z');
        const d = durationSecondsForDisplay({
            durationSeconds: null,
            startedAt,
            endedAt,
            lastIngestActivityAt: endedAt,
            backgroundTimeSeconds: 0,
            latestReplayEndMs: replayEndMs,
            replayAvailable: true,
        });
        expect(d).toBe(35);
    });

    it('caps ended_at at successor session start on the same device', () => {
        const resolvedClose = resolveAuthoritativeSessionClose({
            startedAt: new Date('2026-04-09T00:00:00.000Z'),
            reportedEndedAt: '2026-04-09T00:00:50.000Z',
            successorStartedAt: new Date('2026-04-09T00:00:20.000Z'),
            maxRecordingMinutes: 10,
        });

        expect(resolvedClose.endedAt.toISOString()).toBe('2026-04-09T00:00:20.000Z');
        expect(resolvedClose.successorCapApplied).toBe(true);
    });
});
