/**
 * Billing Routes
 * 
 * Session-based billing endpoints:
 * - Team session usage tracking
 * - Plan information
 * - Usage history
 */

import { Router } from 'express';
import { eq, and, inArray, isNull, desc, sum } from 'drizzle-orm';
import { db, projects, projectUsage, billingUsage, teams } from '../db/client.js';
import { isSelfHosted } from '../config.js';
import { getTeamBillingPeriodDates } from '../utils/billing.js';
import { sessionAuth, requireTeamAccess, asyncHandler } from '../middleware/index.js';
import { validate } from '../middleware/validation.js';
import { writeApiRateLimiter } from '../middleware/rateLimit.js';
import { teamIdParamSchema } from '../validation/teams.js';
import { getTeamSubscription } from '../services/stripeProducts.js';
import { getTeamSessionUsage } from '../services/quotaCheck.js';

const router = Router();

/**
 * Get team session usage
 * GET /api/teams/:teamId/billing/usage
 */
router.get(
    '/:teamId/billing/usage',
    sessionAuth,
    validate(teamIdParamSchema, 'params'),
    requireTeamAccess,
    asyncHandler(async (req, res) => {
        const teamId = req.params.teamId;

        // Get team's billing cycle anchor
        const [team] = await db
            .select({ billingCycleAnchor: teams.billingCycleAnchor })
            .from(teams)
            .where(eq(teams.id, teamId))
            .limit(1);

        // Get billing period based on team's anchor
        const billingPeriod = getTeamBillingPeriodDates(team?.billingCycleAnchor ?? null);
        const period = billingPeriod.periodString;

        // Get session usage (uses team's billing period internally)
        const usage = await getTeamSessionUsage(teamId);

        res.json({
            period,
            billingCycleStart: billingPeriod.start.toISOString(),
            billingCycleEnd: billingPeriod.end.toISOString(),
            usage: {
                sessionsUsed: usage.sessionsUsed,
                sessionLimit: usage.sessionLimit,
                sessionsRemaining: usage.sessionsRemaining,
                percentUsed: usage.percentUsed,
                isAtLimit: usage.isAtLimit,
                isNearLimit: usage.isNearLimit,
            },
            plan: {
                name: usage.planName,
            },
            quota: null,
        });
    })
);

/**
 * Get team billing dashboard (summary)
 * GET /api/teams/:teamId/billing/dashboard
 */
router.get(
    '/:teamId/billing/dashboard',
    sessionAuth,
    validate(teamIdParamSchema, 'params'),
    requireTeamAccess,
    asyncHandler(async (req, res) => {
        const teamId = req.params.teamId;

        // Get team's billing cycle anchor
        const [team] = await db
            .select({ billingCycleAnchor: teams.billingCycleAnchor })
            .from(teams)
            .where(eq(teams.id, teamId))
            .limit(1);

        // Get billing period based on team's anchor
        const billingPeriod = getTeamBillingPeriodDates(team?.billingCycleAnchor ?? null);
        const period = billingPeriod.periodString;

        // Get team's subscription and current usage
        const subscription = await getTeamSubscription(teamId);
        const usage = await getTeamSessionUsage(teamId);

        // Get team projects
        const projectsList = await db
            .select({ id: projects.id })
            .from(projects)
            .where(and(eq(projects.teamId, teamId), isNull(projects.deletedAt)));

        const projectIds = projectsList.map((p) => p.id);

        // Get current period storage and requests
        let currentStorageBytes = 0;
        let currentRequests = 0;

        if (projectIds.length > 0) {
            const [usageAgg] = await db
                .select({
                    storageBytes: sum(projectUsage.storageBytes),
                    requests: sum(projectUsage.requests),
                })
                .from(projectUsage)
                .where(and(inArray(projectUsage.projectId, projectIds), eq(projectUsage.period, period)));

            currentStorageBytes = Number(usageAgg?.storageBytes ?? 0);
            currentRequests = Number(usageAgg?.requests ?? 0);
        }

        res.json({
            period,
            plan: {
                name: subscription.planName,
                displayName: subscription.displayName,
                priceCents: subscription.priceCents,
                sessionLimit: subscription.sessionLimit,
                isCustom: subscription.isCustom,
            },
            usage: {
                sessionsUsed: usage.sessionsUsed,
                sessionLimit: usage.sessionLimit,
                sessionsRemaining: usage.sessionsRemaining,
                percentUsed: usage.percentUsed,
                isAtLimit: usage.isAtLimit,
                isNearLimit: usage.isNearLimit,
                storageBytes: currentStorageBytes,
                requests: currentRequests,
            },
            billing: {
                cycleStart: billingPeriod.start.toISOString(),
                cycleEnd: billingPeriod.end.toISOString(),
                selfHosted: isSelfHosted,
            },
            projectCount: projectIds.length,
        });
    })
);

/**
 * Get team billing history
 * GET /api/teams/:teamId/billing/history
 */
