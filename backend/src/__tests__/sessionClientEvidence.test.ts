import { describe, expect, it } from 'vitest';
import { collectSessionClientEvidence, coerceTimestampToDate } from '../services/sessionClientEvidence.js';

describe('sessionClientEvidence', () => {
    it('coerces seconds, milliseconds, iso strings, and dates into valid timestamps', () => {
        const iso = '2026-04-09T12:00:10.000Z';
        const ms = Date.parse(iso);
        const seconds = Math.trunc(ms / 1000);
        const asDate = new Date(iso);

        expect(coerceTimestampToDate(seconds)?.toISOString()).toBe(iso);
        expect(coerceTimestampToDate(ms)?.toISOString()).toBe(iso);
        expect(coerceTimestampToDate(iso)?.toISOString()).toBe(iso);
        expect(coerceTimestampToDate(asDate)?.toISOString()).toBe(iso);
        expect(coerceTimestampToDate('')).toBeNull();
        expect(coerceTimestampToDate('not-a-date')).toBeNull();
    });

    it('collects client timing evidence and foreground background totals from artifacts', () => {
        const backgroundAtIso = '2026-04-09T12:00:10.000Z';
        const foregroundAtIso = '2026-04-09T12:00:15.000Z';
        const latestEventIso = '2026-04-09T12:00:20.000Z';
        const backgroundAtSeconds = Math.trunc(Date.parse(backgroundAtIso) / 1000);
        const foregroundAtMs = Date.parse(foregroundAtIso);

        const evidence = collectSessionClientEvidence([
            { type: 'navigation', timestamp: '2026-04-09T12:00:03.000Z' },
            { type: 'app_background', timestamp: backgroundAtSeconds },
            { type: 'app_foreground', timestamp: foregroundAtMs, totalBackgroundTime: 2_000 },
            { type: 'app_foreground', timestamp: latestEventIso, totalBackgroundTime: '3000' },
        ]);

        expect(evidence.maxClientEventAt?.toISOString()).toBe(latestEventIso);
        expect(evidence.maxClientForegroundAt?.toISOString()).toBe(latestEventIso);
        expect(evidence.maxClientBackgroundAt?.toISOString()).toBe(backgroundAtIso);
        expect(evidence.artifactBackgroundSeconds).toBe(5);
    });
});
