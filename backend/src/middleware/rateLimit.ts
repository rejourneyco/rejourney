/**
 * Rate Limiting Middleware
 * 
 * Redis-backed sliding window rate limiting
 */

import { Request, Response, NextFunction } from 'express';
import { createHash } from 'crypto';
import { checkRateLimit, isRedisConnected, getRedis, getRedisDiagnosticsForLog } from '../db/redis.js';
import { rateLimits } from '../config.js';
import { logger } from '../logger.js';
import {
    buildIngestDeviceRateLimitKey,
    buildIngestProjectRateLimitKey,
} from '../utils/ingestRateLimitKey.js';
import { getRequestIp } from '../utils/requestIp.js';

/**
 * ioredis uses "reconnecting" (and "connect") after idle drops or network blips.
 * Treating only ready|connecting as usable caused 503 on all dashboard routes until
 * reconnect finished — e.g. /api/projects after tab idle in k8s.
 */
function isRedisClientUsable(redisClient: ReturnType<typeof getRedis>): boolean {
    if (isRedisConnected()) return true;
    const s = redisClient.status;
    return s === 'ready' || s === 'connecting' || s === 'connect' || s === 'reconnecting';
}

interface RateLimitOptions {
    windowMs: number;
    max: number;
    keyGenerator?: (req: Request) => string;
    failOpen?: boolean; // Allow if Redis is down
    redisUnavailableFallback?: boolean;
    message?: string;
}

interface InMemoryRateLimitBucket {
    count: number;
    resetAt: number;
}

const inMemoryFallbackBuckets = new Map<string, InMemoryRateLimitBucket>();

declare global {
    namespace Express {
        interface Request {
            rateLimitFallbackUsed?: boolean;
        }
    }
}

export function checkInMemoryRateLimit(
    key: string,
    windowMs: number,
    max: number,
    now: number = Date.now(),
    store: Map<string, InMemoryRateLimitBucket> = inMemoryFallbackBuckets,
): { allowed: boolean; remaining: number; resetAt: number } {
    const existing = store.get(key);

    if (!existing || existing.resetAt <= now) {
        const resetAt = now + windowMs;
        store.set(key, { count: 1, resetAt });
        return {
            allowed: true,
            remaining: Math.max(max - 1, 0),
            resetAt,
        };
    }

    existing.count += 1;

    return {
        allowed: existing.count <= max,
        remaining: Math.max(max - existing.count, 0),
        resetAt: existing.resetAt,
    };
}

export function resetInMemoryRateLimitFallbacksForTests(): void {
    inMemoryFallbackBuckets.clear();
}

/**
 * Create a rate limiter middleware
 */
