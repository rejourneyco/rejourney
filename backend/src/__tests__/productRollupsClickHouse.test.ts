import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    isConfigured: vi.fn(() => true),
    isProductReadsEnabled: vi.fn(() => true),
    isProductWritesEnabled: vi.fn(() => true),
    query: vi.fn(),
    insert: vi.fn(),
}));

vi.mock('../db/clickhouse.js', () => ({
    getClickHouseClient: () => ({ query: mocks.query, insert: mocks.insert }),
    isClickHouseConfigured: mocks.isConfigured,
    isClickHouseProductRollupsReadsEnabled: mocks.isProductReadsEnabled,
    isClickHouseProductRollupsWritesEnabled: mocks.isProductWritesEnabled,
}));

import {
    buildClickHouseProductAnalyticsDailyRollupRows,
    buildClickHouseScreenHeatmapDailyRollupRows,
    hasClickHouseDeviceUsageDailyRollupValue,
    writeProductAnalyticsDailyRollupToClickHouse,
} from '../services/clickhouseProductRollupsSink.js';
import {
    queryDeviceUsageDailyRollupsFromClickHouse,
    queryProductDailyStatsFromClickHouse,
    queryScreenTouchHeatmapsFromClickHouse,
} from '../services/productRollupsClickHouse.js';

