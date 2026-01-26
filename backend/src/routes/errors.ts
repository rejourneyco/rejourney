/**
 * Errors Routes
 * 
 * API endpoints for JavaScript errors, unhandled exceptions, and promise rejections
 */

import { Router } from 'express';
import { eq, and, desc, sql } from 'drizzle-orm';
import { db, errors, projects, teamMembers } from '../db/client.js';
import { sessionAuth, asyncHandler, ApiError } from '../middleware/index.js';

const router = Router();

/**
 * Get errors for a project
 */
router.get(
    '/projects/:projectId/errors',
    sessionAuth,
    asyncHandler(async (req, res) => {
        const { projectId } = req.params;
        const limit = Math.min(parseInt(req.query.limit as string) || 50, 500);
        const offset = parseInt(req.query.offset as string) || 0;

        // Verify access to project
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

        if (!membership) {
            throw ApiError.forbidden('Access denied');
        }

        const errorList = await db
            .select()
            .from(errors)
            .where(eq(errors.projectId, projectId))
            .orderBy(desc(errors.timestamp))
            .limit(limit)
            .offset(offset);

        const total = await db
            .select({ count: sql<number>`count(*)` })
            .from(errors)
            .where(eq(errors.projectId, projectId));

        res.json({
            errors: errorList,
            total: Number(total[0]?.count || 0),
        });
    })
);

/**
 * Get error details
 */
router.get(
    '/projects/:projectId/errors/:errorId',
    sessionAuth,
    asyncHandler(async (req, res) => {
        const { projectId, errorId } = req.params;

        // Verify access to project
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

        if (!membership) {
            throw ApiError.forbidden('Access denied');
        }

        const [error] = await db
            .select()
            .from(errors)
            .where(and(eq(errors.id, errorId), eq(errors.projectId, projectId)))
            .limit(1);

        if (!error) {
            throw ApiError.notFound('Error not found');
        }

        res.json(error);
    })
);

export default router;
