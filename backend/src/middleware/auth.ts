/**
 * Authentication Middleware
 * 
 * Supports session-based auth and API key auth
 */

import { Request, Response, NextFunction } from 'express';
import { createHash, createHmac } from 'crypto';
import { eq, and, isNull } from 'drizzle-orm';
import { db, userSessions, users, apiKeys, projects, teams, teamMembers } from '../db/client.js';
import { logger } from '../logger.js';

const AUTH_CONTEXT_CACHE_TTL_MS = 5 * 60 * 1000;
const API_KEY_LAST_USED_WRITE_INTERVAL_MS = 5 * 60 * 1000;

type RequestProjectContext = NonNullable<Express.Request['project']>;
type RequestApiKeyContext = NonNullable<Express.Request['apiKey']>;
type CachedAuthContext = {
    expiresAt: number;
    project: RequestProjectContext;
    apiKey: RequestApiKeyContext;
};
type UploadTokenPayload = {
    type?: string;
    deviceId?: string | null;
    projectId?: string | null;
    teamId?: string | null;
    projectName?: string | null;
    recordingEnabled?: boolean;
    rejourneyEnabled?: boolean;
    iat?: number;
    exp?: number;
};

const authContextCache = new Map<string, CachedAuthContext>();
const apiKeyLastUsedAt = new Map<string, number>();

function getCachedAuthContext(cacheKey: string): CachedAuthContext | null {
    const cached = authContextCache.get(cacheKey);
    if (!cached) {
        return null;
    }

    if (cached.expiresAt <= Date.now()) {
        authContextCache.delete(cacheKey);
        return null;
    }

    return cached;
}

function setCachedAuthContext(cacheKey: string, context: {
    project: RequestProjectContext;
    apiKey: RequestApiKeyContext;
}): void {
    authContextCache.set(cacheKey, {
        ...context,
        expiresAt: Date.now() + AUTH_CONTEXT_CACHE_TTL_MS,
    });
}

function applyCachedAuthContext(req: Request, context: CachedAuthContext): void {
    req.project = context.project;
    req.apiKey = context.apiKey;
}

function buildProjectContext(project: {
    id: string;
    teamId: string;
    name: string;
    recordingEnabled?: boolean | null;
    rejourneyEnabled?: boolean | null;
}, apiKey: RequestApiKeyContext): CachedAuthContext {
    return {
        expiresAt: Date.now() + AUTH_CONTEXT_CACHE_TTL_MS,
        project: {
            id: project.id,
            teamId: project.teamId,
            name: project.name,
            recordingEnabled: project.recordingEnabled ?? undefined,
            rejourneyEnabled: project.rejourneyEnabled ?? undefined,
        },
        apiKey,
    };
}

function decodeUploadTokenPayload(token: string): UploadTokenPayload | null {
    try {
        const dotIdx = token.indexOf('.');
        if (dotIdx <= 0) {
            return null;
        }

        const payloadB64 = token.substring(0, dotIdx);
        const payload = JSON.parse(Buffer.from(payloadB64, 'base64').toString());
        if (!payload || typeof payload !== 'object') {
            return null;
        }

        return payload as UploadTokenPayload;
    } catch {
        return null;
    }
}

function buildUploadTokenCacheKey(projectId: string): string {
    return `upload-project:${projectId}`;
}

function buildApiKeyCacheKey(hashedKey: string): string {
    return `api-key:${hashedKey}`;
}

function buildPublicKeyCacheKey(projectKey: string): string {
    return `public-key:${projectKey}`;
}

function shouldWriteApiKeyLastUsed(apiKeyId: string): boolean {
    const now = Date.now();
    const lastWriteAt = apiKeyLastUsedAt.get(apiKeyId) ?? 0;
    if ((now - lastWriteAt) < API_KEY_LAST_USED_WRITE_INTERVAL_MS) {
        return false;
    }

    apiKeyLastUsedAt.set(apiKeyId, now);
    return true;
}

// Extend Express Request type
declare global {
    namespace Express {
        interface Request {
            user?: {
                id: string;
                email: string;
                displayName?: string;
                roles: string[];
            };
            project?: {
                id: string;
                teamId: string;
                name: string;
                recordingEnabled?: boolean;
                rejourneyEnabled?: boolean;
            };
            apiKey?: {
                id: string;
                projectId: string;
                scopes: string[];
            };
        }
    }
}

