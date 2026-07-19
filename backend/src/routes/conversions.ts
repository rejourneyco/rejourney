import { Router } from 'express';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { db, projects, teamMembers, teams } from '../db/client.js';
import { ApiError, asyncHandler, sessionAuth } from '../middleware/index.js';
import { writeApiRateLimiter } from '../middleware/rateLimit.js';
import { validate } from '../middleware/validation.js';
import { recordGoogleAdsMilestone } from '../services/googleAdsConversions.js';

const router = Router();

const productMilestoneSchema = z.object({
    eventName: z.literal('sdk_setup_opened'),
    projectId: z.string().uuid(),
}).strict();

router.post(
    '/product-event',
    sessionAuth,
    writeApiRateLimiter,
    validate(productMilestoneSchema),
    asyncHandler(async (req, res) => {
        const { eventName, projectId } = req.body;
        const [membership] = await db
            .select({
                teamId: projects.teamId,
                ownerUserId: teams.ownerUserId,
            })
            .from(projects)
            .innerJoin(teams, eq(teams.id, projects.teamId))
            .innerJoin(teamMembers, and(
                eq(teamMembers.teamId, projects.teamId),
                eq(teamMembers.userId, req.user!.id),
            ))
            .where(eq(projects.id, projectId))
            .limit(1);
        if (!membership) throw ApiError.forbidden('No access to this project');

        await recordGoogleAdsMilestone({
            eventName,
            userId: membership.ownerUserId,
            teamId: membership.teamId,
            projectId,
            eventSource: 'WEB',
        });
        res.status(202).json({ success: true });
    }),
);

export default router;
