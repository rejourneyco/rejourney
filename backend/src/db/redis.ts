/**
 * Redis Client
 * 
 * Used for rate limiting and caching
 */

import { createRequire } from 'module';
import { config } from '../config.js';
import { logger } from '../logger.js';

// Use createRequire for CJS modules that don't have proper ESM exports
const require = createRequire(import.meta.url);
const Redis = require('ioredis');

type RedisClient = InstanceType<typeof Redis>;

let redis: RedisClient | null = null;
let isConnected = false;

/** For structured logs when debugging Redis vs app logic (ingest, rate limits, session cache). */
export function getRedisDiagnosticsForLog(): {
    redisReportedConnected: boolean;
    redisClientStatus: string;
} {
    try {
        const client = getRedis();
        return {
            redisReportedConnected: isConnected,
            redisClientStatus: typeof client.status === 'string' ? client.status : 'unknown',
        };
    } catch {
        return { redisReportedConnected: false, redisClientStatus: 'client_init_error' };
    }
}

function logRedisOperationFailed(operation: string, err: unknown, extra: Record<string, unknown> = {}): void {
    logger.warn(
        {
            event: 'redis.operation_failed',
            operation,
            err,
            ...getRedisDiagnosticsForLog(),
            ...extra,
        },
        'redis.operation_failed',
    );
}

export function getRedis(): RedisClient {
    if (!redis) {
        redis = new Redis(config.REDIS_URL, {
            maxRetriesPerRequest: 3,
            retryStrategy(times: number) {
                const delay = Math.min(times * 50, 2000);
                return delay;
            },
            lazyConnect: true,
        });

        redis.on('connect', () => {
            isConnected = true;
            logger.info('Redis connected');
        });

        redis.on('error', (err: Error) => {
            logger.error({ err }, 'Redis error');
            isConnected = false;
        });

        redis.on('close', () => {
            isConnected = false;
            logger.warn('Redis connection closed');
        });
    }

    return redis;
}

/**
 * Initialize Redis connection
 */
export async function initRedis(): Promise<void> {
    const client = getRedis();
    if (!isConnected) {
        try {
            await client.connect();
            logger.info('Redis connection initialized');
        } catch (err) {
            logRedisOperationFailed('init_connect', err);
            // Don't throw - allow app to start even if Redis is down
        }
    }
}

export function isRedisConnected(): boolean {
    return isConnected;
}

/**
 * Rate limit helpers
 */
export async function checkRateLimit(
    key: string,
    windowMs: number,
    maxRequests: number
): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
    const redisClient = getRedis();
    const now = Date.now();
    const windowStart = now - windowMs;
    const resetAt = now + windowMs;

    try {
        const pipeline = redisClient.pipeline();
        pipeline.zremrangebyscore(key, 0, windowStart);
        pipeline.zadd(key, now.toString(), `${now}-${Math.random()}`);
        pipeline.zcard(key);
        pipeline.pexpire(key, windowMs);

        const results = await pipeline.exec();
        const count = (results?.[2]?.[1] as number) || 0;
        const remaining = Math.max(0, maxRequests - count);

        return {
            allowed: count <= maxRequests,
            remaining,
            resetAt,
        };
    } catch (err) {
        logRedisOperationFailed('check_rate_limit', err, { rateLimitKeyPrefix: key.split(':').slice(0, 3).join(':') });
        return { allowed: true, remaining: maxRequests, resetAt };
    }
}

/**
 * Idempotency helpers for ingest
 */
export async function getIdempotencyStatus(
    projectId: string,
    idempotencyKey: string
): Promise<{ status: string; checksum?: string } | null> {
    const redisClient = getRedis();
    const key = `ingest:idempotency:${projectId}:${idempotencyKey}`;

    try {
        const data = await redisClient.hgetall(key);
        if (!data || !data.status) return null;
        return { status: data.status, checksum: data.checksum };
    } catch (err) {
        logRedisOperationFailed('get_idempotency_status', err, { projectId });
        return null;
    }
}

