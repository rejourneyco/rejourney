/**
 * Session archive list: text search, allowlisted column sorts, and keyset cursors for GET /api/sessions.
 */
import { Buffer } from 'node:buffer';

import { and, eq, gt, ilike, lt, or, sql, type SQL } from 'drizzle-orm';

import { sessionMetrics, sessions } from '../db/client.js';

export const ARCHIVE_LIST_SORT_KEYS = [
    'date',
    'duration',
    'apiResponse',
    'startup',
    'screens',
    'apiSuccess',
    'apiError',
    'crashes',
    'anrs',
    'errors',
    'rage',
    'network',
] as const;

export type ArchiveListSortKey = (typeof ARCHIVE_LIST_SORT_KEYS)[number];

export type ArchiveListSortDir = 'asc' | 'desc';

export function normalizeArchiveListSortKey(raw: unknown): ArchiveListSortKey {
    if (typeof raw === 'string' && (ARCHIVE_LIST_SORT_KEYS as readonly string[]).includes(raw)) {
        return raw as ArchiveListSortKey;
    }
    return 'date';
}

export function normalizeArchiveListSortDir(raw: unknown): ArchiveListSortDir {
    if (raw === 'asc' || raw === 'ASC') return 'asc';
    return 'desc';
}

export function archiveListSortNeedsMetricsJoin(sortKey: ArchiveListSortKey): boolean {
    return sortKey !== 'date' && sortKey !== 'duration';
}