/**
 * Session-based authentication for dashboard
 * 
 * Uses Redis caching to reduce database load and improve resilience.
 * Falls back to database if Redis is unavailable.
 */
export async function sessionAuth(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        // Get session token from cookie or Authorization header
        const token =
            req.cookies?.session ||
            req.headers.authorization?.replace('Bearer ', '');

        if (!token) {
            res.status(401).json({ error: 'Unauthorized', message: 'No session token provided' });
            return;
        }

        // Try Redis cache first (faster, reduces DB load)
        let userData: { id: string; email: string; displayName?: string; roles: string[] } | null = null;

        try {
            const { getRedis } = await import('../db/redis.js');
            const redisClient = getRedis();
            const cacheKey = `session:${token}`;
            const cached = await Promise.race([
                redisClient.get(cacheKey),
                new Promise<string | null>((_, reject) =>
                    setTimeout(() => reject(new Error('Redis timeout')), 100)
                )
            ]) as string | null;

            if (cached) {
                try {
                    const parsed = JSON.parse(cached);
                    // Check expiry
                    if (parsed.expiresAt && new Date(parsed.expiresAt) > new Date()) {
                        userData = {
                            id: parsed.userId,
                            email: parsed.email,
                            displayName: parsed.displayName,
                            roles: parsed.roles || [],
                        };
                    }
                } catch {
                    // Invalid cache data, fall through to DB
                }
            }
        } catch (redisErr) {
            // Redis unavailable or error - fall back to database
            logger.debug({ err: redisErr }, 'Redis cache miss, falling back to database');
        }

        // If cache miss, query database
        if (!userData) {
            try {
                // Add timeout to prevent hanging on DB issues
                const dbQuery = db
                    .select({
                        session: userSessions,
                        user: users,
                    })
                    .from(userSessions)
                    .innerJoin(users, eq(userSessions.userId, users.id))
                    .where(eq(userSessions.token, token))
                    .limit(1);

                const sessionResults = await Promise.race([
                    dbQuery,
                    new Promise<Array<{ session: any; user: any }>>((_, reject) =>
                        setTimeout(() => reject(new Error('Database query timeout')), 2000)
                    )
                ]);
                const sessionResult = sessionResults[0];

                if (!sessionResult || sessionResult.session.expiresAt < new Date()) {
                    res.status(401).json({ error: 'Unauthorized', message: 'Invalid or expired session' });
                    return;
                }

                userData = {
                    id: sessionResult.user.id,
                    email: sessionResult.user.email,
                    displayName: sessionResult.user.displayName ?? undefined,
                    roles: sessionResult.user.roles || [],
                };

                // Cache in Redis for future requests (non-blocking)
                try {
                    const { getRedis } = await import('../db/redis.js');
                    const redisClient = getRedis();
                    const cacheKey = `session:${token}`;
                    const ttl = Math.floor((sessionResult.session.expiresAt.getTime() - Date.now()) / 1000);
                    if (ttl > 0) {
                        await redisClient.setex(
                            cacheKey,
                            ttl,
                            JSON.stringify({
                                userId: userData.id,
                                email: userData.email,
                                displayName: userData.displayName,
                                roles: userData.roles,
                                expiresAt: sessionResult.session.expiresAt.toISOString(),
                            })
                        );
                    }
                } catch (cacheErr) {
                    // Cache write failed - non-critical, continue
                    logger.debug({ err: cacheErr }, 'Failed to cache session');
                }
            } catch (dbErr: any) {
                // Database error - check if it's a timeout or connection issue
                if (dbErr.message?.includes('timeout') || dbErr.code === 'ECONNREFUSED') {
                    logger.error({ err: dbErr }, 'Database connection error in sessionAuth');
                    res.status(503).json({
                        error: 'Service Unavailable',
                        message: 'Authentication service temporarily unavailable'
                    });
                    return;
                }
                throw dbErr; // Re-throw other errors
            }
        }

        // Attach user to request
        req.user = userData;
        next();
    } catch (err) {
        logger.error({ err }, 'Session auth error');
        // Don't expose internal errors in production
        const message = process.env.NODE_ENV === 'production'
            ? 'Authentication failed'
            : err instanceof Error ? err.message : 'Internal server error';
        res.status(500).json({ error: 'Internal server error', message });
    }
}

