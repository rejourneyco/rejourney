/**
 * MCP on the main API.
 *
 *   /oauth/*                                     the authorization server (mounted by `mountMcpOAuth`)
 *   /.well-known/oauth-authorization-server/oauth  its metadata (RFC 8414 path form)
 *
 *   GET    /api/mcp/consent/:uid                 what the consent page shows
 *   POST   /api/mcp/consent/:uid                 the user's choice (allow or deny)
 *   GET    /api/mcp/teams/:teamId/overview       usage, connections, team switches
 *   GET    /api/mcp/teams/:teamId/activity       recent calls
 *   DELETE /api/mcp/teams/:teamId/connections/:id  revoke one connection
 *   PUT    /api/mcp/teams/:teamId/settings       team switches (admins)
 *
 * Every route answers 404 while MCP is off on this server, which the
 * dashboard shows as "not enabled".
 */

import { and, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import { Router } from 'express';
import type { Express, NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/client.js';
import { mcpCallLog, mcpGrants, mcpUsagePeriods, projects, teamMembers, teams, users } from '../db/schema.js';
import { logger } from '../logger.js';
import { requireTeamAccess, sessionAuth, writeApiRateLimiter } from '../middleware/index.js';
import { resolveAllowance } from '../mcp/allowance.js';
import type { McpTeamBilling } from '../mcp/allowance.js';
import { CONSENT_DECISION_MODEL, createOAuthMetadataHandler, createOAuthRouter, oauthMetadataPath } from '../mcp/oauth/router.js';
import type { StoredConsentDecision } from '../mcp/oauth/router.js';
import type { McpGrantRecord } from '../mcp/oauth/grants.js';
import { MCP_SCOPES } from '../mcp/router.js';
import { createAuditLog } from '../services/auditLog.js';
import { sendMcpConnectionEmail } from '../services/mcpEmails.js';
import { syncTeamMcpLimits } from '../services/mcpEntitlement.js';
import { CLAUDE_CODE_CLIENT_ID, getMcpOAuth } from '../services/mcpOAuth.js';

const CONSENT_DECISION_TTL_SECONDS = 10 * 60;
const MAX_PROJECTS_PER_GRANT = 500;
const ADMIN_ROLES = new Set(['owner', 'admin']);
const UUID = z.uuid();

const SCOPE_TEXT: Record<string, { label: string; description: string }> = {
    'sessions:read': { label: 'Sessions', description: 'Read sessions: screens visited, taps, failed and slow requests, and the timeline of what happened.' },
    'replay:read': { label: 'Replay links', description: 'Read whether a session has a replay and link to it in Rejourney.' },
    'issues:read': { label: 'Crashes, ANRs and errors', description: 'Read crashes, ANRs, errors and issue groups, with their stacks and the moments before them.' },
    'analytics:read': { label: 'Project health', description: 'Read counts and trends: sessions, crash-free rate and where users struggle.' },
};

// --- Helpers -----------------------------------------------------------------

/** The signed-in dashboard user, or null. Runs the normal session check without answering the request. */
export function resolveSessionUser(req: Request): Promise<{ id: string; email: string } | null> {
    return new Promise((resolve) => {
        let settled = false;
        const done = (value: { id: string; email: string } | null) => {
            if (!settled) {
                settled = true;
                resolve(value);
            }
        };
        const silent = {
            status() {
                return this;
            },
            json() {
                done(null);
                return this;
            },
            setHeader() {
                return this;
            },
        } as unknown as Response;
        void sessionAuth(req, silent, () => done(req.user ? { id: req.user.id, email: req.user.email } : null)).catch(() => done(null));
    });
}

function requireMcp(_req: Request, res: Response, next: NextFunction): void {
    if (!getMcpOAuth()) {
        res.status(404).json({ error: 'not_found', message: 'MCP is not enabled on this server.' });
        return;
    }
    next();
}

function noStore(_req: Request, res: Response, next: NextFunction): void {
    res.setHeader('Cache-Control', 'no-store');
    next();
}

async function memberRole(userId: string, teamId: string): Promise<string | null> {
    const [row] = await db
        .select({ role: teamMembers.role })
        .from(teamMembers)
        .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)))
        .limit(1);
    return row?.role ?? null;
}

