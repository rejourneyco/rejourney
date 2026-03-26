import { type SQL, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

const DEFAULT_REJOURNEY_API_HOSTS = ['api.rejourney.co'];
const INTERNAL_ENDPOINT_PREFIXES = ['/api/ingest', '/upload/artifacts'];

function toPathOnly(endpoint: string): string {
    const trimmed = endpoint.trim().toLowerCase();
    if (!trimmed) return '';

    const withoutMethod = trimmed.replace(/^(get|post|put|patch|delete|options|head)\s+/, '');

    try {
        return new URL(withoutMethod).pathname.toLowerCase();
    } catch {
        return withoutMethod.split('?')[0];
    }
}

function isInternalRejourneyPath(path: string): boolean {
    return INTERNAL_ENDPOINT_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

function parseExtraApiHosts(): string[] {
    const raw = process.env.RJ_INTERNAL_API_HOSTS?.trim();
    if (!raw) return [];
    return raw
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
}

/** Hostnames used by the ReJourney backend (ingest, device auth, etc.). */
export function isRejourneyConfiguredApiHost(host: string): boolean {
    const h = host.toLowerCase().replace(/\.$/, '');
    if (!h) return false;
    if (DEFAULT_REJOURNEY_API_HOSTS.includes(h)) return true;
    return parseExtraApiHosts().includes(h);
}

/**
 * Rollup row key is usually `METHOD /path` (pathname only). We can only reliably
 * exclude ReJourney storage URLs (`rejourney` in the string). We do **not** exclude
 * `/api/ingest` here — a customer app may use the same path on their own origin.
 */
export function shouldExcludeFromEndpointProductAnalytics(endpoint: string): boolean {
    const lowered = endpoint.toLowerCase();
    if (lowered.includes('rejourney')) return true;
    const path = toPathOnly(endpoint);
    return isInternalRejourneyPath(path);
}

/**
 * Ingest-time exclusion: uses `urlHost` / parsed URL host so `/api/ingest` on
 * `api.rejourney.co` is dropped, but `/api/ingest` on the customer API is kept.
 */
export function shouldExcludeNetworkEventFromProductAnalytics(event: {
    method?: string;
    url?: string;
    endpoint?: string;
    urlHost?: string | null;
}): boolean {
    const rawUrl = String(event.url || event.endpoint || '');
    const method = String(event.method || 'GET').toUpperCase();
    const combined = `${method} ${rawUrl}`.toLowerCase();
    if (combined.includes('rejourney')) return true;

    let host = String(event.urlHost || '').toLowerCase().trim();
    if (!host && rawUrl) {
        try {
            host = new URL(rawUrl).host.toLowerCase();
        } catch {
            /* relative URL — no host */
        }
    }

    let path = rawUrl;
    try {
        path = new URL(rawUrl).pathname;
    } catch {
        path = rawUrl.startsWith('/') ? rawUrl.split('?')[0] : rawUrl;
    }
    const pathNorm = path.split('?')[0].toLowerCase();
    const isIngestPath = pathNorm === '/api/ingest' || pathNorm.startsWith('/api/ingest/');
    const isUploadRelayPath = pathNorm === '/upload/artifacts' || pathNorm.startsWith('/upload/artifacts/');
    if (isUploadRelayPath) return true;
    if (isIngestPath && (!host || isRejourneyConfiguredApiHost(host))) return true;

    return false;
}

/**
 * SQL predicate for rollup rows: only paths containing `rejourney` (storage, etc.).
 * Path-only `/api/ingest/*` rows cannot be attributed to ReJourney vs customer in SQL.
 */
export function excludeInternalToolEndpointTraffic(endpointColumn: AnyPgColumn): SQL {
    return sql`(
        lower(${endpointColumn}) NOT LIKE '%rejourney%'
        AND lower(${endpointColumn}) NOT LIKE '%/api/ingest%'
        AND lower(${endpointColumn}) NOT LIKE '%/upload/artifacts%'
    )`;
}
