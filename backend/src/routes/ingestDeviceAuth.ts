import { Router } from 'express';
import { createHmac } from 'crypto';
import { eq } from 'drizzle-orm';
import { db, projects } from '../db/client.js';
import { logger } from '../logger.js';
import { getRedis, getRedisDiagnosticsForLog } from '../db/redis.js';
import { asyncHandler, ApiError } from '../middleware/index.js';
import {
    ingestAuthProjectRateLimiter,
    ingestDeviceAuthRateLimiter,
} from '../middleware/rateLimit.js';
import { config } from '../config.js';

const router = Router();

router.post(
    '/auth/device',
    ingestAuthProjectRateLimiter,
    ingestDeviceAuthRateLimiter,
    asyncHandler(async (req, res) => {
        const projectKey =
            (req.headers['x-rejourney-key'] as string) ||
            (req.headers['x-api-key'] as string);
        const { deviceId, metadata } = req.body || {};

        if (!projectKey) {
            throw ApiError.unauthorized('Project key is required');
        }
        if (!deviceId || typeof deviceId !== 'string') {
            throw ApiError.badRequest('deviceId is required');
        }

        const [project] = await db
        .select({
            id: projects.id,
            teamId: projects.teamId,
            name: projects.name,
            recordingEnabled: projects.recordingEnabled,
            rejourneyEnabled: projects.rejourneyEnabled,
            deletedAt: projects.deletedAt,
        })
        .from(projects)
        .where(eq(projects.publicKey, projectKey))
        .limit(1);

        if (!project || project.deletedAt) {
            throw ApiError.unauthorized('Invalid project key');
        }

        const tokenTTL = 3600;
        const tokenPayload = JSON.stringify({
            type: 'upload',
            deviceId,
            projectId: project.id,
            teamId: project.teamId,
            projectName: project.name,
            recordingEnabled: project.recordingEnabled,
            rejourneyEnabled: project.rejourneyEnabled,
            iat: Math.floor(Date.now() / 1000),
            exp: Math.floor(Date.now() / 1000) + tokenTTL,
        });
        const payloadB64 = Buffer.from(tokenPayload).toString('base64');
        const hmacSig = createHmac('sha256', config.INGEST_HMAC_SECRET)
            .update(payloadB64)
            .digest('hex');
        const token = `${payloadB64}.${hmacSig}`;

        try {
            const redis = getRedis();
            await Promise.race([
                redis.set(`upload:token:${project.id}:${deviceId}`, token, 'EX', tokenTTL),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Redis timeout')), 500)),
            ]);
        } catch (err) {
            logger.warn(
                {
                    err,
                    event: 'ingest.device_auth_redis_token_store_failed',
                    projectId: project.id,
                    deviceId,
                    ...getRedisDiagnosticsForLog(),
                },
                'ingest.device_auth_redis_token_store_failed',
            );
        }

        logger.info({ projectId: project.id, platform: (metadata as any)?.os }, 'Device upload token issued');

        res.json({ uploadToken: token, expiresIn: tokenTTL });
    })
);

export default router;
