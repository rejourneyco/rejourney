/**
 * Projects Routes
 * 
 * Project CRUD and attestation config
 */

import { Router } from 'express';
import { randomBytes } from 'crypto';
import { eq, and, inArray, gte, isNull, sql, desc, ne } from 'drizzle-orm';
import { db, projects, teamMembers, sessions, sessionMetrics, teams, alertSettings, alertRecipients } from '../db/client.js';
import { getRedis } from '../db/redis.js';
import { logger } from '../logger.js';
import { sessionAuth, requireProjectAccess, asyncHandler, ApiError } from '../middleware/index.js';
import { validate } from '../middleware/validation.js';
import { dashboardRateLimiter, writeApiRateLimiter } from '../middleware/rateLimit.js';
import {
    createProjectSchema,
    updateProjectSchema,
    projectIdParamSchema,
    requestDeleteProjectOtpSchema,
    deleteProjectSchema,
} from '../validation/projects.js';
import { auditFromRequest } from '../services/auditLog.js';
import { hardDeleteProject } from '../services/deletion.js';
import { sendDeletionOtp, verifyDeletionOtp } from '../services/deleteOtp.js';
import {
    assertNoDuplicateContentSpam,
    enforceNewAccountActionLimit,
} from '../services/abuseDetection.js';

const router = Router();

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

function computeHealthScore(input: {
    sessionsTotal: number;
    errorsTotal: number;
    crashesTotal: number;
    anrsTotal: number;
    avgUxScoreAllTime: number;
    apiErrorsTotal: number;
    apiTotalCount: number;
    rageTapTotal: number;
}): number {
    if (input.sessionsTotal <= 0) return 60;
    const hasAnyMetricSignal = (
        input.avgUxScoreAllTime > 0
        || input.errorsTotal > 0
        || input.crashesTotal > 0
        || input.anrsTotal > 0
        || input.apiTotalCount > 0
        || input.rageTapTotal > 0
    );
    if (!hasAnyMetricSignal) return 65;

    const sessionsCount = Math.max(1, input.sessionsTotal);
    const errorRate = input.errorsTotal / sessionsCount;
    const crashAnrRate = (input.crashesTotal + input.anrsTotal) / sessionsCount;
    const rageTapRate = input.rageTapTotal / sessionsCount;
    const apiErrorRate = input.apiTotalCount > 0 ? input.apiErrorsTotal / input.apiTotalCount : 0;

    const uxScore = input.avgUxScoreAllTime > 0 ? input.avgUxScoreAllTime : 70;
    const reliabilityScore = clamp(100 - (errorRate * 120), 0, 100);
    const stabilityScore = clamp(100 - (crashAnrRate * 250), 0, 100);
    const apiReliabilityScore = input.apiTotalCount > 0
        ? clamp(100 - (apiErrorRate * 140), 0, 100)
        : 85;
    const interactionStabilityScore = clamp(100 - (rageTapRate * 160), 0, 100);

    const score = (
        (uxScore * 0.35)
        + (reliabilityScore * 0.2)
        + (stabilityScore * 0.25)
        + (apiReliabilityScore * 0.15)
        + (interactionStabilityScore * 0.05)
    );

    return Math.round(clamp(score, 0, 100));
}

function getHealthLevel(score: number): 'excellent' | 'good' | 'fair' | 'critical' {
    if (score >= 85) return 'excellent';
    if (score >= 70) return 'good';
    if (score >= 50) return 'fair';
    return 'critical';
}

/**
 * Get all projects for user
 * GET /api/projects
 */
