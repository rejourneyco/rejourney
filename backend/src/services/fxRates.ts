import { pool } from '../db/client.js';
import { logger } from '../logger.js';
import { setBoundedMapEntry } from '../utils/boundedMap.js';

// Daily USD exchange rates, used to show multi-currency revenue as one USD total.
// As in standard accounting practice, each day's revenue converts at that day's rate.
// A day's rates are stored once (fx_rates_daily) and never change, so past revenue
// keeps its USD value and every server converts it the same way.
// fawazahmed0/currency-api is free, keyless, has daily files back to 2024-03-02 and
// covers every currency we have seen (including IQD and TRY, which the ECB feed lacks).
const RATE_FILE_URLS = [
    (version: string) => `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${version}/v1/currencies/usd.json`,
    (version: string) => `https://${version}.currency-api.pages.dev/v1/currencies/usd.json`,
];
const RATES_SOURCE = 'fawazahmed0';
const EARLIEST_RATES_DATE = '2024-03-02';
/** A day's file may be late or missing; the closest earlier file stands in for it. */
const MAX_DAYS_BACK = 7;
const FETCH_TIMEOUT_MS = 5_000;
const RETRY_AFTER_FAILURE_MS = 10 * 60 * 1000;
const MAX_CONCURRENT_FETCHES = 6;
/** Longer backfills finish in the background and show on the next load. */
const REQUEST_WAIT_MS = 3_000;
const CACHE_MAX_DATES = 500;
const DAY_MS = 24 * 60 * 60 * 1000;

const ISO_CURRENCIES = new Set(Intl.supportedValuesOf('currency').map((code) => code.toLowerCase()));

export interface UsdRates {
    /** Units of each lowercase currency per 1 USD. */
    rates: Record<string, number>;
    /** Day (YYYY-MM-DD) the rates were published for. */
    asOf: string;
}

/** Rates per day; a day's rates never change, so entries never go stale. */
const cache = new Map<string, UsdRates>();
const inflight = new Map<string, Promise<void>>();
const fetchQueue: Array<() => void> = [];
let activeFetches = 0;
let lastFailureAt = 0;

function addDays(date: string, days: number): string {
    return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

function earlier(a: string, b: string): string {
    return a < b ? a : b;
}

/** The day's rate file, or null if it is not published. Throws when the provider is unreachable. */
async function fetchRateFile(version: string): Promise<UsdRates | null> {
    let lastError: unknown = null;
    for (const url of RATE_FILE_URLS) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
        try {
            const response = await fetch(url(version), { signal: controller.signal });
            if (response.status === 404) return null;
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const body = await response.json() as { date?: string; usd?: Record<string, unknown> };
            if (!body.usd) throw new Error('Unexpected exchange rate payload');
            const rates: Record<string, number> = {};
            for (const [code, value] of Object.entries(body.usd)) {
                if (ISO_CURRENCIES.has(code) && typeof value === 'number' && Number.isFinite(value) && value > 0) rates[code] = value;
            }
            rates.usd = 1;
            return { rates, asOf: body.date ?? version };
        } catch (error) {
            lastError = error;
        } finally {
            clearTimeout(timer);
        }
    }
    throw lastError;
}

async function fetchAndStoreRates(date: string): Promise<void> {
    const today = new Date().toISOString().slice(0, 10);
    const newest = date < EARLIEST_RATES_DATE ? EARLIEST_RATES_DATE : earlier(date, today);
    for (let back = 0; back <= MAX_DAYS_BACK; back += 1) {
        const version = addDays(newest, -back);
        if (version < EARLIEST_RATES_DATE) break;
        const file = await fetchRateFile(version);
        if (!file) continue;
        // First writer wins, so the servers agree and a stored day never changes.
        await pool.query(
            `INSERT INTO fx_rates_daily (date, rates, rates_date, source)
             VALUES ($1::date, $2::jsonb, $3::date, $4)
             ON CONFLICT (date) DO NOTHING`,
            [date, JSON.stringify(file.rates), file.asOf, RATES_SOURCE],
        );
        return;
    }
    logger.warn({ date }, 'No exchange rate file found for date');
}

