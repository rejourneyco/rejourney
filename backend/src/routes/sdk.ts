/**
 * SDK Routes
 * 
 * SDK initialization and project resolution
 */

import { Router, type Request } from 'express';
import { eq } from 'drizzle-orm';
import { db, projects } from '../db/client.js';
import { getRedis } from '../db/redis.js';
import { asyncHandler, ApiError } from '../middleware/index.js';
import { buildSdkConfigResponse } from '../services/sdkConfig.js';
import { checkBillingStatus, getTeamSessionUsage } from '../services/quotaCheck.js';
import { isWebOriginAllowed } from '../utils/webAllowedDomains.js';


const router = Router();

function isWebSdkRequest(req: Request): boolean {
    return String(req.headers['x-platform'] ?? '').toLowerCase() === 'web' ||
        typeof req.headers.origin === 'string';
}

function getWebRequestOrigin(req: Request): string | undefined {
    const origin = req.headers.origin;
    if (typeof origin === 'string' && origin) return origin;
    const referer = req.headers.referer;
    if (typeof referer === 'string' && referer) return referer;
    return undefined;
}

/**
 * Get project config via public key header
 * GET /api/sdk/config
 * 
 * Unified endpoint for mobile and web SDKs to fetch project configuration.
 * Uses x-public-key header for authentication.
 */
router.get(
    '/config',
    asyncHandler(async (req, res) => {
        const publicKey = req.headers['x-public-key'] as string;

        if (!publicKey) {
            throw ApiError.badRequest('x-public-key header is required');
        }

        // Find project by public key (cached)
        const cacheKey = `sdk:config:v6:${publicKey}`;
        let project:
            | {
                id: string;
                teamId: string;
                name: string;
                webDomain?: string | null;
                webAllowedDomains?: string[] | null;
                rejourneyEnabled: boolean;
                recordingEnabled: boolean;
                textInputMasking?: string | null;
                imageVideoMasking?: string | null;
                recordingFps: number;
                sampleRate: number;
                maxRecordingMinutes: number;
                webMaxObservabilityMinutes: number;
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
                    webDomain: projects.webDomain,
                    webAllowedDomains: projects.webAllowedDomains,
                    rejourneyEnabled: projects.rejourneyEnabled,
                    recordingEnabled: projects.recordingEnabled,
                    textInputMasking: projects.textInputMasking,
                    imageVideoMasking: projects.imageVideoMasking,
                    recordingFps: projects.recordingFps,
                    sampleRate: projects.sampleRate,
                    maxRecordingMinutes: projects.maxRecordingMinutes,
                    webMaxObservabilityMinutes: projects.webMaxObservabilityMinutes,
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

        if (isWebSdkRequest(req) && !isWebOriginAllowed([
            ...(project.webAllowedDomains ?? []),
            ...(project.webDomain ? [project.webDomain] : []),
        ], getWebRequestOrigin(req))) {
            throw ApiError.forbidden('Domain is not allowed for this project');
        }

        // If Rejourney is disabled, return early with disabled flag
        if (!project.rejourneyEnabled) {
            res.json(buildSdkConfigResponse(project));
            return;
        }

        // Check billing status. Hard payment blocks still stop the SDK; replay
        // quota exhaustion degrades existing SDKs to analytics-only via
        // recordingEnabled=false while keeping billingBlocked=false.
        let billingBlocked = false;
        let billingReason: string | undefined;
        let replayQuotaBillingExhausted = false;
        const billingCacheKey = `sdk:billing:${project.teamId}`;
        let billingCacheHit = false;

        try {
            const cached = await getRedis().get(billingCacheKey);
            if (cached) {
                const parsed = JSON.parse(cached) as {
                    billingBlocked?: boolean;
                    billingReason?: string;
                    replayQuotaBillingExhausted?: boolean;
                };
                billingBlocked = Boolean(parsed.billingBlocked);
                billingReason = typeof parsed.billingReason === 'string' ? parsed.billingReason : undefined;
                replayQuotaBillingExhausted = Boolean(parsed.replayQuotaBillingExhausted);
                billingCacheHit = true;
            }
        } catch {
            billingCacheHit = false;
        }

        if (!billingCacheHit) {
            const billingStatus = await checkBillingStatus(project.teamId);
            if (!billingStatus.canRecord) {
                billingBlocked = true;
                billingReason = billingStatus.reason;
            } else {
                const usage = await getTeamSessionUsage(project.teamId);
                if (usage.isReplayAtLimit) {
                    replayQuotaBillingExhausted = true;
                    billingReason = `Replay quota reached (${usage.sessionReplaysUsed}/${usage.sessionReplayLimit}). Analytics will continue without replay.`;
                }
            }

            try {
                await getRedis().set(
                    billingCacheKey,
                    JSON.stringify({ billingBlocked, billingReason: billingReason ?? null, replayQuotaBillingExhausted }),
                    'EX',
                    60,
                );
            } catch {
                // ignore cache errors
            }
        }

        res.json(buildSdkConfigResponse(project, {
            billingBlocked,
            billingReason,
            replayQuotaBillingExhausted,
        }));
    })
);

export default router;
