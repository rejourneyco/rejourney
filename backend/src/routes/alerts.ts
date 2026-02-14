/**
 * Alerts Routes
 * 
 * Email alert settings and recipients management
 */

import { Router } from 'express';
import { eq, and, gte, sql, desc, or, ilike } from 'drizzle-orm';
import { db, projects, teamMembers, users, alertSettings, alertRecipients, alertHistory, emailLogs } from '../db/client.js';
import { logger } from '../logger.js';
import { sessionAuth, requireProjectAccess, asyncHandler, ApiError } from '../middleware/index.js';
import { validate } from '../middleware/validation.js';
import { dashboardRateLimiter, writeApiRateLimiter } from '../middleware/rateLimit.js';
import { z } from 'zod';

const router = Router();

// =============================================================================
// Validation Schemas
// =============================================================================

const projectIdParamSchema = z.object({
    projectId: z.string().uuid(),
});

const updateAlertSettingsSchema = z.object({
    crashAlertsEnabled: z.boolean().optional(),
    anrAlertsEnabled: z.boolean().optional(),
    errorSpikeAlertsEnabled: z.boolean().optional(),
    apiDegradationAlertsEnabled: z.boolean().optional(),
    dailyDigestEnabled: z.boolean().optional(),
    errorSpikeThresholdPercent: z.number().min(10).max(500).optional(),
    apiLatencyThresholdMs: z.number().min(500).max(30000).optional(),
});

const addRecipientSchema = z.object({
    userId: z.string().uuid(),
});

const removeRecipientParamSchema = z.object({
    projectId: z.string().uuid(),
    userId: z.string().uuid(),
});

// =============================================================================
// Alert Settings Endpoints
// =============================================================================

/**
 * Get alert settings for a project
 * GET /api/projects/:projectId/alert-settings
 */
router.get(
    '/projects/:projectId/alert-settings',
    sessionAuth,
    validate(projectIdParamSchema, 'params'),
    requireProjectAccess,
    dashboardRateLimiter,
    asyncHandler(async (req, res) => {
        const projectId = req.params.projectId;

        // Get or create default settings
        let [settings] = await db
            .select()
            .from(alertSettings)
            .where(eq(alertSettings.projectId, projectId))
            .limit(1);

        if (!settings) {
            // Create default settings
            [settings] = await db.insert(alertSettings).values({
                projectId,
            }).returning();
        }

        res.json({ settings });
    })
);

/**
 * Update alert settings for a project
 * PUT /api/projects/:projectId/alert-settings
 */
router.put(
    '/projects/:projectId/alert-settings',
    sessionAuth,
    writeApiRateLimiter,
    validate(projectIdParamSchema, 'params'),
    validate(updateAlertSettingsSchema),
    requireProjectAccess,
    dashboardRateLimiter,
    asyncHandler(async (req, res) => {
        const projectId = req.params.projectId;
        const data = req.body;

        // Ensure settings exist first
        const [existing] = await db
            .select()
            .from(alertSettings)
            .where(eq(alertSettings.projectId, projectId))
            .limit(1);

        let settings;
        if (existing) {
            [settings] = await db.update(alertSettings)
                .set({
                    ...data,
                    updatedAt: new Date(),
                })
                .where(eq(alertSettings.projectId, projectId))
                .returning();
        } else {
            [settings] = await db.insert(alertSettings).values({
                projectId,
                ...data,
            }).returning();
        }

        logger.info({ projectId, userId: req.user!.id }, 'Alert settings updated');

        res.json({ settings });
    })
);

// =============================================================================
// Alert Recipients Endpoints
// =============================================================================

/**
 * Get alert recipients for a project
 * GET /api/projects/:projectId/alert-recipients
 */