router.get(
    '/',
    sessionAuth,
    dashboardRateLimiter,
    asyncHandler(async (req, res) => {
        // Get user's teams
        const teamMemberships = await db
            .select({ teamId: teamMembers.teamId })
            .from(teamMembers)
            .where(eq(teamMembers.userId, req.user!.id));

        const teamIds = teamMemberships.map((tm) => tm.teamId);

        if (teamIds.length === 0) {
            res.json({ projects: [] });
            return;
        }

        // Get projects for those teams
        const projectsList = await db
            .select()
            .from(projects)
            .where(and(inArray(projects.teamId, teamIds), isNull(projects.deletedAt)))
            .orderBy(desc(projects.createdAt));

        if (projectsList.length === 0) {
            res.json({ projects: [] });
            return;
        }

        const projectIds = projectsList.map((project) => project.id);

        // Get session stats for each project
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const [totalSessionsRows, last7SessionsRows, last7ErrorsRows, allTimeMetricsRows] = await Promise.all([
            db
                .select({
                    projectId: sessions.projectId,
                    count: sql<number>`count(*)::int`,
                })
                .from(sessions)
                .where(inArray(sessions.projectId, projectIds))
                .groupBy(sessions.projectId),
            db
                .select({
                    projectId: sessions.projectId,
                    count: sql<number>`count(*)::int`,
                })
                .from(sessions)
                .where(and(inArray(sessions.projectId, projectIds), gte(sessions.startedAt, sevenDaysAgo)))
                .groupBy(sessions.projectId),
            db
                .select({
                    projectId: sessions.projectId,
                    total: sql<number>`coalesce(sum(${sessionMetrics.errorCount}), 0)::int`,
                })
                .from(sessions)
                .leftJoin(sessionMetrics, eq(sessionMetrics.sessionId, sessions.id))
                .where(and(inArray(sessions.projectId, projectIds), gte(sessions.startedAt, sevenDaysAgo)))
                .groupBy(sessions.projectId),
            db
                .select({
                    projectId: sessions.projectId,
                    errorsTotal: sql<number>`coalesce(sum(${sessionMetrics.errorCount}), 0)::int`,
                    crashesTotal: sql<number>`coalesce(sum(${sessionMetrics.crashCount}), 0)::int`,
                    anrsTotal: sql<number>`coalesce(sum(${sessionMetrics.anrCount}), 0)::int`,
                    avgUxScoreAllTime: sql<number>`coalesce(avg(${sessionMetrics.uxScore}), 0)::float`,
                    apiErrorsTotal: sql<number>`coalesce(sum(${sessionMetrics.apiErrorCount}), 0)::int`,
                    apiTotalCount: sql<number>`coalesce(sum(${sessionMetrics.apiTotalCount}), 0)::int`,
                    rageTapTotal: sql<number>`coalesce(sum(${sessionMetrics.rageTapCount}), 0)::int`,
                })
                .from(sessions)
                .leftJoin(sessionMetrics, eq(sessionMetrics.sessionId, sessions.id))
                .where(inArray(sessions.projectId, projectIds))
                .groupBy(sessions.projectId),
        ]);

        const totalSessionsByProject = new Map(totalSessionsRows.map((row) => [row.projectId, row.count]));
        const last7SessionsByProject = new Map(last7SessionsRows.map((row) => [row.projectId, row.count]));
        const last7ErrorsByProject = new Map(last7ErrorsRows.map((row) => [row.projectId, Number(row.total ?? 0)]));
        const allTimeMetricsByProject = new Map(allTimeMetricsRows.map((row) => [row.projectId, row]));

        const projectStats = projectsList.map((project) => {
            const sessionsTotal = totalSessionsByProject.get(project.id) ?? 0;
            const sessionsLast7Days = last7SessionsByProject.get(project.id) ?? 0;
            const errorsLast7Days = last7ErrorsByProject.get(project.id) ?? 0;
            const allTimeMetrics = allTimeMetricsByProject.get(project.id);

            const errorsTotal = Number(allTimeMetrics?.errorsTotal ?? 0);
            const crashesTotal = Number(allTimeMetrics?.crashesTotal ?? 0);
            const anrsTotal = Number(allTimeMetrics?.anrsTotal ?? 0);
            const avgUxScoreAllTime = Number(allTimeMetrics?.avgUxScoreAllTime ?? 0);
            const apiErrorsTotal = Number(allTimeMetrics?.apiErrorsTotal ?? 0);
            const apiTotalCount = Number(allTimeMetrics?.apiTotalCount ?? 0);
            const rageTapTotal = Number(allTimeMetrics?.rageTapTotal ?? 0);
            const healthScore = computeHealthScore({
                sessionsTotal,
                errorsTotal,
                crashesTotal,
                anrsTotal,
                avgUxScoreAllTime,
                apiErrorsTotal,
                apiTotalCount,
                rageTapTotal,
            });
            const healthLevel = getHealthLevel(healthScore);

            return {
                ...project,
                platforms: project.platform ? [project.platform] : [],
                sessionsTotal,
                sessionsLast7Days,
                errorsLast7Days,
                errorsTotal,
                crashesTotal,
                anrsTotal,
                avgUxScoreAllTime,
                apiErrorsTotal,
                apiTotalCount,
                rageTapTotal,
                healthScore,
                healthLevel,
            };
        });

        res.json({ projects: projectStats });
    })
);

/**
 * Create a new project
 * POST /api/projects
 */
