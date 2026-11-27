/**
 * Valid arguments for every registered tool, per team, drawn from the demo
 * seed. Several sets per tool: the first is the common path (used for the
 * round-trip and timing budgets), the rest widen what the leak scan sees.
 */
import type { DemoSeedManifest, DemoTeamManifest } from '../../mcp/demo/seed.js';

/** Covers every seeded session (the seed spans the 30 days before "now"). */
export const SEED_RANGE = { from: '2026-10-21T00:00:00.000Z', to: '2026-11-20T12:00:00.000Z' };

/** find_friction takes at most 30 days. */
export const FRICTION_RANGE = { from: '2026-10-21T12:00:00.000Z', to: '2026-11-20T12:00:00.000Z' };

export function toolCases(team: DemoTeamManifest): Record<string, Array<Record<string, unknown>>> {
    const project = team.projects[0];
    const s = team.special;
    const f = team.filterValues;
    const base = { projectId: project.id, ...SEED_RANGE };
    return {
        list_projects: [{}],
        get_usage: [{}],
        get_project_health: [base, { projectId: project.id }],
        find_friction: [
            { projectId: project.id },
            { projectId: project.id, ...FRICTION_RANGE },
            { projectId: project.id, ...FRICTION_RANGE, platform: 'mobile', appVersion: f.appVersion },
            { projectId: project.id, ...FRICTION_RANGE, screenName: f.screenName },
        ],
        search_sessions: [
            base,
            { ...base, userId: f.userId },
            { ...base, screenName: f.screenName, issueType: 'crash' },
            { ...base, customEventName: f.customEventName, hasReplay: true },
            { ...base, country: f.country, platform: 'mobile', appVersion: f.appVersion },
        ],
        sample_sessions: [{ ...base, size: 25, seed: 7 }, { ...base, issueType: 'error', size: 10 }],
        get_session: [{ sessionId: s.rageThenCrash.sessionId }, { sessionId: s.secrets.sessionId }, { sessionId: s.expired.sessionId }],
        get_session_digests: [
            { sessionIds: project.sessionIds.slice(0, 20) },
            { sessionIds: [s.rageThenCrash.sessionId, s.failedCheckout.sessionId, s.secrets.sessionId, s.long.sessionId] },
        ],
        get_session_timeline: [
            { sessionId: s.rageThenCrash.sessionId },
            { sessionId: s.failedCheckout.sessionId },
            { sessionId: s.secrets.sessionId },
            { sessionId: s.long.sessionId, limit: 500 },
            { sessionId: s.expired.sessionId },
        ],
        get_session_context: [
            { sessionId: s.rageThenCrash.sessionId },
            { sessionId: s.failedCheckout.sessionId },
            { sessionId: s.secrets.sessionId },
            { sessionId: s.long.sessionId },
            { sessionId: s.expired.sessionId },
        ],
        summarize_faults: [{ ...base, type: 'error' }, { ...base, type: 'crash' }, { ...base, type: 'anr', platform: 'mobile' }, { ...base, type: 'error', includeLeadUp: true }, { ...base, type: 'crash', includeLeadUp: true }],
        list_issues: [base, { ...base, type: 'crash' }],
        get_issue: [{ issueId: s.rageThenCrash.issueId }, ...project.issueIds.slice(0, 5).map((issueId) => ({ issueId }))],
        get_issue_context: [{ issueId: s.rageThenCrash.issueId }, ...project.issueIds.slice(0, 5).map((issueId) => ({ issueId }))],
        get_crash_context: [
            { faultId: s.rageThenCrash.crashId, type: 'crash' },
            { faultId: s.rageThenCrash.crashId },
            { faultId: s.failedCheckout.errorId },
            { faultId: project.anrIds[0] },
            { faultId: project.crashIds[project.crashIds.length - 1] },
        ],
    };
}

export function teamsOf(manifest: DemoSeedManifest): { a: DemoTeamManifest; b: DemoTeamManifest } {
    return { a: manifest.teamA, b: manifest.teamB };
}

/** Removes what legitimately differs between two otherwise identical responses. */
export function normalizeResponse(text: string): string {
    return text
        .replace(/req_[0-9a-f]{32}/g, 'req_X')
        .replace(/"tookMs":\d+/g, '"tookMs":0')
        .replace(/\(took \d+ ms/g, '(took 0 ms');
}
