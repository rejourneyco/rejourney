import { describe, expect, it, vi } from 'vitest';

vi.mock('../db/redis.js', () => ({
    checkRateLimitStrict: vi.fn(),
    isRedisConnected: vi.fn(() => false),
    getRedis: vi.fn(() => ({ status: 'end' })),
    getRedisDiagnosticsForLog: vi.fn(() => ({ redisStatus: 'end' })),
}));

vi.mock('../logger.js', () => ({
    logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { normalizeOtpRateLimitEmail } from '../middleware/rateLimit.js';

describe('normalizeOtpRateLimitEmail', () => {
    it('puts case and whitespace variants of one address in the same bucket', () => {
        const variants = ['victim@example.com', 'VICTIM@example.com', '  Victim@Example.COM ', 'victim@EXAMPLE.com\t'];
        expect(new Set(variants.map(normalizeOtpRateLimitEmail))).toEqual(new Set(['victim@example.com']));
    });

    it('ignores non-string emails so the IP bucket is used instead', () => {
        expect(normalizeOtpRateLimitEmail(undefined)).toBe('');
        expect(normalizeOtpRateLimitEmail({ $ne: '' })).toBe('');
        expect(normalizeOtpRateLimitEmail(['a@example.com'])).toBe('');
    });
});
