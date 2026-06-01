/**
 * Replay Quota Check Service
 * 
 * Enforces session replay limits based on team's billing plan.
 * Uses distributed locking to prevent race conditions.
 * 
 * Replay Quota Counting Rules:
 * - Captured analytics sessions increment project_usage.sessions when the
 *   session row is first created.
 * - Billable replay usage increments project_usage.session_replays once, when
 *   the session first becomes replay_available=true.
 * - replay_quota_counted_at makes replay counting idempotent across retries,
 *   worker replays, and reconciliation.
 */

import { eq, and, sql, inArray, isNull } from 'drizzle-orm';
import { db, teams, users, projects, projectUsage, billingNotifications, teamMembers, sessions } from '../db/client.js';
import {
    getSessionLimitCacheWithLock,
    invalidateSessionLimitCache,
    getBillingStatusCache,
    setBillingStatusCache,
    getBillingPeriodCache,
    setBillingPeriodCache,
} from '../db/redis.js';
import { getTeamSubscription } from './stripeProducts.js';
import { sendBillingWarningEmail } from './email.js';
import {
    FREE_TIER_SESSIONS,
    getTeamBillingPeriod,
    getEffectiveBillingPeriod,
    getEffectiveBillingPeriodForDate,
    calculateSessionUsage,
    effectiveBonusSessions,
} from '../utils/billing.js';
import { logger } from '../logger.js';
import { ApiError } from '../middleware/index.js';

// =============================================================================
// Types
// =============================================================================

export interface SessionLimitCheckResult {
    allowed: boolean;
    /** Backward-compatible alias for sessionReplaysUsed. */
    sessionsUsed: number;
    sessionsCaptured: number;
    sessionReplaysUsed: number;
    /** Backward-compatible alias for sessionReplayLimit. */
    sessionLimit: number;
    sessionReplayLimit: number;
    sessionsRemaining: number;
    sessionReplaysRemaining: number;
    percentUsed: number;
    sessionReplayPercentUsed: number;
    planName: string;
    isAtLimit: boolean;
    isReplayAtLimit: boolean;
    isNearLimit: boolean;
    isReplayNearLimit: boolean;
    /** Plan cap without bonus (matches Stripe / free tier) */
    planSessionLimit: number;
    sessionReplayPlanLimit: number;
    /** Bonus applied this billing period only; 0 after the period changes */
    bonusSessionsActive: number;
}

export interface TeamSessionData {
    teamId: string;
    /** Backward-compatible alias for sessionReplaysUsed. */
    sessionsUsed: number;
    sessionsCaptured: number;
    sessionReplaysUsed: number;
    /** Backward-compatible alias for sessionReplayLimit. */
    sessionLimit: number;
    sessionReplayLimit: number;
    planName: string;
    planSessionLimit: number;
    sessionReplayPlanLimit: number;
    bonusSessionsActive: number;
}

type OwnerFreeTierUsage = {
    sessionReplaysUsed: number;
    sessionsCaptured: number;
};

// =============================================================================
// Replay Quota Checking
// =============================================================================

async function calculateOwnerFreeTierUsageDetails(ownerUserId: string): Promise<OwnerFreeTierUsage> {
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
        return { sessionReplaysUsed: 0, sessionsCaptured: 0 };
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
        return { sessionReplaysUsed: 0, sessionsCaptured: 0 };
    }

    // For each free team, calculate sessions in their current billing period
    // Then sum them all together
    let totalSessionReplays = 0;
    let totalSessionsCaptured = 0;

    for (const team of ownedTeams.filter(t => freeTeamIds.includes(t.id))) {
        const period = getTeamBillingPeriod(team.billingCycleAnchor ?? null);

        const teamProjectIds = freeTeamProjects
            .filter(p => p.teamId === team.id)
            .map(p => p.id);

        if (teamProjectIds.length > 0) {
            const [usageAgg] = await db
                .select({
                    totalSessionReplays: sql<number>`COALESCE(SUM(${projectUsage.sessionReplays}), 0)::int`,
                    totalSessionsCaptured: sql<number>`COALESCE(SUM(${projectUsage.sessions}), 0)::int`,
                })
                .from(projectUsage)
                .where(and(
                    inArray(projectUsage.projectId, teamProjectIds),
                    eq(projectUsage.period, period)
                ));
            totalSessionReplays += usageAgg?.totalSessionReplays ?? 0;
            totalSessionsCaptured += usageAgg?.totalSessionsCaptured ?? 0;
        }
    }

    return {
        sessionReplaysUsed: totalSessionReplays,
        sessionsCaptured: totalSessionsCaptured,
    };
}