/** Project ids that belong to the team and are not deleted, from the given list. */
async function liveTeamProjects(teamId: string, projectIds: readonly string[]): Promise<string[]> {
    if (projectIds.length === 0) return [];
    const rows = await db
        .select({ id: projects.id })
        .from(projects)
        .where(and(eq(projects.teamId, teamId), inArray(projects.id, [...projectIds]), isNull(projects.deletedAt)));
    return rows.map((row) => row.id);
}

function clientKind(clientId: string, clientName: string | null): 'claude-code' | 'other' {
    if (clientId === CLAUDE_CODE_CLIENT_ID) return 'claude-code';
    return /claude code/i.test(clientName ?? '') ? 'claude-code' : 'other';
}

function displayPlanName(planName: string): string {
    if (!planName) return 'Free';
    return planName.charAt(0).toUpperCase() + planName.slice(1);
}

type TeamRow = typeof teams.$inferSelect;

function teamBilling(team: TeamRow): McpTeamBilling {
    return {
        teamId: team.id,
        ownerUserId: team.ownerUserId,
        hasSubscription: Boolean(team.stripeSubscriptionId),
        creditLimit: team.mcpCreditLimit ?? null,
        limitsSyncedAt: team.mcpLimitsSyncedAt ?? null,
        planName: team.mcpPlanName ?? null,
        billingCycleAnchor: team.billingCycleAnchor ?? null,
        stripePeriodStart: team.stripeCurrentPeriodStart ?? null,
        stripePeriodEnd: team.stripeCurrentPeriodEnd ?? null,
        paymentFailedAt: team.paymentFailedAt ?? null,
    };
}

async function loadTeam(teamId: string): Promise<TeamRow | null> {
    const [team] = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1);
    return team ?? null;
}

/** Syncs the plan limits, then reads the team row back. Billing trouble never blocks the page. */
async function loadTeamWithLimits(teamId: string): Promise<TeamRow | null> {
    try {
        await syncTeamMcpLimits(teamId);
    } catch (err) {
        logger.warn({ err, teamId }, 'MCP limit sync failed; using stored limits');
    }
    return loadTeam(teamId);
}

// --- Consent -------------------------------------------------------------------

async function takeDecision(uid: string): Promise<StoredConsentDecision | null> {
    const oauth = getMcpOAuth();
    if (!oauth) return null;
    const payload = await oauth.store.find(CONSENT_DECISION_MODEL, uid);
    if (!payload) return null;
    await oauth.store.destroy(CONSENT_DECISION_MODEL, uid);
    const decision = payload as unknown as StoredConsentDecision;
    return typeof decision.userId === 'string' && (decision.decision === 'allow' || decision.decision === 'deny') ? decision : null;
}

async function confirmDecision(decision: StoredConsentDecision): Promise<boolean> {
    if (!decision.teamId || !decision.projectIds?.length) return false;
    const [role, team] = await Promise.all([memberRole(decision.userId, decision.teamId), loadTeam(decision.teamId)]);
    if (!role || !team || !team.mcpEnabled) return false;
    const live = await liveTeamProjects(decision.teamId, decision.projectIds);
    return live.length === decision.projectIds.length;
}

