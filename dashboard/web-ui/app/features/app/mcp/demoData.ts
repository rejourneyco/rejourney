/**
 * Static sample data for /demo/mcp. Nothing here is fetched.
 * Times are relative to the shared demo clock so the page always looks current.
 */

import { DEMO_NOW, demoProjects } from '~/shared/data/demoData';
import type { McpActivity, McpActivityItem, McpConnection, McpOverview, McpProjectRef, McpToolUsage } from './types';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** The demo clock. Relative times on the page are measured from here. */
export const DEMO_MCP_NOW = DEMO_NOW;

const at = (offsetMs: number) => new Date(DEMO_NOW - offsetMs).toISOString();

const DEMO_PROJECT_REFS: McpProjectRef[] = demoProjects.map((project) => ({ id: project.id, name: project.name }));

/** Demo team members who connected an app. The first is the demo account itself. */
export const demoMcpMembers = [
    { userId: 'demo-user', name: 'Demo User', email: 'demo@shopflow.example' },
    { userId: 'demo-user-priya', name: 'Priya Raman', email: 'priya@shopflow.example' },
    { userId: 'demo-user-jonas', name: 'Jonas Weber', email: 'jonas@shopflow.example' },
] as const;

export const DEMO_MCP_CREDIT_LIMIT = 6000;
export const DEMO_MCP_CREDITS_USED = 2340;

/** Sums to DEMO_MCP_CREDITS_USED. */
export const demoMcpToolUsage: McpToolUsage[] = [
    { tool: 'get_session_context', calls: 240, credits: 720 },
    { tool: 'get_session_digests', calls: 84, credits: 420 },
    { tool: 'get_crash_context', calls: 85, credits: 340 },
    { tool: 'get_issue_context', calls: 72, credits: 216 },
    { tool: 'get_session_timeline', calls: 94, credits: 94 },
    { tool: 'get_session', calls: 215, credits: 215 },
    { tool: 'search_sessions', calls: 140, credits: 140 },
    { tool: 'list_issues', calls: 62, credits: 62 },
    { tool: 'get_issue', calls: 48, credits: 48 },
    { tool: 'get_project_health', calls: 45, credits: 45 },
    { tool: 'sample_sessions', calls: 40, credits: 40 },
    { tool: 'list_projects', calls: 58, credits: 0 },
    { tool: 'get_usage', calls: 21, credits: 0 },
];

/** Calls and credits across the three connections add up to the tool breakdown above. */
export const demoMcpConnections: McpConnection[] = [
    {
        id: 'demo-mcp-connection-claude-code',
        clientName: 'Claude Code',
        clientKind: 'claude-code',
        connectedBy: demoMcpMembers[1],
        connectedAt: at(23 * DAY),
        lastUsedAt: at(38 * MINUTE),
        projects: DEMO_PROJECT_REFS,
        scopes: ['sessions:read', 'replay:read', 'issues:read', 'analytics:read'],
        callsThisPeriod: 702,
        creditsThisPeriod: 1410,
    },
    {
        id: 'demo-mcp-connection-claude-code-desktop',
        clientName: 'Claude Code',
        clientKind: 'claude-code',
        connectedBy: demoMcpMembers[0],
        connectedAt: at(12 * DAY),
        lastUsedAt: at(5 * HOUR),
        projects: DEMO_PROJECT_REFS,
        scopes: ['sessions:read', 'replay:read', 'issues:read', 'analytics:read'],
        callsThisPeriod: 331,
        creditsThisPeriod: 640,
    },
    {
        id: 'demo-mcp-connection-claude-code-laptop',
        clientName: 'Claude Code',
        clientKind: 'claude-code',
        connectedBy: demoMcpMembers[2],
        connectedAt: at(9 * DAY),
        lastUsedAt: at(2 * DAY + 3 * HOUR),
        projects: DEMO_PROJECT_REFS,
        scopes: ['sessions:read', 'issues:read'],
        callsThisPeriod: 171,
        creditsThisPeriod: 290,
    },
];

export const demoMcpOverview: McpOverview = {
    usage: {
        planName: 'Growth',
        creditLimit: DEMO_MCP_CREDIT_LIMIT,
        creditsUsed: DEMO_MCP_CREDITS_USED,
        periodStart: at(16 * DAY),
        resetsAt: new Date(DEMO_NOW + 14 * DAY).toISOString(),
        byTool: demoMcpToolUsage,
    },
    connections: demoMcpConnections,
    settings: {
        mcpEnabled: true,
        maskEndUserIdentifiers: true,
    },
    canManageSettings: true,
};

const [demoUser, priya, jonas] = demoMcpMembers;

const activityRow = (
    index: number,
    offsetMs: number,
    tool: string,
    userName: string,
    clientName: string,
    credits: number,
    outcome: McpActivityItem['outcome'] = 'ok',
    detail?: string,
): McpActivityItem => ({
    id: `demo-mcp-call-${String(index).padStart(2, '0')}`,
    at: at(offsetMs),
    tool,
    userName,
    clientName,
    credits,
    outcome,
    ...(detail ? { detail } : {}),
});

/** Newest first, spread across the last week. */
export const demoMcpActivity: McpActivity = {
    items: [
        activityRow(1, 38 * MINUTE, 'get_crash_context', priya.name, 'Claude Code', 4),
        activityRow(2, 41 * MINUTE, 'list_issues', priya.name, 'Claude Code', 1),
        activityRow(3, 5 * HOUR, 'get_session_context', demoUser.name, 'Claude Code', 3),
        activityRow(4, 5 * HOUR + 2 * MINUTE, 'get_session_timeline', demoUser.name, 'Claude Code', 1),
        activityRow(5, 1 * DAY + 2 * HOUR, 'get_session_digests', priya.name, 'Claude Code', 6),
        activityRow(6, 1 * DAY + 2 * HOUR + 1 * MINUTE, 'sample_sessions', priya.name, 'Claude Code', 0, 'limit_reached', 'Per-minute call limit reached. Retried after 20 seconds.'),
        activityRow(7, 2 * DAY + 3 * HOUR, 'search_sessions', jonas.name, 'Claude Code', 1),
        activityRow(8, 2 * DAY + 3 * HOUR + 4 * MINUTE, 'get_session', jonas.name, 'Claude Code', 1),
        activityRow(9, 3 * DAY + 6 * HOUR, 'get_session_context', demoUser.name, 'Claude Code', 0, 'error', 'Request failed. Request ID req_8f3a21c0.'),
        activityRow(10, 4 * DAY + 1 * HOUR, 'get_project_health', demoUser.name, 'Claude Code', 1),
        activityRow(11, 5 * DAY + 4 * HOUR, 'get_issue', priya.name, 'Claude Code', 1),
        activityRow(12, 6 * DAY + 7 * HOUR, 'list_projects', jonas.name, 'Claude Code', 0),
    ],
};
