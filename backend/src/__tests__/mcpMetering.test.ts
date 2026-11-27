/**
 * Allowance rules, the metering gate and the Postgres sign-in store, in
 * isolation: in-process Postgres, in-memory Redis, and a Redis that fails.
 */
import RedisMock from 'ioredis-mock';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mcpCallLog, mcpOAuthRecords, mcpUsagePeriods } from '../db/schema.js';
import { FREE_TIER_MCP_CREDITS, mcpRateLimitPerMinute, resolveAllowance } from '../mcp/allowance.js';
import type { McpTeamBilling } from '../mcp/allowance.js';
import type { McpContext } from '../mcp/context.js';
import { McpToolError } from '../mcp/errors.js';
import { createKillSwitches, createMetering } from '../mcp/metering.js';
import type { MeteringRedis } from '../mcp/metering.js';
import { OAuthRecordConflictError } from '../mcp/oauth/store.js';
import { PostgresOAuthStore } from '../mcp/oauth/pgStore.js';
import { PGLITE_SEED, PGLITE_START_TIMEOUT_MS, createPgliteHarness } from './helpers/pgliteHarness.js';
import type { PgliteHarness } from './helpers/pgliteHarness.js';

const NOW = new Date('2026-11-20T12:00:00Z');
const { teamA, userA } = PGLITE_SEED;

function team(overrides: Partial<McpTeamBilling> = {}): McpTeamBilling {
    return {
        teamId: teamA.id,
        ownerUserId: userA.id,
        hasSubscription: false,
        creditLimit: 300,
        limitsSyncedAt: NOW,
        planName: 'free',
        billingCycleAnchor: null,
        stripePeriodStart: null,
        stripePeriodEnd: null,
        paymentFailedAt: null,
        ...overrides,
    };
}

describe('allowance rules', () => {
    it('free teams share one allowance per owner, per UTC calendar month', () => {
        const allowance = resolveAllowance(team(), NOW);
        expect(allowance).toMatchObject({ scopeKey: `owner:${userA.id}`, period: '2026-11', creditLimit: 300, perMinute: 10, paymentFailed: false });
        expect(allowance.periodStart.toISOString()).toBe('2026-11-01T00:00:00.000Z');
        expect(allowance.periodEnd.toISOString()).toBe('2026-12-01T00:00:00.000Z');
    });

    it('paid teams have their own allowance per Stripe period, or 30-day cycles from the anchor', () => {
        const stripe = resolveAllowance(team({ hasSubscription: true, creditLimit: 6000, planName: 'growth', stripePeriodStart: new Date('2026-11-14T08:00:00Z'), stripePeriodEnd: new Date('2026-12-14T08:00:00Z') }), NOW);
        expect(stripe).toMatchObject({ scopeKey: `team:${teamA.id}`, period: '2026-11-14', creditLimit: 6000, perMinute: 30 });
        const anchored = resolveAllowance(team({ hasSubscription: true, billingCycleAnchor: new Date('2026-10-01T00:00:00Z') }), NOW);
        expect(anchored.periodStart.toISOString()).toBe('2026-10-31T00:00:00.000Z');
        expect(anchored.periodEnd.toISOString()).toBe('2026-11-30T00:00:00.000Z');
    });

    it('an unsynced free team gets the free allowance; an unsynced paid team is not blocked; a failed payment is flagged', () => {
        expect(resolveAllowance(team({ limitsSyncedAt: null, creditLimit: null }), NOW).creditLimit).toBe(FREE_TIER_MCP_CREDITS);
        expect(resolveAllowance(team({ hasSubscription: true, limitsSyncedAt: null, creditLimit: null }), NOW).creditLimit).toBeNull();
        expect(resolveAllowance(team({ hasSubscription: true, paymentFailedAt: NOW }), NOW).paymentFailed).toBe(true);
    });

    it('calls per minute grow with the plan', () => {
        expect([300, 2000, 6000, 20000, 75000, null].map(mcpRateLimitPerMinute)).toEqual([10, 20, 30, 60, 120, 120]);
    });
});

let pg: PgliteHarness;
beforeAll(async () => {
    pg = await createPgliteHarness();
}, PGLITE_START_TIMEOUT_MS);
afterAll(async () => {
    await pg?.close();
});

function ctx(overrides: Partial<McpTeamBilling> = {}, userId: string = userA.id): McpContext {
    return {
        requestId: 'req_test',
        userId,
        grantId: 'grant-test',
        teamId: teamA.id,
        allowedProjectIds: [teamA.projectId],
        scopes: [],
        maskIdentifiers: false,
        allowance: resolveAllowance(team(overrides), new Date()),
    };
}

async function expectCode(promise: Promise<unknown>, code: string) {
    await expect(promise).rejects.toSatisfy((error: unknown) => error instanceof McpToolError && error.code === code);
}