export function rateLimit(options: RateLimitOptions) {
    const { windowMs, max, keyGenerator, failOpen = false, redisUnavailableFallback = false, message } = options;

    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        // Skip rate limiting in test mode
        if (process.env.NODE_ENV === 'test') {
            next();
            return;
        }

        const key = keyGenerator
            ? keyGenerator(req)
            : `rate:${rateLimitClientIp(req)}:${req.path}`;

        const applyInMemoryFallback = (event: string, err?: unknown): void => {
            const result = checkInMemoryRateLimit(key, windowMs, max);
            req.rateLimitFallbackUsed = true;

            res.set('X-RateLimit-Limit', String(max));
            res.set('X-RateLimit-Remaining', String(result.remaining));
            res.set('X-RateLimit-Reset', String(Math.ceil(result.resetAt / 1000)));
            res.set('X-RateLimit-Fallback', 'memory');

            logger.warn(
                {
                    err,
                    event,
                    path: req.path,
                    rateLimitKey: key,
                    allowed: result.allowed,
                    max,
                    windowMs,
                    retryAfterSec: Math.ceil((result.resetAt - Date.now()) / 1000),
                    ...getRedisDiagnosticsForLog(),
                },
                event,
            );

            if (!result.allowed) {
                res.status(429).json({
                    error: 'Too Many Requests',
                    message: message || 'Rate limit exceeded. Please try again later.',
                    retryAfter: Math.ceil((result.resetAt - Date.now()) / 1000),
                });
                return;
            }

            next();
        };

        const redisClient = getRedis();
        const redisReady = isRedisClientUsable(redisClient);

        if (!redisReady) {
            if (redisUnavailableFallback) {
                applyInMemoryFallback('rate_limit.redis_unavailable_memory_fallback');
                return;
            }

            if (failOpen) {
                logger.warn(
                    {
                        event: 'rate_limit.redis_unavailable_fail_open',
                        path: req.path,
                        ...getRedisDiagnosticsForLog(),
                    },
                    'rate_limit.redis_unavailable_fail_open',
                );
                next();
                return;
            } else {
                const ingestRelated =
                    req.path.startsWith('/api/ingest') || req.path.startsWith('/upload');
                logger.warn(
                    {
                        event: 'rate_limit.redis_unavailable_fail_closed',
                        path: req.path,
                        ingestRelated,
                        ...getRedisDiagnosticsForLog(),
                    },
                    'rate_limit.redis_unavailable_fail_closed',
                );
                res.status(503).json({
                    error: 'Service temporarily unavailable',
                    retryAfter: 60,
                });
                return;
            }
        }

        try {
            const result = await checkRateLimit(key, windowMs, max);

            // Set rate limit headers
            res.set('X-RateLimit-Limit', String(max));
            res.set('X-RateLimit-Remaining', String(result.remaining));
            res.set('X-RateLimit-Reset', String(Math.ceil(result.resetAt / 1000)));

            if (!result.allowed) {
                const signedOrIngestKey =
                    key.startsWith('rate:ingest:') || key.startsWith('rate:signed:');
                if (signedOrIngestKey) {
                    logger.warn(
                        {
                            event: 'ingest.rate_limit_429',
                            rateLimitKey: key,
                            path: req.path,
                            projectId: req.project?.id,
                            max,
                            windowMs,
                            retryAfterSec: Math.ceil((result.resetAt - Date.now()) / 1000),
                            ...getRedisDiagnosticsForLog(),
                        },
                        'ingest.rate_limit_429',
                    );
                }
                res.status(429).json({
                    error: 'Too Many Requests',
                    message: message || 'Rate limit exceeded. Please try again later.',
                    retryAfter: Math.ceil((result.resetAt - Date.now()) / 1000),
                });
                return;
            }

            next();
        } catch (err) {
            logger.error(
                {
                    err,
                    event: 'rate_limit.middleware_error',
                    path: req.path,
                    failOpen,
                    ...getRedisDiagnosticsForLog(),
                },
                'Rate limit check failed',
            );
            if (redisUnavailableFallback) {
                applyInMemoryFallback('rate_limit.redis_error_memory_fallback', err);
                return;
            }

            if (failOpen) {
                next();
            } else {
                res.status(500).json({ error: 'Internal server error' });
            }
        }
    };
}

function scopeRateLimitKey(
    scope: string,
    baseKeyGenerator: (req: Request) => string,
): (req: Request) => string {
    return (req: Request) => `${baseKeyGenerator(req)}:bucket:${scope}`;
}

function rateLimitClientIp(req: Request): string {
    return getRequestIp(req) || 'unknown';
}

/**
 * Pre-configured rate limiters
 */

// Dashboard API rate limiter (per user)
// failOpen: Redis outages or reconnect windows must not brick the authenticated dashboard
// (same idea as dashboardStatsRateLimiter). Abuse risk is limited to logged-in users.
export const dashboardRateLimiter = rateLimit({
    ...rateLimits.dashboard.perUser,
    keyGenerator: (req) => `rate:dash:${req.user?.id || rateLimitClientIp(req)}`,
    failOpen: true,
    message: 'Too many requests. Please slow down.',
});

// Dashboard stats rate limiter (more restrictive)
export const dashboardStatsRateLimiter = rateLimit({
    ...rateLimits.dashboard.stats,
    keyGenerator: (req) => `rate:stats:${req.params.projectId || req.project?.id || rateLimitClientIp(req)}`,
    failOpen: true,
    message: 'Too many stats requests. Please wait before refreshing.',
});

