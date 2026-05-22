import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    isReadsEnabled: vi.fn(() => true),
    query: vi.fn(),
}));

vi.mock('../db/clickhouse.js', () => ({
    getClickHouseClient: () => ({ query: mocks.query }),
    isClickHouseReadsEnabled: mocks.isReadsEnabled,
}));

import {
    queryApiEndpointStatusRowsFromClickHouse,
    queryDailyApiCallsFromClickHouse,
    queryRegionStatsFromClickHouse,
    querySlowApiEndpointsFromClickHouse,
} from '../services/apiEndpointStatsClickHouse.js';

describe('apiEndpointStatsClickHouse', () => {
    beforeEach(() => {
        mocks.isReadsEnabled.mockReturnValue(true);
        mocks.query.mockReset();
        mocks.query.mockResolvedValue({ json: async () => [] });
    });

    it('reads endpoint status rows from the daily ClickHouse rollup', async () => {
        await queryApiEndpointStatusRowsFromClickHouse({
            projectIds: ['3f4f7d8a-7660-4a78-b944-442051c62eca'],
            startDate: '2026-05-01',
        });

        const call = mocks.query.mock.calls[0]?.[0];
        expect(call.query).toContain('FROM api_endpoint_daily_rollups');
        expect(call.query).toContain('GROUP BY endpoint, status_code');
        expect(call.query).toContain('date >= {startDate:Date}');
        expect(call.query).toContain('NOT match');
        expect(call.query).not.toContain('api_endpoint_daily_stats_imported');
        expect(call.query).not.toContain('api_endpoint_request_events');
        expect(call.query_params).toEqual({
            projectIds: ['3f4f7d8a-7660-4a78-b944-442051c62eca'],
            startDate: '2026-05-01',
        });
    });

    it('reads region stats from the daily ClickHouse rollup', async () => {
        await queryRegionStatsFromClickHouse({
            projectId: '3f4f7d8a-7660-4a78-b944-442051c62eca',
            startDate: '2026-05-01',
        });

        const call = mocks.query.mock.calls[0]?.[0];
        expect(call.query).toContain('FROM api_endpoint_daily_rollups');
        expect(call.query).toContain('GROUP BY region');
        expect(call.query_params).toEqual({
            projectId: '3f4f7d8a-7660-4a78-b944-442051c62eca',
            startDate: '2026-05-01',
        });
    });

    it('reads daily API call totals from the daily ClickHouse rollup', async () => {
        await queryDailyApiCallsFromClickHouse({
            projectIds: ['3f4f7d8a-7660-4a78-b944-442051c62eca'],
            startDate: '2026-05-01',
            endDate: '2026-05-21',
        });

        const call = mocks.query.mock.calls[0]?.[0];
        expect(call.query).toContain('toString(rollupDate) AS date');
        expect(call.query).toContain('date AS rollupDate');
        expect(call.query).toContain('date <= {endDate:Date}');
        expect(call.query).toContain('FROM api_endpoint_daily_rollups');
        expect(call.query_params).toEqual({
            projectIds: ['3f4f7d8a-7660-4a78-b944-442051c62eca'],
            startDate: '2026-05-01',
            endDate: '2026-05-21',
        });
    });

    it('reads slow endpoint candidates from the daily ClickHouse rollup', async () => {
        await querySlowApiEndpointsFromClickHouse({
            projectId: '3f4f7d8a-7660-4a78-b944-442051c62eca',
            startDate: '2026-05-01',
            limit: 20,
            minCalls: 5,
        });

        const call = mocks.query.mock.calls[0]?.[0];
        expect(call.query).toContain('avgLatency > 500');
        expect(call.query).toContain('totalErrors / nullIf(totalCalls, 0) > 0.05');
        expect(call.query).toContain('FROM api_endpoint_daily_rollups');
        expect(call.query_params).toEqual({
            projectId: '3f4f7d8a-7660-4a78-b944-442051c62eca',
            startDate: '2026-05-01',
            minCalls: 5,
            limit: 20,
        });
    });

    it('returns no rows when ClickHouse reads are disabled', async () => {
        mocks.isReadsEnabled.mockReturnValue(false);

        const rows = await queryApiEndpointStatusRowsFromClickHouse({
            projectIds: ['3f4f7d8a-7660-4a78-b944-442051c62eca'],
            startDate: '2026-05-01',
        });

        expect(rows).toEqual([]);
        expect(mocks.query).not.toHaveBeenCalled();
    });
});