router.post(
    '/',
    sessionAuth,
    writeApiRateLimiter,
    dashboardRateLimiter,
    validate(createProjectSchema),
    asyncHandler(async (req, res) => {
        const data = req.body;

        // Get default team if not specified
        let teamId = data.teamId;
        if (!teamId) {
            const [membership] = await db
                .select()
                .from(teamMembers)
                .where(and(eq(teamMembers.userId, req.user!.id), eq(teamMembers.role, 'owner')))
                .limit(1);

            if (!membership) {
                throw ApiError.badRequest('No team found. Please create a team first.');
            }
            teamId = membership.teamId;
        } else {
            // Verify user has access to the team
            const [membership] = await db
                .select()
                .from(teamMembers)
                .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, req.user!.id)))
                .limit(1);

            if (!membership) {
                throw ApiError.forbidden('No access to this team');
            }
        }

        await enforceNewAccountActionLimit({
            userId: req.user!.id,
            action: 'project_create',
        });

        await assertNoDuplicateContentSpam({
            actorId: req.user!.id,
            action: 'project_create',
            contentParts: [data.name, data.webDomain, data.bundleId, data.packageName],
            targetId: teamId,
        });

        // Check for duplicate bundle IDs (if provided)
        if (data.bundleId) {
            const [existingBundle] = await db
                .select({ id: projects.id, name: projects.name })
                .from(projects)
                .where(
                    and(
                        eq(projects.bundleId, data.bundleId),
                        isNull(projects.deletedAt)
                    )
                )
                .limit(1);

            if (existingBundle) {
                throw ApiError.badRequest(
                    `Bundle ID "${data.bundleId}" is already in use by project "${existingBundle.name}". Each bundle ID must be unique across all projects.`
                );
            }
        }

        // Check for duplicate package names (if provided)
        if (data.packageName) {
            const [existingPackage] = await db
                .select({ id: projects.id, name: projects.name })
                .from(projects)
                .where(
                    and(
                        eq(projects.packageName, data.packageName),
                        isNull(projects.deletedAt)
                    )
                )
                .limit(1);

            if (existingPackage) {
                throw ApiError.badRequest(
                    `Package name "${data.packageName}" is already in use by project "${existingPackage.name}". Each package name must be unique across all projects.`
                );
            }
        }

        // Generate public key for SDK
        const publicKey = `rj_${randomBytes(16).toString('hex')}`;

        const [project] = await db.insert(projects).values({
            name: data.name,
            teamId,
            bundleId: data.bundleId,
            packageName: data.packageName,
            webDomain: data.webDomain,
            platform: data.platforms?.[0],
            publicKey,
            rejourneyEnabled: data.rejourneyEnabled ?? true,
            recordingEnabled: data.recordingEnabled ?? true,
            sampleRate: data.sampleRate ?? 100,
            healthyReplaysPromoted: data.healthyReplaysPromoted ?? 0.05,
            maxRecordingMinutes: data.maxRecordingMinutes ?? 10,
        }).returning();

        logger.info({ projectId: project.id, userId: req.user!.id }, 'Project created');

        // Create default alert settings for the project
        await db.insert(alertSettings).values({
            projectId: project.id,
            crashAlertsEnabled: true,
            anrAlertsEnabled: true,
            errorSpikeAlertsEnabled: true,
            apiDegradationAlertsEnabled: true,
            errorSpikeThresholdPercent: 50,
            apiDegradationThresholdPercent: 100,
            apiLatencyThresholdMs: 3000,
        });

        // Add team owners as default alert recipients (max 5)
        const owners = await db
            .select({ userId: teamMembers.userId })
            .from(teamMembers)
            .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.role, 'owner')))
            .limit(5);

        for (const { userId } of owners) {
            await db.insert(alertRecipients).values({
                projectId: project.id,
                userId,
            });
        }

        if (owners.length > 0) {
            logger.info({ projectId: project.id, ownerCount: owners.length }, 'Added team owners as default alert recipients');
        }

        // Audit log
        await auditFromRequest(req, 'project_created', {
            targetType: 'project',
            targetId: project.id,
            newValue: { name: project.name, teamId: project.teamId },
        });

        res.status(201).json({
            project: {
                ...project,
                platforms: project.platform ? [project.platform] : [],
            },
        });
    })
);

/**
 * Get project by ID
 * GET /api/projects/:id
 */
router.get(
    '/:id',
    sessionAuth,
    validate(projectIdParamSchema, 'params'),
    requireProjectAccess,
    asyncHandler(async (req, res) => {
        const [project] = await db
            .select()
            .from(projects)
            .where(eq(projects.id, req.params.id))
            .limit(1);

        if (!project || project.deletedAt) {
            throw ApiError.notFound('Project not found');
        }

        res.json({
            ...project,
            platforms: project.platform ? [project.platform] : [],
        });
    })
);