function onGrantCreated(record: McpGrantRecord, req: Request): void {
    void (async () => {
        await createAuditLog({
            userId: record.userId,
            teamId: record.teamId,
            action: 'mcp_connection_created',
            targetType: 'mcp_connection',
            targetId: record.grantId.slice(0, 100),
            newValue: { clientName: record.clientName ?? null, clientId: record.clientId, projectIds: record.projectIds, scopes: record.scopes },
        }, req);
        const [[user], [team], projectRows] = await Promise.all([
            db.select({ email: users.email }).from(users).where(eq(users.id, record.userId)).limit(1),
            db.select({ name: teams.name }).from(teams).where(eq(teams.id, record.teamId)).limit(1),
            db.select({ name: projects.name }).from(projects).where(inArray(projects.id, record.projectIds)),
        ]);
        if (user?.email) {
            await sendMcpConnectionEmail({
                to: user.email,
                clientName: record.clientName ?? 'An AI app',
                teamName: team?.name ?? 'your team',
                projectNames: projectRows.map((row) => row.name),
                connectedAt: new Date(record.createdAt),
            });
        }
    })().catch((err) => logger.error({ err }, 'MCP new-connection follow-up failed'));
}

/**
 * Mounts the authorization server on the main app. Call before the CSRF and
 * origin checks are reached for these paths (they are exempt there): the
 * token endpoint is called by AI clients, not browsers on our origin.
 */
export function mountMcpOAuth(app: Express): void {
    const oauth = getMcpOAuth();
    if (!oauth) return;
    const mountPath = new URL(oauth.config.issuer).pathname.replace(/\/$/, '') || '/oauth';
    app.use(mountPath, noStore, createOAuthRouter({
        provider: oauth.provider,
        resource: oauth.config.resource,
        grants: oauth.grants,
        dashboardConsent: {
            consentPageUrl: `${oauth.config.dashboardBaseUrl}/oauth/consent`,
            resolveSessionUser,
            takeDecision,
            confirm: confirmDecision,
            onGrantCreated,
        },
    }));
    app.get(oauthMetadataPath(oauth.config.issuer), noStore, createOAuthMetadataHandler(oauth.provider));
    logger.info({ issuer: oauth.config.issuer }, 'MCP OAuth authorization server mounted');
}

// --- Dashboard API -------------------------------------------------------------

const router = Router();
router.use(requireMcp, noStore);

router.get('/consent/:uid', sessionAuth, async (req: Request, res: Response) => {
    try {
        const oauth = getMcpOAuth()!;
        const uid = String(req.params.uid ?? '');
        const interaction = uid.length <= 128 ? await oauth.provider.Interaction.find(uid) : undefined;
        if (!interaction) {
            res.status(404).json({ error: 'interaction_not_found', message: 'This sign-in request has expired or was already used.' });
            return;
        }
        const params = interaction.params as Record<string, unknown>;
        const clientId = String(params.client_id ?? '');
        const client = await oauth.provider.Client.find(clientId).catch(() => undefined);
        if (!client) {
            res.status(404).json({ error: 'interaction_not_found', message: 'The app that started this sign-in is not allowed to connect.' });
            return;
        }
        const meta = client as unknown as { clientName?: string; clientUri?: string; logoUri?: string };
        const redirectUri = typeof params.redirect_uri === 'string' ? params.redirect_uri : '';
        let redirectHost = '';
        try {
            redirectHost = new URL(redirectUri).hostname;
        } catch {
            redirectHost = '';
        }
        const loopbackOnly = ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(redirectHost);
        const registration = clientId.startsWith('https://') ? 'metadata_document' : 'dynamic';

        const userId = req.user!.id;
        const memberships = await db
            .select({ id: teams.id, name: teams.name, role: teamMembers.role, mcpEnabled: teams.mcpEnabled })
            .from(teamMembers)
            .innerJoin(teams, eq(teams.id, teamMembers.teamId))
            .where(eq(teamMembers.userId, userId))
            .orderBy(teams.name);
        const teamIds = memberships.map((team) => team.id);
        const projectRows = teamIds.length === 0
            ? []
            : await db
                .select({ id: projects.id, name: projects.name, platform: projects.platform, teamId: projects.teamId })
                .from(projects)
                .where(and(inArray(projects.teamId, teamIds), isNull(projects.deletedAt)))
                .orderBy(projects.name);

        const requested = String(params.scope ?? '').split(' ').filter((scope) => (MCP_SCOPES as readonly string[]).includes(scope));
        const scopes = (requested.length > 0 ? requested : [...MCP_SCOPES]).map((id) => ({ id, ...(SCOPE_TEXT[id] ?? { label: id, description: '' }) }));

        res.json({
            uid,
            expiresAt: new Date(((interaction as unknown as { exp?: number }).exp ?? Math.floor(Date.now() / 1000) + 600) * 1000).toISOString(),
            client: {
                id: clientId,
                name: meta.clientName?.trim() || 'An unnamed app',
                uri: typeof meta.clientUri === 'string' ? meta.clientUri : null,
                logoUri: typeof meta.logoUri === 'string' ? meta.logoUri : null,
                redirectHost,
                loopbackOnly,
                registration,
            },
            scopes,
            user: { email: req.user!.email },
            teams: memberships.map((team) => ({
                id: team.id,
                name: team.name ?? 'Untitled team',
                role: team.role,
                mcpEnabled: team.mcpEnabled,
                disabledReason: team.mcpEnabled ? null : 'A team admin has turned MCP off for this team.',
                projects: projectRows.filter((project) => project.teamId === team.id).map((project) => ({ id: project.id, name: project.name, platform: project.platform ?? null })),
            })),
        });
    } catch (err) {
        logger.error({ err }, 'MCP consent details failed');
        res.status(500).json({ error: 'internal', message: 'This sign-in request could not be loaded.' });
    }
});

