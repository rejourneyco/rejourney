import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
    dbSelectMock,
    pingWorkerMock,
    redisEvalMock,
    redisGetMock,
    redisSetMock,
} = vi.hoisted(() => ({
    dbSelectMock: vi.fn(),
    pingWorkerMock: vi.fn(async () => undefined),
    redisEvalMock: vi.fn(async () => 1),
    redisGetMock: vi.fn(async (): Promise<string | null> => new Date().toISOString()),
    redisSetMock: vi.fn(async (): Promise<string | null> => 'OK'),
}));

vi.mock('drizzle-orm', () => ({
    and: vi.fn(),
    eq: vi.fn(),
    gte: vi.fn(),
    lte: vi.fn(),
}));

vi.mock('../db/client.js', () => ({
    db: { select: dbSelectMock },
    sessionMetrics: {},
    sessions: {},
}));

vi.mock('../db/redis.js', () => ({
    getRedis: () => ({
        eval: redisEvalMock,
        get: redisGetMock,
        set: redisSetMock,
    }),
}));

vi.mock('../logger.js', () => ({
    logger: {
        debug: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
    },
}));

vi.mock('../services/monitoring.js', () => ({
    pingWorker: pingWorkerMock,
}));

vi.mock('../services/clickhouseProductRollupsSink.js', () => ({
    writeProductAnalyticsDailyRollupInputToClickHouse: vi.fn(),
}));

vi.mock('../services/productRollupsClickHouse.js', () => ({
    queryProductDailyUniqueUserCountFromClickHouse: vi.fn(),
}));

import {
    backfillDailyStats,
    resolveStatsAggregationLeaseTtlMs,
    runDailyRollup,
    runStatsAggregation,
    startBackfillDailyStats,
    startStatsAggregationJob,
    stopStatsAggregationJob,
} from '../jobs/statsAggregator.js';