/**
 * Update project
 * PUT /api/projects/:id
 */
router.put(
    '/:id',
    sessionAuth,
    writeApiRateLimiter,
    validate(projectIdParamSchema, 'params'),
    validate(updateProjectSchema),
    requireProjectAccess,
    asyncHandler(async (req, res) => {
        const data = req.body;

        // Fetch current project to check existing values
        const [currentProject] = await db
            .select()
            .from(projects)
            .where(eq(projects.id, req.params.id))
            .limit(1);

        if (!currentProject) {
            throw ApiError.notFound('Project not found');
        }

        // If changing team, verify access to new team
        if (data.teamId) {
            const [membership] = await db
                .select()
                .from(teamMembers)
                .where(and(eq(teamMembers.teamId, data.teamId), eq(teamMembers.userId, req.user!.id)))
                .limit(1);

            if (!membership || !['owner', 'admin'].includes(membership.role)) {
                throw ApiError.forbidden('Admin access required to move project');
            }
        }

        // Bundle ID and Package Name can only be set if currently empty (immutable once set)
        let bundleId = undefined;
        let packageName = undefined;

        if (data.bundleId) {
            if (currentProject.bundleId) {
                throw ApiError.badRequest('Bundle ID cannot be changed once set');
            }

            // Check for duplicate bundle IDs across all projects
            const [existingBundle] = await db
                .select({ id: projects.id, name: projects.name })
                .from(projects)
                .where(
                    and(
                        eq(projects.bundleId, data.bundleId),
                        isNull(projects.deletedAt),
                        ne(projects.id, req.params.id) // Exclude current project
                    )
                )
                .limit(1);

            if (existingBundle) {
                throw ApiError.badRequest(
                    `Bundle ID "${data.bundleId}" is already in use by project "${existingBundle.name}". Each bundle ID must be unique across all projects.`
                );
            }

            bundleId = data.bundleId;
        }

        if (data.packageName) {
            if (currentProject.packageName) {
                throw ApiError.badRequest('Package Name cannot be changed once set');
            }

            // Check for duplicate package names across all projects
            const [existingPackage] = await db
                .select({ id: projects.id, name: projects.name })
                .from(projects)
                .where(
                    and(
                        eq(projects.packageName, data.packageName),
                        isNull(projects.deletedAt),
                        ne(projects.id, req.params.id) // Exclude current project
                    )
                )
                .limit(1);

            if (existingPackage) {
                throw ApiError.badRequest(
                    `Package name "${data.packageName}" is already in use by project "${existingPackage.name}". Each package name must be unique across all projects.`
                );
            }

            packageName = data.packageName;
        }

        if (
            data.name !== undefined ||
            data.webDomain !== undefined ||
            bundleId !== undefined ||
            packageName !== undefined
        ) {
            await assertNoDuplicateContentSpam({
                actorId: req.user!.id,
                action: 'project_update',
                contentParts: [
                    data.name,
                    typeof data.webDomain === 'string' ? data.webDomain : null,
                    bundleId,
                    packageName,
                ],
                targetId: req.params.id,
            });
        }

        // Build update object, only including fields that should be updated
        const updateData: Record<string, any> = {
            updatedAt: new Date(),
        };

        // Only include fields that are explicitly provided
        if (data.name !== undefined) updateData.name = data.name;
        if (data.teamId !== undefined) updateData.teamId = data.teamId;
        if (bundleId !== undefined) updateData.bundleId = bundleId;
        if (packageName !== undefined) updateData.packageName = packageName;
        if (data.webDomain !== undefined) updateData.webDomain = data.webDomain;
        if (data.rejourneyEnabled !== undefined) updateData.rejourneyEnabled = data.rejourneyEnabled;
        if (data.recordingEnabled !== undefined) updateData.recordingEnabled = data.recordingEnabled;
        if (data.sampleRate !== undefined) updateData.sampleRate = data.sampleRate;
        if (data.healthyReplaysPromoted !== undefined) updateData.healthyReplaysPromoted = data.healthyReplaysPromoted;
        if (data.maxRecordingMinutes !== undefined) updateData.maxRecordingMinutes = data.maxRecordingMinutes;

        const [project] = await db.update(projects)
            .set(updateData)
            .where(eq(projects.id, req.params.id))
            .returning();

        const shouldInvalidateConfig =
            data.sampleRate !== undefined ||
            data.maxRecordingMinutes !== undefined ||
            data.recordingEnabled !== undefined ||
            data.rejourneyEnabled !== undefined ||
            data.healthyReplaysPromoted !== undefined ||
            bundleId !== undefined ||
            packageName !== undefined;

        if (shouldInvalidateConfig) {
            try {
                await getRedis().del(`sdk:config:${project.publicKey}`);
            } catch {
                // ignore cache errors
            }
        }

        logger.info({ projectId: project.id, userId: req.user!.id }, 'Project updated');

        // Audit log
        await auditFromRequest(req, 'project_updated', {
            targetType: 'project',
            targetId: project.id,
            previousValue: { name: currentProject.name, recordingEnabled: currentProject.recordingEnabled },
            newValue: { name: project.name, recordingEnabled: project.recordingEnabled },
        });

        res.json({
            project: {
                ...project,
                platforms: project.platform ? [project.platform] : [],
            },
        });
    })
);