describe('metering gate', () => {
    let redis: InstanceType<typeof RedisMock>;
    beforeEach(async () => {
        redis = new RedisMock();
        await redis.flushall();
        await pg.db.delete(mcpUsagePeriods);
    });

    it('reserves credits up to the limit, gives them back when a call fails, and never overshoots in parallel', async () => {
        const metering = createMetering({ db: pg.db, redis: redis as unknown as MeteringRedis, dashboardBaseUrl: 'https://d.test', maxConcurrentPerUser: 100 });
        const c = ctx({ creditLimit: 10 }, '00000000-0000-4000-8000-00000000f002');
        // This test is about credits, not the per-minute limit.
        c.allowance!.perMinute = 1000;
        const failed = await metering.gate.admit(c, { name: 'get_session_context', credits: 3 });
        await failed({ ok: false });
        // Ten parallel 1-credit calls plus five more: exactly ten get through.
        const attempts = await Promise.allSettled(Array.from({ length: 15 }, () => metering.gate.admit(c, { name: 'get_issue', credits: 1 })));
        expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(10);
        const refused = attempts.find((attempt) => attempt.status === 'rejected') as PromiseRejectedResult;
        expect(refused.reason).toMatchObject({ code: 'limit_reached' });
        expect(refused.reason.publicMessage).toContain('https://d.test/dashboard/billing');
        // Free tools still pass at the limit.
        await expect(metering.gate.admit(c, { name: 'get_usage', credits: 0 })).resolves.toBeTypeOf('function');
        expect((await metering.usage.getUsage(c)).creditsUsed).toBe(10);
    });

    it('limits calls per minute and calls at once, per person', async () => {
        const metering = createMetering({ db: pg.db, redis: redis as unknown as MeteringRedis, dashboardBaseUrl: 'https://d.test' });
        const c = ctx({ creditLimit: null });
        const held = await Promise.all(Array.from({ length: 4 }, () => metering.gate.admit(c, { name: 'list_projects', credits: 0 })));
        await expectCode(metering.gate.admit(c, { name: 'list_projects', credits: 0 }), 'busy');
        await held[0]({ ok: true });
        const again = await metering.gate.admit(c, { name: 'list_projects', credits: 0 });
        await Promise.all([again, ...held.slice(1)].map((release) => release({ ok: true })));

        const free = ctx({ creditLimit: 300 }, '00000000-0000-4000-8000-00000000f001');
        for (let call = 0; call < 10; call += 1) await (await metering.gate.admit(free, { name: 'list_projects', credits: 0 }))({ ok: true });
        const limited = metering.gate.admit(free, { name: 'list_projects', credits: 0 });
        await expect(limited).rejects.toMatchObject({ code: 'rate_limited', retryAfterSeconds: expect.any(Number) });
    });

    it('refuses calls that cost credits after a failed payment, but not the free ones', async () => {
        const metering = createMetering({ db: pg.db, redis: redis as unknown as MeteringRedis, dashboardBaseUrl: 'https://d.test' });
        const c = ctx({ hasSubscription: true, creditLimit: 2000, paymentFailedAt: new Date() });
        await expectCode(metering.gate.admit(c, { name: 'get_issue', credits: 1 }), 'limit_reached');
        await expect(metering.gate.admit(c, { name: 'get_usage', credits: 0 })).resolves.toBeTypeOf('function');
    });

    it('with Redis down, checks the allowance in Postgres; with both down, refuses rather than allows', async () => {
        const broken: MeteringRedis = {
            eval: async () => { throw new Error('redis down'); },
            get: async () => { throw new Error('redis down'); },
            set: async () => { throw new Error('redis down'); },
            incr: async () => { throw new Error('redis down'); },
            decr: async () => { throw new Error('redis down'); },
            decrby: async () => { throw new Error('redis down'); },
            expire: async () => { throw new Error('redis down'); },
        };
        const errors: string[] = [];
        const metering = createMetering({ db: pg.db, redis: broken, dashboardBaseUrl: 'https://d.test', onError: (_error, where) => errors.push(where) });
        const c = ctx({ creditLimit: 5 });
        await pg.db.insert(mcpUsagePeriods).values({ scopeKey: c.allowance!.scopeKey, period: c.allowance!.period, credits: 4, calls: 4, bytes: 0 });
        await expect(metering.gate.admit(c, { name: 'get_issue', credits: 1 })).resolves.toBeTypeOf('function');
        await expectCode(metering.gate.admit(c, { name: 'get_session_context', credits: 3 }), 'limit_reached');
        expect(errors).toContain('reserve.redis');

        const deadDb = { select: () => { throw new Error('db down'); } } as unknown as typeof pg.db;
        const neither = createMetering({ db: deadDb, redis: broken, dashboardBaseUrl: 'https://d.test' });
        await expectCode(neither.gate.admit(c, { name: 'get_issue', credits: 1 }), 'busy');
    });

    it('records each call: one log row, the period total, nothing for failed calls', async () => {
        const metering = createMetering({ db: pg.db, redis: redis as unknown as MeteringRedis, dashboardBaseUrl: 'https://d.test' });
        const c = ctx();
        const base = { requestId: 'r', grantId: 'grant-test', teamId: teamA.id, userId: userA.id, durationMs: 12, scopeKey: c.allowance!.scopeKey, period: c.allowance!.period };
        metering.usage.recordCall!({ ...base, tool: 'get_issue', credits: 1, bytes: 500, outcome: 'ok' });
        metering.usage.recordCall!({ ...base, tool: 'get_issue', credits: 0, bytes: 0, outcome: 'internal' });
        metering.usage.recordCall!({ ...base, tool: 'get_session_context', credits: 3, bytes: 9000, outcome: 'ok' });
        await metering.flush();
        const [period] = await pg.db.select().from(mcpUsagePeriods).where(and(eq(mcpUsagePeriods.scopeKey, base.scopeKey), eq(mcpUsagePeriods.period, base.period)));
        expect(period).toMatchObject({ credits: 4, calls: 2, bytes: 9500 });
        const rows = await pg.db.select({ tool: mcpCallLog.tool, outcome: mcpCallLog.outcome, credits: mcpCallLog.credits }).from(mcpCallLog).where(eq(mcpCallLog.grantId, 'grant-test'));
        expect(rows.map((row) => [row.tool, row.outcome, row.credits])).toEqual(expect.arrayContaining([
            ['get_issue', 'ok', 1], ['get_issue', 'internal', 0], ['get_session_context', 'ok', 3],
        ]));
    });
});