/**
 * API key authentication for ingest and SDK
 * Supports both API keys and attestation tokens
 */
export async function apiKeyAuth(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const projectKey = (req.headers['x-rejourney-key'] as string) || (req.headers['x-api-key'] as string);
        const uploadToken = req.headers['x-upload-token'] as string;

        // Try upload token first (from /api/ingest/auth/device)
        if (uploadToken) {
            try {
                const payload = decodeUploadTokenPayload(uploadToken);
                if (payload) {
                    const dotIdx = uploadToken.indexOf('.');
                    const payloadB64 = dotIdx > 0 ? uploadToken.substring(0, dotIdx) : '';
                    const signature = uploadToken.substring(dotIdx + 1);

                    if (payload.type === 'upload' && payload.deviceId && payload.projectId) {
                        // SECURITY: Check token expiry
                        const now = Math.floor(Date.now() / 1000);
                        if (payload.exp && payload.exp < now) {
                            logger.debug({ deviceId: payload.deviceId, exp: payload.exp }, 'Upload token expired');
                            // Fall through to API key auth
                        } else {
                            // SECURITY: Verify HMAC signature (offline validation)
                            const { config } = await import('../config.js');
                            const expectedSig = createHmac('sha256', config.INGEST_HMAC_SECRET)
                                .update(payloadB64)
                                .digest('hex');
                            const hmacValid = signature.length === expectedSig.length &&
                                createHash('sha256').update(signature).digest('hex') ===
                                createHash('sha256').update(expectedSig).digest('hex');

                            // Also check Redis for revocation (non-blocking; HMAC is authoritative)
                            let redisValid = false;
                            try {
                                const { getRedis } = await import('../db/redis.js');
                                const redisClient = getRedis();
                                const storedToken = await Promise.race([
                                    redisClient.get(`upload:token:${payload.projectId}:${payload.deviceId}`),
                                    new Promise<string | null>((_, reject) =>
                                        setTimeout(() => reject(new Error('Redis timeout')), 200)
                                    ),
                                ]) as string | null;
                                redisValid = storedToken === uploadToken;
                            } catch {
                                // Redis unavailable — HMAC alone is sufficient
                            }

                            if (hmacValid || redisValid) {
                                const embeddedContext = (
                                    typeof payload.teamId === 'string'
                                    && typeof payload.projectName === 'string'
                                    && typeof payload.recordingEnabled === 'boolean'
                                    && typeof payload.rejourneyEnabled === 'boolean'
                                )
                                    ? buildProjectContext(
                                        {
                                            id: payload.projectId,
                                            teamId: payload.teamId,
                                            name: payload.projectName,
                                            recordingEnabled: payload.recordingEnabled,
                                            rejourneyEnabled: payload.rejourneyEnabled,
                                        },
                                        {
                                            id: 'device-auth',
                                            projectId: payload.projectId,
                                            scopes: ['ingest'],
                                        },
                                    )
                                    : null;

                                if (embeddedContext) {
                                    setCachedAuthContext(buildUploadTokenCacheKey(payload.projectId), embeddedContext);
                                    applyCachedAuthContext(req, embeddedContext);
                                    next();
                                    return;
                                }

                                const cachedUploadContext = getCachedAuthContext(buildUploadTokenCacheKey(payload.projectId));
                                if (cachedUploadContext) {
                                    applyCachedAuthContext(req, cachedUploadContext);
                                    next();
                                    return;
                                }

                                const [projectResult] = await db
                                    .select({
                                        project: projects,
                                        team: teams,
                                    })
                                    .from(projects)
                                    .innerJoin(teams, eq(projects.teamId, teams.id))
                                    .where(eq(projects.id, payload.projectId))
                                    .limit(1);

                                if (projectResult && !projectResult.project.deletedAt) {
                                    const context = buildProjectContext(
                                        {
                                            id: projectResult.project.id,
                                            teamId: projectResult.project.teamId,
                                            name: projectResult.project.name,
                                            recordingEnabled: projectResult.project.recordingEnabled,
                                            rejourneyEnabled: (projectResult.project as any).rejourneyEnabled,
                                        },
                                        {
                                            id: 'device-auth',
                                            projectId: projectResult.project.id,
                                            scopes: ['ingest'],
                                        },
                                    );
                                    setCachedAuthContext(buildUploadTokenCacheKey(payload.projectId), context);
                                    applyCachedAuthContext(req, context);
                                    next();
                                    return;
                                }

                                logger.warn({ projectId: payload.projectId }, 'Project not found or deleted for upload token');
                            } else {
                                logger.debug({ deviceId: payload.deviceId }, 'Upload token HMAC/Redis validation failed, falling back');
                            }
                        }
                    }
                }
            } catch (err) {
                logger.warn({ err }, 'Upload token validation failed, falling back to other auth methods');
            }
        }

        // Fall back to project key / API key authentication
        if (!projectKey) {
            res.status(401).json({ error: 'Unauthorized', message: 'Project key or upload token required' });
            return;
        }

        // Hash the key for API key table lookup
        const hashedKey = createHash('sha256').update(projectKey).digest('hex');

        logger.debug({
            keyPrefix: projectKey.substring(0, 10),
            hashedKeyPrefix: hashedKey.substring(0, 16)
        }, 'Looking up key');

        const cachedApiKeyContext = getCachedAuthContext(buildApiKeyCacheKey(hashedKey));
        if (cachedApiKeyContext) {
            applyCachedAuthContext(req, cachedApiKeyContext);
            next();
            return;
        }

        const cachedPublicKeyContext = getCachedAuthContext(buildPublicKeyCacheKey(projectKey));
        if (cachedPublicKeyContext) {
            applyCachedAuthContext(req, cachedPublicKeyContext);
            next();
            return;
        }

        // Find API key with project and team
        const [keyResult] = await db
            .select({
                key: apiKeys,
                project: projects,
                team: teams,
            })
            .from(apiKeys)
            .innerJoin(projects, eq(apiKeys.projectId, projects.id))
            .innerJoin(teams, eq(projects.teamId, teams.id))
            .where(and(eq(apiKeys.hashedKey, hashedKey), isNull(apiKeys.revokedAt)))
            .limit(1);

        if (!keyResult) {
            // The SDK sends a project public key (not an API key).
            // Look up the project directly by its public_key column.
            const [projectByPubKey] = await db
                .select({
                    project: projects,
                    team: teams,
                })
                .from(projects)
                .innerJoin(teams, eq(projects.teamId, teams.id))
                .where(eq(projects.publicKey, projectKey))
                .limit(1);

            if (projectByPubKey && !projectByPubKey.project.deletedAt) {
                const context = buildProjectContext({
                    id: projectByPubKey.project.id,
                    teamId: projectByPubKey.project.teamId,
                    name: projectByPubKey.project.name,
                    recordingEnabled: projectByPubKey.project.recordingEnabled,
                    rejourneyEnabled: (projectByPubKey.project as any).rejourneyEnabled,
                }, {
                    id: 'project-public-key',
                    projectId: projectByPubKey.project.id,
                    scopes: ['ingest'],
                });
                setCachedAuthContext(buildPublicKeyCacheKey(projectKey), context);
                applyCachedAuthContext(req, context);
                logger.debug({ projectId: projectByPubKey.project.id }, 'Authenticated via project public key fallback');
                next();
                return;
            }

            logger.warn({ keyPrefix: projectKey.substring(0, 10), hashedKeyPrefix: hashedKey.substring(0, 16) }, 'Key not found in database');
            res.status(401).json({ error: 'Unauthorized', message: 'Invalid project key' });
            return;
        }

        // Check if project is deleted
        if (keyResult.project.deletedAt) {
            res.status(403).json({ error: 'Forbidden', message: 'Project has been deleted' });
            return;
        }

        // Update last used timestamp (non-blocking)
        if (shouldWriteApiKeyLastUsed(keyResult.key.id)) {
            db.update(apiKeys)
                .set({ lastUsedAt: new Date() })
                .where(eq(apiKeys.id, keyResult.key.id))
                .then(() => { })
                .catch((err) => logger.warn({ err }, 'Failed to update API key lastUsedAt'));
        }

        const context = buildProjectContext({
            id: keyResult.project.id,
            teamId: keyResult.project.teamId,
            name: keyResult.project.name,
            recordingEnabled: keyResult.project.recordingEnabled,
            rejourneyEnabled: (keyResult.project as any).rejourneyEnabled,
        }, {
            id: keyResult.key.id,
            projectId: keyResult.key.projectId,
            scopes: keyResult.key.scopes || [],
        });
        setCachedAuthContext(buildApiKeyCacheKey(hashedKey), context);
        applyCachedAuthContext(req, context);

        next();
    } catch (err) {
        logger.error({ err }, 'API key auth error');
        res.status(500).json({ error: 'Internal server error' });
    }
}