/**
 * Calculate free tier replay usage for an account owner.
 * Backward-compatible name: free tier limits are now replay limits.
 */
export async function calculateOwnerFreeTierUsage(ownerUserId: string): Promise<number> {
    const usage = await calculateOwnerFreeTierUsageDetails(ownerUserId);
    return usage.sessionReplaysUsed;
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
            bonusSessions: teams.bonusSessions,
            bonusSessionsBillingPeriod: teams.bonusSessionsBillingPeriod,
            stripeCurrentPeriodStart: teams.stripeCurrentPeriodStart,
            stripeCurrentPeriodEnd: teams.stripeCurrentPeriodEnd,
        })
        .from(teams)
        .where(eq(teams.id, teamId))
        .limit(1);

    if (!team) {
        throw new Error('Team not found');
    }

    const subscription = await getTeamSubscription(teamId);

    // Use Stripe period boundaries when available (handles calendar-month subscriptions
    // where 30-day anchor math would roll the period a day early in 31-day months).
    const period = periodOverride ?? getEffectiveBillingPeriod(
        team.billingCycleAnchor ?? null,
        team.stripeCurrentPeriodStart ?? null,
        team.stripeCurrentPeriodEnd ?? null,
    );

    let sessionReplaysUsed = 0;
    let sessionsCaptured = 0;

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
                .select({
                    totalSessionReplays: sql<number>`COALESCE(SUM(${projectUsage.sessionReplays}), 0)::int`,
                    totalSessionsCaptured: sql<number>`COALESCE(SUM(${projectUsage.sessions}), 0)::int`,
                })
                .from(projectUsage)
                .where(and(
                    inArray(projectUsage.projectId, projectIds),
                    eq(projectUsage.period, period)
                ));
            sessionReplaysUsed = usageAgg?.totalSessionReplays ?? 0;
            sessionsCaptured = usageAgg?.totalSessionsCaptured ?? 0;
        }
    } else {
        // Free plan: count replay quota across ALL free teams owned by the account owner
        const ownerUsage = await calculateOwnerFreeTierUsageDetails(team.ownerUserId);
        sessionReplaysUsed = ownerUsage.sessionReplaysUsed;
        sessionsCaptured = ownerUsage.sessionsCaptured;
    }

    const effectiveBonus = effectiveBonusSessions(
        team.bonusSessions ?? 0,
        team.bonusSessionsBillingPeriod,
        team.billingCycleAnchor ?? null,
        period
    );

    const planSessionLimit = subscription.sessionLimit;

    return {
        teamId,
        sessionsUsed: sessionReplaysUsed,
        sessionsCaptured,
        sessionReplaysUsed,
        sessionLimit: planSessionLimit + effectiveBonus,
        sessionReplayLimit: planSessionLimit + effectiveBonus,
        planSessionLimit,
        sessionReplayPlanLimit: planSessionLimit,
        bonusSessionsActive: effectiveBonus,
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
 * @throws ApiError.tooManyRequests if session replay limit reached
 */
export async function checkAndEnforceSessionLimit(
    teamId: string
): Promise<SessionLimitCheckResult> {
    // Fast path: get billing period from Redis cache (1h TTL) to avoid a teams
    // SELECT on every presign call. The period only changes once a month at
    // billing renewal; syncTeamFromStripe invalidates this cache when it changes.
    let currentPeriod = await getBillingPeriodCache(teamId);

    if (!currentPeriod) {
        // Cache miss — fetch the three period-related columns from teams
        const [team] = await db
            .select({
                billingCycleAnchor: teams.billingCycleAnchor,
                stripeCurrentPeriodStart: teams.stripeCurrentPeriodStart,
                stripeCurrentPeriodEnd: teams.stripeCurrentPeriodEnd,
            })
            .from(teams)
            .where(eq(teams.id, teamId))
            .limit(1);

        currentPeriod = getEffectiveBillingPeriod(
            team?.billingCycleAnchor ?? null,
            team?.stripeCurrentPeriodStart ?? null,
            team?.stripeCurrentPeriodEnd ?? null,
        );

        // Store for next call (fire-and-forget; failure falls back to DB gracefully)
        setBillingPeriodCache(teamId, currentPeriod).catch(() => {});
    }

    // Use distributed locking to prevent cache stampede race conditions
    const sessionData = await getSessionLimitCacheWithLock(
        teamId,
        currentPeriod,
        () => fetchTeamSessionData(teamId)
    );

    const {
        sessionsUsed,
        sessionsCaptured,
        sessionReplaysUsed,
        sessionLimit,
        sessionReplayLimit,
        planName,
        planSessionLimit,
        sessionReplayPlanLimit,
        bonusSessionsActive,
    } = sessionData;
    const usage = calculateSessionUsage(sessionsUsed, sessionLimit);

    // Check if session replay limit is reached
    if (usage.isAtLimit) {
        logger.info({ teamId, sessionReplaysUsed, sessionReplayLimit, planName }, 'Team session replay limit reached');
        throw ApiError.tooManyRequests(
            `Session replay limit reached (${sessionsUsed}/${sessionLimit}). Please upgrade your plan.`
        );
    }

    return {
        allowed: true,
        sessionsUsed,
        sessionsCaptured,
        sessionReplaysUsed,
        sessionLimit,
        sessionReplayLimit,
        sessionsRemaining: usage.remaining,
        sessionReplaysRemaining: usage.remaining,
        percentUsed: usage.percentUsed,
        sessionReplayPercentUsed: usage.percentUsed,
        planName,
        isAtLimit: usage.isAtLimit,
        isReplayAtLimit: usage.isAtLimit,
        isNearLimit: usage.isNearLimit,
        isReplayNearLimit: usage.isNearLimit,
        planSessionLimit,
        sessionReplayPlanLimit,
        bonusSessionsActive,
    };
}

/**
 * Get replay quota and captured-session usage for a team without enforcing limits
 * Uses team's billing cycle anchor for period calculation
 */
export async function getTeamSessionUsage(
    teamId: string
): Promise<SessionLimitCheckResult> {
    const sessionData = await fetchTeamSessionData(teamId);

    const {
        sessionsUsed,
        sessionsCaptured,
        sessionReplaysUsed,
        sessionLimit,
        sessionReplayLimit,
        planName,
        planSessionLimit,
        sessionReplayPlanLimit,
        bonusSessionsActive,
    } = sessionData;
    const usage = calculateSessionUsage(sessionsUsed, sessionLimit);

    return {
        allowed: !usage.isAtLimit,
        sessionsUsed,
        sessionsCaptured,
        sessionReplaysUsed,
        sessionLimit,
        sessionReplayLimit,
        sessionsRemaining: usage.remaining,
        sessionReplaysRemaining: usage.remaining,
        percentUsed: usage.percentUsed,
        sessionReplayPercentUsed: usage.percentUsed,
        planName,
        isAtLimit: usage.isAtLimit,
        isReplayAtLimit: usage.isAtLimit,
        isNearLimit: usage.isNearLimit,
        isReplayNearLimit: usage.isNearLimit,
        planSessionLimit,
        sessionReplayPlanLimit,
        bonusSessionsActive,
    };
}

/**
 * Invalidate replay limit cache for a team
 * Call this after session count updates or plan changes
 */
export async function invalidateSessionCache(teamId: string): Promise<void> {
    await invalidateSessionLimitCache(teamId);
}

// =============================================================================
// Billing Status Checking
// =============================================================================

/**
 * Check billing status for a team.
 * Returns whether the team can record based on payment status.
 *
 * Caches the result in Redis for 60 s to avoid a DB hit on every presign
 * request. Invalidated by syncTeamFromStripe when paymentFailedAt changes.
 */
export async function checkBillingStatus(
    teamId: string
): Promise<{ canRecord: boolean; reason?: string }> {
    // Fast path: Redis cache hit avoids a DB round-trip on every presign call
    const cached = await getBillingStatusCache(teamId);
    if (cached !== null) return cached;

    const [team] = await db
        .select({
            paymentFailedAt: teams.paymentFailedAt,
        })
        .from(teams)
        .where(eq(teams.id, teamId))
        .limit(1);

    if (!team) {
        // Don't cache "not found" — it's transient / shouldn't happen in production
        return { canRecord: false, reason: 'Team not found' };
    }

    const result: { canRecord: boolean; reason?: string } = team.paymentFailedAt
        ? { canRecord: false, reason: 'Payment failed - please update your payment method' }
        : { canRecord: true };

    // Cache for 60 s; Stripe webhook path will invalidate on payment status change
    setBillingStatusCache(teamId, result).catch(() => {});

    // Replay-limit enforcement is handled separately via checkAndEnforceSessionLimit().
    return result;
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
    sessionsCaptured: number;
    sessionReplaysUsed: number;
    sessionsRemaining: number;
    sessionReplaysRemaining: number;
    isExhausted: boolean;
}> {
    // Calculate free tier usage dynamically across all free teams
    const ownerUsage = await calculateOwnerFreeTierUsageDetails(userId);
    const sessionsUsed = ownerUsage.sessionReplaysUsed;

    // Sum bonus sessions from all free teams owned by this user
    const ownedFreeTeams = await db
        .select({
            bonusSessions: teams.bonusSessions,
            bonusSessionsBillingPeriod: teams.bonusSessionsBillingPeriod,
            billingCycleAnchor: teams.billingCycleAnchor,
        })
        .from(teams)
        .where(and(
            eq(teams.ownerUserId, userId),
            isNull(teams.stripeSubscriptionId)
        ));
    const totalBonus = ownedFreeTeams.reduce(
        (sum, t) =>
            sum +
            effectiveBonusSessions(
                t.bonusSessions ?? 0,
                t.bonusSessionsBillingPeriod,
                t.billingCycleAnchor ?? null
            ),
        0
    );
    const effectiveLimit = FREE_TIER_SESSIONS + totalBonus;

    const isExhausted = sessionsUsed >= effectiveLimit;
    const sessionsRemaining = Math.max(0, effectiveLimit - sessionsUsed);

    return {
        canRecord: !isExhausted,
        sessionsUsed,
        sessionsCaptured: ownerUsage.sessionsCaptured,
        sessionReplaysUsed: sessionsUsed,
        sessionsRemaining,
        sessionReplaysRemaining: sessionsRemaining,
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
    capturedSessions: number = 1
): Promise<void> {
    // Get team's billing cycle anchor to determine current period
    const [team] = await db
        .select({
            billingCycleAnchor: teams.billingCycleAnchor,
            stripeCurrentPeriodStart: teams.stripeCurrentPeriodStart,
            stripeCurrentPeriodEnd: teams.stripeCurrentPeriodEnd,
        })
        .from(teams)
        .where(eq(teams.id, teamId))
        .limit(1);

    const period = getEffectiveBillingPeriod(
        team?.billingCycleAnchor ?? null,
        team?.stripeCurrentPeriodStart ?? null,
        team?.stripeCurrentPeriodEnd ?? null,
    );

    // Upsert project usage
    await db
        .insert(projectUsage)
        .values({
            projectId,
            period,
            sessions: capturedSessions,
            sessionReplays: 0,
            storageBytes: BigInt(0),
            requests: 0,
        })
        .onConflictDoUpdate({
            target: [projectUsage.projectId, projectUsage.period, projectUsage.quotaVersion],
            set: {
                sessions: sql`${projectUsage.sessions} + ${capturedSessions}`,
                updatedAt: new Date(),
            },
        });

    // Invalidate cache
    await invalidateSessionCache(teamId);

    logger.debug({ projectId, teamId, capturedSessions, period }, 'Project captured session count incremented');
}

export async function incrementProjectSessionReplayIfNeeded(sessionId: string): Promise<boolean> {
    const countedAt = new Date();

    const result = await db.transaction(async (tx) => {
        const [row] = await tx
            .select({
                sessionId: sessions.id,
                projectId: sessions.projectId,
                startedAt: sessions.startedAt,
                replayAvailable: sessions.replayAvailable,
                replayQuotaBillingExhausted: sessions.replayQuotaBillingExhausted,
                teamId: projects.teamId,
                billingCycleAnchor: teams.billingCycleAnchor,
                stripeCurrentPeriodStart: teams.stripeCurrentPeriodStart,
                stripeCurrentPeriodEnd: teams.stripeCurrentPeriodEnd,
            })
            .from(sessions)
            .innerJoin(projects, eq(sessions.projectId, projects.id))
            .innerJoin(teams, eq(projects.teamId, teams.id))
            .where(eq(sessions.id, sessionId))
            .limit(1);

        if (!row || !row.replayAvailable || row.replayQuotaBillingExhausted) {
            return null;
        }

        const updated = await tx
            .update(sessions)
            .set({ replayQuotaCountedAt: countedAt, updatedAt: countedAt })
            .where(and(eq(sessions.id, sessionId), isNull(sessions.replayQuotaCountedAt)))
            .returning({ id: sessions.id });

        if (updated.length === 0) {
            return null;
        }

        const period = getEffectiveBillingPeriodForDate(
            row.billingCycleAnchor ?? null,
            row.stripeCurrentPeriodStart ?? null,
            row.stripeCurrentPeriodEnd ?? null,
            row.startedAt ?? countedAt,
        );

        await tx
            .insert(projectUsage)
            .values({
                projectId: row.projectId,
                period,
                sessions: 0,
                sessionReplays: 1,
                storageBytes: BigInt(0),
                requests: 0,
            })
            .onConflictDoUpdate({
                target: [projectUsage.projectId, projectUsage.period, projectUsage.quotaVersion],
                set: {
                    sessionReplays: sql`${projectUsage.sessionReplays} + 1`,
                    updatedAt: countedAt,
                },
            });

        return { teamId: row.teamId, period, projectId: row.projectId };
    });

    if (!result) {
        return false;
    }

    await invalidateSessionCache(result.teamId);

    logger.debug({
        projectId: result.projectId,
        teamId: result.teamId,
        sessionId,
        period: result.period,
    }, 'Project session replay count incremented');

    checkAndSendUsageAlerts(result.teamId, result.period).catch(err => {
        logger.error({ err, teamId: result.teamId }, 'Failed to check/send replay usage alert');
    });

    return true;
}


/**
 * Check and send replay usage alerts if thresholds are crossed (80%, 100%).
 */
export async function checkAndSendUsageAlerts(teamId: string, period: string): Promise<void> {
    const sessionData = await fetchTeamSessionData(teamId, period);
    const { sessionReplaysUsed, sessionReplayLimit, sessionsCaptured, planName } = sessionData;

    // Don't alert for unlimited plans or zero limits (shouldn't happen)
    if (sessionReplayLimit <= 0) return;

    const percentUsed = (sessionReplaysUsed / sessionReplayLimit) * 100;

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

    const dedupeKey = `team:${teamId}:period:${period}:type:${alertType}`;
    const notificationMetadata = {
        sessionsUsed: sessionReplaysUsed,
        sessionLimit: sessionReplayLimit,
        sessionReplaysUsed,
        sessionReplayLimit,
        sessionsCaptured,
        percentUsed,
        planName,
        usageMetric: 'session_replays',
    };

    const inserted = await db.insert(billingNotifications).values({
        teamId,
        type: alertType,
        period,
        dedupeKey,
        metadata: notificationMetadata,
        sentAt: new Date()
    }).onConflictDoNothing().returning({ id: billingNotifications.id });

    if (inserted.length === 0) return;

    try {
        await sendBillingWarningEmail(
            recipientEmails,
            team.name || 'Your Team',
            Math.floor(percentUsed),
            sessionReplaysUsed,
            sessionReplayLimit
        );
    } catch (err) {
        await db.delete(billingNotifications).where(eq(billingNotifications.id, inserted[0].id));
        throw err;
    }

    logger.info({ teamId, alertType, percentUsed, recipientsCount: recipientEmails.length }, 'Sent usage alert emails');
}
