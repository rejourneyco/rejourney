/** Shapes shared by the MCP page, its demo data and the `/api/mcp` client. */

/** Only Claude Code is supported; anything else that connects is shown as 'other'. */
export type McpClientKind = 'claude-code' | 'other';

export type McpScope = 'sessions:read' | 'replay:read' | 'issues:read' | 'analytics:read';

export type McpCallOutcome = 'ok' | 'limit_reached' | 'error';

export interface McpToolUsage {
    tool: string;
    calls: number;
    credits: number;
}

export interface McpUsage {
    planName: string;
    /** Credits included per period. `null` means no limit (self-hosted without billing). */
    creditLimit: number | null;
    creditsUsed: number;
    periodStart: string;
    /** When the allowance resets. */
    resetsAt: string;
    byTool: McpToolUsage[];
}

export interface McpProjectRef {
    id: string;
    name: string;
}

export interface McpConnection {
    id: string;
    clientName: string;
    clientKind: McpClientKind;
    connectedBy: {
        userId: string;
        name: string;
        email?: string;
    };
    connectedAt: string;
    lastUsedAt: string | null;
    projects: McpProjectRef[];
    scopes: McpScope[];
    callsThisPeriod: number;
    creditsThisPeriod: number;
    /** False when the signed-in member may see but not revoke this connection. Defaults to true. */
    canRevoke?: boolean;
}

export interface McpSettings {
    /** Team admin switch: MCP access on or off for the whole team. */
    mcpEnabled: boolean;
    /** Team admin switch: mask end-user identifiers and location in every MCP response. */
    maskEndUserIdentifiers: boolean;
}

export interface McpOverview {
    usage: McpUsage;
    connections: McpConnection[];
    settings: McpSettings;
    /** True when the signed-in member may change the team switches. */
    canManageSettings: boolean;
}

export interface McpActivityItem {
    id: string;
    at: string;
    tool: string;
    userName: string;
    clientName: string;
    credits: number;
    outcome: McpCallOutcome;
    /** Short plain-text note for calls that did not succeed. */
    detail?: string;
}

export interface McpActivity {
    items: McpActivityItem[];
}