router.get(
    '/projects/:projectId/alert-recipients',
    sessionAuth,
    validate(projectIdParamSchema, 'params'),
    requireProjectAccess,
    dashboardRateLimiter,
    asyncHandler(async (req, res) => {
        const projectId = req.params.projectId;

        const recipients = await db
            .select({
                id: alertRecipients.id,
                userId: alertRecipients.userId,
                email: users.email,
                displayName: users.displayName,
                avatarUrl: users.avatarUrl,
                createdAt: alertRecipients.createdAt,
            })
            .from(alertRecipients)
            .innerJoin(users, eq(alertRecipients.userId, users.id))
            .where(eq(alertRecipients.projectId, projectId));

        res.json({ recipients });
    })
);

/**
 * Add alert recipient (max 5 per project)
 * POST /api/projects/:projectId/alert-recipients
 */
router.post(
    '/projects/:projectId/alert-recipients',
    sessionAuth,
    writeApiRateLimiter,
    validate(projectIdParamSchema, 'params'),
    validate(addRecipientSchema),
    requireProjectAccess,
    dashboardRateLimiter,
    asyncHandler(async (req, res) => {
        const projectId = req.params.projectId;
        const { userId } = req.body;

        // Check recipient limit (max 5)
        const [countResult] = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(alertRecipients)
            .where(eq(alertRecipients.projectId, projectId));

        if ((countResult?.count ?? 0) >= 5) {
            throw ApiError.badRequest('Maximum of 5 alert recipients per project');
        }

        // Verify user is a team member
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
            .where(and(eq(teamMembers.teamId, project.teamId), eq(teamMembers.userId, userId)))
            .limit(1);

        if (!membership) {
            throw ApiError.badRequest('User must be a team member to receive alerts');
        }

        // Check if already a recipient
        const [existing] = await db
            .select()
            .from(alertRecipients)
            .where(and(eq(alertRecipients.projectId, projectId), eq(alertRecipients.userId, userId)))
            .limit(1);

        if (existing) {
            throw ApiError.badRequest('User is already an alert recipient');
        }

        // Add recipient
        const [recipient] = await db.insert(alertRecipients).values({
            projectId,
            userId,
        }).returning();

        // Get user details
        const [user] = await db
            .select({
                email: users.email,
                displayName: users.displayName,
                avatarUrl: users.avatarUrl,
            })
            .from(users)
            .where(eq(users.id, userId))
            .limit(1);

        logger.info({ projectId, userId, addedBy: req.user!.id }, 'Alert recipient added');

        res.status(201).json({
            recipient: {
                id: recipient.id,
                userId: recipient.userId,
                email: user?.email,
                displayName: user?.displayName,
                avatarUrl: user?.avatarUrl,
                createdAt: recipient.createdAt,
            },
        });
    })
);

/**
 * Remove alert recipient
 * DELETE /api/projects/:projectId/alert-recipients/:userId
 */
router.delete(
    '/projects/:projectId/alert-recipients/:userId',
    sessionAuth,
    writeApiRateLimiter,
    validate(removeRecipientParamSchema, 'params'),
    requireProjectAccess,
    dashboardRateLimiter,
    asyncHandler(async (req, res) => {
        const projectId = req.params.projectId;
        const userId = req.params.userId;

        await db.delete(alertRecipients)
            .where(and(
                eq(alertRecipients.projectId, projectId),
                eq(alertRecipients.userId, userId)
            ));

        logger.info({ projectId, userId, removedBy: req.user!.id }, 'Alert recipient removed');

        res.json({ success: true });
    })
);

// =============================================================================
// Team Members for Selection (available recipients)
// =============================================================================

/**
 * Get team members who can be added as alert recipients
 * GET /api/projects/:projectId/available-recipients
 */
