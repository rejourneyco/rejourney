import { Router } from 'express';
import { logger } from '../logger.js';
import { ApiError, asyncHandler } from '../middleware/errorHandler.js';
import { requireAnalyticsRollupInternalAuth } from '../middleware/internalServiceAuth.js';
import {
    runDailyRollup,
    startBackfillDailyStats,
    type StatsAggregationLeaseResult,
    type StatsBackfillStartResult,
} from '../jobs/statsAggregator.js';

export const MAX_ANALYTICS_BACKFILL_DAYS = 30;

export type AnalyticsRollupRequest =
    | { kind: 'backfill'; days: number }
    | { kind: 'date'; date: Date; dateText: string }
    | { kind: 'default' };

export type AnalyticsRollupDependencies = {
    runDailyRollup: (date?: Date) => Promise<StatsAggregationLeaseResult>;
    startBackfillDailyStats: (days: number) => Promise<StatsBackfillStartResult>;
};

export type AnalyticsRollupResponse = { message: string };

function parseHistoricUtcDate(value: unknown): { date: Date; dateText: string } {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        throw ApiError.badRequest('date must use YYYY-MM-DD format');
    }

    const date = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
        throw ApiError.badRequest('date must be a valid calendar date');
    }

    const todayUtc = new Date();
    todayUtc.setUTCHours(0, 0, 0, 0);
    if (date >= todayUtc) {
        throw ApiError.badRequest('date must be before today');
    }

    return { date, dateText: value };
}

export function parseAnalyticsRollupRequest(body: unknown): AnalyticsRollupRequest {
    if (body === undefined || body === null) return { kind: 'default' };
    if (typeof body !== 'object' || Array.isArray(body)) {
        throw ApiError.badRequest('Request body must be a JSON object');
    }

    const record = body as Record<string, unknown>;
    const keys = Object.keys(record);
    const unknownKeys = keys.filter((key) => key !== 'date' && key !== 'backfillDays');
    if (unknownKeys.length > 0) {
        throw ApiError.badRequest('Request body contains unsupported fields');
    }

    const hasDate = Object.prototype.hasOwnProperty.call(record, 'date');
    const hasBackfillDays = Object.prototype.hasOwnProperty.call(record, 'backfillDays');
    if (hasDate && hasBackfillDays) {
        throw ApiError.badRequest('Specify either date or backfillDays, not both');
    }

    if (hasBackfillDays) {
        const days = record.backfillDays;
        if (
            typeof days !== 'number'
            || !Number.isFinite(days)
            || !Number.isInteger(days)
            || days < 1
            || days > MAX_ANALYTICS_BACKFILL_DAYS
        ) {
            throw ApiError.badRequest(
                `backfillDays must be an integer from 1 to ${MAX_ANALYTICS_BACKFILL_DAYS}`,
            );
        }
        return { kind: 'backfill', days };
    }

    if (hasDate) {
        const parsed = parseHistoricUtcDate(record.date);
        return { kind: 'date', ...parsed };
    }

    return { kind: 'default' };
}

function assertCompleted(result: StatsAggregationLeaseResult): void {
    if (result === 'busy') {
        throw ApiError.conflict('A stats rollup is already running');
    }
    if (result === 'lease_lost') {
        throw ApiError.serviceUnavailable('Stats rollup ownership was lost before completion');
    }
}

function assertBackfillStarted(result: StatsBackfillStartResult): void {
    if (result === 'busy') {
        throw ApiError.conflict('A stats rollup is already running');
    }
    if (result === 'lease_lost') {
        throw ApiError.serviceUnavailable('Stats rollup ownership was lost before the backfill started');
    }
}

export async function handleAnalyticsRollupRequest(
    body: unknown,
    audit: { internalService: string; path: string },
    dependencies: AnalyticsRollupDependencies = {
        runDailyRollup,
        startBackfillDailyStats,
    },
): Promise<AnalyticsRollupResponse> {
    const request = parseAnalyticsRollupRequest(body);
    logger.info({
        event: 'analytics.rollup_manual_triggered',
        internalService: audit.internalService,
        kind: request.kind,
        path: audit.path,
        ...(request.kind === 'backfill' ? { backfillDays: request.days } : {}),
        ...(request.kind === 'date' ? { date: request.dateText } : {}),
    }, 'Manual analytics rollup triggered');

    if (request.kind === 'backfill') {
        const result = await dependencies.startBackfillDailyStats(request.days);
        assertBackfillStarted(result);
        return { message: `Backfill started for ${request.days} days` };
    }

    if (request.kind === 'date') {
        const result = await dependencies.runDailyRollup(request.date);
        assertCompleted(result);
        return { message: `Rollup completed for ${request.dateText}` };
    }

    const result = await dependencies.runDailyRollup();
    assertCompleted(result);
    return { message: 'Rollup completed for yesterday' };
}

export function createAnalyticsRollupRouter(
    dependencies: AnalyticsRollupDependencies = {
        runDailyRollup,
        startBackfillDailyStats,
    },
) {
    const router = Router();

    router.post(
        '/',
        requireAnalyticsRollupInternalAuth,
        asyncHandler(async (req, res) => {
            res.json(await handleAnalyticsRollupRequest(req.body, {
                internalService: res.locals.internalService ?? 'unknown',
                path: req.originalUrl,
            }, dependencies));
        }),
    );

    return router;
}

export default createAnalyticsRollupRouter();