describe('kill switches', () => {
    it('master switch, tool list from the environment, and live switches from Redis', async () => {
        const redis = new RedisMock();
        await redis.flushall();
        const c = { teamId: teamA.id, grantId: 'g1' };
        await expectCode(createKillSwitches({ enabled: false }).check('list_projects', c), 'disabled');
        await expectCode(createKillSwitches({ enabled: true, disabledTools: ['get_session_timeline'] }).check('get_session_timeline', c), 'disabled');
        const live = createKillSwitches({ enabled: true, redis, cacheMs: 0 });
        await expect(live.check('list_projects', c)).resolves.toBeUndefined();
        for (const field of ['all', 'tool:list_projects', `team:${teamA.id}`, 'grant:g1']) {
            await redis.hset('mcp:switches', field, 'off');
            await expectCode(live.check('list_projects', c), 'disabled');
            await redis.hdel('mcp:switches', field);
        }
        await expect(live.check('list_projects', c)).resolves.toBeUndefined();
        // Redis failing keeps the last known switches rather than failing calls.
        const flaky = createKillSwitches({ enabled: true, redis: { hgetall: async () => { throw new Error('down'); } }, cacheMs: 0 });
        await expect(flaky.check('list_projects', c)).resolves.toBeUndefined();
    });
});

describe('Postgres sign-in store', () => {
    let store: PostgresOAuthStore;
    beforeEach(async () => {
        store = new PostgresOAuthStore(pg.db);
        await pg.db.delete(mcpOAuthRecords);
    });

    it('stores, finds by key and uid, consumes once, and forgets expired records', async () => {
        await store.upsert('AuthorizationCode', 'k1', { kind: 'AuthorizationCode', grantId: 'g1', uid: 'u1' }, { expiresInSeconds: 60 });
        expect(await store.find('AuthorizationCode', 'k1')).toMatchObject({ grantId: 'g1' });
        expect(await store.findByUid('AuthorizationCode', 'u1')).toMatchObject({ grantId: 'g1' });
        await store.consume('AuthorizationCode', 'k1');
        expect(await store.find('AuthorizationCode', 'k1')).toMatchObject({ consumed: expect.any(Number) });
        await expect(store.consume('AuthorizationCode', 'k1')).rejects.toBeInstanceOf(OAuthRecordConflictError);

        await store.upsert('Session', 's1', { kind: 'Session' }, { expiresInSeconds: 60 });
        await pg.db.update(mcpOAuthRecords).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(mcpOAuthRecords.key, 's1'));
        expect(await store.find('Session', 's1')).toBeUndefined();
        expect(await store.deleteExpired()).toBe(1);
    });

    it('insert-only records refuse a second write while live (replay detection)', async () => {
        await store.upsert('ReplayDetection', 'jti', { kind: 'ReplayDetection' }, { expiresInSeconds: 60, insertOnly: true });
        await expect(store.upsert('ReplayDetection', 'jti', { kind: 'ReplayDetection' }, { expiresInSeconds: 60, insertOnly: true })).rejects.toBeInstanceOf(OAuthRecordConflictError);
    });

    it('revoking a grant removes every record that belongs to it, of every model', async () => {
        await store.upsert('AccessToken', 'a', { grantId: 'g9' });
        await store.upsert('RefreshToken', 'r', { grantId: 'g9' });
        await store.upsert('AccessToken', 'other', { grantId: 'g10' });
        await store.revokeByGrantId('RefreshToken', 'g9');
        expect(await store.find('RefreshToken', 'r')).toBeUndefined();
        expect(await store.find('AccessToken', 'a')).toBeDefined();
        await store.revokeAllForGrant('g9');
        expect(await store.find('AccessToken', 'a')).toBeUndefined();
        expect(await store.find('AccessToken', 'other')).toBeDefined();
    });
});
