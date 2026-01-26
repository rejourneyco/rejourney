/**
 * Session Limit Check Service
 * 
 * Enforces session limits based on team's billing plan.
 * Uses distributed locking to prevent race conditions.
 * 
 * Session Counting Rules:
 * - Sessions are counted when rejourneyEnabled=true (regardless of recordingEnabled)
 * - Sessions are counted on first chunk upload
 * - Sessions are NOT counted for duplicate session IDs
 */

import { eq, and, sql, inArray, isNull } from 'drizzle-orm';
import { db, teams, users, projects, projectUsage, billingNotifications, teamMembers } from '../db/client.js';
import { getSessionLimitCacheWithLock, invalidateSessionLimitCache } from '../db/redis.js';
import { getTeamSubscription } from './stripeProducts.js';
import { sendBillingWarningEmail } from './email.js';
import {
    FREE_TIER_SESSIONS,
    getTeamBillingPeriod,
    calculateSessionUsage,
    isFreeTierExhausted,
} from '../utils/billing.js';
import { logger } from '../logger.js';
import { ApiError } from '../middleware/index.js';

// =============================================================================
// Types
// =============================================================================

export interface SessionLimitCheckResult {
    allowed: boolean;
    sessionsUsed: number;
    sessionLimit: number;
    sessionsRemaining: number;
    percentUsed: number;
    planName: string;
    isAtLimit: boolean;
    isNearLimit: boolean;
}

export interface TeamSessionData {
    teamId: string;
    sessionsUsed: number;
    sessionLimit: number;
    planName: string;
}

// =============================================================================
// Session Limit Checking
// =============================================================================

/**
 * Calculate free tier usage for an account owner
 * Sums sessions from all free teams owned by the owner
 * Excludes teams that are on paid plans
 */
export async function calculateOwnerFreeTierUsage(ownerUserId: string): Promise<number> {
    // Get all teams owned by this user
    const ownedTeams = await db
        .select({
            id: teams.id,
            stripeSubscriptionId: teams.stripeSubscriptionId,
            billingCycleAnchor: teams.billingCycleAnchor,
        })
        .from(teams)
        .where(eq(teams.ownerUserId, ownerUserId));

    // Filter to only free teams (no active subscription)
    const freeTeamIds = ownedTeams
        .filter(team => !team.stripeSubscriptionId)
        .map(team => team.id);

    if (freeTeamIds.length === 0) {
        return 0;
    }

    // Get all projects for free teams
    const freeTeamProjects = await db
        .select({ id: projects.id, teamId: projects.teamId })
        .from(projects)
        .where(and(
            inArray(projects.teamId, freeTeamIds),
            isNull(projects.deletedAt)
        ));

    if (freeTeamProjects.length === 0) {
        return 0;
    }

    // For each free team, calculate sessions in their current billing period
    // Then sum them all together
    let totalSessions = 0;

    for (const team of ownedTeams.filter(t => freeTeamIds.includes(t.id))) {
        const period = getTeamBillingPeriod(team.billingCycleAnchor ?? null);

        const teamProjectIds = freeTeamProjects
            .filter(p => p.teamId === team.id)
            .map(p => p.id);

        if (teamProjectIds.length > 0) {
            const [usageAgg] = await db
                .select({ totalSessions: sql<number>`COALESCE(SUM(${projectUsage.sessions}), 0)::int` })
                .from(projectUsage)
                .where(and(
                    inArray(projectUsage.projectId, teamProjectIds),
                    eq(projectUsage.period, period)
                ));
            totalSessions += usageAgg?.totalSessions ?? 0;
        }
    }

    return totalSessions;
}

/**
 * Fetch session data from database for a team
 * Uses team's billing cycle anchor for period calculation
 * For free teams, calculates usage across all free teams owned by the account owner
 */
async function fetchTeamSessionData(
    teamId: string,
    periodOverride?: string
): Promise<TeamSessionData> {
    // Get team's plan info and billing cycle anchor
    const [team] = await db
        .select({
            billingCycleAnchor: teams.billingCycleAnchor,
            ownerUserId: teams.ownerUserId,
            stripeSubscriptionId: teams.stripeSubscriptionId,
        })
        .from(teams)
        .where(eq(teams.id, teamId))
        .limit(1);

    if (!team) {
        throw new Error('Team not found');
    }

    const subscription = await getTeamSubscription(teamId);

    // Use team's billing period based on their anchor, or override if provided
    const period = periodOverride ?? getTeamBillingPeriod(team?.billingCycleAnchor ?? null);

    let sessionsUsed = 0;

    // If team is on a paid plan, calculate sessions for this team only
    if (team.stripeSubscriptionId) {
        // Paid plan: count sessions for this team only
        const teamProjects = await db
            .select({ id: projects.id })
            .from(projects)
            .where(and(eq(projects.teamId, teamId), isNull(projects.deletedAt)));

        const projectIds = teamProjects.map(p => p.id);

        if (projectIds.length > 0) {
            const [usageAgg] = await db
                .select({ totalSessions: sql<number>`COALESCE(SUM(${projectUsage.sessions}), 0)::int` })
                .from(projectUsage)
                .where(and(
                    inArray(projectUsage.projectId, projectIds),
                    eq(projectUsage.period, period)
                ));
            sessionsUsed = usageAgg?.totalSessions ?? 0;
        }
    } else {
        // Free plan: count sessions across ALL free teams owned by the account owner
        sessionsUsed = await calculateOwnerFreeTierUsage(team.ownerUserId);
    }

    return {
        teamId,
        sessionsUsed,
        sessionLimit: subscription.sessionLimit,
        planName: subscription.planName,
    };
}

