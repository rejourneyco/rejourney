/**
 * Projects Routes
 * 
 * Project CRUD and attestation config
 */

import { Router } from 'express';
import { randomBytes } from 'crypto';
import { eq, and, inArray, gte, isNull, sql, sum, desc, ne } from 'drizzle-orm';
import { db, projects, teamMembers, sessions, sessionMetrics, apiKeys } from '../db/client.js';
import { getRedis } from '../db/redis.js';
import { logger } from '../logger.js';
import { sessionAuth, requireProjectAccess, asyncHandler, ApiError } from '../middleware/index.js';
import { validate } from '../middleware/validation.js';
import { dashboardRateLimiter } from '../middleware/rateLimit.js';
import {
    createProjectSchema,
    updateProjectSchema,
    projectIdParamSchema,
} from '../validation/projects.js';
import { auditFromRequest } from '../services/auditLog.js';

const router = Router();

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

        // Get session stats for each project (last 7 days)
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const projectStats = await Promise.all(
            projectsList.map(async (project) => {
                // Total sessions
                const [totalResult] = await db
                    .select({ count: sql<number>`count(*)::int` })
                    .from(sessions)
                    .where(eq(sessions.projectId, project.id));

                // Sessions last 7 days
                const [last7DaysResult] = await db
                    .select({ count: sql<number>`count(*)::int` })
                    .from(sessions)
                    .where(and(eq(sessions.projectId, project.id), gte(sessions.startedAt, sevenDaysAgo)));

                // Errors last 7 days
                const [errorsResult] = await db
                    .select({ total: sum(sessionMetrics.errorCount) })
                    .from(sessionMetrics)
                    .innerJoin(sessions, eq(sessionMetrics.sessionId, sessions.id))
                    .where(and(eq(sessions.projectId, project.id), gte(sessions.startedAt, sevenDaysAgo)));

                return {
                    ...project,
                    platforms: project.platform ? [project.platform] : [],
                    sessionsTotal: totalResult?.count ?? 0,
                    sessionsLast7Days: last7DaysResult?.count ?? 0,
                    errorsLast7Days: Number(errorsResult?.total ?? 0),
                };
            })
        );

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
 * Delete project (soft delete)
 * DELETE /api/projects/:id
 */
router.delete(
    '/:id',
    sessionAuth,
    validate(projectIdParamSchema, 'params'),
    requireProjectAccess,
    asyncHandler(async (req, res) => {
        const projectId = req.params.id;

        // Verify admin/owner access
        const [project] = await db
            .select()
            .from(projects)
            .where(eq(projects.id, projectId))
            .limit(1);

        if (!project) {
            throw ApiError.notFound('Project not found');
        }

        const [membership] = await db
            .select()
            .from(teamMembers)
            .where(and(eq(teamMembers.teamId, project.teamId), eq(teamMembers.userId, req.user!.id)))
            .limit(1);

        if (!membership || !['owner', 'admin'].includes(membership.role)) {
            throw ApiError.forbidden('Admin access required to delete project');
        }

        // Soft delete
        await db.update(projects)
            .set({ deletedAt: new Date() })
            .where(eq(projects.id, projectId));

        // Revoke all API keys
        await db.update(apiKeys)
            .set({ revokedAt: new Date() })
            .where(eq(apiKeys.projectId, projectId));

        logger.info({ projectId, userId: req.user!.id }, 'Project deleted');

        // Audit log
        await auditFromRequest(req, 'project_deleted', {
            targetType: 'project',
            targetId: projectId,
            previousValue: { name: project.name, teamId: project.teamId },
        });

        res.json({ success: true });
    })
);

export default router;
