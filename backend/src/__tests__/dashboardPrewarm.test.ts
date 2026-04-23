import { beforeAll, describe, expect, it, vi } from 'vitest';

type DashboardPrewarmModule = typeof import('../services/dashboardPrewarm.js');

class FakePipeline {
    constructor(private readonly bucketRows: Map<string, string[]>) {}

    private readonly commands: string[] = [];

    zrange(key: string): this {
        this.commands.push(key);
        return this;
    }

    async exec(): Promise<Array<[null, string[]]>> {
        return this.commands.map((key) => [null, this.bucketRows.get(key) ?? []]);
    }
}

class FakeRedis {
    public readonly set = vi.fn(async () => 'OK');
    public readonly get = vi.fn(async (_key: string) => null as string | null);

    constructor(private readonly bucketRows: Map<string, string[]> = new Map()) {}

    pipeline(): FakePipeline {
        return new FakePipeline(this.bucketRows);
    }

    multi() {
        const redis = this;
        return {
            set(...args: Parameters<FakeRedis['set']>) {
                void redis.set(...args);
                return this;
            },
            async exec() {
                return [];
            },
        };
    }
}

let dashboardPrewarm: DashboardPrewarmModule;

beforeAll(async () => {
    process.env.DATABASE_URL ??= 'postgresql://test:test@127.0.0.1:5432/rejourney';
    process.env.JWT_SECRET ??= 'x'.repeat(32);
    process.env.INGEST_HMAC_SECRET ??= 'y'.repeat(32);
    process.env.REDIS_URL ??= 'redis://127.0.0.1:6379/0';
    dashboardPrewarm = await import('../services/dashboardPrewarm.js');
});

describe('dashboardPrewarm', () => {
    it('aggregates the hottest single-project supported scopes from recent buckets', async () => {
        const nowMs = 60000 * 2000;
        const redis = new FakeRedis(new Map([
            ['dashboard-prewarm:hits:2000', [
                'general|proj-1|30d', '4',
                'api|proj-1|30d', '2',
                'general|all|30d', '999',
            ]],
            ['dashboard-prewarm:hits:1999', [
                'general|proj-1|30d', '3',
                'geo|proj-2|7d', '5',
                'journeys|proj-9|30d', '8',
            ]],
        ]));

        const candidates = await dashboardPrewarm.collectDashboardPrewarmCandidates({
            nowMs,
            lookbackMinutes: 2,
            scopeLimit: 5,
            redisClient: redis as any,
        });

        expect(candidates).toEqual([
            {
                liveCacheKey: 'overview:general:proj-1:30d:v1',
                shadowCacheKey: 'shadow:overview:general:proj-1:30d:v1',
                scope: { scope: 'general', projectId: 'proj-1', timeRange: '30d' },
                totalHits: 7,
            },
            {
                liveCacheKey: 'overview:geo:proj-2:7d:v1',
                shadowCacheKey: 'shadow:overview:geo:proj-2:7d:v1',
                scope: { scope: 'geo', projectId: 'proj-2', timeRange: '7d' },
                totalHits: 5,
            },
            {
                liveCacheKey: 'overview:api:proj-1:30d:v1',
                shadowCacheKey: 'shadow:overview:api:proj-1:30d:v1',
                scope: { scope: 'api', projectId: 'proj-1', timeRange: '30d' },
                totalHits: 2,
            },
        ]);
    });

    it('refreshes the live cache from a fresh shadow payload', async () => {
        const redis = new FakeRedis();
        redis.get.mockResolvedValueOnce(JSON.stringify({
            generatedAt: new Date('2026-04-23T12:00:30.000Z').toISOString(),
            serializedPayload: '{"ok":true}',
        }));

        const result = await dashboardPrewarm.refreshOverviewCacheFromShadow('overview:general:proj-1:30d:v1', {
            nowMs: new Date('2026-04-23T12:01:00.000Z').getTime(),
            redisClient: redis as any,
        });

        expect(result).toBe('warmed');
        expect(redis.set).toHaveBeenCalledWith('overview:general:proj-1:30d:v1', '{"ok":true}', 'EX', 60);
    });

    it('skips stale shadow payloads instead of extending them indefinitely', async () => {
        const redis = new FakeRedis();
        redis.get.mockResolvedValueOnce(JSON.stringify({
            generatedAt: new Date('2026-04-23T11:50:00.000Z').toISOString(),
            serializedPayload: '{"ok":true}',
        }));

        const result = await dashboardPrewarm.refreshOverviewCacheFromShadow('overview:general:proj-1:30d:v1', {
            nowMs: new Date('2026-04-23T12:01:00.000Z').getTime(),
            redisClient: redis as any,
        });

        expect(result).toBe('stale');
        expect(redis.set).not.toHaveBeenCalled();
    });
});