/**
 * Require specific scopes for API key
 */
export function requireScope(...scopes: string[]) {
    return (req: Request, res: Response, next: NextFunction): void => {
        if (!req.apiKey) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        const hasScope = scopes.some((scope) =>
            req.apiKey!.scopes.includes(scope) || req.apiKey!.scopes.includes('*')
        );

        if (!hasScope) {
            res.status(403).json({
                error: 'Forbidden',
                message: `Required scope: ${scopes.join(' or ')}`,
            });
            return;
        }

        next();
    };
}

/**
 * Check if user has access to a team
 * 
 * Isolated error handling - database errors here don't break sessionAuth
 */
export async function requireTeamAccess(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> {
    const teamId = req.params.teamId || req.body?.teamId;

    if (!teamId) {
        res.status(400).json({ error: 'Team ID required' });
        return;
    }

    if (!req.user) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }

    try {
        // Add timeout to prevent hanging on DB issues
        const membershipQuery = db
            .select()
            .from(teamMembers)
            .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, req.user.id)))
            .limit(1);

        const membershipResults = await Promise.race([
            membershipQuery,
            new Promise<Array<any>>((_, reject) =>
                setTimeout(() => reject(new Error('Database query timeout')), 2000)
            )
        ]);
        const membership = membershipResults[0];

        if (!membership) {
            res.status(403).json({ error: 'Forbidden', message: 'Not a member of this team' });
            return;
        }

        next();
    } catch (err: any) {
        // Isolated error handling - don't break other routes
        logger.error({ err, teamId, userId: req.user?.id }, 'Team access check error');

        // Handle database connection errors gracefully
        if (err.message?.includes('timeout') || err.code === 'ECONNREFUSED') {
            res.status(503).json({
                error: 'Service Unavailable',
                message: 'Team access check temporarily unavailable'
            });
            return;
        }

        res.status(500).json({ error: 'Internal server error' });
    }
}

