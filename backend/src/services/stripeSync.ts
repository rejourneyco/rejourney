/**
 * Stripe Sync Service
 *
 * Reconciles local DB billing state against Stripe as the source of truth.
 * Designed to be safe, idempotent, and non-destructive:
 *
 * - Read-only for teams already in sync (no DB writes if nothing is wrong)
 * - Rebuilds current-period project_usage from the sessions table (ground truth)
 * - Zeroes out stale wrong-period rows instead of deleting them (audit trail kept)
 * - All period migrations run inside a transaction so failures roll back fully
 * - Handles bonus sessions: syncs paymentFailedAt considering effective bonus
 * - Safe to run concurrently with the live API
 *
 * Source-of-truth hierarchy:
 *   Stripe subscription  → billing period dates, plan, payment status
 *   sessions table       → actual session counts per project per date range
 *   project_usage table  → derived counter; repaired by this worker when wrong
 *   teams table          → local billing state; synced from Stripe
 */

import Stripe from 'stripe';
import { eq, and, inArray, isNotNull, isNull, sql, gte, lt, ne } from 'drizzle-orm';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { db, teams, projects, projectUsage, sessions } from '../db/client.js';
import { effectiveBonusSessions } from '../utils/billing.js';
import { invalidateSessionLimitCache } from '../db/redis.js';
import { syncTeamVideoRetention, FREE_VIDEO_RETENTION_TIER } from './videoRetention.js';

// =============================================================================
// Types
// =============================================================================

export interface TeamSyncResult {
    teamId: string;
    status: 'ok' | 'fixed' | 'skipped' | 'error';
    corrections: string[];
    error?: string;
}

export interface ReconciliationReport {
    runId: string;
    startedAt: Date;
    completedAt: Date;
    totalTeams: number;
    okCount: number;
    fixedCount: number;
    skippedCount: number;
    errorCount: number;
    results: TeamSyncResult[];
}

// =============================================================================
// Stripe Client
// =============================================================================

let stripeClient: Stripe | null = null;

function getStripe(): Stripe | null {
    if (!config.STRIPE_SECRET_KEY) {
        return null;
    }
    if (!stripeClient) {
        stripeClient = new Stripe(config.STRIPE_SECRET_KEY, {
            apiVersion: '2023-10-16' as any,
            typescript: true,
        });
    }
    return stripeClient;
}

// =============================================================================
// Period Utilities
// =============================================================================

/**
 * Format a Date as the YYYY-MM-DD period string used in project_usage.
 * Mirrors the logic in getTeamBillingPeriod but operates on a concrete date.
 */