/**
 * Send project deletion OTP
 * POST /api/projects/:id/delete-otp
 */
router.post(
    '/:id/delete-otp',
    sessionAuth,
    writeApiRateLimiter,
    validate(projectIdParamSchema, 'params'),
    validate(requestDeleteProjectOtpSchema),
    dashboardRateLimiter,
    asyncHandler(async (req, res) => {
        const projectId = req.params.id;
        const { confirmText } = req.body;

        const [projectResult] = await db
            .select({
                project: projects,
                ownerUserId: teams.ownerUserId,
            })
            .from(projects)
            .innerJoin(teams, eq(projects.teamId, teams.id))
            .where(eq(projects.id, projectId))
            .limit(1);

        if (!projectResult) {
            throw ApiError.notFound('Project not found');
        }

        if (projectResult.ownerUserId !== req.user!.id) {
            throw ApiError.forbidden('Only the team owner can delete projects');
        }

        const expectedConfirmText =
            projectResult.project.name && projectResult.project.name.trim().length > 0
                ? projectResult.project.name
                : projectResult.project.id;
        if (confirmText !== expectedConfirmText) {
            throw ApiError.badRequest(
                `Confirmation text must match project ${projectResult.project.name ? 'name' : 'ID'} exactly`
            );
        }

        const otpResult = await sendDeletionOtp({
            scope: 'project',
            resourceId: projectResult.project.id,
            userId: req.user!.id,
            userEmail: req.user!.email,
        });

        res.json({
            success: true,
            message: 'OTP sent to your email. Enter it to confirm project deletion.',
            expiresInMinutes: otpResult.expiresInMinutes,
            ...(otpResult.devCode ? { devCode: otpResult.devCode } : {}),
        });
    })
);

/**
 * Delete project (hard delete, OTP confirmed)
 * DELETE /api/projects/:id
 */
router.delete(
    '/:id',
    sessionAuth,
    writeApiRateLimiter,
    validate(projectIdParamSchema, 'params'),
    validate(deleteProjectSchema),
    asyncHandler(async (req, res) => {
        const projectId = req.params.id;
        const { confirmText, otpCode } = req.body;

        const [projectResult] = await db
            .select({
                project: projects,
                ownerUserId: teams.ownerUserId,
            })
            .from(projects)
            .innerJoin(teams, eq(projects.teamId, teams.id))
            .where(eq(projects.id, projectId))
            .limit(1);

        if (!projectResult) {
            throw ApiError.notFound('Project not found');
        }

        if (projectResult.ownerUserId !== req.user!.id) {
            throw ApiError.forbidden('Only the team owner can delete projects');
        }

        const expectedConfirmText =
            projectResult.project.name && projectResult.project.name.trim().length > 0
                ? projectResult.project.name
                : projectResult.project.id;
        if (confirmText !== expectedConfirmText) {
            throw ApiError.badRequest(
                `Confirmation text must match project ${projectResult.project.name ? 'name' : 'ID'} exactly`
            );
        }

        await verifyDeletionOtp({
            scope: 'project',
            resourceId: projectResult.project.id,
            userId: req.user!.id,
            code: otpCode,
        });

        await hardDeleteProject({
            id: projectResult.project.id,
            teamId: projectResult.project.teamId,
            name: projectResult.project.name,
            publicKey: projectResult.project.publicKey,
        });

        try {
            await getRedis().del(`sdk:config:${projectResult.project.publicKey}`);
        } catch {
            // ignore cache errors
        }

        logger.info({ projectId, userId: req.user!.id }, 'Project deleted (hard delete)');

        // Audit log
        await auditFromRequest(req, 'project_deleted', {
            targetType: 'project',
            targetId: projectId,
            previousValue: { name: projectResult.project.name, teamId: projectResult.project.teamId },
            newValue: { hardDeleted: true, otpConfirmed: true, deletedByRole: 'owner' },
        });

        res.json({ success: true });
    })
);

export default router;
