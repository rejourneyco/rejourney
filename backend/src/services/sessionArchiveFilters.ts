import { sql, type SQL } from 'drizzle-orm';

import { sessionMetrics, sessions } from '../db/client.js';

export const SESSION_ARCHIVE_ISSUE_FILTERS = [
    'all',
    'crashes',
    'anrs',
    'errors',
    'rage',
    'dead_taps',
    'slow_start',
    'slow_api',
    'new_user',
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
    return Boolean(filter && filter !== 'all' && filter !== 'new_user');
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
        case 'new_user':
            // First-ever session for this visitor (device → anonymous → user id) in the project.
            return sql`
                coalesce(${sessions.deviceId}, ${sessions.anonymousHash}, ${sessions.userDisplayId}) is not null
                and not exists (
                    select 1 from sessions as earlier
                    where earlier.project_id = ${sessions.projectId}
                    and coalesce(earlier.device_id, earlier.anonymous_hash, earlier.user_display_id)
                        = coalesce(${sessions.deviceId}, ${sessions.anonymousHash}, ${sessions.userDisplayId})
                    and (
                        earlier.started_at < ${sessions.startedAt}
                        or (earlier.started_at = ${sessions.startedAt} and earlier.id < ${sessions.id})
                    )
                )
            `;
        default:
            return undefined;
    }
}
