import type { Request } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    buildInternalSignaturePayload,
    canonicalizeBody,
    hmacSha256Hex,
    INTERNAL_SERVICE_HEADERS,
    sha256Hex,
    signInternalServiceRequest,
    verifyInternalServiceRequest,
} from '../services/internalServiceAuth.js';

const mocks = vi.hoisted(() => ({
    redisSet: vi.fn(),
}));

vi.mock('../db/redis.js', () => ({
    getRedis: () => ({
        set: mocks.redisSet,
    }),
}));

function toRequest(input: {
    body?: unknown;
    headers?: Record<string, string>;
    method?: string;
    originalUrl?: string;
}): Request {
    return {
        body: input.body,
        headers: input.headers ?? {},
        method: input.method ?? 'GET',
        originalUrl: input.originalUrl ?? '/api/internal/issue-detection/projects',
    } as Request;
}

function lowerCaseHeaders(headers: Record<string, string>): Record<string, string> {
    return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
}

describe('internal service auth helpers', () => {
    beforeEach(() => {
        mocks.redisSet.mockReset();
        mocks.redisSet.mockResolvedValue('OK');
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('canonicalizes empty bodies to an empty string', () => {
        expect(canonicalizeBody(undefined)).toBe('');
        expect(canonicalizeBody(null)).toBe('');
        expect(canonicalizeBody({})).toBe('');
    });

    it('builds stable signature payloads', () => {
        const payload = buildInternalSignaturePayload({
            body: { projectId: 'project_1' },
            method: 'post',
            nonce: 'nonce-1',
            pathWithQuery: '/api/internal/issue-detection/projects?limit=1',
            timestamp: '2026-06-13T12:00:00.000Z',
        });

        expect(payload).toBe([
            'POST',
            '/api/internal/issue-detection/projects?limit=1',
            '2026-06-13T12:00:00.000Z',
            'nonce-1',
            sha256Hex(JSON.stringify({ projectId: 'project_1' })),
        ].join('\n'));
    });

    it('signs requests using HMAC-SHA256', () => {
        const headers = signInternalServiceRequest({
            body: '',
            method: 'GET',
            nonce: 'nonce-2',
            pathWithQuery: '/v1/leaks/leak_1',
            secret: 'secret',
            service: 'rejourney',
            timestamp: '2026-06-13T12:00:00.000Z',
        });
        const expectedPayload = buildInternalSignaturePayload({
            body: '',
            method: 'GET',
            nonce: 'nonce-2',
            pathWithQuery: '/v1/leaks/leak_1',
            timestamp: '2026-06-13T12:00:00.000Z',
        });

        expect(headers['X-RJ-Internal-Service']).toBe('rejourney');
        expect(headers['X-RJ-Internal-Signature']).toBe(hmacSha256Hex('secret', expectedPayload));
    });

    it('accepts a valid signed request and reserves the nonce', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-06-13T12:00:00.000Z'));
        const timestamp = new Date().toISOString();
        const nonce = 'nonce-valid';
        const headers = lowerCaseHeaders(signInternalServiceRequest({
            body: { projectId: 'project_1' },
            method: 'POST',
            nonce,
            pathWithQuery: '/api/internal/issue-detection/projects',
            secret: 'secret',
            service: 'issue-detection',
            timestamp,
        }));

        const result = await verifyInternalServiceRequest({
            allowedServices: { 'issue-detection': 'secret' },
            req: toRequest({
                body: { projectId: 'project_1' },
                headers,
                method: 'POST',
            }),
        });

        expect(result).toEqual({ ok: true, service: 'issue-detection' });
        expect(mocks.redisSet).toHaveBeenCalledWith(
            'internal-service-auth:issue-detection:nonce-valid',
            '1',
            'EX',
            301,
            'NX',
        );
    });

    it('retains a future-boundary nonce through its full remaining acceptance window', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-06-13T12:00:00.000Z'));
        const timestamp = new Date(Date.now() + 5 * 60_000).toISOString();
        const headers = lowerCaseHeaders(signInternalServiceRequest({
            method: 'GET',
            nonce: 'nonce-future-boundary',
            pathWithQuery: '/api/internal/issue-detection/projects',
            secret: 'secret',
            service: 'issue-detection',
            timestamp,
        }));

        await expect(verifyInternalServiceRequest({
            allowedServices: { 'issue-detection': 'secret' },
            req: toRequest({ headers }),
        })).resolves.toEqual({ ok: true, service: 'issue-detection' });

        expect(mocks.redisSet).toHaveBeenCalledWith(
            'internal-service-auth:issue-detection:nonce-future-boundary',
            '1',
            'EX',
            601,
            'NX',
        );
    });

    it('keeps a current-timestamp nonce reserved across the skew equality boundary', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-06-13T12:00:00.000Z'));
        const timestamp = new Date().toISOString();
        const headers = lowerCaseHeaders(signInternalServiceRequest({
            method: 'GET',
            nonce: 'nonce-current-boundary',
            pathWithQuery: '/api/internal/issue-detection/projects',
            secret: 'secret',
            service: 'issue-detection',
            timestamp,
        }));

        await expect(verifyInternalServiceRequest({
            allowedServices: { 'issue-detection': 'secret' },
            req: toRequest({ headers }),
        })).resolves.toEqual({ ok: true, service: 'issue-detection' });
        expect(mocks.redisSet).toHaveBeenLastCalledWith(
            'internal-service-auth:issue-detection:nonce-current-boundary',
            '1',
            'EX',
            301,
            'NX',
        );

        // The verifier deliberately accepts exact skew equality. The original
        // 301-second reservation is therefore still alive when this replay is
        // checked at +300 seconds.
        mocks.redisSet.mockResolvedValueOnce(null);
        vi.setSystemTime(new Date('2026-06-13T12:05:00.000Z'));
        await expect(verifyInternalServiceRequest({
            allowedServices: { 'issue-detection': 'secret' },
            req: toRequest({ headers }),
        })).resolves.toEqual({ ok: false, reason: 'replayed_internal_nonce' });
    });

    it('does not let an explicit short nonce TTL weaken replay protection', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-06-13T12:00:00.000Z'));
        const timestamp = new Date(Date.now() + 5 * 60_000).toISOString();
        const headers = lowerCaseHeaders(signInternalServiceRequest({
            method: 'GET',
            nonce: 'nonce-short-explicit-ttl',
            pathWithQuery: '/api/internal/issue-detection/projects',
            secret: 'secret',
            service: 'issue-detection',
            timestamp,
        }));

        await expect(verifyInternalServiceRequest({
            allowedServices: { 'issue-detection': 'secret' },
            nonceTtlSeconds: 1,
            req: toRequest({ headers }),
        })).resolves.toEqual({ ok: true, service: 'issue-detection' });

        expect(mocks.redisSet).toHaveBeenCalledWith(
            'internal-service-auth:issue-detection:nonce-short-explicit-ttl',
            '1',
            'EX',
            601,
            'NX',
        );
    });

    it('honors an explicit nonce TTL only when it is longer than the safety floor', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-06-13T12:00:00.000Z'));
        const timestamp = new Date().toISOString();
        const headers = lowerCaseHeaders(signInternalServiceRequest({
            method: 'GET',
            nonce: 'nonce-long-explicit-ttl',
            pathWithQuery: '/api/internal/issue-detection/projects',
            secret: 'secret',
            service: 'issue-detection',
            timestamp,
        }));

        await expect(verifyInternalServiceRequest({
            allowedServices: { 'issue-detection': 'secret' },
            nonceTtlSeconds: 900,
            req: toRequest({ headers }),
        })).resolves.toEqual({ ok: true, service: 'issue-detection' });

        expect(mocks.redisSet).toHaveBeenCalledWith(
            'internal-service-auth:issue-detection:nonce-long-explicit-ttl',
            '1',
            'EX',
            900,
            'NX',
        );
    });

    it('rejects missing signatures', async () => {
        const result = await verifyInternalServiceRequest({
            allowedServices: { 'issue-detection': 'secret' },
            req: toRequest({
                headers: {
                    [INTERNAL_SERVICE_HEADERS.service]: 'issue-detection',
                    [INTERNAL_SERVICE_HEADERS.timestamp]: new Date().toISOString(),
                    [INTERNAL_SERVICE_HEADERS.nonce]: 'nonce-missing-signature',
                },
            }),
        });

        expect(result).toEqual({ ok: false, reason: 'missing_internal_auth_headers' });
        expect(mocks.redisSet).not.toHaveBeenCalled();
    });

    it('rejects bad signatures', async () => {
        const headers = lowerCaseHeaders(signInternalServiceRequest({
            method: 'GET',
            nonce: 'nonce-bad-signature',
            pathWithQuery: '/api/internal/issue-detection/projects',
            secret: 'secret',
            service: 'issue-detection',
            timestamp: new Date().toISOString(),
        }));
        headers[INTERNAL_SERVICE_HEADERS.signature] = '0'.repeat(64);

        const result = await verifyInternalServiceRequest({
            allowedServices: { 'issue-detection': 'secret' },
            req: toRequest({ headers }),
        });

        expect(result).toEqual({ ok: false, reason: 'bad_internal_signature' });
        expect(mocks.redisSet).not.toHaveBeenCalled();
    });

    it('rejects stale timestamps', async () => {
        const timestamp = '2026-01-01T00:00:00.000Z';
        const headers = lowerCaseHeaders(signInternalServiceRequest({
            method: 'GET',
            nonce: 'nonce-stale',
            pathWithQuery: '/api/internal/issue-detection/projects',
            secret: 'secret',
            service: 'issue-detection',
            timestamp,
        }));

        const result = await verifyInternalServiceRequest({
            allowedServices: { 'issue-detection': 'secret' },
            maxSkewMs: 1,
            req: toRequest({ headers }),
        });

        expect(result).toEqual({ ok: false, reason: 'stale_internal_timestamp' });
        expect(mocks.redisSet).not.toHaveBeenCalled();
    });

    it('rejects reused nonces', async () => {
        mocks.redisSet.mockResolvedValueOnce(null);
        const headers = lowerCaseHeaders(signInternalServiceRequest({
            method: 'GET',
            nonce: 'nonce-replayed',
            pathWithQuery: '/api/internal/issue-detection/projects',
            secret: 'secret',
            service: 'issue-detection',
            timestamp: new Date().toISOString(),
        }));

        const result = await verifyInternalServiceRequest({
            allowedServices: { 'issue-detection': 'secret' },
            req: toRequest({ headers }),
        });

        expect(result).toEqual({ ok: false, reason: 'replayed_internal_nonce' });
    });

    it('rejects changed request bodies', async () => {
        const headers = lowerCaseHeaders(signInternalServiceRequest({
            body: { projectId: 'project_1' },
            method: 'POST',
            nonce: 'nonce-body-changed',
            pathWithQuery: '/api/internal/issue-detection/projects',
            secret: 'secret',
            service: 'issue-detection',
            timestamp: new Date().toISOString(),
        }));

        const result = await verifyInternalServiceRequest({
            allowedServices: { 'issue-detection': 'secret' },
            req: toRequest({
                body: { projectId: 'project_2' },
                headers,
                method: 'POST',
            }),
        });

        expect(result).toEqual({ ok: false, reason: 'bad_internal_signature' });
    });

    it('rejects unknown internal services', async () => {
        const headers = lowerCaseHeaders(signInternalServiceRequest({
            method: 'GET',
            nonce: 'nonce-unknown',
            pathWithQuery: '/api/internal/issue-detection/projects',
            secret: 'secret',
            service: 'unknown-service',
            timestamp: new Date().toISOString(),
        }));

        const result = await verifyInternalServiceRequest({
            allowedServices: { 'issue-detection': 'secret' },
            req: toRequest({ headers }),
        });

        expect(result).toEqual({ ok: false, reason: 'unknown_internal_service' });
        expect(mocks.redisSet).not.toHaveBeenCalled();
    });
});
