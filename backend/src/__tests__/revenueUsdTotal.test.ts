import { describe, expect, it } from 'vitest';

import { mergeDailyRowsAsUsd } from '../services/revenueSources.js';

const row = (date: string, cents: number) => ({
    date,
    currency: 'eur',
    grossAmountCents: cents,
    refundAmountCents: 0,
    feeAmountCents: 0,
    netAmountCents: cents,
    transactionCount: 1,
    refundCount: 0,
    subscriberCount: 0,
    trialCount: 0,
    subscriptionStartCount: 0,
    cancellationCount: 0,
    conversionCount: 0,
    customEventCounts: {},
});
const day = (asOf: string, eur: number) => ({ rates: { usd: 1, eur }, asOf });

describe('mergeDailyRowsAsUsd', () => {
    it('converts each day at its own rates', () => {
        const merged = mergeDailyRowsAsUsd(
            [{ currency: 'eur', daily: [row('2026-10-01', 1000), row('2026-10-02', 1000)] }],
            new Map([['2026-10-01', day('2026-10-01', 0.8)], ['2026-10-02', day('2026-10-02', 0.5)]]),
        );
        expect(merged.map((entry) => entry.grossAmountCents)).toEqual([1250, 2000]);
    });

    it('leaves a past day unchanged when a newer day has a different rate', () => {
        const past = [{ currency: 'eur', daily: [row('2026-10-01', 999)] }];
        const before = mergeDailyRowsAsUsd(past, new Map([['2026-10-01', day('2026-10-01', 0.8)]]));
        const after = mergeDailyRowsAsUsd(past, new Map([
            ['2026-10-01', day('2026-10-01', 0.8)],
            ['2026-10-02', day('2026-10-02', 0.5)],
        ]));
        expect(after).toEqual(before);
    });

    it('reports a currency the day has no rate for', () => {
        const unconverted = new Set<string>();
        const merged = mergeDailyRowsAsUsd(
            [{ currency: 'xyz', daily: [row('2026-10-01', 1000)] }],
            new Map([['2026-10-01', day('2026-10-01', 0.8)]]),
            unconverted,
        );
        expect(merged[0]?.grossAmountCents).toBe(0);
        expect([...unconverted]).toEqual(['xyz']);
    });
});
