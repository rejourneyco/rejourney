import { randomUUID } from 'crypto';
import { config } from '../config.js';
import { getRedis } from '../db/redis.js';

const PREWARM_ALLOWED_SCOPES = new Set(['general', 'api', 'devices', 'geo']);
const PREWARM_HIT_BUCKET_PREFIX = 'dashboard-prewarm:hits:';
const PREWARM_LOCK_KEY = 'dashboard-prewarm:lock';

export const OVERVIEW_CACHE_TTL_SECONDS = 60;
export const OVERVIEW_SHADOW_CACHE_TTL_SECONDS = 180;
export const OVERVIEW_PREWARM_SCOPE_LIMIT = 12;

type RedisClient = ReturnType<typeof getRedis>;

type OverviewShadowEnvelope = {
    generatedAt: string;
    serializedPayload: string;
};

export type DashboardPrewarmScope = {
    scope: 'general' | 'api' | 'devices' | 'geo';
    projectId: string;
    timeRange?: string;
};

export type DashboardPrewarmCandidate = {
    liveCacheKey: string;
    shadowCacheKey: string;
    scope: DashboardPrewarmScope;
    totalHits: number;
};

export function buildOverviewCacheKey(
    scope: string,
    projectIds: string[],
    timeRange?: string,
    version: string = 'v1',
): string {
    return `overview:${scope}:${projectIds.slice().sort().join(',') || 'all'}:${timeRange || 'all'}:${version}`;
}

export function buildOverviewShadowCacheKey(liveCacheKey: string): string {
    return `shadow:${liveCacheKey}`;
}

function buildPrewarmScopeMember(scope: string, projectIds: string[], timeRange?: string): string {
    return `${scope}|${projectIds.slice().sort().join(',') || 'all'}|${timeRange || 'all'}`;
}

export function parseDashboardPrewarmScopeMember(member: string): DashboardPrewarmScope | null {
    const [scope, rawProjectIds, rawTimeRange] = member.split('|');
    if (!scope || !PREWARM_ALLOWED_SCOPES.has(scope)) {
        return null;
    }

    if (!rawProjectIds || rawProjectIds === 'all' || rawProjectIds.includes(',')) {
        return null;
    }

    return {
        scope,
        projectId: rawProjectIds,
        timeRange: rawTimeRange && rawTimeRange !== 'all' ? rawTimeRange : undefined,
    } as DashboardPrewarmScope;
}

export async function persistOverviewCachePayload(
    liveCacheKey: string,
    serializedPayload: string,
    options?: {
        ttlSeconds?: number;
        redisClient?: RedisClient;
        generatedAt?: Date;
    },
): Promise<void> {
    const redisClient = options?.redisClient ?? getRedis();
    const ttlSeconds = options?.ttlSeconds ?? OVERVIEW_CACHE_TTL_SECONDS;
    const shadowEnvelope: OverviewShadowEnvelope = {
        generatedAt: (options?.generatedAt ?? new Date()).toISOString(),
        serializedPayload,
    };

    await redisClient
        .multi()
        .set(liveCacheKey, serializedPayload, 'EX', ttlSeconds)
        .set(buildOverviewShadowCacheKey(liveCacheKey), JSON.stringify(shadowEnvelope), 'EX', OVERVIEW_SHADOW_CACHE_TTL_SECONDS)
        .exec();
}

export async function recordDashboardPrewarmScopeHit(
    scope: string,
    projectIds: string[],
    timeRange?: string,
    redisClient: RedisClient = getRedis(),
): Promise<void> {
    if (!config.RJ_DASHBOARD_PREWARM_TRACKING_ENABLED) {
        return;
    }

    if (!PREWARM_ALLOWED_SCOPES.has(scope) || projectIds.length !== 1 || !projectIds[0] || projectIds[0] === 'all') {
        return;
    }

    const bucketMinutes = Math.floor(Date.now() / 60000);
    const bucketKey = `${PREWARM_HIT_BUCKET_PREFIX}${bucketMinutes}`;
    const member = buildPrewarmScopeMember(scope, projectIds, timeRange);
    const ttlSeconds = Math.max(config.RJ_DASHBOARD_PREWARM_LOOKBACK_MINUTES * 120, 600);

    await redisClient
        .multi()
        .zincrby(bucketKey, 1, member)
        .expire(bucketKey, ttlSeconds)
        .exec();
}

