/**
 * Device Authentication Routes
 * 
 * Handles device registration and upload token issuance
 * Uses Redis for scalability with high traffic
 */

import { Router } from 'express';
import { randomBytes } from 'crypto';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { db, deviceRegistrations, projects, deviceTrustScores } from '../db/client.js';
import { getRedis } from '../db/redis.js';
import {
    generateChallenge,
    generateCredentialId,
    verifySignature,
    validatePublicKey,
    getSecurityConfig,
} from '../services/deviceAuth.js';
import { isCloudIp, updateDeviceTrustScore, recordAbuseSignal } from '../services/fraud.js';
import { logger } from '../logger.js';
import { asyncHandler, ApiError } from '../middleware/index.js';
import { validate } from '../middleware/validation.js';

const router = Router();
const redis = getRedis();

const securityMode = (process.env.SECURITY_MODE || 'BALANCED') as 'STRICT' | 'BALANCED' | 'PERMISSIVE';
const config = getSecurityConfig(securityMode);

const registerSchema = z.object({
    projectPublicKey: z.string(),
    bundleId: z.string(),
    platform: z.enum(['ios', 'android', 'web']),
    sdkVersion: z.string(),
    devicePublicKey: z.string(), // PEM format ECDSA P-256
});

const challengeRequestSchema = z.object({
    deviceCredentialId: z.string(),
});

const startSessionSchema = z.object({
    deviceCredentialId: z.string(),
    challenge: z.string(),
    signature: z.string(), // base64
    nonce: z.string(),
});

/**
 * Register new device
 * POST /api/devices/register
 */
router.post(
    '/register',
    validate(registerSchema),
    asyncHandler(async (req, res) => {
        const body = req.body;
        const clientIp = req.ip || '';

        // Rate limit check (Redis)
        const registrationKey = `device:reg:ip:${clientIp}`;
        const count = await redis.incr(registrationKey);
        if (count === 1) {
            await redis.expire(registrationKey, 3600); // 1 hour window
        }

        if (count > config.maxRegistrationsPerIP) {
            logger.warn({ ip: clientIp }, 'Device registration rate limit exceeded');
            throw ApiError.tooManyRequests('Too many registration attempts');
        }

        // Validate public key format
        if (!validatePublicKey(body.devicePublicKey)) {
            throw ApiError.badRequest('Invalid public key format. Must be ECDSA P-256 in PEM format.');
        }

        // Verify project exists and get bundle ID configuration
        const [project] = await db
            .select({ 
                id: projects.id,
                bundleId: projects.bundleId,
                packageName: projects.packageName,
            })
            .from(projects)
            .where(eq(projects.publicKey, body.projectPublicKey))
            .limit(1);

        if (!project) {
            throw ApiError.notFound('Project not found');
        }

        // SECURITY: Validate bundle ID matches project configuration (if configured)
        // This prevents apps with valid project keys but wrong bundle IDs from registering
        if (body.platform === 'ios' && project.bundleId) {
            if (body.bundleId !== project.bundleId) {
                logger.warn({ 
                    projectId: project.id, 
                    expected: project.bundleId, 
                    received: body.bundleId,
                    platform: body.platform,
                    ip: clientIp,
                }, 'Bundle ID mismatch during device registration');
                throw ApiError.forbidden('Bundle ID mismatch. The app bundle ID does not match the project configuration.');
            }
        }

        // SECURITY: Validate package name for Android (if configured)
        if (body.platform === 'android' && project.packageName) {
            if (body.bundleId !== project.packageName) {
                logger.warn({ 
                    projectId: project.id, 
                    expected: project.packageName, 
                    received: body.bundleId,
                    platform: body.platform,
                    ip: clientIp,
                }, 'Package name mismatch during device registration');
                throw ApiError.forbidden('Package name mismatch. The app package name does not match the project configuration.');
            }
        }

        //  Check if device already registered (idempotent)
        const [existing] = await db
            .select({ deviceCredentialId: deviceRegistrations.deviceCredentialId })
            .from(deviceRegistrations)
            .where(
                and(
                    eq(deviceRegistrations.projectId, project.id),
                    eq(deviceRegistrations.devicePublicKey, body.devicePublicKey)
                )
            )
            .limit(1);

        if (existing) {
            res.json({ deviceCredentialId: existing.deviceCredentialId });
            return;
        }

        // Create new registration
        const credentialId = await generateCredentialId();

        await db.insert(deviceRegistrations).values({
            deviceCredentialId: credentialId,
            projectId: project.id,
            bundleId: body.bundleId,
            packageName: body.platform === 'android' ? body.bundleId : null,
            platform: body.platform,
            sdkVersion: body.sdkVersion,
            devicePublicKey: body.devicePublicKey,
        });

        logger.info({ projectId: project.id, platform: body.platform }, 'Device registered');

        res.json({ deviceCredentialId: credentialId });
    })
);

