import type { NextFunction, Request, Response } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db/redis.js', () => ({
    checkRateLimitStrict: vi.fn(),
    isRedisConnected: vi.fn(() => false),
    getRedis: vi.fn(() => ({ status: 'end' })),
    getRedisDiagnosticsForLog: vi.fn(() => ({ redisStatus: 'end' })),
}));

vi.mock('../logger.js', () => ({
    logger: {
        warn: vi.fn(),
        error: vi.fn(),
    },
}));

import { checkRateLimitStrict, getRedis, isRedisConnected } from '../db/redis.js';
import {
    checkInMemoryRateLimit,
    otpSendIpRateLimiter,
    rateLimit,
    resetInMemoryRateLimitFallbacksForTests,
} from '../middleware/rateLimit.js';

function createResponse() {
    const res = {
        set: vi.fn().mockReturnThis(),
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
    };
    return res as unknown as Response & typeof res;
}

describe('OTP rate-limit Redis fallback', () => {
    const originalNodeEnv = process.env.NODE_ENV;

    beforeEach(() => {
        process.env.NODE_ENV = 'production';
        resetInMemoryRateLimitFallbacksForTests();
        vi.mocked(isRedisConnected).mockReturnValue(false);
        vi.mocked(getRedis).mockReturnValue({ status: 'end' } as never);
    });

    afterEach(() => {
        process.env.NODE_ENV = originalNodeEnv;
        resetInMemoryRateLimitFallbacksForTests();
        vi.clearAllMocks();
    });

    it('uses in-memory fallback instead of returning 503 when Redis is unavailable', async () => {
        const middleware = rateLimit({
            windowMs: 60_000,
            max: 2,
            keyGenerator: () => 'rate:otp:send:test@example.com',
            redisUnavailableFallback: true,
            message: 'Too many OTP requests.',
        });
        const req = {
            ip: '127.0.0.1',
            path: '/api/auth/otp/send',
            body: { email: 'test@example.com' },
        } as Request;
        const res = createResponse();
        const next = vi.fn() as unknown as NextFunction;

        await middleware(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(req.rateLimitFallbackUsed).toBe(true);
        expect(res.status).not.toHaveBeenCalledWith(503);
        expect(res.set).toHaveBeenCalledWith('X-RateLimit-Fallback', 'memory');
    });

    it('returns 429 from fallback only after the configured threshold', async () => {
        const middleware = rateLimit({
            windowMs: 60_000,
            max: 2,
            keyGenerator: () => 'rate:otp:send:test@example.com',
            redisUnavailableFallback: true,
            message: 'Too many OTP requests.',
        });
        const req = {
            ip: '127.0.0.1',
            path: '/api/auth/otp/send',
            body: { email: 'test@example.com' },
        } as Request;
        const firstRes = createResponse();
        const secondRes = createResponse();
        const thirdRes = createResponse();
        const next = vi.fn() as unknown as NextFunction;

        await middleware(req, firstRes, next);
        await middleware(req, secondRes, next);
        await middleware(req, thirdRes, next);

        expect(next).toHaveBeenCalledTimes(2);
        expect(firstRes.status).not.toHaveBeenCalled();
        expect(secondRes.status).not.toHaveBeenCalled();
        expect(thirdRes.status).toHaveBeenCalledWith(429);
        expect(thirdRes.json).toHaveBeenCalledWith(expect.objectContaining({
            error: 'Too Many Requests',
            message: 'Too many OTP requests.',
        }));
    });

    it('tracks fallback windows in memory', () => {
        const store = new Map();
        expect(checkInMemoryRateLimit('rate:test', 1000, 2, 100, store)).toMatchObject({
            allowed: true,
            remaining: 1,
            resetAt: 1100,
        });
        expect(checkInMemoryRateLimit('rate:test', 1000, 2, 200, store)).toMatchObject({
            allowed: true,
            remaining: 0,
            resetAt: 1100,
        });
        expect(checkInMemoryRateLimit('rate:test', 1000, 2, 300, store)).toMatchObject({
            allowed: false,
            remaining: 0,
            resetAt: 1100,
        });
        expect(checkInMemoryRateLimit('rate:test', 1000, 2, 1200, store)).toMatchObject({
            allowed: true,
            remaining: 1,
            resetAt: 2200,
        });
    });

    it('bounds fallback buckets when Redis is unavailable under high-cardinality traffic', () => {
        const store = new Map();
        checkInMemoryRateLimit('rate:a', 1000, 2, 100, store, 2);
        checkInMemoryRateLimit('rate:b', 1000, 2, 100, store, 2);
        checkInMemoryRateLimit('rate:a', 1000, 2, 200, store, 2);
        checkInMemoryRateLimit('rate:c', 1000, 2, 100, store, 2);

        expect([...store.keys()]).toEqual(['rate:a', 'rate:c']);
    });

    it('uses the OTP memory fallback when Redis is ready but the command fails', async () => {
        vi.mocked(isRedisConnected).mockReturnValue(true);
        vi.mocked(getRedis).mockReturnValue({ status: 'ready' } as never);
        vi.mocked(checkRateLimitStrict).mockRejectedValue(new Error('READONLY replica'));
        const middleware = rateLimit({
            windowMs: 60_000,
            max: 2,
            keyGenerator: () => 'rate:otp:send:test@example.com',
            redisUnavailableFallback: true,
        });
        const req = {
            ip: '127.0.0.1',
            path: '/api/auth/otp/send',
            body: { email: 'test@example.com' },
        } as Request;
        const res = createResponse();
        const next = vi.fn() as unknown as NextFunction;

        await middleware(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(req.rateLimitFallbackUsed).toBe(true);
        expect(res.set).toHaveBeenCalledWith('X-RateLimit-Fallback', 'memory');
    });

    it('fails closed with the existing response shape when a connected Redis command fails', async () => {
        vi.mocked(isRedisConnected).mockReturnValue(true);
        vi.mocked(getRedis).mockReturnValue({ status: 'ready' } as never);
        vi.mocked(checkRateLimitStrict).mockRejectedValue(new Error('Redis command timed out'));
        const middleware = rateLimit({
            windowMs: 60_000,
            max: 2,
            keyGenerator: () => 'rate:ingest:test',
            failOpen: false,
        });
        const req = {
            ip: '127.0.0.1',
            path: '/api/ingest/presign',
        } as Request;
        const res = createResponse();
        const next = vi.fn() as unknown as NextFunction;

        await middleware(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.json).toHaveBeenCalledWith({ error: 'Internal server error' });
    });

    it('keys OTP IP limits by the forwarded client IP instead of the internal proxy hop', async () => {
        vi.mocked(isRedisConnected).mockReturnValue(true);
        vi.mocked(getRedis).mockReturnValue({ status: 'ready' } as never);
        vi.mocked(checkRateLimitStrict).mockResolvedValue({
            allowed: true,
            remaining: 39,
            resetAt: Date.now() + 15 * 60_000,
        });

        const req = {
            ip: '10.42.3.37',
            path: '/api/auth/otp/send',
            headers: {
                'cf-connecting-ip': '91.126.76.114',
                'x-forwarded-for': '91.126.76.114, 10.0.0.3,10.42.3.37',
                'x-real-ip': '10.0.0.3',
            },
            socket: { remoteAddress: '::ffff:10.42.3.101' },
            body: { email: 'new@example.com' },
        } as unknown as Request;
        const res = createResponse();
        const next = vi.fn() as unknown as NextFunction;

        await otpSendIpRateLimiter(req, res, next);

        expect(checkRateLimitStrict).toHaveBeenCalledWith(
            'rate:otp:send:ip:91.126.76.114',
            15 * 60_000,
            40,
        );
        expect(next).toHaveBeenCalledTimes(1);
    });
});
