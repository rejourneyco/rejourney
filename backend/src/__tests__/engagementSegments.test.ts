import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

const { executed, scrubbedDays, chCommands, redisStore } = vi.hoisted(() => ({
    executed: [] as unknown[],
    scrubbedDays: [] as { day: string }[],
    chCommands: [] as { query: string; query_params: Record<string, unknown> }[],
    redisStore: new Map<string, string>(),
}));

vi.mock('../db/client.js', async () => {
    const schema = await vi.importActual<typeof import('../db/schema.js')>('../db/schema.js');
    const chain: any = {};
    chain.select = () => chain;
    chain.from = () => chain;
    chain.where = () => chain;
    chain.groupBy = async () => scrubbedDays;
    return {
        ...schema,
        db: {
            ...chain,
            execute: async (query: unknown) => {
                executed.push(query);
                return { rows: [
                    { day: '2026-10-29', bouncers: 1, casuals: 2, explorers: 3, loyalists: 4 },
                    { day: '2026-10-30', bouncers: 5, casuals: 6, explorers: 7, loyalists: 8 },
                ] };
            },
        },
    };
});
vi.mock('../db/redis.js', () => ({
    getRedis: () => ({
        get: async (key: string) => redisStore.get(key) ?? null,
        set: async (key: string, value: string) => { redisStore.set(key, value); return 'OK'; },
    }),
}));
vi.mock('../db/clickhouse.js', () => ({
    isClickHouseConfigured: () => true,
    getClickHouseClient: () => ({
        query: async () => ({ json: async () => [{ projectId: 'p1', firstDate: '2026-10-29' }] }),
        command: async (input: { query: string; query_params: Record<string, unknown> }) => { chCommands.push(input); },
    }),
}));

import { gradeEngagementByDay, gradeUserDay } from '../services/engagementSegments.js';
import { ENGAGEMENT_GRADING_VERSION, regradeEngagementRollups } from '../services/engagementRollupRegrade.js';

const facts = (overrides: Partial<Parameters<typeof gradeUserDay>[0]>) => ({
    activeDays: 1, engagedDays: 1, daysSinceFirstEngaged: 0, daySeconds: 30, ...overrides,
});

describe('retention-based engagement grading', () => {
    beforeEach(() => {
        executed.length = 0;
        scrubbedDays.length = 0;
        chCommands.length = 0;
        redisStore.clear();
    });

    it('grades by retention before session length', () => {
        // No engaged session in 28 days: a bouncer even after returning.
        expect(gradeUserDay(facts({ activeDays: 3, engagedDays: 0, daysSinceFirstEngaged: null, daySeconds: 4 }))).toBe('bouncers');
        // Weekly habit across two weeks: loyal even on a brief visit today.
        expect(gradeUserDay(facts({ activeDays: 5, engagedDays: 4, daysSinceFirstEngaged: 7, daySeconds: 3 }))).toBe('loyalists');
        // Four days in a row is a burst, not yet a habit.
        expect(gradeUserDay(facts({ activeDays: 4, engagedDays: 4, daysSinceFirstEngaged: 3 }))).toBe('explorers');
        // Returned on another day, or a deep first visit: exploring.
        expect(gradeUserDay(facts({ activeDays: 2 }))).toBe('explorers');
        expect(gradeUserDay(facts({ daySeconds: 180 }))).toBe('explorers');
        // One engaged, light visit.
        expect(gradeUserDay(facts({}))).toBe('casuals');
    });

    it('grades each user-day over a trailing 28-day window keyed by visitor identity', async () => {
        const days = await gradeEngagementByDay({ projectIds: ['p1'], fromDate: '2026-10-29', toDate: '2026-10-30' });
        expect(days).toEqual([
            { date: '2026-10-29', bouncers: 1, casuals: 2, explorers: 3, loyalists: 4 },
            { date: '2026-10-30', bouncers: 5, casuals: 6, explorers: 7, loyalists: 8 },
        ]);
        const { sql, params } = new PgDialect().sqlToQuery(executed[0] as any);
        expect(sql).toContain('RANGE BETWEEN 27 PRECEDING AND CURRENT ROW');
        expect(sql).toContain("::date - 27)");
        expect(sql).toContain('PARTITION BY project_id, user_key');
        expect(sql).toContain("coalesce(nullif(trim(device_id), '')");
        expect(sql).not.toMatch(/\bs\./);
        expect(params).toEqual(expect.arrayContaining(['p1', '2026-10-29', '2026-10-30', 10, 2, 4, 7, 180]));
    });

    it('regrades stored rollups once, skipping identity-scrubbed days', async () => {
        scrubbedDays.push({ day: '2026-10-29' });
        await expect(regradeEngagementRollups({ signal: new AbortController().signal, throughDate: '2026-10-30' })).resolves.toBe(true);
        expect(chCommands).toHaveLength(1);
        expect(chCommands[0].query).toContain('FROM app_daily_rollups FINAL');
        expect(chCommands[0].query).toContain('updated_at + toIntervalMillisecond(1)');
        expect(chCommands[0].query_params).toMatchObject({
            projectId: 'p1', dates: ['2026-10-30'], bouncers: [5], casuals: [6], explorers: [7], loyalists: [8],
        });
        expect(redisStore.has(`stats:engagement-grading:${ENGAGEMENT_GRADING_VERSION}`)).toBe(true);

        // Finished: later passes do nothing.
        await regradeEngagementRollups({ signal: new AbortController().signal, throughDate: '2026-10-30' });
        expect(chCommands).toHaveLength(1);
    });

    it('stops without marking progress when the lease is lost', async () => {
        const controller = new AbortController();
        controller.abort();
        await expect(regradeEngagementRollups({ signal: controller.signal, throughDate: '2026-10-30' })).resolves.toBe(false);
        expect(chCommands).toHaveLength(0);
        expect(redisStore.size).toBe(0);
    });
});