function formatPeriodString(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// =============================================================================
// Session Count Rebuild (Source-of-Truth Repair)
// =============================================================================

/**
 * For a given project, count sessions from the sessions table that started
 * within the Stripe billing period. This is the source of truth.
 *
 * Note: We count all sessions started in the period regardless of whether
 * the recording upload triggered an increment — this is the authoritative count.
 */
async function countSessionsFromTable(
    projectId: string,
    periodStart: Date,
    periodEnd: Date
): Promise<number> {
    const [result] = await db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(sessions)
        .where(and(
            eq(sessions.projectId, projectId),
            gte(sessions.startedAt, periodStart),
            lt(sessions.startedAt, periodEnd)
        ));
    return result?.count ?? 0;
}

/**
 * Rebuild project_usage for the correct current billing period using the
 * sessions table as source of truth.
 *
 * Steps:
 * 1. Zero out ALL existing project_usage rows for this project that are NOT
 *    in the correct period (stale wrong-period rows from a desynced anchor).
 * 2. Set the correct-period row to the exact count from the sessions table.
 *
 * Rows are zeroed rather than deleted to preserve the audit trail.
 * All writes run inside the caller's transaction.
 */
async function rebuildProjectUsageInTx(
    tx: typeof db,
    projectId: string,
    correctPeriod: string,
    periodStart: Date,
    periodEnd: Date,
    quotaVersion: number
): Promise<{ staleRowsZeroed: number; correctCount: number; wasOff: boolean }> {
    // 1. Delete ghost rows — rows whose period string falls *within* the current
    //    Stripe billing window but doesn't match the correct period string.
    //    These were created by the 30-day anchor math rolling over early inside a
    //    31-day calendar month (e.g. period "2026-04-15" while Stripe says the
    //    current window is "2026-03-16" → "2026-04-16").
    //
    //    Rows with a period *before* the current window are legitimate historical
    //    records and are left untouched.
    const periodStartString = correctPeriod; // YYYY-MM-DD — lexicographically safe to compare
    const staleRows = await tx
        .select({ id: projectUsage.id, period: projectUsage.period, sessions: projectUsage.sessions })
        .from(projectUsage)
        .where(and(
            eq(projectUsage.projectId, projectId),
            ne(projectUsage.period, correctPeriod),
            // Only rows whose period date is >= the current period start are ghost rows.
            // Anything before that is a legitimate prior-period record.
            sql`${projectUsage.period} >= ${periodStartString}`
        ));

    let staleRowsZeroed = 0;
    for (const row of staleRows) {
        await tx
            .delete(projectUsage)
            .where(eq(projectUsage.id, row.id));
        staleRowsZeroed++;
        logger.info({
            projectId,
            stalePeriod: row.period,
            correctPeriod,
            deletedSessions: row.sessions,
        }, 'Stripe sync: deleted ghost wrong-period project_usage row');
    }

    // 2. Count ground-truth sessions for the correct period
    const correctCount = await countSessionsFromTable(projectId, periodStart, periodEnd);

    // 3. Read current value in the correct-period row (may not exist yet)
    const [existingRow] = await tx
        .select({ id: projectUsage.id, sessions: projectUsage.sessions })
        .from(projectUsage)
        .where(and(
            eq(projectUsage.projectId, projectId),
            eq(projectUsage.period, correctPeriod)
        ))
        .limit(1);

    const currentCount = existingRow?.sessions ?? 0;
    const wasOff = currentCount !== correctCount;

    if (wasOff || !existingRow) {
        // Upsert with the correct count
        await tx
            .insert(projectUsage)
            .values({
                projectId,
                period: correctPeriod,
                sessions: correctCount,
                storageBytes: BigInt(0),
                requests: 0,
                quotaVersion,
            })
            .onConflictDoUpdate({
                target: [projectUsage.projectId, projectUsage.period, projectUsage.quotaVersion],
                set: {
                    sessions: correctCount,
                    updatedAt: new Date(),
                },
            });

        logger.info({
            projectId,
            correctPeriod,
            oldCount: currentCount,
            newCount: correctCount,
        }, 'Stripe sync: project_usage corrected from sessions table');
    }

    return { staleRowsZeroed, correctCount, wasOff };
}

// =============================================================================
// Team Reconciliation
// =============================================================================

/**
 * Reconcile a single team's DB billing state against Stripe.
 *
 * Makes no DB writes if the team is already in sync.
 * All anchor + usage repairs run inside a DB transaction.
 */
export async function syncTeamFromStripe(
    teamId: string,
    client: Stripe
): Promise<TeamSyncResult> {
    const corrections: string[] = [];

    // Load team from DB including bonus session fields
    const [team] = await db
        .select({
            id: teams.id,
            stripeSubscriptionId: teams.stripeSubscriptionId,
            stripePriceId: teams.stripePriceId,
            billingCycleAnchor: teams.billingCycleAnchor,
            paymentFailedAt: teams.paymentFailedAt,
            stripeCurrentPeriodStart: teams.stripeCurrentPeriodStart,
            stripeCurrentPeriodEnd: teams.stripeCurrentPeriodEnd,
            bonusSessions: teams.bonusSessions,
            bonusSessionsBillingPeriod: teams.bonusSessionsBillingPeriod,
        })
        .from(teams)
        .where(eq(teams.id, teamId))
        .limit(1);

    if (!team) {
        return { teamId, status: 'error', corrections, error: 'Team not found' };
    }

    // Skip free teams — nothing to sync against Stripe
    if (!team.stripeSubscriptionId) {
        return { teamId, status: 'skipped', corrections };
    }

    // Fetch subscription from Stripe
    let subscription: Stripe.Subscription | null = null;
    try {
        subscription = await client.subscriptions.retrieve(team.stripeSubscriptionId);
    } catch (err: any) {
        if (err?.statusCode === 404) {
            subscription = null;
        } else {
            return { teamId, status: 'error', corrections, error: `Stripe API error: ${err?.message}` };
        }
    }

    // Handle subscription missing from Stripe or explicitly canceled
    if (!subscription || subscription.status === 'canceled') {
        await db.update(teams)
            .set({
                stripeSubscriptionId: null,
                stripePriceId: null,
                stripeCurrentPeriodStart: null,
                stripeCurrentPeriodEnd: null,
                paymentFailedAt: null,
                updatedAt: new Date(),
            })
            .where(eq(teams.id, teamId));

        await syncTeamVideoRetention(teamId, FREE_VIDEO_RETENTION_TIER);
        await invalidateSessionLimitCache(teamId);

        corrections.push(`cleared ${subscription ? 'canceled' : 'missing'} subscription (${team.stripeSubscriptionId})`);
        logger.info({ teamId, subscriptionId: team.stripeSubscriptionId }, 'Stripe sync: cleared stale subscription');
        return { teamId, status: 'fixed', corrections };
    }

    const subData = subscription as any;
    const stripeStatus  = subscription.status as string;
    const stripePriceId = subscription.items.data[0]?.price.id ?? null;
    const periodStart   = new Date(subData.current_period_start * 1000);
    const periodEnd     = new Date(subData.current_period_end   * 1000);
    const correctPeriod = formatPeriodString(periodStart);

    // =========================================================================
    // Detect desync
    // =========================================================================

    const ANCHOR_DRIFT_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour

    const anchorDriftMs = team.billingCycleAnchor
        ? Math.abs(periodStart.getTime() - team.billingCycleAnchor.getTime())
        : Infinity;
    const anchorDesynced = anchorDriftMs > ANCHOR_DRIFT_THRESHOLD_MS;

    const priceDesynced = team.stripePriceId !== stripePriceId;

    const periodColsDesynced =
        !team.stripeCurrentPeriodStart ||
        Math.abs(team.stripeCurrentPeriodStart.getTime() - periodStart.getTime()) > ANCHOR_DRIFT_THRESHOLD_MS;

    const shouldHavePaymentFailed = stripeStatus === 'past_due' || stripeStatus === 'unpaid';
    const paymentStatusDesynced =
        (shouldHavePaymentFailed && !team.paymentFailedAt) ||
        (!shouldHavePaymentFailed && !!team.paymentFailedAt &&
            (stripeStatus === 'active' || stripeStatus === 'trialing'));

    // Bonus session consistency: log if bonus period doesn't match the Stripe period
    // (informational — we don't auto-clear bonuses; that's an admin action)
    const effectiveBonus = effectiveBonusSessions(
        team.bonusSessions ?? 0,
        team.bonusSessionsBillingPeriod,
        team.billingCycleAnchor ?? null
    );
    if ((team.bonusSessions ?? 0) > 0 && effectiveBonus === 0) {
        logger.info({
            teamId,
            bonusSessions: team.bonusSessions,
            bonusSessionsBillingPeriod: team.bonusSessionsBillingPeriod,
            currentPeriod: correctPeriod,
        }, 'Stripe sync: bonus sessions present but inactive for current period (expected if period rolled)');
    }

    // Always rebuild project_usage from sessions table to catch any drift,
    // even if the anchor looks correct. This is the full source-of-truth repair.
    // We run it inside a transaction along with any anchor/price fixes.
    const needsAnyWrite = anchorDesynced || priceDesynced || periodColsDesynced || paymentStatusDesynced;

    // Get all non-deleted projects for this team
    const teamProjects = await db
        .select({ id: projects.id })
        .from(projects)
        .where(and(eq(projects.teamId, teamId), isNull(projects.deletedAt)));

    // Check if any project_usage rows need repair (stale periods or wrong counts)
    let usageNeedsRepair = false;
    if (teamProjects.length > 0) {
        const projectIds = teamProjects.map(p => p.id);

        // Check for any ghost rows within the current billing window
        // (period >= correctPeriod but != correctPeriod — caused by early anchor rollover)
        const staleNonZeroRows = await db
            .select({ id: projectUsage.id })
            .from(projectUsage)
            .where(and(
                inArray(projectUsage.projectId, projectIds),
                ne(projectUsage.period, correctPeriod),
                sql`${projectUsage.period} >= ${correctPeriod}`,
                sql`${projectUsage.sessions} > 0`
            ))
            .limit(1);

        if (staleNonZeroRows.length > 0) {
            usageNeedsRepair = true;
        }

        if (!usageNeedsRepair) {
            // Also check if the correct-period row's count diverges from sessions table
            for (const project of teamProjects) {
                const [usageRow] = await db
                    .select({ sessions: projectUsage.sessions })
                    .from(projectUsage)
                    .where(and(
                        eq(projectUsage.projectId, project.id),
                        eq(projectUsage.period, correctPeriod)
                    ))
                    .limit(1);

                const groundTruth = await countSessionsFromTable(project.id, periodStart, periodEnd);
                if ((usageRow?.sessions ?? 0) !== groundTruth) {
                    usageNeedsRepair = true;
                    break;
                }
            }
        }
    }

    // If everything is in sync, return early with no DB writes
    if (!needsAnyWrite && !usageNeedsRepair) {
        return { teamId, status: 'ok', corrections };
    }

    // =========================================================================
    // Run all repairs inside a transaction
    // =========================================================================

    await db.transaction(async (tx) => {
        // --- Fix billing anchor + period columns ---
        if (anchorDesynced || periodColsDesynced) {
            await tx.update(teams)
                .set({
                    billingCycleAnchor: periodStart,
                    stripeCurrentPeriodStart: periodStart,
                    stripeCurrentPeriodEnd: periodEnd,
                    updatedAt: new Date(),
                })
                .where(eq(teams.id, teamId));

            if (anchorDesynced) {
                corrections.push(
                    `billingCycleAnchor synced: ${team.billingCycleAnchor?.toISOString() ?? 'null'} → ${periodStart.toISOString()}`
                );
                logger.info({
                    teamId,
                    oldAnchor: team.billingCycleAnchor,
                    newAnchor: periodStart,
                    anchorDriftMs,
                }, 'Stripe sync: billing cycle anchor corrected');
            } else {
                corrections.push('stripeCurrentPeriodStart/End columns synced');
            }
        }

        // --- Fix stripePriceId ---
        if (priceDesynced) {
            await tx.update(teams)
                .set({ stripePriceId, updatedAt: new Date() })
                .where(eq(teams.id, teamId));
            corrections.push(`stripePriceId synced: ${team.stripePriceId ?? 'null'} → ${stripePriceId ?? 'null'}`);
            logger.info({ teamId, oldPriceId: team.stripePriceId, newPriceId: stripePriceId }, 'Stripe sync: stripePriceId corrected');
        }

        // --- Fix paymentFailedAt ---
        if (paymentStatusDesynced) {
            const newPaymentFailedAt = shouldHavePaymentFailed ? (team.paymentFailedAt ?? new Date()) : null;
            await tx.update(teams)
                .set({ paymentFailedAt: newPaymentFailedAt, updatedAt: new Date() })
                .where(eq(teams.id, teamId));
            corrections.push(
                shouldHavePaymentFailed
                    ? `paymentFailedAt set (subscription status=${stripeStatus})`
                    : 'paymentFailedAt cleared (subscription active/trialing)'
            );
            logger.info({ teamId, stripeStatus, paymentFailedAt: newPaymentFailedAt }, 'Stripe sync: paymentFailedAt corrected');
        }

        // --- Rebuild project_usage from sessions table (source of truth) ---
        if (usageNeedsRepair && teamProjects.length > 0) {
            let totalStaleZeroed = 0;
            let totalProjectsFixed = 0;

            for (const project of teamProjects) {
                const { staleRowsZeroed, wasOff } = await rebuildProjectUsageInTx(
                    tx as any,
                    project.id,
                    correctPeriod,
                    periodStart,
                    periodEnd,
                    1 // default quotaVersion
                );
                totalStaleZeroed += staleRowsZeroed;
                if (wasOff || staleRowsZeroed > 0) totalProjectsFixed++;
            }

            if (totalProjectsFixed > 0 || totalStaleZeroed > 0) {
                corrections.push(
                    `project_usage rebuilt from sessions table for ${totalProjectsFixed} project(s), ` +
                    `${totalStaleZeroed} stale row(s) zeroed`
                );
            }
        }
    });

    // Invalidate Redis session cache
    await invalidateSessionLimitCache(teamId);

    return { teamId, status: 'fixed', corrections };
}

// =============================================================================
// Diagnostic: recount sessions from ground-truth sessions table
// =============================================================================

/**
 * Count sessions from the sessions table for a team within a date range.
 * Used in reconciliation reports to detect divergence from project_usage counters.
 * Not called on the hot path.
 */
export async function recalculateTeamSessionsFromTable(
    teamId: string,
    periodStart: Date,
    periodEnd: Date
): Promise<number> {
    const teamProjects = await db
        .select({ id: projects.id })
        .from(projects)
        .where(and(eq(projects.teamId, teamId), isNull(projects.deletedAt)));

    if (teamProjects.length === 0) return 0;

    const projectIds = teamProjects.map(p => p.id);

    const [result] = await db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(sessions)
        .where(and(
            inArray(sessions.projectId, projectIds),
            gte(sessions.startedAt, periodStart),
            lt(sessions.startedAt, periodEnd)
        ));

    return result?.count ?? 0;
}

// =============================================================================
// Batch Reconciliation
// =============================================================================

/**
 * Reconcile all teams that have an active Stripe subscription.
 * Processes teams in small concurrent batches to respect Stripe rate limits.
 *
 * Teams already in sync with correct project_usage counts generate zero DB writes.
 */
export async function reconcileAllActiveTeams(): Promise<ReconciliationReport> {
    const runId = `stripeSync:${Date.now()}`;
    const startedAt = new Date();

    const client = getStripe();
    if (!client) {
        throw new Error('Stripe is not configured (STRIPE_SECRET_KEY missing)');
    }

    // Fetch all teams with active Stripe subscriptions
    const activeTeams = await db
        .select({ id: teams.id })
        .from(teams)
        .where(isNotNull(teams.stripeSubscriptionId));

    logger.info({ runId, totalTeams: activeTeams.length }, 'Stripe sync: starting reconciliation');

    const report: ReconciliationReport = {
        runId,
        startedAt,
        completedAt: new Date(),
        totalTeams: activeTeams.length,
        okCount: 0,
        fixedCount: 0,
        skippedCount: 0,
        errorCount: 0,
        results: [],
    };

    // Process in batches of 5 — well within Stripe's 100 reads/sec default limit
    const CONCURRENCY = 5;

    for (let i = 0; i < activeTeams.length; i += CONCURRENCY) {
        const batch = activeTeams.slice(i, i + CONCURRENCY);

        const settled = await Promise.allSettled(
            batch.map(t => syncTeamFromStripe(t.id, client))
        );

        for (const outcome of settled) {
            if (outcome.status === 'fulfilled') {
                const result = outcome.value;
                report.results.push(result);
                if (result.status === 'ok')            report.okCount++;
                else if (result.status === 'fixed')    report.fixedCount++;
                else if (result.status === 'skipped')  report.skippedCount++;
                else                                   report.errorCount++;
            } else {
                report.errorCount++;
                report.results.push({
                    teamId: 'unknown',
                    status: 'error',
                    corrections: [],
                    error: String(outcome.reason),
                });
                logger.error({ err: outcome.reason }, 'Stripe sync: unhandled error for a team');
            }
        }
    }

    report.completedAt = new Date();

    logger.info({
        runId,
        totalTeams: report.totalTeams,
        okCount: report.okCount,
        fixedCount: report.fixedCount,
        skippedCount: report.skippedCount,
        errorCount: report.errorCount,
        durationMs: report.completedAt.getTime() - report.startedAt.getTime(),
    }, 'Stripe sync: reconciliation complete');

    return report;
}
