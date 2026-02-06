/**
 * SDK Routes
 * 
 * SDK initialization and project resolution
 */

import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { db, projects } from '../db/client.js';
import { getRedis } from '../db/redis.js';
import { asyncHandler, ApiError } from '../middleware/index.js';

const router = Router();

/**
 * Get project config via public key header
 * GET /api/sdk/config
 * 
 * Unified endpoint for iOS and Android SDKs to fetch project configuration.
 * Uses x-public-key header for authentication.
 * Supports optional bundle ID / package name validation via headers.
 */
router.get(
    '/config',
    asyncHandler(async (req, res) => {
        const publicKey = req.headers['x-public-key'] as string;
        const bundleId = req.headers['x-bundle-id'] as string;
        const packageName = req.headers['x-package-name'] as string;
        const platform = req.headers['x-platform'] as string;

        if (!publicKey) {
            throw ApiError.badRequest('x-public-key header is required');
        }

        // Find project by public key (cached)
        const cacheKey = `sdk:config:${publicKey}`;
        let project:
            | {
                id: string;
                teamId: string;
                name: string;
                bundleId: string | null;
                packageName: string | null;
                rejourneyEnabled: boolean;
                recordingEnabled: boolean;
                maxRecordingMinutes: number;
                sampleRate: number;
                deletedAt: Date | null;
            }
            | undefined;

        try {
            const cached = await getRedis().get(cacheKey);
            if (cached) {
                project = JSON.parse(cached);
            }
        } catch {
            project = undefined;
        }

        if (!project) {
            const [dbProject] = await db
                .select({
                    id: projects.id,
                    teamId: projects.teamId,
                    name: projects.name,
                    bundleId: projects.bundleId,
                    packageName: projects.packageName,
                    rejourneyEnabled: projects.rejourneyEnabled,
                    recordingEnabled: projects.recordingEnabled,
                    maxRecordingMinutes: projects.maxRecordingMinutes,
                    sampleRate: projects.sampleRate,
                    deletedAt: projects.deletedAt,
                })
                .from(projects)
                .where(eq(projects.publicKey, publicKey))
                .limit(1);

            if (dbProject) {
                project = dbProject;
                try {
                    await getRedis().set(
                        cacheKey,
                        JSON.stringify(dbProject),
                        'EX',
                        300
                    );
                } catch {
                    // ignore cache errors
                }
            }
        }

        if (project?.deletedAt) {
            project = undefined;
        }

        if (!project) {
            throw ApiError.unauthorized('Invalid public key');
        }

        const sampleRate = Math.max(0, Math.min(100, project.sampleRate ?? 100));
        const maxRecordingMinutes = Math.max(
            1,
            Math.min(10, project.maxRecordingMinutes ?? 10)
        );

        // SECURITY: Validate bundle ID if provided and project has one configured
        if (platform === 'ios' && bundleId && project.bundleId) {
            if (bundleId !== project.bundleId) {
                throw ApiError.forbidden('Bundle ID mismatch');
            }
        }

        // SECURITY: Validate package name if provided and project has one configured
        if (platform === 'android' && packageName && project.packageName) {
            if (packageName !== project.packageName) {
                throw ApiError.forbidden('Package name mismatch');
            }
        }

        // If Rejourney is disabled, return early with disabled flag
        if (!project.rejourneyEnabled) {
            res.json({
                projectId: project.id,
                rejourneyEnabled: false,
                recordingEnabled: false,
                disabled: true,
                reason: 'Rejourney disabled by project admin',
            });
            return;
        }

        // Check billing status (session limits)
        let billingBlocked = false;
        let billingReason: string | undefined;

        const { teams } = await import('../db/client.js');
        const [team] = await db
            .select({ ownerUserId: teams.ownerUserId })
            .from(teams)
            .where(eq(teams.id, project.teamId))
            .limit(1);

        if (team?.ownerUserId) {
            const { canUserRecord } = await import('./stripeBilling.js');
            const billingStatus = await canUserRecord(team.ownerUserId, project.teamId);
            billingBlocked = !billingStatus.canRecord;
            billingReason = billingStatus.reason;
        }

        const { getAdaptiveScaleFactor } = await import('../utils/adaptiveSampling.js');
        const adaptiveFactor = await getAdaptiveScaleFactor(project.id);
        const effectiveSampleRate = Math.round(sampleRate * adaptiveFactor);

        res.json({
            projectId: project.id,
            teamId: project.teamId,
            name: project.name,
            rejourneyEnabled: project.rejourneyEnabled,
            recordingEnabled: project.recordingEnabled,
            maxRecordingMinutes,
            sampleRate: effectiveSampleRate,
            billingBlocked,
            billingReason,
        });
    })
);

export default router;
