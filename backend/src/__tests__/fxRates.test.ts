import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../db/client.js', () => ({ pool: { query: mocks.query } }));
vi.mock('../logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn() } }));

import { getUsdRatesByDate, resetUsdRatesForTests, toUsdCents } from '../services/fxRates.js';

const rates = { rates: { usd: 1, eur: 0.9, iqd: 1518, try: 49.8 }, asOf: '2026-10-28' };

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

describe('getUsdRatesByDate', () => {
    /** Stands in for fx_rates_daily: first write for a date wins. */
    let stored: Map<string, { date: string; rates: Record<string, number>; rates_date: string }>;
    let published: Record<string, Record<string, unknown>>;
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        resetUsdRatesForTests();
        stored = new Map();
        published = {};
        mocks.query.mockReset();
        mocks.query.mockImplementation(async (text: string, params?: unknown[]) => {
            if (text.includes('INSERT INTO fx_rates_daily')) {
                const [date, json, ratesDate] = params as [string, string, string];
                if (!stored.has(date)) stored.set(date, { date, rates: JSON.parse(json), rates_date: ratesDate });
                return { rows: [] };
            }
            if (text.includes('ANY($1::date[])')) {
                return { rows: (params![0] as string[]).flatMap((date) => stored.get(date) ?? []) };
            }
            return { rows: [...stored.values()].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 1) };
        });
        fetchMock = vi.fn(async (url: string) => {
            const version = /@(\d{4}-\d{2}-\d{2})|\/\/(\d{4}-\d{2}-\d{2})/.exec(url);
            const usd = published[version?.[1] ?? version?.[2] ?? ''];
            return usd
                ? { ok: true, status: 200, json: async () => ({ date: version?.[1] ?? version?.[2], usd }) }
                : { ok: false, status: 404, json: async () => ({}) };
        });
        vi.stubGlobal('fetch', fetchMock);
    });

    it('gives each date its own rates and keeps only real currencies', async () => {
        published['2026-10-27'] = { usd: 1, eur: 0.9, btc: 0.00001 };
        published['2026-10-28'] = { usd: 1, eur: 0.8 };

        const result = await getUsdRatesByDate(['2026-10-27', '2026-10-28', '2026-10-27']);

        expect(result?.get('2026-10-27')).toEqual({ rates: { usd: 1, eur: 0.9 }, asOf: '2026-10-27' });
        expect(result?.get('2026-10-28')?.rates.eur).toBe(0.8);
    });

    it('never changes a stored day, whatever the provider publishes later', async () => {
        published['2026-10-27'] = { usd: 1, eur: 0.9 };
        const first = await getUsdRatesByDate(['2026-10-27']);

        published['2026-10-27'] = { usd: 1, eur: 0.5 };
        resetUsdRatesForTests();
        const second = await getUsdRatesByDate(['2026-10-27']);

        expect(first?.get('2026-10-27')?.rates.eur).toBe(0.9);
        expect(second?.get('2026-10-27')?.rates.eur).toBe(0.9);
    });

    it('serves stored days without calling the provider again', async () => {
        published['2026-10-27'] = { usd: 1, eur: 0.9 };
        await getUsdRatesByDate(['2026-10-27']);
        fetchMock.mockClear();
        mocks.query.mockClear();

        await getUsdRatesByDate(['2026-10-27']);

        expect(fetchMock).not.toHaveBeenCalled();
        expect(mocks.query).not.toHaveBeenCalled();
    });

    it('uses the closest earlier file when a day has none, and records which', async () => {
        published['2026-10-25'] = { usd: 1, eur: 0.7 };

        const result = await getUsdRatesByDate(['2026-10-27']);

        expect(result?.get('2026-10-27')).toEqual({ rates: { usd: 1, eur: 0.7 }, asOf: '2026-10-25' });
        expect(stored.get('2026-10-27')?.rates_date).toBe('2026-10-25');
    });

    it('freezes a future-dated day at the newest published file', async () => {
        const today = new Date().toISOString().slice(0, 10);
        published[today] = { usd: 1, eur: 0.6 };

        const result = await getUsdRatesByDate(['2999-01-01']);

        expect(result?.get('2999-01-01')?.rates.eur).toBe(0.6);
    });

    it('uses the first published file for days before the provider began', async () => {
        published['2024-03-02'] = { usd: 1, gbp: 0.79 };

        const result = await getUsdRatesByDate(['2023-06-01']);

        expect(result?.get('2023-06-01')?.rates.gbp).toBe(0.79);
    });

    it('borrows stored rates for this response only when the provider is down', async () => {
        published['2026-10-27'] = { usd: 1, eur: 0.9 };
        await getUsdRatesByDate(['2026-10-27']);
        fetchMock.mockRejectedValue(new Error('network down'));

        const result = await getUsdRatesByDate(['2026-10-27', '2026-10-28']);

        expect(result?.get('2026-10-28')?.rates.eur).toBe(0.9);
        expect(stored.has('2026-10-28')).toBe(false);
    });

    it('stores the real rates once the provider recovers', async () => {
        published['2026-10-27'] = { usd: 1, eur: 0.9 };
        await getUsdRatesByDate(['2026-10-27']);
        fetchMock.mockRejectedValueOnce(new Error('down')).mockRejectedValueOnce(new Error('down'));
        await getUsdRatesByDate(['2026-10-28']);
        resetUsdRatesForTests();
        published['2026-10-28'] = { usd: 1, eur: 0.8 };

        const result = await getUsdRatesByDate(['2026-10-28']);

        expect(result?.get('2026-10-28')?.rates.eur).toBe(0.8);
    });

    it('returns null when no rates exist at all', async () => {
        fetchMock.mockRejectedValue(new Error('network down'));

        expect(await getUsdRatesByDate(['2026-10-27'])).toBeNull();
    });
});
