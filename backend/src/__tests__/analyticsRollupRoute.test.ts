import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const INTERNAL_SECRET = 'a'.repeat(64);

const mocks = vi.hoisted(() => ({
    loggerInfo: vi.fn(),
    nonceSet: vi.fn(async () => 'OK' as string | null),
    runDailyRollup: vi.fn(async (): Promise<'completed' | 'busy' | 'lease_lost'> => 'completed'),
    startBackfillDailyStats: vi.fn(async (): Promise<'started' | 'busy' | 'lease_lost'> => 'started'),
}));

vi.mock('../config.js', () => ({
    config: {
        NODE_ENV: 'test',
        REJOURNEY_INTERNAL_SERVICE_SECRET: 'a'.repeat(64),
    },
}));

vi.mock('../db/redis.js', () => ({
    getRedis: () => ({ set: mocks.nonceSet }),
}));

vi.mock('../jobs/statsAggregator.js', () => ({
    runDailyRollup: mocks.runDailyRollup,
    startBackfillDailyStats: mocks.startBackfillDailyStats,
}));

vi.mock('../logger.js', () => ({
    logger: {
        debug: vi.fn(),
        error: vi.fn(),
        info: mocks.loggerInfo,
        warn: vi.fn(),
    },
}));

import analyticsRollupRoutes, {
    handleAnalyticsRollupRequest,
    MAX_ANALYTICS_BACKFILL_DAYS,
    parseAnalyticsRollupRequest,
} from '../routes/analyticsRollup.js';
import { ApiError } from '../middleware/errorHandler.js';
import { requireAnalyticsRollupInternalAuth } from '../middleware/internalServiceAuth.js';
import { csrfProtection, originValidation } from '../middleware/csrf.js';
import { signInternalServiceRequest } from '../services/internalServiceAuth.js';

function lowerCaseHeaders(headers: Record<string, string>): Record<string, string> {
    return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
}

function toRequest(body: unknown, headers: Record<string, string> = {}): Request {
    return {
        body,
        cookies: {},
        headers,
        method: 'POST',
        originalUrl: '/api/analytics/rollup',
        path: '/rollup',
    } as Request;
}

function createResponse(): Response {
    return { locals: {} } as Response;
}

async function invokeMiddleware(
    middleware: (req: Request, res: Response, next: NextFunction) => unknown,
    req: Request,
    res: Response,
): Promise<unknown> {
    return new Promise((resolve) => {
        void middleware(req, res, (error?: unknown) => resolve(error));
    });
}

