import { isTest } from '../config.js';
import { logger } from '../logger.js';

// Latest USD exchange rates, used to show multi-currency revenue as one USD total.
// open.er-api.com is free, keyless and covers ~160 currencies (including IQD and
// TRY, which the ECB feed lacks).
const FX_RATES_URL = 'https://open.er-api.com/v6/latest/USD';
const FRESH_FOR_MS = 6 * 60 * 60 * 1000;
const RETRY_AFTER_FAILURE_MS = 10 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5_000;

export interface UsdRates {
    /** Units of each lowercase currency per 1 USD. */
    rates: Record<string, number>;
    asOf: string;
}

let cached: UsdRates | null = null;
let cachedAt = 0;
let lastFailureAt = 0;
let inflight: Promise<UsdRates | null> | null = null;

/** Latest rates, or the last good ones when the provider is unreachable; null if never loaded. */
export async function getUsdRates(): Promise<UsdRates | null> {
    if (isTest) return cached;
    const now = Date.now();
    if (cached && now - cachedAt < FRESH_FOR_MS) return cached;
    if (now - lastFailureAt < RETRY_AFTER_FAILURE_MS) return cached;
    inflight ??= fetchUsdRates().finally(() => { inflight = null; });
    return inflight;
}

async function fetchUsdRates(): Promise<UsdRates | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
        const response = await fetch(FX_RATES_URL, { signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = await response.json() as { result?: string; rates?: Record<string, unknown>; time_last_update_utc?: string };
        if (body.result !== 'success' || !body.rates) throw new Error('Unexpected exchange rate payload');
        const rates: Record<string, number> = {};
        for (const [code, value] of Object.entries(body.rates)) {
            if (typeof value === 'number' && Number.isFinite(value) && value > 0) rates[code.toLowerCase()] = value;
        }
        rates.usd = 1;
        cached = { rates, asOf: body.time_last_update_utc ? new Date(body.time_last_update_utc).toISOString() : new Date().toISOString() };
        cachedAt = Date.now();
        return cached;
    } catch (error) {
        lastFailureAt = Date.now();
        logger.warn({ err: error }, 'Exchange rate fetch failed');
        return cached;
    } finally {
        clearTimeout(timer);
    }
}

/** Converts minor units (cents) of `currency` to USD cents, or null when the rate is unknown. */
export function toUsdCents(amountCents: number, currency: string, rates: UsdRates): number | null {
    const rate = rates.rates[currency.toLowerCase()];
    return rate ? Math.round(amountCents / rate) : null;
}

/** Test hook. */
export function setUsdRatesForTests(rates: UsdRates | null): void {
    cached = rates;
    cachedAt = rates ? Date.now() : 0;
    lastFailureAt = 0;
}
