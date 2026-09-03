import { describe, expect, it } from 'vitest';
import { buildRetentionCohortRows } from '../services/retentionCohorts.js';

describe('buildRetentionCohortRows', () => {
    it('builds weekly cohorts with retention percentages', () => {
        const rows = buildRetentionCohortRows([
            { userKey: 'u1', weekStartKey: '2026-03-01' },
            { userKey: 'u2', weekStartKey: '2026-03-01' },
            { userKey: 'u1', weekStartKey: '2026-03-08' },
            { userKey: 'u3', weekStartKey: '2026-03-08' },
            { userKey: 'u3', weekStartKey: '2026-03-15' },
        ], { weeks: 4, maxRows: 4 });

        expect(rows).toEqual([
            {
                weekStartKey: '2026-03-01',
                users: 2,
                retention: [100, 50, 0, null],
            },
            {
                weekStartKey: '2026-03-08',
                users: 1,
                retention: [100, 100, null, null],
            },
        ]);
    });

    it('uses the ledger first-seen week so returning visitors do not re-enter as a new cohort', () => {
        const rows = buildRetentionCohortRows([
            // u1 first seen (per ledger) a week before the loaded window: not a new cohort member.
            { userKey: 'u1', weekStartKey: '2026-03-08', firstWeekStartKey: '2026-03-01' },
            { userKey: 'u1', weekStartKey: '2026-03-15', firstWeekStartKey: '2026-03-01' },
            // u2 genuinely new in the first loaded week; ledger agrees.
            { userKey: 'u2', weekStartKey: '2026-03-08', firstWeekStartKey: '2026-03-08' },
            { userKey: 'u2', weekStartKey: '2026-03-15', firstWeekStartKey: '2026-03-08' },
            // u3 has no ledger row yet: observed minimum still applies.
            { userKey: 'u3', weekStartKey: '2026-03-15', firstWeekStartKey: null },
        ], { weeks: 3, maxRows: 3 });

        expect(rows).toEqual([
            {
                weekStartKey: '2026-03-08',
                users: 1,
                retention: [100, 100, null],
            },
            {
                weekStartKey: '2026-03-15',
                users: 1,
                retention: [100, null, null],
            },
        ]);
    });

    it('deduplicates repeated activity rows and keeps only the latest cohort rows', () => {
        const rows = buildRetentionCohortRows([
            { userKey: 'u1', weekStartKey: '2026-02-01' },
            { userKey: 'u1', weekStartKey: '2026-02-01' },
            { userKey: 'u2', weekStartKey: '2026-02-08' },
            { userKey: 'u3', weekStartKey: '2026-02-15' },
        ], { weeks: 2, maxRows: 2 });

        expect(rows).toEqual([
            {
                weekStartKey: '2026-02-08',
                users: 1,
                retention: [100, 0],
            },
            {
                weekStartKey: '2026-02-15',
                users: 1,
                retention: [100, null],
            },
        ]);
    });
});
