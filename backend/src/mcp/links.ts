/**
 * Dashboard deep links. These are the only URLs MCP results contain, and they
 * always point at the configured dashboard origin.
 */

export interface DashboardLinks {
    /** Base URL without a trailing slash. */
    base: string;
    session(sessionId: string, seekToEpochMs?: number): string;
    issue(issueId: string): string;
}

export function createDashboardLinks(baseUrl: string): DashboardLinks {
    const parsed = new URL(baseUrl);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        throw new Error('Dashboard base URL must be http(s)');
    }
    const base = `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`;
    return {
        base,
        session(sessionId, seekToEpochMs) {
            const link = `${base}/dashboard/sessions/${encodeURIComponent(sessionId)}`;
            return seekToEpochMs !== undefined && Number.isFinite(seekToEpochMs)
                ? `${link}?seekToTimestamp=${Math.round(seekToEpochMs)}`
                : link;
        },
        issue(issueId) {
            return `${base}/dashboard/general/${encodeURIComponent(issueId)}`;
        },
    };
}
