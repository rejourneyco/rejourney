/**
 * Crashes Routes
 */

import { Router } from 'express';
import { eq, and, desc, sql } from 'drizzle-orm';
import { db, crashes, projects, teamMembers } from '../db/client.js';
import { sessionAuth, asyncHandler, ApiError } from '../middleware/index.js';
import { logger } from '../logger.js';
import { downloadFromS3ForProject } from '../db/s3.js';

const router = Router();

/**
 * Get crashes for a project
 */
router.get(
    '/projects/:projectId/crashes',
    sessionAuth,
    asyncHandler(async (req, res) => {
        const { projectId } = req.params;
        const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
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

        const crashList = await db
            .select()
            .from(crashes)
            .where(eq(crashes.projectId, projectId))
            .orderBy(desc(crashes.timestamp))
            .limit(limit)
            .offset(offset);

        const total = await db
            .select({ count: sql<number>`count(*)` })
            .from(crashes)
            .where(eq(crashes.projectId, projectId));

        res.json({
            crashes: crashList,
            total: Number(total[0]?.count || 0),
        });
    })
);

/**
 * Get crash details
 */
router.get(
    '/projects/:projectId/crashes/:crashId',
    sessionAuth,
    asyncHandler(async (req, res) => {
        const { projectId, crashId } = req.params;

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

        const [crash] = await db
            .select()
            .from(crashes)
            .where(and(eq(crashes.id, crashId), eq(crashes.projectId, projectId)))
            .limit(1);

        if (!crash) {
            throw ApiError.notFound('Crash not found');
        }

        // Stack trace is now stored directly in DB
        // Fallback to S3 for older crashes that don't have stackTrace in DB
        let stackTrace = crash.stackTrace;
        let fullReport = null;
        
        if (!stackTrace && crash.s3ObjectKey) {
            const data = await downloadFromS3ForProject(projectId, crash.s3ObjectKey);
            if (data) {
                try {
                    const parsed = JSON.parse(data.toString());
                    fullReport = parsed;
                    
                    // Extract stack trace from S3 artifact
                    if (parsed.crashes && Array.isArray(parsed.crashes) && parsed.crashes.length > 0) {
                        const crashData = parsed.crashes[0];
                        if (Array.isArray(crashData.stackTrace)) {
                            stackTrace = crashData.stackTrace.join('\n');
                        } else if (typeof crashData.stackTrace === 'string') {
                            stackTrace = crashData.stackTrace;
                        }
                    } else if (parsed.stackTrace) {
                        if (Array.isArray(parsed.stackTrace)) {
                            stackTrace = parsed.stackTrace.join('\n');
                        } else if (typeof parsed.stackTrace === 'string') {
                            stackTrace = parsed.stackTrace;
                        }
                    }
                } catch (e) {
                    logger.warn({ err: e }, 'Failed to parse S3 crash artifact');
                }
            }
        }

        res.json({
            ...crash,
            stackTrace: stackTrace || null,
            fullReport
        });
    })
);

export default router;