describe('stats aggregation distributed lease', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        dbSelectMock.mockReset();
        redisSetMock.mockResolvedValue('OK');
        redisGetMock.mockResolvedValue(new Date().toISOString());
        redisEvalMock.mockResolvedValue(1);
    });

    afterEach(() => {
        stopStatsAggregationJob();
        vi.useRealTimers();
    });

    it('bounds the configured lease TTL', () => {
        expect(resolveStatsAggregationLeaseTtlMs('bad')).toBe(15 * 60_000);
        expect(resolveStatsAggregationLeaseTtlMs('100')).toBe(60_000);
        expect(resolveStatsAggregationLeaseTtlMs(String(24 * 60 * 60_000))).toBe(6 * 60 * 60_000);
    });

    it('skips all rollup work when another replica owns the lease', async () => {
        redisSetMock.mockResolvedValue(null);

        await runStatsAggregation();

        expect(redisSetMock).toHaveBeenCalledWith(
            'lock:stats-aggregation',
            expect.any(String),
            'PX',
            15 * 60_000,
            'NX',
        );
        expect(redisGetMock).not.toHaveBeenCalled();
        expect(dbSelectMock).not.toHaveBeenCalled();
        expect(pingWorkerMock).not.toHaveBeenCalled();
    });

    it('checks the daily watermark and token-safely releases an acquired lease', async () => {
        await runStatsAggregation();

        expect(redisGetMock).toHaveBeenCalledWith('stats:daily_rollup:last_run');
        expect(pingWorkerMock).toHaveBeenCalledWith(
            'statsAggregator',
            'up',
            expect.stringMatching(/^duration=\d+ms$/),
        );
        expect(redisEvalMock).toHaveBeenCalledWith(
            expect.stringContaining("redis.call('del'"),
            1,
            'lock:stats-aggregation',
            expect.any(String),
        );
    });

    it('keeps historic manual runs from overwriting scheduler watermarks', async () => {
        dbSelectMock.mockImplementationOnce(() => ({
            from: vi.fn(() => ({
                where: vi.fn(() => ({
                    groupBy: vi.fn(async () => []),
                })),
            })),
        }));

        await expect(runDailyRollup(new Date('2026-01-15T00:00:00.000Z'))).resolves.toBe('completed');

        expect(redisSetMock).toHaveBeenCalledWith(
            'lock:stats-aggregation',
            expect.any(String),
            'PX',
            15 * 60_000,
            'NX',
        );
        expect(redisSetMock).not.toHaveBeenCalledWith(
            'stats:daily_rollup:last_run',
            expect.any(String),
        );
        expect(redisSetMock).not.toHaveBeenCalledWith(
            'stats:daily_rollup:last_rolled_up_date',
            expect.any(String),
        );
        expect((redisEvalMock.mock.calls as unknown[][]).some((call) => (
            String(call[0]).includes("redis.call('set', KEYS[2]")
        ))).toBe(false);
    });

    it('writes scheduler watermarks for a guarded default-yesterday run', async () => {
        dbSelectMock.mockImplementationOnce(() => ({
            from: vi.fn(() => ({
                where: vi.fn(() => ({
                    groupBy: vi.fn(async () => []),
                })),
            })),
        }));

        await expect(runDailyRollup()).resolves.toBe('completed');

        expect(redisEvalMock).toHaveBeenCalledWith(
            expect.stringContaining("redis.call('set', KEYS[2]"),
            3,
            'lock:stats-aggregation',
            'stats:daily_rollup:last_run',
            'stats:daily_rollup:last_rolled_up_date',
            expect.any(String),
            expect.any(String),
            expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        );
    });

    it('does not report completion when the atomic watermark ownership check fails', async () => {
        dbSelectMock.mockImplementationOnce(() => ({
            from: vi.fn(() => ({
                where: vi.fn(() => ({
                    groupBy: vi.fn(async () => []),
                })),
            })),
        }));
        redisEvalMock.mockResolvedValueOnce(0);

        await expect(runDailyRollup()).resolves.toBe('lease_lost');

        expect(redisEvalMock).toHaveBeenCalledWith(
            expect.stringContaining("redis.call('get', KEYS[1])"),
            3,
            'lock:stats-aggregation',
            'stats:daily_rollup:last_run',
            'stats:daily_rollup:last_rolled_up_date',
            expect.any(String),
            expect.any(String),
            expect.any(String),
        );
    });

    it('acquires the shared lease before acknowledging a backfill and rejects a contender', async () => {
        let finishFirstDay: (() => void) | undefined;
        const firstDayGate = new Promise<void>((resolve) => {
            finishFirstDay = resolve;
        });
        let lookupCount = 0;
        dbSelectMock.mockImplementation(() => ({
            from: vi.fn(() => ({
                where: vi.fn(() => ({
                    groupBy: vi.fn(async () => {
                        lookupCount += 1;
                        if (lookupCount === 1) await firstDayGate;
                        return [];
                    }),
                })),
            })),
        }));
        redisSetMock
            .mockResolvedValueOnce('OK')
            .mockResolvedValueOnce(null);

        await expect(startBackfillDailyStats(2)).resolves.toBe('started');
        expect(lookupCount).toBe(1);
        await expect(runDailyRollup(new Date('2026-01-15T00:00:00.000Z'))).resolves.toBe('busy');

        finishFirstDay?.();
        await vi.waitFor(() => {
            expect(lookupCount).toBe(2);
            expect(redisEvalMock).toHaveBeenCalledWith(
                expect.stringContaining("redis.call('del'"),
                1,
                'lock:stats-aggregation',
                expect.any(String),
            );
        });
        expect(redisSetMock).not.toHaveBeenCalledWith(
            'stats:daily_rollup:last_rolled_up_date',
            expect.any(String),
        );
        expect((redisEvalMock.mock.calls as unknown[][]).some((call) => (
            String(call[0]).includes("redis.call('set', KEYS[2]")
        ))).toBe(false);
    });

    it('stops a backfill before the next day after its lease signal aborts', async () => {
        const controller = new AbortController();
        let lookupCount = 0;
        dbSelectMock.mockImplementation(() => ({
            from: vi.fn(() => ({
                where: vi.fn(() => ({
                    groupBy: vi.fn(async () => {
                        lookupCount += 1;
                        controller.abort();
                        return [];
                    }),
                })),
            })),
        }));

        await expect(backfillDailyStats(3, controller.signal)).resolves.toBe(false);
        expect(lookupCount).toBe(1);
        expect(redisSetMock).not.toHaveBeenCalledWith(
            'stats:daily_rollup:last_rolled_up_date',
            expect.any(String),
        );
    });

    it('finishes the active project batch but starts no later batch after owner replacement', async () => {
        vi.useFakeTimers();
        const previousLeaseTtl = process.env.RJ_STATS_AGGREGATION_LEASE_TTL_MS;
        process.env.RJ_STATS_AGGREGATION_LEASE_TTL_MS = '60000';
        redisGetMock.mockResolvedValue(null);
        redisEvalMock.mockResolvedValue(0);

        const projectIds = Array.from({ length: 11 }, (_, index) => ({ projectId: `project-${index}` }));
        let finishFirstBatch: (() => void) | undefined;
        const firstBatchGate = new Promise<void>((resolve) => {
            finishFirstBatch = resolve;
        });
        dbSelectMock
            .mockImplementationOnce(() => ({
                from: vi.fn(() => ({
                    where: vi.fn(() => ({
                        groupBy: vi.fn(async () => projectIds),
                    })),
                })),
            }))
            .mockImplementation(() => ({
                from: vi.fn(() => ({
                    leftJoin: vi.fn(() => ({
                        where: vi.fn(() => firstBatchGate.then(() => [])),
                    })),
                })),
            }));

        try {
            const aggregation = runStatsAggregation();
            await vi.waitFor(() => {
                expect(dbSelectMock).toHaveBeenCalledTimes(11);
            });

            await vi.advanceTimersByTimeAsync(20_000);
            finishFirstBatch?.();
            await aggregation;

            expect(dbSelectMock).toHaveBeenCalledTimes(11);
            expect(redisSetMock).toHaveBeenCalledTimes(1);
            expect(pingWorkerMock).not.toHaveBeenCalled();
            expect(redisEvalMock).toHaveBeenCalledWith(
                expect.stringContaining("redis.call('pexpire'"),
                1,
                'lock:stats-aggregation',
                expect.any(String),
                '60000',
            );
        } finally {
            if (previousLeaseTtl === undefined) {
                delete process.env.RJ_STATS_AGGREGATION_LEASE_TTL_MS;
            } else {
                process.env.RJ_STATS_AGGREGATION_LEASE_TTL_MS = previousLeaseTtl;
            }
        }
    });

    it('cancels the delayed startup run and permits one clean restart', async () => {
        vi.useFakeTimers();
        startStatsAggregationJob();
        stopStatsAggregationJob();

        await vi.advanceTimersByTimeAsync(10_000);
        expect(redisSetMock).not.toHaveBeenCalled();

        startStatsAggregationJob();
        await vi.advanceTimersByTimeAsync(10_000);
        expect(redisSetMock).toHaveBeenCalledTimes(1);
    });
});