router.get(
    '/projects/:projectId/available-recipients',
    sessionAuth,
    validate(projectIdParamSchema, 'params'),
    requireProjectAccess,
    dashboardRateLimiter,
    asyncHandler(async (req, res) => {
        const projectId = req.params.projectId;

        // Get project's team
        const [project] = await db
            .select()
            .from(projects)
            .where(eq(projects.id, projectId))
            .limit(1);

        if (!project) {
            throw ApiError.notFound('Project not found');
        }

        // Get all team members
        const members = await db
            .select({
                userId: teamMembers.userId,
                email: users.email,
                displayName: users.displayName,
                avatarUrl: users.avatarUrl,
                role: teamMembers.role,
            })
            .from(teamMembers)
            .innerJoin(users, eq(teamMembers.userId, users.id))
            .where(eq(teamMembers.teamId, project.teamId));

        // Get current recipients
        const currentRecipients = await db
            .select({ userId: alertRecipients.userId })
            .from(alertRecipients)
            .where(eq(alertRecipients.projectId, projectId));

        const recipientUserIds = new Set(currentRecipients.map(r => r.userId));

        // Mark which members are already recipients
        const membersWithStatus = members.map(m => ({
            ...m,
            isRecipient: recipientUserIds.has(m.userId),
        }));

        res.json({ members: membersWithStatus });
    })
);

// =============================================================================
// Alert History (for debugging/visibility)
// =============================================================================

/**
 * Get recent alert history for a project
 * GET /api/projects/:projectId/alert-history
 */
router.get(
    '/projects/:projectId/alert-history',
    sessionAuth,
    validate(projectIdParamSchema, 'params'),
    requireProjectAccess,
    dashboardRateLimiter,
    asyncHandler(async (req, res) => {
        const projectId = req.params.projectId;

        // Last 7 days of alerts
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

        const history = await db
            .select()
            .from(alertHistory)
            .where(and(
                eq(alertHistory.projectId, projectId),
                gte(alertHistory.sentAt, sevenDaysAgo)
            ))
            .orderBy(sql`${alertHistory.sentAt} DESC`)
            .limit(50);

        res.json({ history });
    })
);

// =============================================================================
// Email Logs (detailed email history)
// =============================================================================

const emailLogsQuerySchema = z.object({
    search: z.string().optional(),
    alertType: z.string().optional(),
    page: z.string().optional().transform(v => v ? parseInt(v, 10) : 1),
    limit: z.string().optional().transform(v => v ? Math.min(parseInt(v, 10), 100) : 25),
});

/**
 * Get email logs for a project with search and filtering
 * GET /api/projects/:projectId/email-logs
 */
router.get(
    '/projects/:projectId/email-logs',
    sessionAuth,
    validate(projectIdParamSchema, 'params'),
    requireProjectAccess,
    dashboardRateLimiter,
    asyncHandler(async (req, res) => {
        const projectId = req.params.projectId;
        const { search, alertType, page, limit } = emailLogsQuerySchema.parse(req.query);

        const offset = (page - 1) * limit;

        // Build conditions
        const conditions = [eq(emailLogs.projectId, projectId)];

        if (alertType && alertType !== 'all') {
            conditions.push(eq(emailLogs.alertType, alertType));
        }

        if (search && search.trim()) {
            const searchTerm = `%${search.trim()}%`;
            conditions.push(
                or(
                    ilike(emailLogs.recipientEmail, searchTerm),
                    ilike(emailLogs.recipientName, searchTerm),
                    ilike(emailLogs.subject, searchTerm),
                    ilike(emailLogs.issueTitle, searchTerm)
                )!
            );
        }

        // Get total count
        const [countResult] = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(emailLogs)
            .where(and(...conditions));

        const total = countResult?.count ?? 0;

        // Get logs
        const logs = await db
            .select({
                id: emailLogs.id,
                recipientEmail: emailLogs.recipientEmail,
                recipientName: emailLogs.recipientName,
                alertType: emailLogs.alertType,
                subject: emailLogs.subject,
                issueTitle: emailLogs.issueTitle,
                issueId: emailLogs.issueId,
                status: emailLogs.status,
                errorMessage: emailLogs.errorMessage,
                sentAt: emailLogs.sentAt,
            })
            .from(emailLogs)
            .where(and(...conditions))
            .orderBy(desc(emailLogs.sentAt))
            .limit(limit)
            .offset(offset);

        res.json({
            logs,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        });
    })
);

export default router;
