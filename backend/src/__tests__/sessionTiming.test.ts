import { describe, expect, it } from 'vitest';
import {
    computeSessionDurationSeconds,
    preserveExistingSessionEndedAt,
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
});