/**
 * Check if user has admin access to a team
 */
export async function requireTeamAdmin(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> {
    const teamId = req.params.teamId || req.body?.teamId;

    if (!teamId) {
        res.status(400).json({ error: 'Team ID required' });
        return;
    }

    if (!req.user) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }

    try {
        const [membership] = await db
            .select()
            .from(teamMembers)
            .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, req.user.id)))
            .limit(1);

        if (!membership || !['owner', 'admin'].includes(membership.role)) {
            res.status(403).json({ error: 'Forbidden', message: 'Admin access required' });
            return;
        }

        next();
    } catch (err) {
        logger.error({ err }, 'Team admin check error');
        res.status(500).json({ error: 'Internal server error' });
    }
}

/**
 * Check if user is the team owner
 */
export async function requireTeamOwner(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> {
    const teamId = req.params.teamId || req.body?.teamId;

    if (!teamId) {
        res.status(400).json({ error: 'Team ID required' });
        return;
    }

    if (!req.user) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }

    try {
        const [membership] = await db
            .select()
            .from(teamMembers)
            .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, req.user.id)))
            .limit(1);

        if (!membership || membership.role !== 'owner') {
            res.status(403).json({ error: 'Forbidden', message: 'Owner access required' });
            return;
        }

        next();
    } catch (err) {
        logger.error({ err }, 'Team owner check error');
        res.status(500).json({ error: 'Internal server error' });
    }
}