const consentBody = z.discriminatedUnion('decision', [
    z.strictObject({ decision: z.literal('deny') }),
    z.strictObject({
        decision: z.literal('allow'),
        teamId: z.uuid(),
        projectIds: z.array(z.uuid()).min(1).max(MAX_PROJECTS_PER_GRANT),
    }),
]);

router.post('/consent/:uid', sessionAuth, writeApiRateLimiter, async (req: Request, res: Response) => {
    try {
        const oauth = getMcpOAuth()!;
        const uid = String(req.params.uid ?? '');
        const parsed = consentBody.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({ error: 'invalid_request', message: 'Choose a team and at least one project.' });
            return;
        }
        const interaction = uid.length <= 128 ? await oauth.provider.Interaction.find(uid) : undefined;
        if (!interaction) {
            res.status(404).json({ error: 'interaction_not_found', message: 'This sign-in request has expired or was already used. Start again from Claude Code.' });
            return;
        }
        const userId = req.user!.id;
        let decision: StoredConsentDecision;
        if (parsed.data.decision === 'deny') {
            decision = { userId, decision: 'deny' };
        } else {
            const { teamId } = parsed.data;
            const projectIds = [...new Set(parsed.data.projectIds)];
            const role = await memberRole(userId, teamId);
            if (!role) {
                res.status(403).json({ error: 'not_a_member', message: 'You are not a member of that team.' });
                return;
            }
            const team = await loadTeamWithLimits(teamId);
            if (!team?.mcpEnabled) {
                res.status(403).json({ error: 'team_mcp_disabled', message: 'A team admin has turned MCP off for this team.' });
                return;
            }
            const live = await liveTeamProjects(teamId, projectIds);
            if (live.length !== projectIds.length) {
                res.status(400).json({ error: 'invalid_request', message: 'One of the selected projects no longer exists in this team. Reload and choose again.' });
                return;
            }
            const params = interaction.params as Record<string, unknown>;
            const requested = String(params.scope ?? '').split(' ').filter((scope) => (MCP_SCOPES as readonly string[]).includes(scope));
            decision = { userId, decision: 'allow', teamId, projectIds, scopes: requested.length > 0 ? requested : [...MCP_SCOPES] };
        }
        await oauth.store.upsert(CONSENT_DECISION_MODEL, uid, decision as unknown as Record<string, unknown>, { expiresInSeconds: CONSENT_DECISION_TTL_SECONDS });
        res.json({ redirectTo: `${oauth.config.issuer}/interaction/${encodeURIComponent(uid)}/finish` });
    } catch (err) {
        logger.error({ err }, 'MCP consent decision failed');
        res.status(500).json({ error: 'internal', message: 'Your choice could not be saved. Try again.' });
    }
});