describe('ClickHouse product analytics rollups', () => {
    beforeEach(() => {
        mocks.isConfigured.mockReturnValue(true);
        mocks.isProductReadsEnabled.mockReturnValue(true);
        mocks.isProductWritesEnabled.mockReturnValue(true);
        mocks.query.mockReset();
        mocks.insert.mockReset();
        mocks.insert.mockResolvedValue(undefined);
    });

    it('builds daily rollup rows without durable user or session identity fields', () => {
        const rows = buildClickHouseProductAnalyticsDailyRollupRows({
            projectId: '3f4f7d8a-7660-4a78-b944-442051c62eca',
            date: '2026-05-21',
            totalSessions: 12,
            completedSessions: 10,
            totalErrors: 2,
            uniqueUserCount: 7,
            deviceModelBreakdown: { 'iPhone 17': 5 },
            screenViewBreakdown: {
                'https://shop.example.com/users/123?email=person@example.com': 4,
            },
            screenTransitionBreakdown: {
                '/users/123\u2192/orders/550e8400-e29b-41d4-a716-446655440000': 3,
            },
            customEventBreakdown: { 'Checkout Submitted': 2 },
            source: 'test',
            updatedAt: new Date('2026-05-21T12:00:00.000Z'),
        } as any);

        const serialized = JSON.stringify(rows);
        expect(serialized).not.toContain('session_id');
        expect(serialized).not.toContain('device_id');
        expect(serialized).not.toContain('anonymous');
        expect(serialized).not.toContain('uniqueUserIds');
        expect(serialized).not.toContain('person@example.com');
        expect(rows.dailyRow).toMatchObject({
            project_id: '3f4f7d8a-7660-4a78-b944-442051c62eca',
            date: '2026-05-21',
            total_sessions: '12',
            unique_user_count: '7',
        });
        expect(rows.dimensionRows.map((row) => row.dimension_value)).toContain('/users/:id');
        expect(rows.dimensionRows.map((row) => row.dimension_value)).toContain('/users/:id\u2192/orders/:id');
    });

    it('builds heatmap bucket rows without sample session identity', () => {
        const rows = buildClickHouseScreenHeatmapDailyRollupRows({
            projectId: '3f4f7d8a-7660-4a78-b944-442051c62eca',
            date: '2026-05-21',
            screenName: '/products/123?token=secret',
            touchBuckets: { '0.10,0.20': 3 },
            rageTapBuckets: { '0.10,0.20': 1 },
            screenFirstSeenMs: 1780000000000,
            viewportWidth: 390,
            viewportHeight: 844,
        });

        expect(rows).toHaveLength(2);
        expect(JSON.stringify(rows)).not.toContain('sample_session');
        expect(JSON.stringify(rows)).not.toContain('sess_');
        expect(rows[0]).toMatchObject({
            screen_name: '/products/:id',
            bucket_x: 10,
            bucket_y: 20,
            bucket_count: '3',
        });
    });

    it('marks all-zero device usage rows as skippable', () => {
        expect(hasClickHouseDeviceUsageDailyRollupValue({
            project_id: '3f4f7d8a-7660-4a78-b944-442051c62eca',
            period: '2026-05-21',
            bytes_uploaded: '0',
            minutes_recorded: '0',
            sessions_started: '0',
            request_count: '0',
            source: 'test',
            schema_version: 1,
            updated_at: '2026-05-21 12:00:00.000',
        })).toBe(false);

        expect(hasClickHouseDeviceUsageDailyRollupValue({
            project_id: '3f4f7d8a-7660-4a78-b944-442051c62eca',
            period: '2026-05-21',
            bytes_uploaded: '1',
            minutes_recorded: '0',
            sessions_started: '0',
            request_count: '0',
            source: 'test',
            schema_version: 1,
            updated_at: '2026-05-21 12:00:00.000',
        })).toBe(true);
    });

    it('writes daily rows to the new ClickHouse rollup tables', async () => {
        const rows = buildClickHouseProductAnalyticsDailyRollupRows({
            projectId: '3f4f7d8a-7660-4a78-b944-442051c62eca',
            date: '2026-05-21',
            totalSessions: 1,
            platformBreakdown: { ios: 1 },
        });

        await writeProductAnalyticsDailyRollupToClickHouse(rows);

        expect(mocks.insert).toHaveBeenCalledTimes(2);
        expect(mocks.insert.mock.calls[0]?.[0].table).toBe('app_daily_rollups');
        expect(mocks.insert.mock.calls[1]?.[0].table).toBe('app_dimension_daily_rollups');
    });

    it('reads daily stats with dashboard-compatible breakdown fields', async () => {
        mocks.query
            .mockResolvedValueOnce({
                json: async () => [{
                    projectId: '3f4f7d8a-7660-4a78-b944-442051c62eca',
                    date: '2026-05-21',
                    totalSessions: '12',
                    completedSessions: '10',
                    avgDurationSeconds: 42,
                    avgInteractionScore: null,
                    avgUxScore: 91,
                    avgApiErrorRate: 0.01,
                    avgApiResponseMs: 120,
                    p50Duration: 30,
                    p90Duration: 80,
                    p50InteractionScore: null,
                    p90InteractionScore: null,
                    totalErrors: '2',
                    totalRageTaps: '1',
                    totalDeadTaps: '0',
                    totalCrashes: '1',
                    totalAnrs: '0',
                    totalBouncers: '3',
                    totalCasuals: '4',
                    totalExplorers: '3',
                    totalLoyalists: '2',
                    totalTouches: '44',
                    totalScrolls: '12',
                    totalGestures: '2',
                    totalInteractions: '60',
                    uniqueUserCount: '7',
                }],
            })
            .mockResolvedValueOnce({
                json: async () => [{
                    projectId: '3f4f7d8a-7660-4a78-b944-442051c62eca',
                    date: '2026-05-21',
                    dimensionType: 'platform',
                    dimensionValue: 'ios',
                    count: '12',
                }],
            });

        const rows = await queryProductDailyStatsFromClickHouse({
            projectIds: ['3f4f7d8a-7660-4a78-b944-442051c62eca'],
            startDate: '2026-05-01',
            endDate: '2026-05-31',
        });

        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            totalSessions: 12,
            completedSessions: 10,
            platformBreakdown: { ios: 12 },
        });
        expect(mocks.query.mock.calls[0]?.[0].query).toContain('FROM app_daily_rollups');
        expect(mocks.query.mock.calls[0]?.[0].query).toContain('date AS rollupDate');
        expect(mocks.query.mock.calls[0]?.[0].query).toContain('toString(rollupDate) AS date');
        expect(mocks.query.mock.calls[0]?.[0].query).not.toContain('toString(date) AS date');
        expect(mocks.query.mock.calls[1]?.[0].query).toContain('FROM app_dimension_daily_rollups');
        expect(mocks.query.mock.calls[1]?.[0].query).toContain('date AS rollupDate');
        expect(mocks.query.mock.calls[1]?.[0].query).toContain('toString(rollupDate) AS date');
        expect(mocks.query.mock.calls[1]?.[0].query).not.toContain('toString(date) AS date');
    });

    it('reads device usage with a Date-safe period alias', async () => {
        mocks.query.mockResolvedValueOnce({
            json: async () => [{
                projectId: '3f4f7d8a-7660-4a78-b944-442051c62eca',
                period: '2026-05-21',
                bytesUploaded: '1024',
                minutesRecorded: '8',
                sessionsStarted: '2',
                requestCount: '4',
            }],
        });

        const rows = await queryDeviceUsageDailyRollupsFromClickHouse({
            projectIds: ['3f4f7d8a-7660-4a78-b944-442051c62eca'],
            endDate: '2026-05-31',
        });

        expect(rows).toEqual([{
            projectId: '3f4f7d8a-7660-4a78-b944-442051c62eca',
            period: '2026-05-21',
            bytesUploaded: 1024,
            minutesRecorded: 8,
            sessionsStarted: 2,
            requestCount: 4,
        }]);
        expect(mocks.query.mock.calls[0]?.[0].query).toContain('period AS rollupPeriod');
        expect(mocks.query.mock.calls[0]?.[0].query).toContain('toString(rollupPeriod) AS period');
        expect(mocks.query.mock.calls[0]?.[0].query).not.toContain('toString(period) AS period');
    });

    it('reads heatmaps with null sampleSessionId for replay-safe aggregates', async () => {
        mocks.query.mockResolvedValueOnce({
            json: async () => [{
                projectId: '3f4f7d8a-7660-4a78-b944-442051c62eca',
                screenName: '/products/:id',
                eventKind: 'touch',
                bucketX: 10,
                bucketY: 20,
                count: '3',
                screenFirstSeenMs: '1780000000000',
                pageWidth: 0,
                pageHeight: 0,
                viewportWidth: 390,
                viewportHeight: 844,
            }],
        });

        const rows = await queryScreenTouchHeatmapsFromClickHouse({
            projectIds: ['3f4f7d8a-7660-4a78-b944-442051c62eca'],
        });

        expect(rows).toEqual([{
            projectId: '3f4f7d8a-7660-4a78-b944-442051c62eca',
            screenName: '/products/:id',
            touchBuckets: { '0.10,0.20': 3 },
            rageTapBuckets: {},
            totalTouches: 3,
            totalRageTaps: 0,
            sampleSessionId: null,
            screenFirstSeenMs: 1780000000000,
            pageWidth: null,
            pageHeight: null,
            viewportWidth: 390,
            viewportHeight: 844,
        }]);
    });

    it('queries ClickHouse even when legacy product read flags are disabled', async () => {
        mocks.isProductReadsEnabled.mockReturnValue(false);
        mocks.query
            .mockResolvedValueOnce({ json: async () => [] })
            .mockResolvedValueOnce({ json: async () => [] });

        const rows = await queryProductDailyStatsFromClickHouse({
            projectIds: ['3f4f7d8a-7660-4a78-b944-442051c62eca'],
        });

        expect(rows).toEqual([]);
        expect(mocks.query).toHaveBeenCalledTimes(1);
    });

    it('returns empty rollup rows when ClickHouse is not configured', async () => {
        mocks.isConfigured.mockReturnValue(false);

        await expect(queryProductDailyStatsFromClickHouse({
            projectIds: ['3f4f7d8a-7660-4a78-b944-442051c62eca'],
        })).resolves.toEqual([]);
        await expect(queryDeviceUsageDailyRollupsFromClickHouse({
            projectIds: ['3f4f7d8a-7660-4a78-b944-442051c62eca'],
        })).resolves.toEqual([]);
        await expect(queryScreenTouchHeatmapsFromClickHouse({
            projectIds: ['3f4f7d8a-7660-4a78-b944-442051c62eca'],
        })).resolves.toEqual([]);

        expect(mocks.query).not.toHaveBeenCalled();
    });
});