function runFetch(date: string): Promise<void> {
    return new Promise<void>((resolve) => {
        const start = () => {
            activeFetches += 1;
            const failedRecently = Date.now() - lastFailureAt < RETRY_AFTER_FAILURE_MS;
            (failedRecently ? Promise.resolve() : fetchAndStoreRates(date))
                .catch((error) => {
                    lastFailureAt = Date.now();
                    logger.warn({ err: error, date }, 'Exchange rate fetch failed');
                })
                .finally(() => {
                    activeFetches -= 1;
                    fetchQueue.shift()?.();
                    resolve();
                });
        };
        if (activeFetches < MAX_CONCURRENT_FETCHES) start();
        else fetchQueue.push(start);
    });
}

function ensureStored(date: string): Promise<void> {
    let pending = inflight.get(date);
    if (!pending) {
        pending = runFetch(date).finally(() => inflight.delete(date));
        inflight.set(date, pending);
    }
    return pending;
}

async function loadStoredRates(dates: string[], found: Map<string, UsdRates>): Promise<void> {
    if (dates.length === 0) return;
    const { rows } = await pool.query<{ date: string; rates: Record<string, number>; rates_date: string }>(
        `SELECT date::text AS date, rates, rates_date::text AS rates_date FROM fx_rates_daily WHERE date = ANY($1::date[])`,
        [dates],
    );
    for (const row of rows) {
        const entry = { rates: row.rates, asOf: row.rates_date };
        setBoundedMapEntry(cache, row.date, entry, CACHE_MAX_DATES);
        found.set(row.date, entry);
    }
}

/** Closest date in `found`, preferring an earlier one. */
function closestRates(date: string, found: Map<string, UsdRates>): UsdRates | null {
    const known = [...found.keys()].sort();
    const previous = known.filter((candidate) => candidate <= date).pop();
    const next = known.find((candidate) => candidate > date);
    const pick = previous ?? next;
    return pick ? found.get(pick) ?? null : null;
}

/**
 * Rates for each date (YYYY-MM-DD). A date not stored yet is fetched and stored for
 * good. Until that succeeds it borrows the closest stored rates for this response
 * only. Null when no rates are available at all.
 */
export async function getUsdRatesByDate(dates: Iterable<string>): Promise<Map<string, UsdRates> | null> {
    const wanted = [...new Set(dates)];
    const found = new Map<string, UsdRates>();
    for (const date of wanted) {
        const cached = cache.get(date);
        if (cached) found.set(date, cached);
    }
    await loadStoredRates(wanted.filter((date) => !found.has(date)), found);

    const missing = wanted.filter((date) => !found.has(date));
    if (missing.length === 0) return found;

    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
        Promise.all(missing.map(ensureStored)),
        new Promise<void>((resolve) => { timer = setTimeout(resolve, REQUEST_WAIT_MS); }),
    ]);
    clearTimeout(timer);
    await loadStoredRates(missing, found);

    const unresolved = missing.filter((date) => !found.has(date));
    if (unresolved.length === 0) return found;

    const stored = new Map(found);
    if (stored.size === 0) {
        const { rows } = await pool.query<{ date: string; rates: Record<string, number>; rates_date: string }>(
            `SELECT date::text AS date, rates, rates_date::text AS rates_date FROM fx_rates_daily ORDER BY date DESC LIMIT 1`,
        );
        if (rows[0]) stored.set(rows[0].date, { rates: rows[0].rates, asOf: rows[0].rates_date });
    }
    if (stored.size === 0) return null;
    for (const date of unresolved) {
        const standIn = closestRates(date, stored);
        if (standIn) found.set(date, standIn);
    }
    return found;
}

/** Converts minor units (cents) of `currency` to USD cents, or null when the rate is unknown. */
export function toUsdCents(amountCents: number, currency: string, rates: UsdRates): number | null {
    const rate = rates.rates[currency.toLowerCase()];
    return rate ? Math.round(amountCents / rate) : null;
}

/** Test hook. */
export function resetUsdRatesForTests(): void {
    cache.clear();
    inflight.clear();
    fetchQueue.length = 0;
    activeFetches = 0;
    lastFailureAt = 0;
}
