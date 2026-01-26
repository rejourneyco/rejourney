/**
 * ANRs Routes
 * 
 * API endpoints for Application Not Responding (ANR) events
 */

import { Router } from 'express';
import crypto from 'crypto';
import { eq, and, desc, gte } from 'drizzle-orm';
import { db, anrs, projects, teamMembers, sessions } from '../db/client.js';
import { sessionAuth, asyncHandler, ApiError } from '../middleware/index.js';
import { logger } from '../logger.js';
import { downloadFromS3ForProject } from '../db/s3.js';
import { generateANRFingerprint } from '../services/issueTracker.js';

const router = Router();

/**
 * Get ANRs for a project
 */
router.get(
    '/projects/:projectId/anrs',
    sessionAuth,
    asyncHandler(async (req, res) => {
        const { projectId } = req.params;
        const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
        const offset = parseInt(req.query.offset as string) || 0;
        const timeRange = (req.query.timeRange as string) || '30d';

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

        // Time range filter (applied server-side so counts/users are accurate)
        let cutoff: Date | null = null;
        if (timeRange && timeRange !== 'all') {
            const now = new Date();
            switch (timeRange) {
                case '24h':
                    cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
                    break;
                case '7d':
                    cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                    break;
                case '30d':
                    cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
                    break;
                case '90d':
                    cutoff = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
                    break;
                default:
                    cutoff = null;
            }
        }

        // Pull all ANR events in the selected time range and group them into "ANR issues"
        // (same concept as Errors page): grouped by a stable fingerprint derived from threadState.
        const rows = await db
            .select({
                anr: anrs,
                userDisplayId: sessions.userDisplayId,
                anonymousHash: sessions.anonymousHash,
                deviceId: sessions.deviceId,
            })
            .from(anrs)
            .leftJoin(sessions, eq(anrs.sessionId, sessions.id))
            .where(
                and(
                    eq(anrs.projectId, projectId),
                    cutoff ? gte(anrs.timestamp, cutoff) : undefined!
                )
            )
            .orderBy(desc(anrs.timestamp));

        type Group = {
            // Keep the latest (most recent) underlying ANR id so existing detail pages keep working
            id: string;
            sessionId: string | null;
            projectId: string;
            timestamp: Date;
            durationMs: number;
            threadState: string | null;
            s3ObjectKey: string | null;
            deviceMetadata: any;
            status: string;
            occurrenceCount: number;
            userSet: Set<string>;
            groupKey: string;
        };

        const groups = new Map<string, Group>();

        for (const row of rows) {
            const anr = row.anr;
            const fingerprint = generateANRFingerprint(anr.threadState || '');
            const groupKey = `anrgrp_${crypto.createHash('sha1').update(fingerprint).digest('hex').slice(0, 16)}`;

            let group = groups.get(groupKey);
            if (!group) {
                group = {
                    id: anr.id,
                    sessionId: anr.sessionId ?? null,
                    projectId: anr.projectId,
                    timestamp: anr.timestamp,
                    durationMs: anr.durationMs,
                    threadState: anr.threadState,
                    s3ObjectKey: anr.s3ObjectKey ?? null,
                    deviceMetadata: anr.deviceMetadata,
                    status: anr.status,
                    occurrenceCount: 0,
                    userSet: new Set<string>(),
                    groupKey,
                };
                groups.set(groupKey, group);
            }

            group.occurrenceCount += anr.occurrenceCount ?? 1;

            // Bubble up status (open > resolved/ignored)
            if (group.status !== 'open' && anr.status === 'open') {
                group.status = 'open';
            }

            const identity = row.userDisplayId || row.anonymousHash || row.deviceId || anr.sessionId || anr.id;
            group.userSet.add(identity);
        }

        const grouped = Array.from(groups.values())
            .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

        const paged = grouped.slice(offset, offset + limit).map((g) => ({
            id: g.id,
            sessionId: g.sessionId,
            projectId: g.projectId,
            timestamp: g.timestamp,
            durationMs: g.durationMs,
            threadState: g.threadState,
            s3ObjectKey: g.s3ObjectKey,
            deviceMetadata: g.deviceMetadata,
            status: g.status,
            occurrenceCount: g.occurrenceCount,
            userCount: g.userSet.size,
            groupKey: g.groupKey,
        }));

        res.json({
            anrs: paged,
            totalGroups: grouped.length,
            totalEvents: rows.length,
        });
    })
);

/**
 * Get ANR details
 */
router.get(
    '/projects/:projectId/anrs/:anrId',
    sessionAuth,
    asyncHandler(async (req, res) => {
        const { projectId, anrId } = req.params;

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

        const [anr] = await db
            .select()
            .from(anrs)
            .where(and(eq(anrs.id, anrId), eq(anrs.projectId, projectId)))
            .limit(1);

        if (!anr) {
            throw ApiError.notFound('ANR not found');
        }

        // Fetch full ANR report from S3 if needed
        let fullReport = null;
        if (anr.s3ObjectKey) {
            const data = await downloadFromS3ForProject(projectId, anr.s3ObjectKey);
            if (data) {
                try {
                    const parsed = JSON.parse(data.toString());
                    if (parsed.anrs && Array.isArray(parsed.anrs)) {
                        fullReport = parsed;
                    } else {
                        fullReport = parsed;
                    }
                } catch (e) {
                    logger.warn({ err: e }, 'Failed to parse S3 ANR artifact');
                }
            }
        }

        res.json({
            ...anr,
            fullReport
        });
    })
);

export default router;