/** Escape `%` and `_` for ILIKE patterns. */
export function escapeIlikePattern(input: string): string {
    return input.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

export function buildArchiveTextSearchCondition(trimmedQuery: string): SQL | null {
    const q = trimmedQuery.trim();
    if (!q) return null;
    const pattern = `%${escapeIlikePattern(q)}%`;
    return or(
        ilike(sessions.id, pattern),
        ilike(sessions.userDisplayId, pattern),
        ilike(sessions.deviceId, pattern),
        ilike(sessions.deviceModel, pattern),
        ilike(sessions.anonymousHash, pattern),
        ilike(sessions.anonymousDisplayId, pattern)
    )!;
}

/**
 * Sort expression (must match ORDER BY and cursor keyset). Uses sessions + left-joined session_metrics.
 */
export function archiveListSortSqlExpr(sortKey: ArchiveListSortKey): SQL {
    switch (sortKey) {
        case 'date':
            return sql<Date>`${sessions.startedAt}`;
        case 'duration':
            // Wall-clock–style duration from session row (matches common list ordering; may differ slightly from durationSecondsForDisplay replay cap).
            return sql<number>`
                COALESCE(
                    ${sessions.durationSeconds}::double precision,
                    GREATEST(
                        0::double precision,
                        FLOOR(
                            EXTRACT(
                                EPOCH FROM (
                                    COALESCE(${sessions.endedAt}, ${sessions.lastIngestActivityAt}) - ${sessions.startedAt}
                                )
                            )
                        )::double precision - COALESCE(${sessions.backgroundTimeSeconds}, 0)::double precision
                    )
                )
            `;
        case 'apiResponse':
            return sql<number>`COALESCE(${sessionMetrics.apiAvgResponseMs}, 0)::double precision`;
        case 'startup':
            return sql<number>`COALESCE(${sessionMetrics.appStartupTimeMs}, 0)::double precision`;
        case 'screens':
            return sql<number>`COALESCE(cardinality(${sessionMetrics.screensVisited}), 0)::int`;
        case 'apiSuccess':
            return sql<number>`COALESCE(${sessionMetrics.apiSuccessCount}, 0)::int`;
        case 'apiError':
            return sql<number>`COALESCE(${sessionMetrics.apiErrorCount}, 0)::int`;
        case 'crashes':
            return sql<number>`COALESCE(${sessionMetrics.crashCount}, 0)::int`;
        case 'anrs':
            return sql<number>`COALESCE(${sessionMetrics.anrCount}, 0)::int`;
        case 'errors':
            return sql<number>`COALESCE(${sessionMetrics.errorCount}, 0)::int`;
        case 'rage':
            return sql<number>`COALESCE(${sessionMetrics.rageTapCount}, 0)::int`;
        case 'network':
            return sql<number>`
                CASE LOWER(TRIM(COALESCE(${sessionMetrics.networkType}, '')))
                    WHEN 'wifi' THEN 3
                    WHEN '5g' THEN 3
                    WHEN '4g' THEN 2
                    WHEN 'lte' THEN 2
                    WHEN '3g' THEN 1
                    WHEN '2g' THEN 1
                    WHEN 'edge' THEN 1
                    WHEN 'cellular' THEN 2
                    ELSE 0
                END
            `;
        default:
            return sql<Date>`${sessions.startedAt}`;
    }
}

export type ParsedArchiveListCursor =
    | {
          kind: 'keyset_v2';
          sortKey: ArchiveListSortKey;
          sortDir: ArchiveListSortDir;
          id: string;
          kt: string | null;
          kn: number | null;
      }
    | { kind: 'legacy_id'; id: string };

export function encodeArchiveListCursor(params: {
    sortKey: ArchiveListSortKey;
    sortDir: ArchiveListSortDir;
    id: string;
    kt: string | null;
    kn: number | null;
}): string {
    const payload = {
        v: 2 as const,
        sk: params.sortKey,
        sd: params.sortDir,
        i: params.id,
        kt: params.kt,
        kn: params.kn,
    };
    return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function parseArchiveListCursor(raw: unknown): ParsedArchiveListCursor | null {
    if (typeof raw !== 'string' || raw.length === 0) return null;
    try {
        const payload = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as {
            v?: number;
            sk?: string;
            sd?: string;
            i?: string;
            kt?: string | null;
            kn?: number | null;
            s?: string;
        };
        if (payload.v === 2 && typeof payload.sk === 'string' && typeof payload.i === 'string') {
            const sk = normalizeArchiveListSortKey(payload.sk);
            const sd = normalizeArchiveListSortDir(payload.sd);
            return {
                kind: 'keyset_v2',
                sortKey: sk,
                sortDir: sd,
                id: payload.i,
                kt: typeof payload.kt === 'string' ? payload.kt : null,
                kn: typeof payload.kn === 'number' && Number.isFinite(payload.kn) ? payload.kn : null,
            };
        }
        if (typeof payload.s === 'string' && typeof payload.i === 'string') {
            return {
                kind: 'keyset_v2',
                sortKey: 'date',
                sortDir: 'desc',
                id: payload.i,
                kt: payload.s,
                kn: null,
            };
        }
    } catch {
        return { kind: 'legacy_id', id: raw };
    }
    return { kind: 'legacy_id', id: raw };
}

export function archiveKeysetMatchesRequest(
    parsed: ParsedArchiveListCursor,
    sortKey: ArchiveListSortKey,
    sortDir: ArchiveListSortDir
): boolean {
    if (parsed.kind === 'legacy_id') {
        return sortKey === 'date' && sortDir === 'desc';
    }
    return parsed.sortKey === sortKey && parsed.sortDir === sortDir;
}

export function buildArchiveListKeysetCondition(
    sortKey: ArchiveListSortKey,
    sortDir: ArchiveListSortDir,
    parsed: ParsedArchiveListCursor
): SQL | null {
    if (parsed.kind === 'legacy_id') {
        if (sortKey !== 'date' || sortDir !== 'desc') return null;
        return lt(sessions.id, parsed.id);
    }

    const expr = archiveListSortSqlExpr(sortKey);

    if (sortKey === 'date') {
        const iso = parsed.kt;
        if (!iso) return null;
        const startedAt = new Date(iso);
        if (Number.isNaN(startedAt.getTime())) return null;
        if (sortDir === 'desc') {
            return or(lt(sessions.startedAt, startedAt), and(eq(sessions.startedAt, startedAt), lt(sessions.id, parsed.id)))!;
        }
        return or(gt(sessions.startedAt, startedAt), and(eq(sessions.startedAt, startedAt), gt(sessions.id, parsed.id)))!;
    }

    const kn = parsed.kn;
    if (kn == null || !Number.isFinite(kn)) return null;

    if (sortDir === 'desc') {
        return sql`(${expr} < ${kn} OR (${expr} = ${kn} AND ${sessions.id} < ${parsed.id}))`;
    }
    return sql`(${expr} > ${kn} OR (${expr} = ${kn} AND ${sessions.id} > ${parsed.id}))`;
}

export function extractArchiveSortKeyFromRow(
    sortKey: ArchiveListSortKey,
    row: { archiveSortKey: unknown; session: { id: string; startedAt: Date } }
): { kt: string | null; kn: number | null } {
    if (sortKey === 'date') {
        const d = row.session.startedAt;
        return { kt: d.toISOString(), kn: null };
    }
    const v = row.archiveSortKey;
    if (v instanceof Date) {
        return { kt: v.toISOString(), kn: null };
    }
    const n = typeof v === 'number' ? v : Number(v);
    if (!Number.isFinite(n)) return { kt: null, kn: 0 };
    return { kt: null, kn: n };
}