export async function setIdempotencyStatus(
    projectId: string,
    idempotencyKey: string,
    status: string,
    checksum?: string
): Promise<void> {
    const redisClient = getRedis();
    const key = `ingest:idempotency:${projectId}:${idempotencyKey}`;

    try {
        const pipeline = redisClient.pipeline();
        pipeline.hset(key, 'status', status);
        if (checksum) pipeline.hset(key, 'checksum', checksum);
        pipeline.expire(key, 7 * 24 * 3600);
        await pipeline.exec();
    } catch (err) {
        logRedisOperationFailed('set_idempotency_status', err, { projectId });
    }
}

/**
 * Team session limit caching for ingest
 * Caches team session limit and current usage to avoid DB hits on every session start
 * 
 * SECURITY: Uses distributed locking to prevent cache stampede race conditions
 * that could allow session limit bypass when multiple requests hit cache miss simultaneously
 */

// Default TTL of 5 minutes for better performance
// Session cache is invalidated on billing updates via invalidateSessionLimitCache()
const DEFAULT_SESSION_CACHE_TTL_SECONDS = 300;

export interface TeamSessionData {
    teamId: string;
    sessionsUsed: number;
    sessionLimit: number;
    planName: string;
}

export async function getSessionLimitCache(
    teamId: string,
    period: string
): Promise<TeamSessionData | null> {
    const redisClient = getRedis();
    const key = `sessions:${teamId}:${period}`;

    try {
        const data = await redisClient.hgetall(key);
        if (!data || !data.cached) return null;
        return {
            teamId,
            sessionsUsed: parseInt(data.sessionsUsed || '0'),
            sessionLimit: parseInt(data.sessionLimit || '0'),
            planName: data.planName || 'unknown',
        };
    } catch (err) {
        logRedisOperationFailed('get_session_limit_cache', err, { teamId });
        return null;
    }
}

/**
 * Acquire a distributed lock for session limit cache refresh
 * Returns true if lock acquired, false if another process holds it
 */
export async function acquireSessionLimitLock(
    teamId: string,
    period: string,
    lockTtlSeconds: number = 10
): Promise<boolean> {
    const redisClient = getRedis();
    const lockKey = `session_lock:${teamId}:${period}`;

    try {
        // NX = set if not exists, EX = expire in lockTtlSeconds
        const result = await redisClient.set(lockKey, '1', 'EX', lockTtlSeconds, 'NX');
        return result === 'OK';
    } catch (err) {
        logRedisOperationFailed('acquire_session_limit_lock', err, { teamId });
        return false;
    }
}

/**
 * Release the distributed lock for session limit cache refresh
 */
export async function releaseSessionLimitLock(
    teamId: string,
    period: string
): Promise<void> {
    const redisClient = getRedis();
    const lockKey = `session_lock:${teamId}:${period}`;

    try {
        await redisClient.del(lockKey);
    } catch (err) {
        logRedisOperationFailed('release_session_limit_lock', err, { teamId });
    }
}

/**
 * Get session limit cache with distributed locking to prevent race conditions
 * If cache miss and another process is refreshing, waits and retries
 * 
 * @param teamId - Team ID
 * @param period - Billing period (YYYY-MM)
 * @param fetchFromDb - Callback to fetch session data from database if cache miss and lock acquired
 * @param maxRetries - Maximum number of retries if lock is held by another process
 */
export async function getSessionLimitCacheWithLock(
    teamId: string,
    period: string,
    fetchFromDb: () => Promise<TeamSessionData>,
    maxRetries: number = 3
): Promise<TeamSessionData> {
    // Try cache first
    const cached = await getSessionLimitCache(teamId, period);
    if (cached) {
        return cached;
    }

    // Cache miss - try to acquire lock
    const lockAcquired = await acquireSessionLimitLock(teamId, period);

    if (!lockAcquired) {
        // Another process is refreshing, wait and retry
        if (maxRetries > 0) {
            await new Promise(r => setTimeout(r, 100));
            return getSessionLimitCacheWithLock(teamId, period, fetchFromDb, maxRetries - 1);
        }
        // Max retries exceeded, fall through to fetch from DB without caching
        logger.warn({ teamId, period }, 'Session limit cache lock contention, fetching without cache');
        return fetchFromDb();
    }

    try {
        // Double-check cache after acquiring lock (another process may have populated it)
        const rechecked = await getSessionLimitCache(teamId, period);
        if (rechecked) {
            return rechecked;
        }

        // We hold the lock, fetch from DB and cache
        const sessionData = await fetchFromDb();
        await setSessionLimitCache(teamId, period, sessionData);
        return sessionData;
    } finally {
        await releaseSessionLimitLock(teamId, period);
    }
}

