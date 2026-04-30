/**
 * Rate Limiting Middleware
 * 
 * Redis-backed sliding window rate limiting
 */

import { Request, Response, NextFunction } from 'express';
import { checkRateLimit, isRedisConnected, getRedis, getRedisDiagnosticsForLog } from '../db/redis.js';
import { rateLimits } from '../config.js';
import { logger } from '../logger.js';
import {
    buildIngestDeviceRateLimitKey,
    buildIngestProjectRateLimitKey,
} from '../utils/ingestRateLimitKey.js';

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
    message?: string;
}

/**
 * Create a rate limiter middleware
 */
export function rateLimit(options: RateLimitOptions) {
    const { windowMs, max, keyGenerator, failOpen = false, message } = options;

    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        // Skip rate limiting in test mode
        if (process.env.NODE_ENV === 'test') {
            next();
            return;
        }

        const redisClient = getRedis();
        const redisReady = isRedisClientUsable(redisClient);

        if (!redisReady) {
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
            // Generate rate limit key
            const key = keyGenerator
                ? keyGenerator(req)
                : `rate:${req.ip}:${req.path}`;

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

/**
 * Pre-configured rate limiters
 */

// Dashboard API rate limiter (per user)
// failOpen: Redis outages or reconnect windows must not brick the authenticated dashboard
// (same idea as dashboardStatsRateLimiter). Abuse risk is limited to logged-in users.
export const dashboardRateLimiter = rateLimit({
    ...rateLimits.dashboard.perUser,
    keyGenerator: (req) => `rate:dash:${req.user?.id || req.ip}`,
    failOpen: true,
    message: 'Too many requests. Please slow down.',
});

// Dashboard stats rate limiter (more restrictive)
export const dashboardStatsRateLimiter = rateLimit({
    ...rateLimits.dashboard.stats,
    keyGenerator: (req) => `rate:stats:${req.params.projectId || req.project?.id || req.ip}`,
    failOpen: true,
    message: 'Too many stats requests. Please wait before refreshing.',
});

export const queryBuilderUserRateLimiter = rateLimit({
    ...rateLimits.dashboard.queryBuilderUser,
    keyGenerator: (req) => `rate:query-builder:user:${req.user?.id || req.ip || 'unknown'}`,
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
    keyGenerator: (req) => `rate:query-builder:ip:${req.ip || 'unknown'}`,
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
    keyGenerator: (req) => `rate:otp:send:${req.body?.email || req.ip}`,
    failOpen: false, // OTP must be rate limited
    message: 'Too many OTP requests. Please wait before requesting another code.',
});

// OTP send IP limiter (prevents email rotation abuse from one IP)
export const otpSendIpRateLimiter = rateLimit({
    windowMs: 15 * 60_000,
    max: 40,
    keyGenerator: (req) => `rate:otp:send:ip:${req.ip || 'unknown'}`,
    failOpen: false,
    message: 'Too many OTP requests from this network. Please try again later.',
});

// OTP verify rate limiter
export const otpVerifyRateLimiter = rateLimit({
    ...rateLimits.auth.otpVerify,
    keyGenerator: (req) => `rate:otp:verify:${req.body?.email || req.ip}`,
    failOpen: false,
    message: 'Too many verification attempts. Please try again later.',
});

// OTP verify IP limiter (prevents many-email brute force from one IP)
export const otpVerifyIpRateLimiter = rateLimit({
    windowMs: 60_000,
    max: 80,
    keyGenerator: (req) => `rate:otp:verify:ip:${req.ip || 'unknown'}`,
    failOpen: false,
    message: 'Too many verification attempts from this network. Please try again later.',
});

// OAuth flow limiter
export const oauthRateLimiter = rateLimit({
    windowMs: 15 * 60_000,
    max: 60,
    keyGenerator: (req) => `rate:oauth:${req.ip || 'unknown'}`,
    failOpen: false,
    message: 'Too many OAuth attempts. Please try again later.',
});

// Generic write limiter for authenticated dashboard write APIs
export const writeApiRateLimiter = rateLimit({
    windowMs: 60_000,
    max: 120,
    keyGenerator: (req) => `rate:write:${req.user?.id || req.ip || 'unknown'}`,
    failOpen: false,
    message: 'Too many write operations. Please slow down.',
});

// Invitation-specific limiter
export const inviteRateLimiter = rateLimit({
    windowMs: 60 * 60_000,
    max: 40,
    keyGenerator: (req) => `rate:invite:${req.user?.id || req.ip || 'unknown'}:${req.params.teamId || 'global'}`,
    failOpen: false,
    message: 'Too many invitations sent. Please wait before sending more.',
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
    keyGenerator: (req) => `rate:signed:${req.project?.id || req.user?.id || req.ip}`,
    failOpen: false,
    message: 'Too many signed URL requests.',
});

// Network grouping rate limiter
export const networkRateLimiter = rateLimit({
    ...rateLimits.network,
    keyGenerator: (req) => `rate:network:${req.project?.id || req.ip}`,
    failOpen: true,
    message: 'Too many network aggregation requests.',
});

// Admin/billing rate limiter
export const adminRateLimiter = rateLimit({
    ...rateLimits.admin,
    keyGenerator: (req) => `rate:admin:${req.user?.id || req.project?.id || req.ip}`,
    failOpen: false,
    message: 'Too many admin requests.',
});
