import { getRedis } from '../db/redis.js';

export const OVERVIEW_CACHE_TTL_SECONDS = 60;

type RedisClient = ReturnType<typeof getRedis>;

export function buildOverviewCacheKey(
    scope: string,
    projectIds: string[],
    timeRange?: string,
    version: string = 'v1',
): string {
    return `overview:${scope}:${projectIds.slice().sort().join(',') || 'all'}:${timeRange || 'all'}:${version}`;
}

export async function persistOverviewCachePayload(
    liveCacheKey: string,
    serializedPayload: string,
    options?: {
        ttlSeconds?: number;
        redisClient?: RedisClient;
    },
): Promise<void> {
    const redisClient = options?.redisClient ?? getRedis();
    const ttlSeconds = options?.ttlSeconds ?? OVERVIEW_CACHE_TTL_SECONDS;
    await redisClient.set(liveCacheKey, serializedPayload, 'EX', ttlSeconds);
}