export async function setSessionLimitCache(
    teamId: string,
    period: string,
    sessionData: TeamSessionData,
    ttlSeconds: number = DEFAULT_SESSION_CACHE_TTL_SECONDS
): Promise<void> {
    const redisClient = getRedis();
    const key = `sessions:${teamId}:${period}`;

    try {
        const pipeline = redisClient.pipeline();
        pipeline.hset(key, 'cached', '1');
        pipeline.hset(key, 'sessionsUsed', sessionData.sessionsUsed.toString());
        pipeline.hset(key, 'sessionLimit', sessionData.sessionLimit.toString());
        pipeline.hset(key, 'planName', sessionData.planName);
        pipeline.expire(key, ttlSeconds);
        await pipeline.exec();
    } catch (err) {
        logRedisOperationFailed('set_session_limit_cache', err, { teamId });
    }
}

/**
 * Workspace cache - speeds up tab switching by avoiding DB hit on every workspace load
 * Key: workspace:{userId}:{teamId}:{projectId}:{workspaceKey}
 * TTL: 2 minutes; invalidated on save
 */
const WORKSPACE_CACHE_TTL_SECONDS = 120;

function workspaceCacheKey(userId: string, teamId: string, projectId: string, workspaceKey: string): string {
    return `workspace:${userId}:${teamId}:${projectId}:${workspaceKey}`;
}

export async function getWorkspaceCache(
    userId: string,
    teamId: string,
    projectId: string,
    workspaceKey: string
): Promise<string | null> {
    const redisClient = getRedis();
    const key = workspaceCacheKey(userId, teamId, projectId, workspaceKey);
    try {
        return await redisClient.get(key);
    } catch (err) {
        logRedisOperationFailed('get_workspace_cache', err, { userId, teamId });
        return null;
    }
}

export async function setWorkspaceCache(
    userId: string,
    teamId: string,
    projectId: string,
    workspaceKey: string,
    payload: string
): Promise<void> {
    const redisClient = getRedis();
    const key = workspaceCacheKey(userId, teamId, projectId, workspaceKey);
    try {
        await redisClient.setex(key, WORKSPACE_CACHE_TTL_SECONDS, payload);
    } catch (err) {
        logRedisOperationFailed('set_workspace_cache', err, { userId, teamId });
    }
}

export async function invalidateWorkspaceCache(
    userId: string,
    teamId: string,
    projectId: string,
    workspaceKey: string = 'default'
): Promise<void> {
    const redisClient = getRedis();
    const key = workspaceCacheKey(userId, teamId, projectId, workspaceKey);
    try {
        await redisClient.del(key);
    } catch (err) {
        logRedisOperationFailed('invalidate_workspace_cache', err, { userId, teamId });
    }
}

/**
 * Invalidate team session limit cache (call after billing updates or session count changes)
 */
export async function invalidateSessionLimitCache(
    teamId: string,
    period?: string
): Promise<void> {
    const redisClient = getRedis();
    const currentPeriod = period || `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
    const key = `sessions:${teamId}:${currentPeriod}`;

    try {
        await redisClient.del(key);
        logger.debug({ teamId, period: currentPeriod }, 'Invalidated team session limit cache');
    } catch (err) {
        logRedisOperationFailed('invalidate_session_limit_cache', err, { teamId });
    }
}

export async function closeRedis(): Promise<void> {
    if (redis) {
        await redis.quit();
        redis = null;
        isConnected = false;
    }
}

process.on('beforeExit', closeRedis);
