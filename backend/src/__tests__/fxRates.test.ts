import { describe, expect, it } from 'vitest';

import { toUsdCents } from '../services/fxRates.js';

const rates = { rates: { usd: 1, eur: 0.9, iqd: 1518, try: 49.8 }, asOf: '2026-10-28T00:00:00.000Z' };

describe('toUsdCents', () => {
    it('converts minor units of each currency into USD cents', () => {
        expect(toUsdCents(150000, 'iqd', rates)).toBe(99);
        expect(toUsdCents(297, 'EUR', rates)).toBe(330);
        expect(toUsdCents(4999, 'try', rates)).toBe(100);
        expect(toUsdCents(1234, 'usd', rates)).toBe(1234);
    });

    it('returns null for a currency without a rate', () => {
        expect(toUsdCents(100, 'xyz', rates)).toBeNull();
    });
});
