import { COHORT_REPORT_CREDITS, SESSION_REVIEW_CREDITS } from './presentation';
import type { McpClientKind } from './types';

/** Static copy for the MCP page: setup steps, example prompts and the tool cost reference. */

export interface McpConnectGuide {
    id: string;
    kind: McpClientKind;
    title: string;
    summary: string;
    steps: string[];
    snippetLabel: string;
    /** What the Copy button says. */
    copyLabel: string;
    note?: string;
}

export const MCP_CONNECT_GUIDES: McpConnectGuide[] = [
    {
        id: 'connect-claude-code-terminal',
        kind: 'claude-code',
        title: 'Claude Code in the terminal',
        summary: 'One command, then sign in.',
        steps: [
            'Run the command below in your terminal. It adds Rejourney for every project on this computer.',
            'Start Claude Code, run /mcp and choose rejourney to sign in.',
            'A browser tab opens on Rejourney. Sign in, pick the team and projects to share, and click Allow.',
        ],
        snippetLabel: 'Command',
        copyLabel: 'Copy command',
    },
    {
        id: 'connect-claude-code-desktop',
        kind: 'claude-code',
        title: 'Claude Code in the desktop app',
        summary: 'Same setup as the terminal.',
        steps: [
            'Run the command below once in a terminal on the same computer. Claude Code in the Claude desktop app reads the same settings.',
            'Open a new session in the Code tab of the Claude desktop app and run /mcp, then choose rejourney to sign in.',
            'A browser tab opens on Rejourney. Sign in, pick the team and projects to share, and click Allow.',
        ],
        snippetLabel: 'Command',
        copyLabel: 'Copy command',
        note: 'If rejourney does not appear in the desktop app, start a new session after running the command.',
    },
];

/** Stated on every Connect detail. */
export const MCP_CONNECT_FACTS: string[] = [
    'Access is read-only. No tool can change your data.',
    'You choose which projects to share on the consent screen.',
    'You can revoke access at any time from this page.',
];

export interface McpPromptGuide {
    id: string;
    title: string;
    summary: string;
    explanation: string;
    prompts: string[];
    tools: string[];
    cost: string;
    comingSoon?: boolean;
}

export const MCP_PROMPT_GUIDES: McpPromptGuide[] = [
    {
        id: 'ask-review-session',
        title: 'Review a session',
        summary: 'What the user did and where they got stuck.',
        explanation:
            'Your AI client reads a session the way you would in the replay: screens visited, taps, failed requests, errors, and the moments where something went wrong with what led up to each. Every moment links to the replay at that second.',
        prompts: [
            'Review this Rejourney session and tell me what the user did, where they got stuck, and what to fix first: <session link>',
            'Find three sessions from the last 7 days with rage taps on the checkout screen and summarise what went wrong in each.',
            'Show me what the user saw in the 30 seconds before they left the payment screen in this session: <session link>',
            'Take a random sample of 20 sessions on the latest app version and list the most common friction points.',
        ],
        tools: ['find_friction', 'search_sessions', 'sample_sessions', 'get_session_digests', 'get_session_context', 'get_session_timeline'],
        cost: `About ${SESSION_REVIEW_CREDITS} credits per session review.`,
    },
    {
        id: 'ask-triage-crash',
        title: 'Triage a crash',
        summary: 'Stack, device and what happened just before.',
        explanation:
            'One call breaks all crashes, ANRs or errors down by cause, version, device and OS. Another returns the stack, the device and the 30 seconds of timeline before a single crash, ANR or error.',
        prompts: [
            'Which crashes got worse in the latest app version? Rank them by affected users.',
            'Why did this session crash? Show the stack, the device, and what the user did just before: <session link>',
            'List the top five ANRs this week with the devices and versions they affect.',
            'For the top crash, pull three sample sessions and tell me what they have in common.',
        ],
        tools: ['get_project_health', 'summarize_faults', 'list_issues', 'get_issue_context', 'get_crash_context'],
        cost: 'A crash context call costs 4 credits, an issue context call 3, a breakdown 2. Listing or opening an issue costs 1.',
    },
    {
        id: 'ask-analyse-cohort',
        title: 'Analyse a cohort',
        summary: 'Where a group of users drops off, with sample sizes.',
        explanation:
            'Define a group of users, a time window and an outcome. Rejourney computes funnels, paths and comparisons and returns them with sample sizes, percentages and confidence intervals. Your AI client interprets the numbers and writes the report.',
        prompts: [
            'Of users who started a trial in October, where did the ones who did not convert drop off?',
            'What do users who convert do differently from those who do not in their first week?',
            'What percentage of new users hit a rage tap or an error on the onboarding screens?',
            'Test this hypothesis: users who see a failed request during checkout are less likely to subscribe.',
        ],
        tools: ['preview_cohort', 'cohort_funnel', 'cohort_paths', 'find_drop_offs', 'friction_prevalence', 'compare_cohorts', 'test_hypothesis'],
        cost: `About ${COHORT_REPORT_CREDITS} credits per cohort report.`,
        comingSoon: true,
    },
];