router.get('/teams/:teamId/overview', sessionAuth, requireTeamAccess, async (req: Request, res: Response) => {
    try {
        const teamId = String(req.params.teamId);
        if (!UUID.safeParse(teamId).success) {
            res.status(400).json({ error: 'invalid_request', message: 'Invalid team id.' });
            return;
        }
        const userId = req.user!.id;
        const [team, role] = await Promise.all([loadTeamWithLimits(teamId), memberRole(userId, teamId)]);
        if (!team || !role) {
            res.status(404).json({ error: 'not_found', message: 'Team not found.' });
            return;
        }
        const isAdmin = ADMIN_ROLES.has(role);
        const allowance = resolveAllowance(teamBilling(team), new Date());

        const grantConditions = [eq(mcpGrants.teamId, teamId), isNull(mcpGrants.revokedAt)];
        if (!isAdmin) grantConditions.push(eq(mcpGrants.userId, userId));
        const [usageRow] = await db
            .select({ credits: mcpUsagePeriods.credits })
            .from(mcpUsagePeriods)
            .where(and(eq(mcpUsagePeriods.scopeKey, allowance.scopeKey), eq(mcpUsagePeriods.period, allowance.period)))
            .limit(1);
        const [byTool, grantRows, perGrant] = await Promise.all([
            db
                .select({
                    tool: mcpCallLog.tool,
                    calls: sql<number>`count(*) filter (where ${mcpCallLog.outcome} = 'ok')::int`,
                    credits: sql<number>`coalesce(sum(${mcpCallLog.credits}) filter (where ${mcpCallLog.outcome} = 'ok'), 0)::int`,
                })
                .from(mcpCallLog)
                .where(and(eq(mcpCallLog.teamId, teamId), eq(mcpCallLog.period, allowance.period)))
                .groupBy(mcpCallLog.tool),
            db
                .select({
                    grantId: mcpGrants.grantId,
                    clientId: mcpGrants.clientId,
                    clientName: mcpGrants.clientName,
                    userId: mcpGrants.userId,
                    userName: users.displayName,
                    userEmail: users.email,
                    projectIds: mcpGrants.projectIds,
                    scopes: mcpGrants.scopes,
                    createdAt: mcpGrants.createdAt,
                    lastUsedAt: mcpGrants.lastUsedAt,
                })
                .from(mcpGrants)
                .innerJoin(users, eq(users.id, mcpGrants.userId))
                .where(and(...grantConditions))
                .orderBy(desc(mcpGrants.createdAt))
                .limit(200),
            db
                .select({
                    grantId: mcpCallLog.grantId,
                    calls: sql<number>`count(*) filter (where ${mcpCallLog.outcome} = 'ok')::int`,
                    credits: sql<number>`coalesce(sum(${mcpCallLog.credits}) filter (where ${mcpCallLog.outcome} = 'ok'), 0)::int`,
                })
                .from(mcpCallLog)
                .where(and(eq(mcpCallLog.teamId, teamId), eq(mcpCallLog.period, allowance.period)))
                .groupBy(mcpCallLog.grantId),
        ]);
        const projectIds = [...new Set(grantRows.flatMap((grant) => grant.projectIds))];
        const projectNames = projectIds.length === 0
            ? new Map<string, string>()
            : new Map((await db.select({ id: projects.id, name: projects.name }).from(projects).where(inArray(projects.id, projectIds))).map((row) => [row.id, row.name]));
        const usageByGrant = new Map(perGrant.map((row) => [row.grantId, row]));

        res.json({
            usage: {
                planName: displayPlanName(allowance.planName),
                creditLimit: allowance.creditLimit,
                creditsUsed: usageRow?.credits ?? 0,
                periodStart: allowance.periodStart.toISOString(),
                resetsAt: allowance.periodEnd.toISOString(),
                byTool: byTool.filter((row) => row.calls > 0).map((row) => ({ tool: row.tool, calls: row.calls, credits: row.credits })),
            },
            connections: grantRows.map((grant) => ({
                id: grant.grantId,
                clientName: grant.clientName ?? 'Unnamed app',
                clientKind: clientKind(grant.clientId, grant.clientName),
                connectedBy: { userId: grant.userId, name: grant.userName || grant.userEmail, ...(isAdmin || grant.userId === userId ? { email: grant.userEmail } : {}) },
                connectedAt: grant.createdAt.toISOString(),
                lastUsedAt: grant.lastUsedAt ? grant.lastUsedAt.toISOString() : null,
                projects: grant.projectIds.filter((id) => projectNames.has(id)).map((id) => ({ id, name: projectNames.get(id)! })),
                scopes: grant.scopes.filter((scope) => (MCP_SCOPES as readonly string[]).includes(scope)),
                callsThisPeriod: usageByGrant.get(grant.grantId)?.calls ?? 0,
                creditsThisPeriod: usageByGrant.get(grant.grantId)?.credits ?? 0,
                canRevoke: isAdmin || grant.userId === userId,
            })),
            settings: { mcpEnabled: team.mcpEnabled, maskEndUserIdentifiers: team.mcpMaskIdentifiers },
            canManageSettings: isAdmin,
        });
    } catch (err) {
        logger.error({ err }, 'MCP overview failed');
        res.status(500).json({ error: 'internal', message: 'MCP usage could not be loaded.' });
    }
});