/**
 * Get challenge for signing
 * POST /api/devices/challenge
 */
router.post(
    '/challenge',
    validate(challengeRequestSchema),
    asyncHandler(async (req, res) => {
        const body = req.body;

        // Verify device exists
        const [device] = await db
            .select({ id: deviceRegistrations.id, revokedAt: deviceRegistrations.revokedAt })
            .from(deviceRegistrations)
            .where(eq(deviceRegistrations.deviceCredentialId, body.deviceCredentialId))
            .limit(1);

        if (!device) {
            throw ApiError.notFound('Device not found');
        }

        if (device.revokedAt) {
            throw ApiError.forbidden('Device credential revoked');
        }

        // Generate challenge
        const challenge = await generateChallenge();
        const nonce = randomBytes(16).toString('hex');

        // Store in Redis with TTL
        await redis.set(
            `challenge:${nonce}`,
            challenge,
            'EX',
            config.challengeTTL
        );

        res.json({ challenge, nonce });
    })
);

/**
 * Start session and issue upload token
 * POST /api/devices/start-session
 */
router.post(
    '/start-session',
    validate(startSessionSchema),
    asyncHandler(async (req, res) => {
        const body = req.body;

        // Fetch device registration
        const [device] = await db
            .select({
                id: deviceRegistrations.id,
                projectId: deviceRegistrations.projectId,
                devicePublicKey: deviceRegistrations.devicePublicKey,
                revokedAt: deviceRegistrations.revokedAt,
            })
            .from(deviceRegistrations)
            .where(eq(deviceRegistrations.deviceCredentialId, body.deviceCredentialId))
            .limit(1);

        if (!device) {
            throw ApiError.unauthorized('Invalid device credential');
        }

        if (device.revokedAt) {
            throw ApiError.forbidden('Device credential revoked');
        }

        // Verify challenge exists and matches
        const storedChallenge = await redis.get(`challenge:${body.nonce}`);
        if (!storedChallenge || storedChallenge !== body.challenge) {
            throw ApiError.unauthorized('Invalid or expired challenge');
        }

        // Delete challenge (single use)
        await redis.del(`challenge:${body.nonce}`);

        // Verify signature
        const valid = verifySignature(
            device.devicePublicKey,
            body.challenge,
            body.signature
        );

        if (!valid) {
            logger.warn({ deviceId: device.id }, 'Invalid signature');
            throw ApiError.unauthorized('Invalid signature');
        }

        // Check trust score (if exists)
        const [trustScore] = await db
            .select({ score: deviceTrustScores.score })
            .from(deviceTrustScores)
            .where(eq(deviceTrustScores.deviceId, device.id))
            .limit(1);

        if (trustScore && trustScore.score < config.minTrustScore) {
            logger.warn({ deviceId: device.id, score: trustScore.score }, 'Device trust score too low');
            throw ApiError.forbidden('Device trust score too low');
        }

        // Check for cloud IP (fraud detection)
        const clientIp = req.ip || req.socket?.remoteAddress || '';
        const cloudCheck = isCloudIp(clientIp);
        if (cloudCheck.isCloud) {
            // Record abuse signal and update trust score (non-blocking)
            recordAbuseSignal(
                { type: 'cloud_ip', severity: 'medium', metadata: { provider: cloudCheck.provider, ip: clientIp } },
                device.id
            ).catch(() => { });

            updateDeviceTrustScore(device.id, [
                { type: 'cloud_ip', severity: 'medium', metadata: { provider: cloudCheck.provider } }
            ]).catch(() => { });

            logger.warn({ deviceId: device.id, ip: clientIp, provider: cloudCheck.provider }, 'Cloud IP detected');
        }

        // Update last seen
        await db
            .update(deviceRegistrations)
            .set({ lastSeenAt: new Date() })
            .where(eq(deviceRegistrations.id, device.id));

        // Issue upload token (simple signed token)
        const tokenPayload = JSON.stringify({
            type: 'upload',
            deviceId: device.id,
            projectId: device.projectId,
            iat: Math.floor(Date.now() / 1000),
            exp: Math.floor(Date.now() / 1000) + config.uploadTokenTTL,
        });

        const token = `${Buffer.from(tokenPayload).toString('base64')}.${randomBytes(32).toString('hex')}`;

        // Cache token in Redis for quick validation
        await redis.set(
            `upload:token:${device.id}`,
            token,
            'EX',
            config.uploadTokenTTL
        );

        logger.info({ deviceId: device.id, projectId: device.projectId }, 'Upload token issued');

        res.json({
            uploadToken: token,
            expiresIn: config.uploadTokenTTL,
        });
    })
);

export default router;