describe('analytics rollup route', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.nonceSet.mockResolvedValue('OK');
        mocks.runDailyRollup.mockResolvedValue('completed');
        mocks.startBackfillDailyStats.mockResolvedValue('started');
    });

    it('mounts internal HMAC auth before the rollup handler and rejects missing signatures', async () => {
        const routeLayer = (analyticsRollupRoutes as unknown as {
            stack: Array<{ route?: { path: string; stack: Array<{ handle: unknown }> } }>;
        }).stack.find((layer) => layer.route?.path === '/');
        expect(routeLayer?.route?.stack[0]?.handle).toBe(requireAnalyticsRollupInternalAuth);

        let nextError: unknown;
        await requireAnalyticsRollupInternalAuth(
            toRequest({}),
            createResponse(),
            ((error?: unknown) => { nextError = error; }) as NextFunction,
        );

        expect(nextError).toBeInstanceOf(ApiError);
        expect((nextError as ApiError).statusCode).toBe(401);
        expect(mocks.runDailyRollup).not.toHaveBeenCalled();
        expect(mocks.startBackfillDailyStats).not.toHaveBeenCalled();
    });

    it('accepts the analytics-rollup signature and records its service identity', async () => {
        const body = {};
        const headers = lowerCaseHeaders(signInternalServiceRequest({
            body,
            method: 'POST',
            nonce: 'rollup-default',
            pathWithQuery: '/api/analytics/rollup',
            secret: INTERNAL_SECRET,
            service: 'analytics-rollup',
        }));
        const response = createResponse();
        let nextError: unknown = 'not-called';

        await requireAnalyticsRollupInternalAuth(
            toRequest(body, headers),
            response,
            ((error?: unknown) => { nextError = error; }) as NextFunction,
        );

        expect(nextError).toBeUndefined();
        expect(response.locals.internalService).toBe('analytics-rollup');
        expect(mocks.nonceSet).toHaveBeenCalledWith(
            'internal-service-auth:analytics-rollup:rollup-default',
            '1',
            'EX',
            301,
            'NX',
        );
    });

    it('passes the global browser guards but still requires route-level HMAC auth', async () => {
        const body = {};
        const headers = lowerCaseHeaders(signInternalServiceRequest({
            body,
            method: 'POST',
            nonce: 'rollup-middleware-chain',
            pathWithQuery: '/api/analytics/rollup',
            secret: INTERNAL_SECRET,
            service: 'analytics-rollup',
        }));
        const signedRequest = toRequest(body, headers);
        const signedResponse = createResponse();

        await expect(invokeMiddleware(originValidation, signedRequest, signedResponse)).resolves.toBeUndefined();
        await expect(invokeMiddleware(csrfProtection, signedRequest, signedResponse)).resolves.toBeUndefined();
        await expect(invokeMiddleware(
            requireAnalyticsRollupInternalAuth,
            signedRequest,
            signedResponse,
        )).resolves.toBeUndefined();
        expect(signedResponse.locals.internalService).toBe('analytics-rollup');

        const unsignedRequest = toRequest({});
        const unsignedResponse = createResponse();
        await expect(invokeMiddleware(originValidation, unsignedRequest, unsignedResponse)).resolves.toBeUndefined();
        await expect(invokeMiddleware(csrfProtection, unsignedRequest, unsignedResponse)).resolves.toBeUndefined();
        const authError = await invokeMiddleware(
            requireAnalyticsRollupInternalAuth,
            unsignedRequest,
            unsignedResponse,
        );
        expect(authError).toMatchObject({ statusCode: 401, code: 'UNAUTHORIZED' });
        expect(mocks.runDailyRollup).not.toHaveBeenCalled();
        expect(mocks.startBackfillDailyStats).not.toHaveBeenCalled();
    });

    it('preserves the successful default and historic-date response bodies', async () => {
        await expect(handleAnalyticsRollupRequest({}, {
            internalService: 'analytics-rollup',
            path: '/api/analytics/rollup',
        })).resolves.toEqual({ message: 'Rollup completed for yesterday' });

        await expect(handleAnalyticsRollupRequest({ date: '2026-01-15' }, {
            internalService: 'analytics-rollup',
            path: '/api/analytics/rollup',
        })).resolves.toEqual({ message: 'Rollup completed for 2026-01-15' });

        expect(mocks.runDailyRollup).toHaveBeenNthCalledWith(1);
        expect(mocks.runDailyRollup).toHaveBeenNthCalledWith(
            2,
            new Date('2026-01-15T00:00:00.000Z'),
        );
        expect(mocks.loggerInfo).toHaveBeenCalledWith(
            expect.objectContaining({
                event: 'analytics.rollup_manual_triggered',
                internalService: 'analytics-rollup',
            }),
            'Manual analytics rollup triggered',
        );
    });

    it('accepts the exact 30-day maximum and acquires its guard before the started body', async () => {
        await expect(handleAnalyticsRollupRequest({ backfillDays: MAX_ANALYTICS_BACKFILL_DAYS }, {
            internalService: 'analytics-rollup',
            path: '/api/analytics/rollup',
        })).resolves.toEqual({ message: 'Backfill started for 30 days' });

        expect(mocks.startBackfillDailyStats).toHaveBeenCalledWith(MAX_ANALYTICS_BACKFILL_DAYS);
    });

    it('strictly rejects invalid or excessive work before starting it', () => {
        const today = new Date();
        const tomorrow = new Date(today);
        tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
        const invalidBodies = [
            { backfillDays: 0 },
            { backfillDays: 1.5 },
            { backfillDays: String(1) },
            { backfillDays: MAX_ANALYTICS_BACKFILL_DAYS + 1 },
            { date: '2026-02-30' },
            { date: today.toISOString().slice(0, 10) },
            { date: tomorrow.toISOString().slice(0, 10) },
            { date: '2026-01-15', backfillDays: 1 },
            { unexpected: true },
        ];

        for (const body of invalidBodies) {
            expect(() => parseAnalyticsRollupRequest(body)).toThrow(ApiError);
        }
        expect(mocks.runDailyRollup).not.toHaveBeenCalled();
        expect(mocks.startBackfillDailyStats).not.toHaveBeenCalled();
    });

    it('returns conflict instead of a false success when the shared lease is busy', async () => {
        mocks.startBackfillDailyStats.mockResolvedValueOnce('busy');

        const result = handleAnalyticsRollupRequest({ backfillDays: 1 }, {
            internalService: 'analytics-rollup',
            path: '/api/analytics/rollup',
        });

        await expect(result).rejects.toMatchObject({
            statusCode: 409,
            code: 'CONFLICT',
            message: 'A stats rollup is already running',
        });
    });

    it('maps lease loss to a service-unavailable response instead of success', async () => {
        mocks.runDailyRollup.mockResolvedValueOnce('lease_lost');

        const result = handleAnalyticsRollupRequest({}, {
            internalService: 'analytics-rollup',
            path: '/api/analytics/rollup',
        });

        await expect(result).rejects.toMatchObject({
            statusCode: 503,
            code: 'SERVICE_UNAVAILABLE',
            message: 'Stats rollup ownership was lost before completion',
        });
    });
});