router.get('/teams/:teamId/activity', sessionAuth, requireTeamAccess, async (req: Request, res: Response) => {
    try {
        const teamId = String(req.params.teamId);
        const userId = req.user!.id;
        const role = await memberRole(userId, teamId);
        if (!role) {
            res.status(404).json({ error: 'not_found', message: 'Team not found.' });
            return;
        }
        const conditions = [eq(mcpCallLog.teamId, teamId), gte(mcpCallLog.createdAt, sql`now() - interval '30 days'` as unknown as Date)];
        if (!ADMIN_ROLES.has(role)) conditions.push(eq(mcpCallLog.userId, userId));
        const rows = await db
            .select({
                id: mcpCallLog.id,
                at: mcpCallLog.createdAt,
                tool: mcpCallLog.tool,
                credits: mcpCallLog.credits,
                outcome: mcpCallLog.outcome,
                userName: users.displayName,
                userEmail: users.email,
                clientName: mcpGrants.clientName,
            })
            .from(mcpCallLog)
            .leftJoin(users, eq(users.id, mcpCallLog.userId))
            .leftJoin(mcpGrants, eq(mcpGrants.grantId, mcpCallLog.grantId))
            .where(and(...conditions))
            .orderBy(desc(mcpCallLog.createdAt))
            .limit(100);
        const detail: Record<string, string> = {
            limit_reached: 'MCP credits for this period were used up.',
            rate_limited: 'Per-minute call limit reached.',
            busy: 'The server was busy; the call can be retried.',
            deadline_exceeded: 'The call took longer than 20 seconds and was stopped.',
            disabled: 'MCP was switched off for this team or tool.',
            access_revoked: 'The person is no longer a member of the team.',
            not_found: 'The requested item does not exist or is outside the shared projects.',
            invalid_argument: 'The request had an invalid argument.',
            result_too_large: 'The result was too large to return.',
            insufficient_scope: 'The connection was not allowed to use this tool.',
            internal: 'The call failed on the server.',
        };
        res.json({
            items: rows.map((row) => ({
                id: row.id,
                at: row.at.toISOString(),
                tool: row.tool,
                userName: row.userName || row.userEmail || 'Former member',
                clientName: row.clientName ?? 'Unnamed app',
                credits: row.outcome === 'ok' ? row.credits : 0,
                outcome: row.outcome === 'ok' ? 'ok' : row.outcome === 'limit_reached' || row.outcome === 'rate_limited' ? 'limit_reached' : 'error',
                ...(row.outcome === 'ok' ? {} : { detail: detail[row.outcome] ?? 'The call did not succeed.' }),
            })),
        });
    } catch (err) {
        logger.error({ err }, 'MCP activity failed');
        res.status(500).json({ error: 'internal', message: 'MCP activity could not be loaded.' });
    }
});

