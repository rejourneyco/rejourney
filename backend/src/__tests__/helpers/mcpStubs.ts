/**
 * Stand-ins for the MCP server's injected dependencies, for tests that are
 * about the protocol or the sign-in flow rather than the data.
 */
import type { McpAccessChecker, McpContext } from '../../mcp/context.js';
import type { McpScopedData, ProjectSummary } from '../../mcp/data/types.js';

/** Trusts the grant as-is: the user is a member and every granted project is live. */
export const grantTrustingAccess: McpAccessChecker = {
    check: async (grant) => ({ isMember: true, activeProjectIds: [...grant.projectIds] }),
};

/** A data layer that can only list projects; any other read fails the test. */
export function projectsOnlyData(listProjects: (ctx: McpContext) => Promise<ProjectSummary[]>): McpScopedData {
    const refuse = (name: string) => async () => {
        throw new Error(`Unexpected data access in this test: ${name}`);
    };
    return {
        listProjects,
        findFriction: refuse('findFriction'),
        getProjectHealth: refuse('getProjectHealth'),
        searchSessions: refuse('searchSessions'),
        sampleSessions: refuse('sampleSessions'),
        getSession: refuse('getSession'),
        getSessionDigests: refuse('getSessionDigests'),
        getSessionTimeline: refuse('getSessionTimeline'),
        getSessionBundles: refuse('getSessionBundles'),
        listIssues: refuse('listIssues'),
        getIssue: refuse('getIssue'),
        getFault: refuse('getFault'),
        summarizeFaults: refuse('summarizeFaults'),
    };
}
