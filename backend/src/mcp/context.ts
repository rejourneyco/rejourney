/**
 * Per-call request context and the live access check behind it.
 *
 * A token says what a user approved in the past. Before every tool call the
 * server checks what is still true now: the user is still a member of the
 * team, and each granted project still exists, still belongs to that team and
 * is not deleted. That is one query, cached in memory for a few seconds.
 */

import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { projects, teamMembers, teams } from '../db/schema.js';
import { resolveAllowance } from './allowance.js';
import type { McpAllowance, McpTeamBilling } from './allowance.js';
import type { McpGrant } from './auth.js';
import type { McpDb } from './data/db.js';
import { McpToolError } from './errors.js';

/** What every data-access function receives. Built per call, never stored. */
export interface McpContext {
    requestId: string;
    userId: string;
    grantId: string;
    teamId: string;
    /** Granted projects that are live right now. Every query filters on these. */
    allowedProjectIds: readonly string[];
    scopes: readonly string[];
    /** Team switch: remove emails, user ids and city-level location from results. */
    maskIdentifiers: boolean;
    /** The allowance this call counts against. Absent only in tests that build a context by hand. */
    allowance?: McpAllowance;
    /** Aborted when the call's deadline passes or the client cancels. */
    signal?: AbortSignal;
}

/** The team row as the access check reads it. */
export interface McpTeamState extends McpTeamBilling {
    mcpEnabled: boolean;
    maskIdentifiers: boolean;
}

export interface McpAccess {
    /** False when the user is no longer a member of the grant's team. */
    isMember: boolean;
    /** Granted projects that still belong to the team and are not deleted. */
    activeProjectIds: string[];
    /** The team's MCP switches and billing fields. Absent from checkers that do not read them (tests). */
    team?: McpTeamState;
}

export interface McpAccessChecker {
    check(grant: McpGrant): Promise<McpAccess>;
}

export interface DbAccessCheckerOptions {
    /** How long a result may be reused. Zero disables the cache. */
    ttlMs?: number;
    now?: () => number;
    maxEntries?: number;
}

export const DEFAULT_ACCESS_CACHE_TTL_MS = 3000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
    return typeof value === 'string' && UUID_PATTERN.test(value);
}

/**
 * Membership and project liveness in one query: team_members LEFT JOIN the
 * granted projects. No rows means the user is not a member; rows with a null
 * project mean a member with no live granted project.
 */
export function createDbAccessChecker(db: McpDb, options: DbAccessCheckerOptions = {}): McpAccessChecker {
    const ttlMs = options.ttlMs ?? DEFAULT_ACCESS_CACHE_TTL_MS;
    const now = options.now ?? Date.now;
    const maxEntries = options.maxEntries ?? 5000;
    const cache = new Map<string, { at: number; access: McpAccess }>();

    async function load(grant: McpGrant): Promise<McpAccess> {
        if (!isUuid(grant.userId) || !isUuid(grant.teamId)) return { isMember: false, activeProjectIds: [] };
        const grantedProjectIds = [...new Set(grant.projectIds.filter(isUuid))];

        const membership = and(eq(teamMembers.teamId, grant.teamId), eq(teamMembers.userId, grant.userId));
        const teamColumns = {
            teamId: teams.id,
            ownerUserId: teams.ownerUserId,
            stripeSubscriptionId: teams.stripeSubscriptionId,
            mcpEnabled: teams.mcpEnabled,
            maskIdentifiers: teams.mcpMaskIdentifiers,
            creditLimit: teams.mcpCreditLimit,
            planName: teams.mcpPlanName,
            limitsSyncedAt: teams.mcpLimitsSyncedAt,
            billingCycleAnchor: teams.billingCycleAnchor,
            stripePeriodStart: teams.stripeCurrentPeriodStart,
            stripePeriodEnd: teams.stripeCurrentPeriodEnd,
            paymentFailedAt: teams.paymentFailedAt,
        };
        type TeamRow = { [K in keyof typeof teamColumns]: unknown };
        const toTeam = (row: TeamRow): McpTeamState => ({
            teamId: row.teamId as string,
            ownerUserId: row.ownerUserId as string,
            hasSubscription: Boolean(row.stripeSubscriptionId),
            mcpEnabled: row.mcpEnabled !== false,
            maskIdentifiers: row.maskIdentifiers === true,
            creditLimit: typeof row.creditLimit === 'number' ? row.creditLimit : null,
            planName: typeof row.planName === 'string' ? row.planName : null,
            limitsSyncedAt: (row.limitsSyncedAt as Date | null) ?? null,
            billingCycleAnchor: (row.billingCycleAnchor as Date | null) ?? null,
            stripePeriodStart: (row.stripePeriodStart as Date | null) ?? null,
            stripePeriodEnd: (row.stripePeriodEnd as Date | null) ?? null,
            paymentFailedAt: (row.paymentFailedAt as Date | null) ?? null,
        });

        // One query: membership, the team row, and which granted projects are live.
        const rows = await db
            .select({ projectId: projects.id, ...teamColumns })
            .from(teamMembers)
            .innerJoin(teams, eq(teams.id, teamMembers.teamId))
            .leftJoin(
                projects,
                and(
                    eq(projects.teamId, teamMembers.teamId),
                    grantedProjectIds.length > 0 ? inArray(projects.id, grantedProjectIds) : sql`false`,
                    isNull(projects.deletedAt),
                ),
            )
            .where(membership)
            .limit(grantedProjectIds.length + 1);

        return {
            isMember: rows.length > 0,
            activeProjectIds: rows.map((row) => row.projectId).filter((id): id is string => typeof id === 'string'),
            team: rows[0] ? toTeam(rows[0]) : undefined,
        };
    }

    return {
        async check(grant: McpGrant): Promise<McpAccess> {
            const key = grant.grantId;
            if (ttlMs > 0) {
                const hit = cache.get(key);
                if (hit && now() - hit.at < ttlMs) return hit.access;
            }
            const access = await load(grant);
            if (ttlMs > 0) {
                if (cache.size >= maxEntries) cache.clear();
                cache.set(key, { at: now(), access });
            }
            return access;
        },
    };
}

/** Throws `access_revoked` when the user has left the team, `disabled` when a team admin switched MCP off. */
export function buildMcpContext(
    grant: McpGrant,
    access: McpAccess,
    extras: { requestId: string; signal?: AbortSignal; now?: Date },
): McpContext {
    if (!access.isMember) throw new McpToolError('access_revoked');
    if (access.team && !access.team.mcpEnabled) throw new McpToolError('disabled');
    const granted = new Set(grant.projectIds);
    return {
        requestId: extras.requestId,
        userId: grant.userId,
        grantId: grant.grantId,
        teamId: grant.teamId,
        // Never wider than the grant, whatever the checker returned.
        allowedProjectIds: Object.freeze([...new Set(access.activeProjectIds.filter((id) => granted.has(id)))]),
        scopes: Object.freeze([...grant.scopes]),
        // Either switch masks: the team's current setting, or one recorded on the grant.
        maskIdentifiers: grant.maskIdentifiers === true || access.team?.maskIdentifiers === true,
        allowance: access.team ? resolveAllowance(access.team, extras.now ?? new Date()) : undefined,
        signal: extras.signal,
    };
}