export interface McpToolCost {
    tool: string;
    returns: string;
    cost: string;
    comingSoon?: boolean;
}

/** Session and crash review tools. */
export const MCP_REVIEW_TOOL_COSTS: McpToolCost[] = [
    { tool: 'list_projects', returns: 'Projects this connection may read', cost: '0' },
    { tool: 'get_usage', returns: 'Allowance used, remaining and reset date', cost: '0' },
    { tool: 'get_project_health', returns: 'Sessions, crash-free rate, top issues for a date range', cost: '1' },
    { tool: 'find_friction', returns: 'Where users struggle, ranked, against the previous period', cost: '2' },
    { tool: 'search_sessions', returns: 'Sessions matching a filter, 25 per page', cost: '1' },
    { tool: 'get_session', returns: 'Device, version, duration and screens visited', cost: '1' },
    { tool: 'get_session_timeline', returns: 'Screens, taps, failed requests, errors and logs', cost: '1' },
    { tool: 'get_session_context', returns: 'One session explained: screens, moments that went wrong, evidence', cost: '3' },
    { tool: 'summarize_faults', returns: 'All crashes, ANRs or errors by cause, version, device and OS', cost: '2' },
    { tool: 'list_issues', returns: 'Grouped crashes, ANRs and errors', cost: '1' },
    { tool: 'get_issue', returns: 'One issue with stack, versions and sample sessions', cost: '1' },
    { tool: 'get_issue_context', returns: 'One issue explained, with what users did before it', cost: '3' },
    { tool: 'get_crash_context', returns: 'Stack, device and the 30 seconds before one crash, ANR or error', cost: '4' },
    { tool: 'sample_sessions', returns: 'A uniform random sample of matching sessions', cost: '1' },
    { tool: 'get_session_digests', returns: 'Up to 50 compact session digests', cost: '1 + 1 per 10 sessions' },
];

/** Cohort analysis tools. These ship in a later phase. */
export const MCP_COHORT_TOOL_COSTS: McpToolCost[] = [
    { tool: 'preview_cohort', returns: 'Cohort size and outcome split', cost: '2', comingSoon: true },
    { tool: 'cohort_funnel', returns: 'People reaching each step, with intervals', cost: '5', comingSoon: true },
    { tool: 'cohort_paths', returns: 'Top paths and furthest point reached', cost: '5', comingSoon: true },
    { tool: 'find_drop_offs', returns: 'Steps ranked by people lost', cost: '5', comingSoon: true },
    { tool: 'friction_prevalence', returns: 'Share of people hitting each friction type', cost: '5', comingSoon: true },
    { tool: 'compare_cohorts', returns: 'Behaviours ranked by significance and effect size', cost: '8', comingSoon: true },
    { tool: 'test_hypothesis', returns: 'One test, fully reported', cost: '3', comingSoon: true },
];

/** What an AI client can read for the projects shared with it. */
export const MCP_VISIBLE_DATA: string[] = [
    'Sessions',
    'Timelines',
    'Replay links',
    'Crashes and errors',
];

/** What an AI client never receives. */
export const MCP_HIDDEN_DATA: string[] = [
    "Other teams' data",
    'API keys',
    'Billing details',
    'Storage links',
];

export const MCP_LIMIT_BEHAVIOUR =
    'At the limit, tools return a clear "allowance used" message with the reset date. There are no overage charges.';
