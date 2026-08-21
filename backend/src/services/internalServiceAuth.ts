import crypto from 'node:crypto';
import type { Request } from 'express';
import { getRedis } from '../db/redis.js';
import { constantTimeEqualSha256Hex } from '../utils/secureCompare.js';

const DEFAULT_MAX_SKEW_MS = 5 * 60 * 1000;
const DEFAULT_NONCE_TTL_SECONDS = 5 * 60;

export const INTERNAL_SERVICE_HEADERS = {
    service: 'x-rj-internal-service',
    timestamp: 'x-rj-internal-timestamp',
    nonce: 'x-rj-internal-nonce',
    signature: 'x-rj-internal-signature',
} as const;

export type InternalServiceAuthResult =
    | { ok: true; service: string }
    | { ok: false; reason: string };

export function sha256Hex(input: string | Buffer): string {
    return crypto.createHash('sha256').update(input).digest('hex');
}

export function hmacSha256Hex(secret: string, input: string): string {
    return crypto.createHmac('sha256', secret).update(input).digest('hex');
}

export function canonicalizeBody(body: unknown): string {
    if (body === undefined || body === null) return '';
    if (Buffer.isBuffer(body)) return body.toString('utf8');
    if (typeof body === 'string') return body;
    if (typeof body === 'object' && Object.keys(body as Record<string, unknown>).length === 0) return '';
    return JSON.stringify(body);
}

export function buildInternalSignaturePayload(input: {
    body?: unknown;
    bodyHash?: string;
    method: string;
    nonce: string;
    pathWithQuery: string;
    timestamp: string;
}): string {
    const bodyHash = input.bodyHash ?? sha256Hex(canonicalizeBody(input.body));
    return [
        input.method.toUpperCase(),
        input.pathWithQuery,
        input.timestamp,
        input.nonce,
        bodyHash,
    ].join('\n');
}

export function signInternalServiceRequest(input: {
    body?: unknown;
    method: string;
    pathWithQuery: string;
    secret: string;
    service: string;
    timestamp?: string;
    nonce?: string;
}): Record<string, string> {
    const timestamp = input.timestamp ?? new Date().toISOString();
    const nonce = input.nonce ?? crypto.randomUUID();
    const payload = buildInternalSignaturePayload({
        body: input.body,
        method: input.method,
        nonce,
        pathWithQuery: input.pathWithQuery,
        timestamp,
    });

    return {
        'X-RJ-Internal-Service': input.service,
        'X-RJ-Internal-Timestamp': timestamp,
        'X-RJ-Internal-Nonce': nonce,
        'X-RJ-Internal-Signature': hmacSha256Hex(input.secret, payload),
    };
}

function getSingleHeader(req: Request, headerName: string): string {
    const value = req.headers[headerName];
    if (Array.isArray(value)) return value[0] ?? '';
    return typeof value === 'string' ? value : '';
}

async function reserveNonce(service: string, nonce: string, ttlSeconds: number): Promise<boolean> {
    const key = `internal-service-auth:${service}:${nonce}`;
    const result = await getRedis().set(key, '1', 'EX', ttlSeconds, 'NX');
    return result === 'OK';
}

function resolveNonceTtlSeconds(input: {
    explicitTtlSeconds?: number;
    maxSkewMs: number;
    nowMs: number;
    timestampMs: number;
}): number {
    // Keep the nonce through the signed timestamp's entire remaining acceptance
    // window. The extra second covers Redis' integer-second expiry granularity
    // and the equality boundary accepted by the skew check below.
    const remainingAcceptanceMs = Math.max(
        0,
        input.timestampMs + input.maxSkewMs - input.nowMs,
    );
    const acceptanceWindowTtlSeconds = Math.ceil(remainingAcceptanceMs / 1000) + 1;
    const explicitTtlFloor = Number.isFinite(input.explicitTtlSeconds)
        ? Math.max(0, Math.ceil(input.explicitTtlSeconds!))
        : 0;

    // Callers may retain nonces longer, but may never shorten either the
    // established default or the timestamp-derived replay-safety window.
    return Math.max(
        DEFAULT_NONCE_TTL_SECONDS,
        acceptanceWindowTtlSeconds,
        explicitTtlFloor,
    );
}

export async function verifyInternalServiceRequest(input: {
    allowedServices: Record<string, string | undefined>;
    maxSkewMs?: number;
    nonceTtlSeconds?: number;
    req: Request;
}): Promise<InternalServiceAuthResult> {
    const { req } = input;
    const service = getSingleHeader(req, INTERNAL_SERVICE_HEADERS.service).trim();
    const timestamp = getSingleHeader(req, INTERNAL_SERVICE_HEADERS.timestamp).trim();
    const nonce = getSingleHeader(req, INTERNAL_SERVICE_HEADERS.nonce).trim();
    const signature = getSingleHeader(req, INTERNAL_SERVICE_HEADERS.signature).trim();

    if (!service || !timestamp || !nonce || !signature) {
        return { ok: false, reason: 'missing_internal_auth_headers' };
    }

    const secret = input.allowedServices[service];
    if (!secret) {
        return { ok: false, reason: 'unknown_internal_service' };
    }

    const timestampMs = Date.parse(timestamp);
    if (!Number.isFinite(timestampMs)) {
        return { ok: false, reason: 'invalid_internal_timestamp' };
    }

    const maxSkewMs = input.maxSkewMs ?? DEFAULT_MAX_SKEW_MS;
    const nowMs = Date.now();
    if (Math.abs(nowMs - timestampMs) > maxSkewMs) {
        return { ok: false, reason: 'stale_internal_timestamp' };
    }

    const expectedPayload = buildInternalSignaturePayload({
        body: req.body,
        method: req.method,
        nonce,
        pathWithQuery: req.originalUrl,
        timestamp,
    });
    const expectedSignature = hmacSha256Hex(secret, expectedPayload);

    if (!constantTimeEqualSha256Hex(signature, expectedSignature)) {
        return { ok: false, reason: 'bad_internal_signature' };
    }

    // Reserve only authenticated nonces. Reserving before signature validation lets
    // an unauthenticated request consume a legitimate caller's nonce.
    const nonceTtlSeconds = resolveNonceTtlSeconds({
        explicitTtlSeconds: input.nonceTtlSeconds,
        maxSkewMs,
        nowMs,
        timestampMs,
    });
    const reserved = await reserveNonce(service, nonce, nonceTtlSeconds);
    if (!reserved) {
        return { ok: false, reason: 'replayed_internal_nonce' };
    }

    return { ok: true, service };
}
