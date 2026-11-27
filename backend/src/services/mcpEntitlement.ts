/**
 * MCP entitlement: copies the team's MCP credit allowance from its billing plan
 * onto the `teams` row, where the MCP server reads it.
 *
 * After a sync, `mcp_credit_limit` null means unlimited. That only happens when
 * billing is disabled (self-hosted) and `MCP_CREDIT_LIMIT` is not set.
 */

import { eq } from 'drizzle-orm';
import { config } from '../config.js';
import { db, teams } from '../db/client.js';
import { logger } from '../logger.js';
import { FREE_TIER_MCP_CREDITS, getTeamSubscription, isStripeEnabled } from './stripeProducts.js';

const RESYNC_AFTER_MS = 60 * 60 * 1000;
const SELF_HOSTED_PLAN_NAME = 'self-hosted';
const FREE_PLAN_NAME = 'free';
const PLAN_NAME_MAX_LENGTH = 64;

interface McpLimits {
    creditLimit: number | null;
    planName: string;
}

async function resolvePlanLimits(teamId: string): Promise<McpLimits> {
    if (!isStripeEnabled()) {
        return { creditLimit: config.MCP_CREDIT_LIMIT ?? null, planName: SELF_HOSTED_PLAN_NAME };
    }

    const subscription = await getTeamSubscription(teamId);
    if (!subscription.priceId || subscription.planName === FREE_PLAN_NAME) {
        return { creditLimit: FREE_TIER_MCP_CREDITS, planName: FREE_PLAN_NAME };
    }
    return {
        creditLimit: subscription.mcpCreditLimit,
        planName: subscription.planName.slice(0, PLAN_NAME_MAX_LENGTH),
    };
}

/**
 * Resolve the team's MCP allowance from its plan and store it on the team row.
 * Writes only when a value changed or the last sync is older than an hour.
 * Billing lookups that fail (for example Stripe unreachable) do not throw: the
 * team row's current values are returned, or the free defaults if it was never synced.
 */
export async function syncTeamMcpLimits(teamId: string): Promise<{ creditLimit: number | null; planName: string }> {
    const [team] = await db
        .select({
            mcpCreditLimit: teams.mcpCreditLimit,
            mcpPlanName: teams.mcpPlanName,
            mcpLimitsSyncedAt: teams.mcpLimitsSyncedAt,
        })
        .from(teams)
        .where(eq(teams.id, teamId))
        .limit(1);

    if (!team) {
        throw new Error('Team not found');
    }

    let resolved: McpLimits;
    try {
        resolved = await resolvePlanLimits(teamId);
    } catch (err) {
        logger.warn({ err, teamId }, 'Could not resolve MCP limits from billing; keeping stored values');
        if (team.mcpLimitsSyncedAt) {
            return { creditLimit: team.mcpCreditLimit, planName: team.mcpPlanName ?? FREE_PLAN_NAME };
        }
        return { creditLimit: FREE_TIER_MCP_CREDITS, planName: FREE_PLAN_NAME };
    }

    const now = new Date();
    const changed = team.mcpCreditLimit !== resolved.creditLimit || team.mcpPlanName !== resolved.planName;
    const stale = !team.mcpLimitsSyncedAt || now.getTime() - team.mcpLimitsSyncedAt.getTime() > RESYNC_AFTER_MS;

    if (changed || stale) {
        try {
            await db
                .update(teams)
                .set({
                    mcpCreditLimit: resolved.creditLimit,
                    mcpPlanName: resolved.planName,
                    mcpLimitsSyncedAt: now,
                })
                .where(eq(teams.id, teamId));
            if (changed) {
                logger.info({
                    teamId,
                    creditLimit: resolved.creditLimit,
                    planName: resolved.planName,
                    previousCreditLimit: team.mcpCreditLimit,
                    previousPlanName: team.mcpPlanName,
                }, 'MCP limits synced from billing plan');
            }
        } catch (err) {
            logger.error({ err, teamId }, 'Failed to store MCP limits on team');
        }
    }

    return resolved;
}

/** Per-user MCP tool calls per minute, scaled by the plan's monthly credit allowance. */
export function mcpRateLimitPerMinute(creditLimit: number | null): number {
    if (creditLimit === null) return 120;
    if (creditLimit <= 300) return 10;
    if (creditLimit <= 2_000) return 20;
    if (creditLimit <= 6_000) return 30;
    if (creditLimit <= 20_000) return 60;
    return 120;
}
