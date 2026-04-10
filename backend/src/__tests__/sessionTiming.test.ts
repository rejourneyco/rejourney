import { describe, expect, it } from 'vitest';
import {
    computeSessionDurationSeconds,
    preserveExistingSessionEndedAt,
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

    it('keeps a previously finalized endedAt ahead of later ingest bookkeeping activity', () => {
        const endedAt = selectSessionEndedAt({
            startedAt: new Date('2026-03-26T03:00:58.176Z'),
            explicitEndedAt: null,
            latestReplayEndMs: null,
            persistedEndedAt: new Date('2026-03-26T03:01:07.240Z'),
            lastIngestActivityAt: new Date('2026-03-26T03:45:41.702Z'),
            maxRecordingMinutes: 10,
            now: new Date('2026-03-26T03:45:41.702Z'),
        });

        expect(endedAt.toISOString()).toBe('2026-03-26T03:01:07.240Z');
    });

    it('still lets explicit end win when it is present', () => {
        const endedAt = selectSessionEndedAt({
            startedAt: new Date('2026-03-26T03:00:58.176Z'),
            explicitEndedAt: new Date('2026-03-26T03:01:11.000Z'),
            latestReplayEndMs: 1774494067240,
            persistedEndedAt: new Date('2026-03-26T03:01:07.240Z'),
            lastIngestActivityAt: new Date('2026-03-26T03:45:41.702Z'),
            maxRecordingMinutes: 10,
        });

        expect(endedAt.toISOString()).toBe('2026-03-26T03:01:11.000Z');
    });

    it('does not let a late explicit end stretch a session far beyond an existing endedAt', () => {
        const preservedEndedAt = preserveExistingSessionEndedAt(
            new Date('2026-03-26T03:43:10.471Z'),
            new Date('2026-03-26T03:23:53.164Z'),
        );

        expect(preservedEndedAt.toISOString()).toBe('2026-03-26T03:23:53.164Z');
    });

    it('still accepts small explicit end corrections near the persisted endedAt', () => {
        const preservedEndedAt = preserveExistingSessionEndedAt(
            new Date('2026-03-26T03:24:10.000Z'),
            new Date('2026-03-26T03:23:53.164Z'),
        );

        expect(preservedEndedAt.toISOString()).toBe('2026-03-26T03:24:10.000Z');
    });

    it('computes playable duration after background time is removed', () => {
        const durationSeconds = computeSessionDurationSeconds(
            new Date('2026-03-26T03:00:58.176Z'),
            new Date('2026-03-26T03:01:08.176Z'),
            3,
        );

        expect(durationSeconds).toBe(7);
    });

    it('derives duration from timestamps when the stored duration is zero', () => {
        const durationSeconds = resolveStoredOrDerivedSessionDurationSeconds({
            durationSeconds: 0,
            startedAt: new Date('2026-03-26T03:00:58.176Z'),
            endedAt: new Date('2026-03-26T03:01:08.176Z'),
            explicitEndedAt: null,
            finalizedAt: null,
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
            explicitEndedAt: null,
            finalizedAt: null,
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
            explicitEndedAt: null,
            finalizedAt: null,
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
            explicitEndedAt: null,
            finalizedAt: null,
            lastIngestActivityAt: new Date('2026-03-26T03:45:00.000Z'),
            backgroundTimeSeconds: 0,
            latestReplayEndMs: null,
        });

        expect(durationSeconds).toBe(0);
    });

    it('keeps legacy explicit stop payloads working when only reported end data exists', () => {
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

    it('anchors background timeout to the last background boundary and trims the reported tail background', () => {
        const resolvedClose = resolveAuthoritativeSessionClose({
            startedAt: new Date('2026-04-09T00:00:00.000Z'),
            lastClientForegroundAt: new Date('2026-04-09T00:00:20.000Z'),
            lastClientBackgroundAt: new Date('2026-04-09T00:00:30.000Z'),
            reportedEndedAt: '2026-04-09T00:00:40.000Z',
            totalBackgroundTimeMs: 25_000,
            storedBackgroundTimeSeconds: 12,
            endReason: 'background_timeout',
            maxRecordingMinutes: 10,
        });

        expect(resolvedClose.endedAt.toISOString()).toBe('2026-04-09T00:00:30.000Z');
        expect(resolvedClose.backgroundTimeSeconds).toBe(15);
        expect(resolvedClose.durationSeconds).toBe(15);
        expect(resolvedClose.usedReportedEndedAt).toBe(false);
    });

    it('ignores reopen-time endedAt for recovery finalize and prefers replay evidence', () => {
        const resolvedClose = resolveAuthoritativeSessionClose({
            startedAt: new Date('2026-04-09T00:00:00.000Z'),
            lastClientEventAt: new Date('2026-04-09T00:00:21.000Z'),
            latestReplayEndMs: new Date('2026-04-09T00:00:22.000Z').getTime(),
            reportedEndedAt: '2026-04-09T00:00:45.000Z',
            endReason: 'recovery_finalize',
            maxRecordingMinutes: 10,
        });

        expect(resolvedClose.endedAt.toISOString()).toBe('2026-04-09T00:00:22.000Z');
        expect(resolvedClose.source).toBe('recovery_replay');
        expect(resolvedClose.usedReportedEndedAt).toBe(false);
    });

    it('lets lifecycle v3 close anchors override bad reported endedAt values', () => {
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

    it('caps a session at the next session start for the same device', () => {
        const resolvedClose = resolveAuthoritativeSessionClose({
            startedAt: new Date('2026-04-09T00:00:00.000Z'),
            reportedEndedAt: '2026-04-09T00:00:50.000Z',
            successorStartedAt: new Date('2026-04-09T00:00:20.000Z'),
            maxRecordingMinutes: 10,
        });

        expect(resolvedClose.endedAt.toISOString()).toBe('2026-04-09T00:00:20.000Z');
        expect(resolvedClose.successorCapApplied).toBe(true);
    });

    it('falls back safely to ingest activity when evidence is sparse', () => {
        const resolvedClose = resolveAuthoritativeSessionClose({
            startedAt: new Date('2026-04-09T00:00:00.000Z'),
            lastIngestActivityAt: new Date('2026-04-09T00:00:07.000Z'),
            maxRecordingMinutes: 10,
        });

        expect(resolvedClose.endedAt.toISOString()).toBe('2026-04-09T00:00:07.000Z');
        expect(resolvedClose.source).toBe('ingest_activity');
    });

    it('does not let reconciliation stretch a session after an explicit end already exists', () => {
        const resolvedClose = resolveAuthoritativeSessionClose({
            startedAt: new Date('2026-04-09T00:00:00.000Z'),
            persistedEndedAt: new Date('2026-04-09T00:00:20.000Z'),
            explicitEndedAtCap: new Date('2026-04-09T00:00:20.000Z'),
            lastClientEventAt: new Date('2026-04-09T00:00:35.000Z'),
            latestReplayEndMs: new Date('2026-04-09T00:00:34.000Z').getTime(),
            maxRecordingMinutes: 10,
        });

        expect(resolvedClose.endedAt.toISOString()).toBe('2026-04-09T00:00:20.000Z');
        expect(resolvedClose.durationSeconds).toBe(20);
    });
});
