import { getRedis } from '../db/redis.js';
import { rateLimits } from '../config.js';
import { logger } from '../logger.js';
import { ApiError } from '../middleware/index.js';

interface EnforceIngestByteBudgetParams {
    projectId: string;
    deviceId: string | null;
    clientIp: string | undefined;
    bytes: number;
    endpoint: 'presign' | 'segment/presign';
}

interface CounterSpec {
    key: string;
    limit: number;
    scope: 'project' | 'device' | 'ip';
    window: 'minute' | 'day';
    ttlSeconds: number;
}

function normalizeClientIp(ip: string | undefined): string {
    if (!ip) return 'unknown';
    const trimmed = ip.trim();
    if (trimmed.startsWith('::ffff:')) {
        return trimmed.slice(7);
    }
    return trimmed || 'unknown';
}

function secondsUntilMinuteRollover(nowMs: number): number {
    const currentSecond = Math.floor(nowMs / 1000);
    return Math.max(1, 60 - (currentSecond % 60));
}

function secondsUntilDayRolloverUtc(nowMs: number): number {
    const now = new Date(nowMs);
    const next = new Date(now);
    next.setUTCHours(24, 0, 0, 0);
    return Math.max(1, Math.ceil((next.getTime() - now.getTime()) / 1000));
}

function buildCounterSpecs(
    projectId: string,
    deviceId: string | null,
    clientIp: string,
    nowMs: number
): CounterSpec[] {
    const minuteBucket = Math.floor(nowMs / 60_000);
    const dayBucket = new Date(nowMs).toISOString().split('T')[0];
    const ttlMinute = 2 * 60;
    const ttlDay = 2 * 24 * 60 * 60;

    const specs: CounterSpec[] = [
        {
            key: `ingest:bytes:project:minute:${projectId}:${minuteBucket}`,
            limit: rateLimits.ingest.byteQuota.perProjectPerMinuteBytes,
            scope: 'project',
            window: 'minute',
            ttlSeconds: ttlMinute,
        },
        {
            key: `ingest:bytes:project:day:${projectId}:${dayBucket}`,
            limit: rateLimits.ingest.byteQuota.perProjectPerDayBytes,
            scope: 'project',
            window: 'day',
            ttlSeconds: ttlDay,
        },
        {
            key: `ingest:bytes:ip:minute:${clientIp}:${minuteBucket}`,
            limit: rateLimits.ingest.byteQuota.perIpPerMinuteBytes,
            scope: 'ip',
            window: 'minute',
            ttlSeconds: ttlMinute,
        },
        {
            key: `ingest:bytes:ip:day:${clientIp}:${dayBucket}`,
            limit: rateLimits.ingest.byteQuota.perIpPerDayBytes,
            scope: 'ip',
            window: 'day',
            ttlSeconds: ttlDay,
        },
    ];

    if (deviceId) {
        specs.push(
            {
                key: `ingest:bytes:device:minute:${deviceId}:${minuteBucket}`,
                limit: rateLimits.ingest.byteQuota.perDevicePerMinuteBytes,
                scope: 'device',
                window: 'minute',
                ttlSeconds: ttlMinute,
            },
            {
                key: `ingest:bytes:device:day:${deviceId}:${dayBucket}`,
                limit: rateLimits.ingest.byteQuota.perDevicePerDayBytes,
                scope: 'device',
                window: 'day',
                ttlSeconds: ttlDay,
            }
        );
    }

    return specs;
}

export async function enforceIngestByteBudget({
    projectId,
    deviceId,
    clientIp,
    bytes,
    endpoint,
}: EnforceIngestByteBudgetParams): Promise<void> {
    if (process.env.NODE_ENV === 'test') {
        return;
    }

    if (!Number.isFinite(bytes) || bytes <= 0) {
        throw ApiError.badRequest('sizeBytes must be a positive number');
    }

    const maxObjectBytes = rateLimits.ingest.byteQuota.maxObjectBytes;
    if (bytes > maxObjectBytes) {
        throw new ApiError(
            `Upload too large. Max allowed per upload is ${maxObjectBytes} bytes.`,
            413,
            'PAYLOAD_TOO_LARGE',
            { maxObjectBytes }
        );
    }

    const nowMs = Date.now();
    const normalizedIp = normalizeClientIp(clientIp);
    const specs = buildCounterSpecs(projectId, deviceId, normalizedIp, nowMs);
    const redis = getRedis();

    try {
        const pipeline = redis.pipeline();
        for (const spec of specs) {
            pipeline.incrby(spec.key, bytes);
            pipeline.expire(spec.key, spec.ttlSeconds);
        }

        const results = await pipeline.exec();
        if (!results) {
            throw new Error('Redis pipeline returned no results');
        }

        const violations: Array<{
            scope: CounterSpec['scope'];
            window: CounterSpec['window'];
            usedBytes: number;
            limitBytes: number;
        }> = [];

        for (let i = 0; i < specs.length; i++) {
            const resultIdx = i * 2;
            const usedBytes = Number(results[resultIdx]?.[1] ?? 0);
            const spec = specs[i];
            if (usedBytes > spec.limit) {
                violations.push({
                    scope: spec.scope,
                    window: spec.window,
                    usedBytes,
                    limitBytes: spec.limit,
                });
            }
        }

        if (violations.length > 0) {
            const retryAfter = Math.max(
                ...violations.map(v =>
                    v.window === 'minute'
                        ? secondsUntilMinuteRollover(nowMs)
                        : secondsUntilDayRolloverUtc(nowMs)
                )
            );

            const primary = violations[0];
            logger.warn(
                {
                    projectId,
                    deviceId,
                    clientIp: normalizedIp,
                    endpoint,
                    bytes,
                    primaryViolation: primary,
                    violationCount: violations.length,
                },
                'Blocked presign request due to ingest byte budget'
            );

            throw ApiError.tooManyRequests(
                `Ingest byte quota exceeded for ${primary.scope} (${primary.window} window).`,
                retryAfter
            );
        }
    } catch (err) {
        if (err instanceof ApiError) {
            throw err;
        }

        logger.error(
            { err, projectId, deviceId, clientIp: normalizedIp, endpoint, bytes },
            'Ingest byte budget check failed'
        );
        throw ApiError.serviceUnavailable('Ingest quota service temporarily unavailable');
    }
}