export async function collectDashboardPrewarmCandidates(options?: {
    redisClient?: RedisClient;
    nowMs?: number;
    lookbackMinutes?: number;
    scopeLimit?: number;
}): Promise<DashboardPrewarmCandidate[]> {
    const redisClient = options?.redisClient ?? getRedis();
    const nowMs = options?.nowMs ?? Date.now();
    const lookbackMinutes = Math.max(1, options?.lookbackMinutes ?? config.RJ_DASHBOARD_PREWARM_LOOKBACK_MINUTES);
    const scopeLimit = Math.max(1, Math.min(options?.scopeLimit ?? config.RJ_DASHBOARD_PREWARM_SCOPE_LIMIT, OVERVIEW_PREWARM_SCOPE_LIMIT));
    const bucketMinutes = Math.floor(nowMs / 60000);
    const pipeline = redisClient.pipeline();

    for (let offset = 0; offset < lookbackMinutes; offset += 1) {
        pipeline.zrange(`${PREWARM_HIT_BUCKET_PREFIX}${bucketMinutes - offset}`, 0, -1, 'WITHSCORES');
    }

    const bucketResults = await pipeline.exec();
    const hitsByMember = new Map<string, number>();

    for (const [, rawResult] of bucketResults ?? []) {
        const result = Array.isArray(rawResult) ? rawResult as string[] : [];
        for (let index = 0; index < result.length; index += 2) {
            const member = result[index];
            const score = Number(result[index + 1] || 0);
            if (!member || !Number.isFinite(score) || score <= 0) continue;
            hitsByMember.set(member, (hitsByMember.get(member) || 0) + score);
        }
    }

    return Array.from(hitsByMember.entries())
        .map(([member, totalHits]) => {
            const scope = parseDashboardPrewarmScopeMember(member);
            if (!scope) return null;

            const liveCacheKey = buildOverviewCacheKey(scope.scope, [scope.projectId], scope.timeRange);
            return {
                liveCacheKey,
                shadowCacheKey: buildOverviewShadowCacheKey(liveCacheKey),
                scope,
                totalHits,
            } satisfies DashboardPrewarmCandidate;
        })
        .filter((candidate): candidate is DashboardPrewarmCandidate => candidate !== null)
        .sort((left, right) => right.totalHits - left.totalHits)
        .slice(0, scopeLimit);
}

export async function acquireDashboardPrewarmLock(
    redisClient: RedisClient = getRedis(),
    ttlSeconds: number = 50,
): Promise<{ acquired: boolean; token: string }> {
    const token = randomUUID();
    const result = await redisClient.set(PREWARM_LOCK_KEY, token, 'EX', ttlSeconds, 'NX');
    return { acquired: result === 'OK', token };
}

export async function releaseDashboardPrewarmLock(
    token: string,
    redisClient: RedisClient = getRedis(),
): Promise<void> {
    const releaseScript = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
            return redis.call("del", KEYS[1])
        end
        return 0
    `;

    await redisClient.eval(releaseScript, 1, PREWARM_LOCK_KEY, token);
}

export async function refreshOverviewCacheFromShadow(
    liveCacheKey: string,
    options?: {
        redisClient?: RedisClient;
        nowMs?: number;
        maxSourceAgeMs?: number;
    },
): Promise<'warmed' | 'missing' | 'stale' | 'invalid'> {
    const redisClient = options?.redisClient ?? getRedis();
    const nowMs = options?.nowMs ?? Date.now();
    const maxSourceAgeMs = options?.maxSourceAgeMs ?? (OVERVIEW_SHADOW_CACHE_TTL_SECONDS * 1000);
    const shadowRaw = await redisClient.get(buildOverviewShadowCacheKey(liveCacheKey));

    if (!shadowRaw) {
        return 'missing';
    }

    let envelope: OverviewShadowEnvelope;
    try {
        envelope = JSON.parse(shadowRaw) as OverviewShadowEnvelope;
    } catch {
        return 'invalid';
    }

    if (!envelope?.generatedAt || typeof envelope.serializedPayload !== 'string') {
        return 'invalid';
    }

    const generatedAtMs = new Date(envelope.generatedAt).getTime();
    if (!Number.isFinite(generatedAtMs)) {
        return 'invalid';
    }

    if ((nowMs - generatedAtMs) > maxSourceAgeMs) {
        return 'stale';
    }

    await redisClient
        .multi()
        .set(liveCacheKey, envelope.serializedPayload, 'EX', OVERVIEW_CACHE_TTL_SECONDS)
        .set(buildOverviewShadowCacheKey(liveCacheKey), shadowRaw, 'EX', OVERVIEW_SHADOW_CACHE_TTL_SECONDS)
        .exec();
    return 'warmed';
}