/**
 * Check if a team can record a new session
 * 
 * Uses distributed locking to prevent race conditions when multiple 
 * sessions start simultaneously.
 * 
 * Session counting uses team's billing cycle anchor:
 * - Each team has their own 30-day billing period based on their anchor
 * - Upgrading resets the anchor to the upgrade date (fresh start)
 * 
 * @param teamId - Team ID
 * @throws ApiError.tooManyRequests if session limit reached
 */
export async function checkAndEnforceSessionLimit(
    teamId: string
): Promise<SessionLimitCheckResult> {
    // Get team's billing cycle anchor to determine current period
    const [team] = await db
        .select({ billingCycleAnchor: teams.billingCycleAnchor })
        .from(teams)
        .where(eq(teams.id, teamId))
        .limit(1);

    const currentPeriod = getTeamBillingPeriod(team?.billingCycleAnchor ?? null);

    // Use distributed locking to prevent cache stampede race conditions
    const sessionData = await getSessionLimitCacheWithLock(
        teamId,
        currentPeriod,
        () => fetchTeamSessionData(teamId)
    );

    const { sessionsUsed, sessionLimit, planName } = sessionData;
    const usage = calculateSessionUsage(sessionsUsed, sessionLimit);

    // Check if session limit is reached
    if (usage.isAtLimit) {
        logger.info({ teamId, sessionsUsed, sessionLimit, planName }, 'Team session limit reached');
        throw ApiError.tooManyRequests(
            `Session limit reached (${sessionsUsed}/${sessionLimit}). Please upgrade your plan.`
        );
    }

    return {
        allowed: true,
        sessionsUsed,
        sessionLimit,
        sessionsRemaining: usage.remaining,
        percentUsed: usage.percentUsed,
        planName,
        isAtLimit: usage.isAtLimit,
        isNearLimit: usage.isNearLimit,
    };
}

/**
 * Get session usage for a team without enforcing limits
 * Uses team's billing cycle anchor for period calculation
 */
export async function getTeamSessionUsage(
    teamId: string
): Promise<SessionLimitCheckResult> {
    const sessionData = await fetchTeamSessionData(teamId);

    const { sessionsUsed, sessionLimit, planName } = sessionData;
    const usage = calculateSessionUsage(sessionsUsed, sessionLimit);

    return {
        allowed: !usage.isAtLimit,
        sessionsUsed,
        sessionLimit,
        sessionsRemaining: usage.remaining,
        percentUsed: usage.percentUsed,
        planName,
        isAtLimit: usage.isAtLimit,
        isNearLimit: usage.isNearLimit,
    };
}

/**
 * Invalidate session limit cache for a team
 * Call this after session count updates or plan changes
 */
export async function invalidateSessionCache(teamId: string): Promise<void> {
    await invalidateSessionLimitCache(teamId);
}

// =============================================================================
// Billing Status Checking
// =============================================================================

/**
 * Check billing status for a team
 * Returns whether the team can record based on payment status and session limits
 */
export async function checkBillingStatus(
    teamId: string
): Promise<{ canRecord: boolean; reason?: string }> {
    const [team] = await db
        .select({
            ownerUserId: teams.ownerUserId,
            paymentFailedAt: teams.paymentFailedAt,
        })
        .from(teams)
        .where(eq(teams.id, teamId))
        .limit(1);

    if (!team) {
        return { canRecord: false, reason: 'Team not found' };
    }

    // Check if payment has failed
    if (team.paymentFailedAt) {
        return {
            canRecord: false,
            reason: 'Payment failed - please update your payment method'
        };
    }

    // Check if owner can record (free tier check)
    const { canUserRecord } = await import('../routes/stripeBilling.js');
    return canUserRecord(team.ownerUserId, teamId);
}

// =============================================================================
// Free Tier Checking (User Level)
// =============================================================================

/**
 * Check if a user (account owner) can record based on their free tier usage
 * Free tier combines sessions from all free teams owned by the account owner
 * 
 * @param userId - User ID (account owner)
 * @returns Free tier usage info
 */
export async function checkUserFreeTier(userId: string): Promise<{
    canRecord: boolean;
    sessionsUsed: number;
    sessionsRemaining: number;
    isExhausted: boolean;
}> {
    // Calculate free tier usage dynamically across all free teams
    const sessionsUsed = await calculateOwnerFreeTierUsage(userId);
    const isExhausted = isFreeTierExhausted(sessionsUsed);
    const sessionsRemaining = Math.max(0, FREE_TIER_SESSIONS - sessionsUsed);

    return {
        canRecord: !isExhausted,
        sessionsUsed,
        sessionsRemaining,
        isExhausted,
    };
}