/**
 * Verify project access for authenticated user
 */
export async function requireProjectAccess(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> {
    const projectId = req.params.projectId || req.params.id || req.body?.projectId;

    if (!projectId) {
        res.status(400).json({ error: 'Project ID required' });
        return;
    }

    if (!req.user) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }

    try {
        const [projectResult] = await db
            .select({
                project: projects,
                team: teams,
            })
            .from(projects)
            .innerJoin(teams, eq(projects.teamId, teams.id))
            .where(eq(projects.id, projectId))
            .limit(1);

        if (!projectResult || projectResult.project.deletedAt) {
            res.status(404).json({ error: 'Project not found' });
            return;
        }

        const [membership] = await db
            .select()
            .from(teamMembers)
            .where(and(eq(teamMembers.teamId, projectResult.project.teamId), eq(teamMembers.userId, req.user.id)))
            .limit(1);

        if (!membership) {
            res.status(403).json({ error: 'Forbidden', message: 'No access to this project' });
            return;
        }

        req.project = {
            id: projectResult.project.id,
            teamId: projectResult.project.teamId,
            name: projectResult.project.name,
            recordingEnabled: projectResult.project.recordingEnabled,
            rejourneyEnabled: (projectResult.project as any).rejourneyEnabled,
        };

        next();
    } catch (err) {
        logger.error({ err }, 'Project access check error');
        res.status(500).json({ error: 'Internal server error' });
    }
}

/**
 * Check if user has billing admin access to a team
 * Billing admins can: manage payment methods, view invoices, change spend caps
 * 
 * Roles that have billing access:
 * - owner: Always has billing access
 * - admin: Always has billing access  
 * - billing_admin: Specific billing role without other admin powers
 * 
 * Isolated error handling - database errors here don't break sessionAuth
 */
export async function requireBillingAdmin(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> {
    const teamId = req.params.teamId || req.body?.teamId;

    if (!teamId) {
        res.status(400).json({ error: 'Team ID required' });
        return;
    }

    if (!req.user) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }

    try {
        // Add timeout to prevent hanging on DB issues
        const membershipQuery = db
            .select()
            .from(teamMembers)
            .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, req.user.id)))
            .limit(1);

        const membershipResults = await Promise.race([
            membershipQuery,
            new Promise<Array<any>>((_, reject) =>
                setTimeout(() => reject(new Error('Database query timeout')), 2000)
            )
        ]);
        const membership = membershipResults[0];

        if (!membership) {
            res.status(403).json({ error: 'Forbidden', message: 'Not a member of this team' });
            return;
        }

        // Check if user has billing access
        const billingRoles = ['owner', 'admin', 'billing_admin'];
        if (!billingRoles.includes(membership.role)) {
            res.status(403).json({ error: 'Forbidden', message: 'Billing admin access required' });
            return;
        }

        next();
    } catch (err: any) {
        // Isolated error handling - don't break other routes
        logger.error({ err, teamId, userId: req.user?.id }, 'Billing admin check error');

        // Handle database connection errors gracefully
        if (err.message?.includes('timeout') || err.code === 'ECONNREFUSED') {
            res.status(503).json({
                error: 'Service Unavailable',
                message: 'Billing access check temporarily unavailable'
            });
            return;
        }

        res.status(500).json({ error: 'Internal server error' });
    }
}

/**
 * Helper to check if a user has billing access for a team
 */
export async function hasBillingAccess(userId: string, teamId: string): Promise<boolean> {
    try {
        const [membership] = await db
            .select()
            .from(teamMembers)
            .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)))
            .limit(1);

        if (!membership) return false;

        const billingRoles = ['owner', 'admin', 'billing_admin'];
        return billingRoles.includes(membership.role);
    } catch {
        return false;
    }
}

/**
 * Get user's role in a team
 */
export async function getTeamMemberRole(userId: string, teamId: string): Promise<string | null> {
    try {
        const [membership] = await db
            .select({ role: teamMembers.role })
            .from(teamMembers)
            .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)))
            .limit(1);

        return membership?.role ?? null;
    } catch {
        return null;
    }
}