export const queryBuilderUserRateLimiter = rateLimit({
    ...rateLimits.dashboard.queryBuilderUser,
    keyGenerator: (req) => `rate:query-builder:user:${req.user?.id || rateLimitClientIp(req)}`,
    failOpen: false,
    message: 'Too many AI query requests. Please wait before generating more queries.',
});

export const queryBuilderProjectRateLimiter = rateLimit({
    ...rateLimits.dashboard.queryBuilderProject,
    keyGenerator: (req) => `rate:query-builder:project:${req.params.id || req.params.projectId || 'unknown'}`,
    failOpen: false,
    message: 'This project has reached its daily AI query-builder limit.',
});

export const queryBuilderIpRateLimiter = rateLimit({
    ...rateLimits.dashboard.queryBuilderIp,
    keyGenerator: (req) => `rate:query-builder:ip:${rateLimitClientIp(req)}`,
    failOpen: false,
    message: 'Too many AI query requests from this network. Please try again later.',
});

// Keep ingest project buckets split by route family so hot replay traffic does
// not cannibalize other ingest paths.
export const ingestAuthProjectRateLimiter = rateLimit({
    ...rateLimits.ingest.perProjectAuth,
    keyGenerator: scopeRateLimitKey('auth-device', buildIngestProjectRateLimitKey),
    failOpen: false,
    message: 'Device ingest auth rate limit exceeded for this project.',
});

export const ingestBatchProjectRateLimiter = rateLimit({
    ...rateLimits.ingest.perProjectBatch,
    keyGenerator: scopeRateLimitKey('batch-ingest', buildIngestProjectRateLimitKey),
    failOpen: false,
    message: 'Batch ingest rate limit exceeded for this project.',
});

export const ingestSegmentProjectRateLimiter = rateLimit({
    ...rateLimits.ingest.perProjectSegment,
    keyGenerator: scopeRateLimitKey('segment-ingest', buildIngestProjectRateLimitKey),
    failOpen: false,
    message: 'Replay ingest rate limit exceeded for this project.',
});

export const ingestLifecycleProjectRateLimiter = rateLimit({
    ...rateLimits.ingest.perProjectLifecycle,
    keyGenerator: scopeRateLimitKey('lifecycle', buildIngestProjectRateLimitKey),
    failOpen: false,
    message: 'Session lifecycle ingest rate limit exceeded for this project.',
});

export const ingestFaultProjectRateLimiter = rateLimit({
    ...rateLimits.ingest.perProjectFault,
    keyGenerator: scopeRateLimitKey('fault', buildIngestProjectRateLimitKey),
    failOpen: false,
    message: 'Fault ingest rate limit exceeded for this project.',
});

// Keep ingest hot paths in separate device buckets so auth, batch presigns, and
// replay segment presigns do not cannibalize each other.
export const ingestDeviceAuthRateLimiter = rateLimit({
    ...rateLimits.ingest.perDeviceAuth,
    keyGenerator: scopeRateLimitKey('auth-device', buildIngestDeviceRateLimitKey),
    failOpen: false,
    message: 'Device ingest auth rate limit exceeded.',
});

export const ingestBatchDeviceRateLimiter = rateLimit({
    ...rateLimits.ingest.perDeviceBatch,
    keyGenerator: scopeRateLimitKey('batch-presign', buildIngestDeviceRateLimitKey),
    failOpen: false,
    message: 'Ingest batch rate limit exceeded for this device.',
});

export const ingestSegmentDeviceRateLimiter = rateLimit({
    ...rateLimits.ingest.perDeviceSegment,
    keyGenerator: scopeRateLimitKey('segment-presign', buildIngestDeviceRateLimitKey),
    failOpen: false,
    message: 'Ingest segment rate limit exceeded for this device.',
});

// OTP send rate limiter
export const otpSendRateLimiter = rateLimit({
    ...rateLimits.auth.otpSend,
    keyGenerator: (req) => `rate:otp:send:${req.body?.email || rateLimitClientIp(req)}`,
    failOpen: false,
    redisUnavailableFallback: true,
    message: 'Too many OTP requests. Please wait before requesting another code.',
});