router.get(
    '/:teamId/billing/history',
    sessionAuth,
    validate(teamIdParamSchema, 'params'),
    requireTeamAccess,
    asyncHandler(async (req, res) => {
        const teamId = req.params.teamId;
        const limit = Math.min(parseInt(req.query.limit as string) || 12, 24);

        // Get recent billing usage records
        const history = await db
            .select()
            .from(billingUsage)
            .where(eq(billingUsage.teamId, teamId))
            .orderBy(desc(billingUsage.period))
            .limit(limit);

        res.json({
            history: history.map(h => ({
                period: h.period,
                sessions: h.sessions,
                storageBytes: Number(h.storageBytes),
                requests: h.requests,
                invoiceStatus: h.invoiceStatus,
                invoiceUrl: h.invoiceUrl,
                computedAt: h.computedAt?.toISOString(),
            })),
        });
    })
);

/**
 * Get per-project usage breakdown
 * GET /api/teams/:teamId/billing/projects
 */
router.get(
    '/:teamId/billing/projects',
    sessionAuth,
    validate(teamIdParamSchema, 'params'),
    requireTeamAccess,
    asyncHandler(async (req, res) => {
        const teamId = req.params.teamId;

        // Get team's billing period or use query parameter override
        let period = req.query.period as string | undefined;
        if (!period) {
            const [team] = await db
                .select({ billingCycleAnchor: teams.billingCycleAnchor })
                .from(teams)
                .where(eq(teams.id, teamId))
                .limit(1);
            const billingPeriod = getTeamBillingPeriodDates(team?.billingCycleAnchor ?? null);
            period = billingPeriod.periodString;
        }

        // Get team projects
        const projectsList = await db
            .select({
                id: projects.id,
                name: projects.name,
                platform: projects.platform,
            })
            .from(projects)
            .where(and(eq(projects.teamId, teamId), isNull(projects.deletedAt)));

        // Get usage per project for the period
        const projectIds = projectsList.map((p) => p.id);

        let projectUsageData: { projectId: string; sessions: number; storageBytes: number; requests: number }[] = [];

        if (projectIds.length > 0) {
            const usageRecords = await db
                .select({
                    projectId: projectUsage.projectId,
                    sessions: projectUsage.sessions,
                    storageBytes: projectUsage.storageBytes,
                    requests: projectUsage.requests,
                })
                .from(projectUsage)
                .where(and(
                    inArray(projectUsage.projectId, projectIds),
                    eq(projectUsage.period, period)
                ));

            projectUsageData = usageRecords.map(r => ({
                projectId: r.projectId,
                sessions: r.sessions ?? 0,
                storageBytes: Number(r.storageBytes ?? 0),
                requests: r.requests ?? 0,
            }));
        }

        // Combine project info with usage
        const projectBreakdown = projectsList.map(p => {
            const usage = projectUsageData.find(u => u.projectId === p.id);
            return {
                id: p.id,
                name: p.name,
                platform: p.platform,
                sessions: usage?.sessions ?? 0,
                storageBytes: usage?.storageBytes ?? 0,
                requests: usage?.requests ?? 0,
            };
        });

        res.json({
            period,
            projects: projectBreakdown,
        });
    })
);

/**
 * Get billing alert settings for a team
 * GET /api/teams/:teamId/billing/alert-settings
 */
router.get(
    '/:teamId/billing/alert-settings',
    sessionAuth,
    validate(teamIdParamSchema, 'params'),
    requireTeamAccess,
    asyncHandler(async (req, res) => {
        const teamId = req.params.teamId;

        // Get team's billing info
        const [team] = await db
            .select({
                billingCycleAnchor: teams.billingCycleAnchor,
            })
            .from(teams)
            .where(eq(teams.id, teamId))
            .limit(1);

        // Get billing period based on team's anchor
        const billingPeriod = getTeamBillingPeriodDates(team?.billingCycleAnchor ?? null);

        // Get current subscription to get session limit
        const subscription = await getTeamSubscription(teamId);

        res.json({
            sessionLimit: subscription.sessionLimit,
            sessionWarningThresholdPercent: 80, // Default threshold
            sessionWarningEnabled: true,
            billingCycleEndDate: billingPeriod.end.toISOString(),
            currentPeriod: billingPeriod.periodString,
        });
    })
);

/**
 * Update billing alert settings for a team
 * PUT /api/teams/:teamId/billing/alert-settings
 * 
 * Note: Currently alert settings are fixed (80% threshold, always enabled)
 * This endpoint exists for future configurability
 */
router.put(
    '/:teamId/billing/alert-settings',
    sessionAuth,
    writeApiRateLimiter,
    validate(teamIdParamSchema, 'params'),
    requireTeamAccess,
    asyncHandler(async (_req, res) => {
        // Currently we don't store configurable alert settings
        // This endpoint is a placeholder for future functionality
        res.json({ success: true });
    })
);

export default router;