router.delete('/teams/:teamId/connections/:grantId', sessionAuth, requireTeamAccess, writeApiRateLimiter, async (req: Request, res: Response) => {
    try {
        const oauth = getMcpOAuth()!;
        const teamId = String(req.params.teamId);
        const grantId = String(req.params.grantId ?? '').slice(0, 128);
        const userId = req.user!.id;
        const role = await memberRole(userId, teamId);
        const [grant] = await db
            .select({ userId: mcpGrants.userId, clientName: mcpGrants.clientName })
            .from(mcpGrants)
            .where(and(eq(mcpGrants.grantId, grantId), eq(mcpGrants.teamId, teamId), isNull(mcpGrants.revokedAt)))
            .limit(1);
        if (!role || !grant) {
            res.status(404).json({ error: 'not_found', message: 'Connection not found.' });
            return;
        }
        if (grant.userId !== userId && !ADMIN_ROLES.has(role)) {
            res.status(403).json({ error: 'forbidden', message: 'Only the person who connected this app or a team admin can revoke it.' });
            return;
        }
        await oauth.grants.delete(grantId, userId);
        await oauth.store.revokeAllForGrant(grantId);
        await createAuditLog({
            userId,
            teamId,
            action: 'mcp_connection_revoked',
            targetType: 'mcp_connection',
            targetId: grantId.slice(0, 100),
            previousValue: { clientName: grant.clientName, connectedBy: grant.userId },
        }, req);
        res.status(204).end();
    } catch (err) {
        logger.error({ err }, 'MCP revoke failed');
        res.status(500).json({ error: 'internal', message: 'The connection could not be revoked. Try again.' });
    }
});

const settingsBody = z.strictObject({
    mcpEnabled: z.boolean().optional(),
    maskEndUserIdentifiers: z.boolean().optional(),
});

router.put('/teams/:teamId/settings', sessionAuth, requireTeamAccess, writeApiRateLimiter, async (req: Request, res: Response) => {
    try {
        const teamId = String(req.params.teamId);
        const role = await memberRole(req.user!.id, teamId);
        if (!role || !ADMIN_ROLES.has(role)) {
            res.status(403).json({ error: 'forbidden', message: 'Only team owners and admins can change MCP settings.' });
            return;
        }
        const parsed = settingsBody.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({ error: 'invalid_request', message: 'Invalid settings.' });
            return;
        }
        const before = await loadTeam(teamId);
        if (!before) {
            res.status(404).json({ error: 'not_found', message: 'Team not found.' });
            return;
        }
        const update: Partial<typeof teams.$inferInsert> = {};
        if (parsed.data.mcpEnabled !== undefined) update.mcpEnabled = parsed.data.mcpEnabled;
        if (parsed.data.maskEndUserIdentifiers !== undefined) update.mcpMaskIdentifiers = parsed.data.maskEndUserIdentifiers;
        if (Object.keys(update).length > 0) {
            await db.update(teams).set({ ...update, updatedAt: new Date() }).where(eq(teams.id, teamId));
            await createAuditLog({
                userId: req.user!.id,
                teamId,
                action: 'mcp_settings_updated',
                targetType: 'team',
                targetId: teamId,
                previousValue: { mcpEnabled: before.mcpEnabled, maskEndUserIdentifiers: before.mcpMaskIdentifiers },
                newValue: parsed.data,
            }, req);
        }
        const after = await loadTeam(teamId);
        res.json({ settings: { mcpEnabled: after?.mcpEnabled ?? before.mcpEnabled, maskEndUserIdentifiers: after?.mcpMaskIdentifiers ?? before.mcpMaskIdentifiers } });
    } catch (err) {
        logger.error({ err }, 'MCP settings update failed');
        res.status(500).json({ error: 'internal', message: 'The settings could not be saved. Try again.' });
    }
});

export default router;