// OTP send IP limiter (prevents email rotation abuse from one IP)
export const otpSendIpRateLimiter = rateLimit({
    windowMs: 15 * 60_000,
    max: 40,
    keyGenerator: (req) => `rate:otp:send:ip:${rateLimitClientIp(req)}`,
    failOpen: false,
    redisUnavailableFallback: true,
    message: 'Too many OTP requests from this network. Please try again later.',
});

// OTP verify rate limiter
export const otpVerifyRateLimiter = rateLimit({
    ...rateLimits.auth.otpVerify,
    keyGenerator: (req) => `rate:otp:verify:${req.body?.email || rateLimitClientIp(req)}`,
    failOpen: false,
    redisUnavailableFallback: true,
    message: 'Too many verification attempts. Please try again later.',
});

// OTP verify IP limiter (prevents many-email brute force from one IP)
export const otpVerifyIpRateLimiter = rateLimit({
    windowMs: 60_000,
    max: 80,
    keyGenerator: (req) => `rate:otp:verify:ip:${rateLimitClientIp(req)}`,
    failOpen: false,
    redisUnavailableFallback: true,
    message: 'Too many verification attempts from this network. Please try again later.',
});

// OAuth flow limiter
export const oauthRateLimiter = rateLimit({
    windowMs: 15 * 60_000,
    max: 60,
    keyGenerator: (req) => `rate:oauth:${rateLimitClientIp(req)}`,
    failOpen: false,
    message: 'Too many OAuth attempts. Please try again later.',
});

// Generic write limiter for authenticated dashboard write APIs
export const writeApiRateLimiter = rateLimit({
    windowMs: 60_000,
    max: 120,
    keyGenerator: (req) => `rate:write:${req.user?.id || rateLimitClientIp(req)}`,
    failOpen: false,
    message: 'Too many write operations. Please slow down.',
});

// Invitation-specific limiter
export const inviteRateLimiter = rateLimit({
    windowMs: 60 * 60_000,
    max: 40,
    keyGenerator: (req) => `rate:invite:${req.user?.id || rateLimitClientIp(req)}:${req.params.teamId || 'global'}`,
    failOpen: false,
    message: 'Too many invitations sent. Please wait before sending more.',
});

// Project setup email limiter
export const projectSetupEmailRateLimiter = rateLimit({
    windowMs: 60 * 60_000,
    max: 30,
    keyGenerator: (req) => `rate:project-setup-email:${req.user?.id || rateLimitClientIp(req)}:${req.params.id || 'global'}`,
    failOpen: false,
    message: 'Too many setup emails sent. Please wait before sending more.',
});

// API key rate limiter
export const apiKeyRateLimiter = rateLimit({
    ...rateLimits.apiKey.perProject,
    keyGenerator: (req) => `rate:api:${req.project?.id || 'unknown'}`,
    failOpen: false,
    message: 'API rate limit exceeded.',
});

// Signed URL rate limiter
export const signedUrlRateLimiter = rateLimit({
    ...rateLimits.signedUrl,
    keyGenerator: (req) => `rate:signed:${req.project?.id || req.user?.id || rateLimitClientIp(req)}`,
    failOpen: false,
    message: 'Too many signed URL requests.',
});

export const replayShareRateLimiter = rateLimit({
    windowMs: 60_000,
    max: 1200,
    keyGenerator: (req) => {
        const token = typeof req.params.shareToken === 'string' ? req.params.shareToken : '';
        const tokenHash = token
            ? createHash('sha256').update(token).digest('hex').slice(0, 16)
            : 'unknown';
        return `rate:replay-share:${rateLimitClientIp(req)}:${tokenHash}`;
    },
    failOpen: false,
    message: 'Too many replay share requests. Please slow down.',
});

// Network grouping rate limiter
export const networkRateLimiter = rateLimit({
    ...rateLimits.network,
    keyGenerator: (req) => `rate:network:${req.project?.id || rateLimitClientIp(req)}`,
    failOpen: true,
    message: 'Too many network aggregation requests.',
});

// Admin/billing rate limiter
export const adminRateLimiter = rateLimit({
    ...rateLimits.admin,
    keyGenerator: (req) => `rate:admin:${req.user?.id || req.project?.id || rateLimitClientIp(req)}`,
    failOpen: false,
    message: 'Too many admin requests.',
});
