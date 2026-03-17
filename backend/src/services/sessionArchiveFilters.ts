import { sql, type SQL } from 'drizzle-orm';

import { sessionMetrics } from '../db/client.js';

export const SESSION_ARCHIVE_ISSUE_FILTERS = [
    'all',
    'crashes',
    'anrs',
    'errors',
    'rage',
    'dead_taps',
    'slow_start',
    'slow_api',
] as const;

export type SessionArchiveIssueFilter = typeof SESSION_ARCHIVE_ISSUE_FILTERS[number];

export function normalizeSessionArchiveIssueFilter(raw: unknown): SessionArchiveIssueFilter | null {
    if (typeof raw !== 'string') return null;
    return SESSION_ARCHIVE_ISSUE_FILTERS.includes(raw as SessionArchiveIssueFilter)
        ? (raw as SessionArchiveIssueFilter)
        : null;
}

export function sessionArchiveIssueFilterUsesMetrics(
    filter: SessionArchiveIssueFilter | null | undefined
): boolean {
    return Boolean(filter && filter !== 'all');
}

export function getSessionArchiveIssueFilterCondition(
    filter: SessionArchiveIssueFilter | null | undefined
): SQL | undefined {
    switch (filter) {
        case 'crashes':
            return sql`coalesce(${sessionMetrics.crashCount}, 0) > 0`;
        case 'anrs':
            return sql`coalesce(${sessionMetrics.anrCount}, 0) > 0`;
        case 'errors':
            return sql`coalesce(${sessionMetrics.errorCount}, 0) > 0`;
        case 'rage':
            return sql`coalesce(${sessionMetrics.rageTapCount}, 0) > 3`;
        case 'dead_taps':
            return sql`coalesce(${sessionMetrics.deadTapCount}, 0) > 0`;
        case 'slow_start':
            return sql`coalesce(${sessionMetrics.appStartupTimeMs}, 0) > 3000`;
        case 'slow_api':
            return sql`coalesce(${sessionMetrics.apiAvgResponseMs}, 0) > 1000`;
        default:
            return undefined;
    }
}
