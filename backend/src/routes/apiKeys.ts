/**
 * API Keys Routes
 * 
 * Project API key management
 */

import { Router } from 'express';
import { createHash, randomBytes } from 'crypto';
import { eq, and, isNull, desc } from 'drizzle-orm';
import { db, apiKeys, projects, teamMembers } from '../db/client.js';
import { logger } from '../logger.js';
import { auditFromRequest } from '../services/auditLog.js';
import { sessionAuth, requireProjectAccess, asyncHandler, ApiError } from '../middleware/index.js';
import { validate } from '../middleware/validation.js';
import { dashboardRateLimiter, writeApiRateLimiter } from '../middleware/rateLimit.js';
import { projectIdParamSchema } from '../validation/projects.js';
import {
    assertNoDuplicateContentSpam,
    enforceNewAccountActionLimit,
} from '../services/abuseDetection.js';

const router = Router();

/**
 * Get API keys for a project
 * GET /api/projects/:id/api-keys
 */
router.get(
    '/projects/:id/api-keys',
    sessionAuth,
    validate(projectIdParamSchema, 'params'),
    requireProjectAccess,
    dashboardRateLimiter,
    asyncHandler(async (req, res) => {
        const keys = await db
            .select({
                id: apiKeys.id,
                projectId: apiKeys.projectId,
                name: apiKeys.name,
                maskedKey: apiKeys.maskedKey,
                scopes: apiKeys.scopes,
                createdAt: apiKeys.createdAt,
                lastUsedAt: apiKeys.lastUsedAt,
                revokedAt: apiKeys.revokedAt,
            })
            .from(apiKeys)
            .where(and(eq(apiKeys.projectId, req.params.id), isNull(apiKeys.revokedAt)))
            .orderBy(desc(apiKeys.createdAt));

        res.json({
            keys: keys.map((k) => ({
                ...k,
                truncatedKey: k.maskedKey,
                createdAt: k.createdAt.toISOString(),
                lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
                revokedAt: k.revokedAt?.toISOString() ?? null,
            })),
        });
    })
);

/**
 * Create a new API key
 * POST /api/projects/:id/api-keys
 */
router.post(
    '/projects/:id/api-keys',
    sessionAuth,
    writeApiRateLimiter,
    validate(projectIdParamSchema, 'params'),
    requireProjectAccess,
    dashboardRateLimiter,
    asyncHandler(async (req, res) => {
        const projectId = req.params.id;

        await enforceNewAccountActionLimit({
            userId: req.user!.id,
            action: 'api_key_create',
        });

        if (req.body?.name) {
            await assertNoDuplicateContentSpam({
                actorId: req.user!.id,
                action: 'api_key_create',
                contentParts: [req.body.name],
                targetId: projectId,
                checkLinks: false,
            });
        }

        // Generate API key
        const keyBytes = randomBytes(32);
        const key = `rj_${keyBytes.toString('hex')}`;
        const hashedKey = createHash('sha256').update(key).digest('hex');
        const maskedKey = `rj_...${key.slice(-8)}`;

        const [apiKey] = await db.insert(apiKeys).values({
            projectId,
            hashedKey,
            maskedKey,
            name: req.body.name || 'API Key',
            scopes: ['ingest'],
        }).returning();

        logger.info({ projectId, keyId: apiKey.id, userId: req.user!.id }, 'API key created');

        // Audit log
        await auditFromRequest(req, 'api_key_created', {
            targetType: 'api_key',
            targetId: apiKey.id,
            newValue: { keyId: apiKey.id, name: apiKey.name, projectId },
        });

        // Return full key only once
        res.status(201).json({
            apiKey: {
                id: apiKey.id,
                key, // Full key - only shown once
                truncatedKey: maskedKey,
            },
        });
    })
);

/**
 * Revoke an API key
 * DELETE /api/api-keys/:id
 */
router.delete(
    '/api-keys/:id',
    sessionAuth,
    writeApiRateLimiter,
    dashboardRateLimiter,
    asyncHandler(async (req, res) => {
        const keyId = req.params.id;

        // Find the key and verify access
        const [keyResult] = await db
            .select({
                key: apiKeys,
                teamId: projects.teamId,
            })
            .from(apiKeys)
            .innerJoin(projects, eq(apiKeys.projectId, projects.id))
            .where(eq(apiKeys.id, keyId))
            .limit(1);

        if (!keyResult) {
            throw ApiError.notFound('API key not found');
        }

        // Verify user has access to the project's team
        const [membership] = await db
            .select()
            .from(teamMembers)
            .where(and(eq(teamMembers.teamId, keyResult.teamId), eq(teamMembers.userId, req.user!.id)))
            .limit(1);

        if (!membership) {
            throw ApiError.forbidden('No access to this API key');
        }

        // Revoke the key
        await db.update(apiKeys)
            .set({ revokedAt: new Date() })
            .where(eq(apiKeys.id, keyId));

        logger.info({ keyId, userId: req.user!.id }, 'API key revoked');

        // Audit log
        await auditFromRequest(req, 'api_key_deleted', {
            targetType: 'api_key',
            targetId: keyId,
            previousValue: { keyId, projectId: keyResult.key.projectId },
        });

        res.json({ success: true });
    })
);

export default router;