// =============================================================================
// Session Counting
// =============================================================================

/**
 * Increment session count for a project
 * Called when a new session starts (first chunk upload)
 * 
 * Uses team's billing cycle anchor for period calculation
 * 
 * @param projectId - Project ID
 * @param teamId - Team ID
 * @param sessions - Number of sessions to add (default 1)
 */
export async function incrementProjectSessionCount(
    projectId: string,
    teamId: string,
    sessions: number = 1
): Promise<void> {
    // Get team's billing cycle anchor to determine current period
    const [team] = await db
        .select({ billingCycleAnchor: teams.billingCycleAnchor })
        .from(teams)
        .where(eq(teams.id, teamId))
        .limit(1);

    const period = getTeamBillingPeriod(team?.billingCycleAnchor ?? null);

    // Upsert project usage
    await db
        .insert(projectUsage)
        .values({
            projectId,
            period,
            sessions,
            storageBytes: BigInt(0),
            requests: 0,
        })
        .onConflictDoUpdate({
            target: [projectUsage.projectId, projectUsage.period, projectUsage.quotaVersion],
            set: {
                sessions: sql`${projectUsage.sessions} + ${sessions}`,
                updatedAt: new Date(),
            },
        });

    // Invalidate cache
    await invalidateSessionCache(teamId);

    logger.debug({ projectId, teamId, sessions, period }, 'Project session count incremented');

    // Fire and forget usage alert check
    checkAndSendUsageAlerts(teamId, period).catch(err => {
        logger.error({ err, teamId }, 'Failed to check/send usage alert');
    });
}


/**
 * Check and send usage alerts if thresholds are crossed (80%, 100%)
 */
export async function checkAndSendUsageAlerts(teamId: string, period: string): Promise<void> {
    const sessionData = await fetchTeamSessionData(teamId, period);
    const { sessionsUsed, sessionLimit, planName } = sessionData;

    // Don't alert for unlimited plans or zero limits (shouldn't happen)
    if (sessionLimit <= 0) return;

    const percentUsed = (sessionsUsed / sessionLimit) * 100;

    let alertType: 'warning_80' | 'limit_100' | null = null;
    if (percentUsed >= 100) {
        alertType = 'limit_100';
    } else if (percentUsed >= 80) {
        alertType = 'warning_80';
    }

    if (!alertType) return;

    // Check if we already sent this alert for this period
    const existing = await db.select()
        .from(billingNotifications)
        .where(and(
            eq(billingNotifications.teamId, teamId),
            eq(billingNotifications.period, period),
            eq(billingNotifications.type, alertType)
        ))
        .limit(1);

    if (existing.length > 0) return;

    // Get team info
    const [team] = await db.select({
        name: teams.name,
        billingEmail: teams.billingEmail,
        ownerUserId: teams.ownerUserId,
        stripeSubscriptionId: teams.stripeSubscriptionId
    })
        .from(teams)
        .where(eq(teams.id, teamId))
        .limit(1);

    if (!team) return;

    // Determine recipients
    let recipientEmails: string[] = [];

    if (team.stripeSubscriptionId) {
        // PAID PLAN: Broadcast to owner, admins, and billing admins
        const members = await db
            .select({ email: users.email })
            .from(teamMembers)
            .innerJoin(users, eq(teamMembers.userId, users.id))
            .where(and(
                eq(teamMembers.teamId, teamId),
                inArray(teamMembers.role, ['owner', 'admin', 'billing_admin'])
            ));
        recipientEmails = members.map(m => m.email);

        // Add specific billing email if not in list
        if (team.billingEmail && !recipientEmails.includes(team.billingEmail)) {
            recipientEmails.push(team.billingEmail);
        }
    } else {
        // FREE PLAN: Owner only
        const [owner] = await db.select({ email: users.email })
            .from(users)
            .where(eq(users.id, team.ownerUserId))
            .limit(1);
        if (owner?.email) {
            recipientEmails.push(owner.email);
        }
    }

    // Deduplicate and filter empty
    recipientEmails = [...new Set(recipientEmails.filter(email => !!email))];

    if (recipientEmails.length === 0) {
        logger.warn({ teamId, alertType }, 'No recipients found for usage alert');
        return;
    }

    // Send email
    await sendBillingWarningEmail(
        recipientEmails,
        team.name || 'Your Team',
        Math.floor(percentUsed),
        sessionsUsed,
        sessionLimit
    );

    // Record notification
    await db.insert(billingNotifications).values({
        teamId,
        type: alertType,
        period,
        metadata: { sessionsUsed, sessionLimit, percentUsed, planName },
        sentAt: new Date()
    });

    logger.info({ teamId, alertType, percentUsed, recipientsCount: recipientEmails.length }, 'Sent usage alert emails');
}

