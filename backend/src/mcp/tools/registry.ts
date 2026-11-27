/**
 * The tool registry. The server registers exactly these tools, in this order,
 * and the tenant-isolation test matrix is generated from this list, so a tool
 * cannot be added here without isolation cases.
 */

import { findFrictionTool } from './findFriction.js';
import { getCrashContextTool } from './getCrashContext.js';
import { getIssueTool } from './getIssue.js';
import { getIssueContextTool } from './getIssueContext.js';
import { getProjectHealthTool } from './getProjectHealth.js';
import { getSessionTool } from './getSession.js';
import { getSessionContextTool } from './getSessionContext.js';
import { getSessionDigestsTool } from './getSessionDigests.js';
import { getSessionTimelineTool } from './getSessionTimeline.js';
import { getUsageTool } from './getUsage.js';
import { listIssuesTool } from './listIssues.js';
import { listProjectsTool } from './listProjects.js';
import { sampleSessionsTool } from './sampleSessions.js';
import { searchSessionsTool } from './searchSessions.js';
import { summarizeFaultsTool } from './summarizeFaults.js';
import type { McpToolDefinition } from './types.js';

export type AnyMcpTool = McpToolDefinition<any, any>;

export const MCP_TOOLS: readonly AnyMcpTool[] = [
    listProjectsTool,
    getUsageTool,
    getProjectHealthTool,
    findFrictionTool,
    searchSessionsTool,
    sampleSessionsTool,
    getSessionTool,
    getSessionDigestsTool,
    getSessionTimelineTool,
    getSessionContextTool,
    summarizeFaultsTool,
    listIssuesTool,
    getIssueTool,
    getIssueContextTool,
    getCrashContextTool,
];

export const MCP_TOOL_NAMES: readonly string[] = MCP_TOOLS.map((tool) => tool.name);
