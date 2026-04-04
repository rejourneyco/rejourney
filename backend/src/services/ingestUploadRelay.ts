import { createHash, createHmac } from 'crypto';
import { config } from '../config.js';

export const ARTIFACT_UPLOAD_URL_TTL_SECONDS = 3600;
export const ABANDONED_ARTIFACT_TTL_MS = 10 * 60 * 1000;
export const STALE_PROCESSING_JOB_TTL_MS = 5 * 60 * 1000;

type UploadRelayTokenPayload = {
    artifactId: string;
    projectId: string;
    sessionId: string;
    kind: string;
    exp: number;
};

function encodePayload(payload: UploadRelayTokenPayload): string {
    return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decodePayload(payloadB64: string): UploadRelayTokenPayload | null {
    try {
        const parsed = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
        if (!parsed || typeof parsed !== 'object') return null;
        if (typeof parsed.artifactId !== 'string' || !parsed.artifactId) return null;
        if (typeof parsed.projectId !== 'string' || !parsed.projectId) return null;
        if (typeof parsed.sessionId !== 'string' || !parsed.sessionId) return null;
        if (typeof parsed.kind !== 'string' || !parsed.kind) return null;
        if (typeof parsed.exp !== 'number' || !Number.isFinite(parsed.exp)) return null;
        return parsed as UploadRelayTokenPayload;
    } catch {
        return null;
    }
}

function signPayload(payloadB64: string): string {
    return createHmac('sha256', config.INGEST_HMAC_SECRET)
        .update(payloadB64)
        .digest('hex');
}

function signaturesMatch(actual: string, expected: string): boolean {
    if (!actual || !expected || actual.length !== expected.length) {
        return false;
    }

    return createHash('sha256').update(actual).digest('hex') ===
        createHash('sha256').update(expected).digest('hex');
}

function trimTrailingSlash(value: string): string {
    return value.endsWith('/') ? value.slice(0, -1) : value;
}

export type UploadRelayPublicBaseSource = 'PUBLIC_INGEST_URL' | 'PUBLIC_API_URL' | 'loopback_fallback';

function resolvePublicIngestBase(): { baseUrl: string; source: UploadRelayPublicBaseSource } {
    if (config.PUBLIC_INGEST_URL) {
        return { baseUrl: trimTrailingSlash(config.PUBLIC_INGEST_URL), source: 'PUBLIC_INGEST_URL' };
    }
    if (config.PUBLIC_API_URL) {
        return { baseUrl: trimTrailingSlash(config.PUBLIC_API_URL), source: 'PUBLIC_API_URL' };
    }
    return {
        baseUrl: trimTrailingSlash(`http://127.0.0.1:${config.PORT}`),
        source: 'loopback_fallback',
    };
}

/**
 * Safe for logs: host + which env drove the relay URL (no token, no query).
 * Misconfigured PUBLIC_INGEST_URL is a top cause of "events work, replay uploads never hit upload pod".
 */
export function getUploadRelayBuildContext(): {
    relayBaseUrl: string;
    relayHost: string;
    publicBaseSource: UploadRelayPublicBaseSource;
} {
    const { baseUrl, source } = resolvePublicIngestBase();
    let relayHost = '';
    try {
        relayHost = new URL(baseUrl).hostname;
    } catch {
        relayHost = 'url_parse_error';
    }
    return {
        relayBaseUrl: baseUrl,
        relayHost,
        publicBaseSource: source,
    };
}

export function buildArtifactUploadRelayUrl(params: {
    artifactId: string;
    projectId: string;
    sessionId: string;
    kind: string;
    expiresInSeconds?: number;
}): string {
    const exp = Math.floor(Date.now() / 1000) + (params.expiresInSeconds ?? ARTIFACT_UPLOAD_URL_TTL_SECONDS);
    const payload: UploadRelayTokenPayload = {
        artifactId: params.artifactId,
        projectId: params.projectId,
        sessionId: params.sessionId,
        kind: params.kind,
        exp,
    };
    const payloadB64 = encodePayload(payload);
    const sig = signPayload(payloadB64);
    const token = `${payloadB64}.${sig}`;
    return `${resolvePublicIngestBase().baseUrl}/upload/artifacts/${params.artifactId}?token=${encodeURIComponent(token)}`;
}

export type UploadRelayTokenFailureReason =
    | 'missing_token'
    | 'malformed_token'
    | 'bad_signature'
    | 'bad_payload'
    | 'artifact_id_mismatch'
    | 'expired';

export function verifyArtifactUploadRelayTokenResult(
    token: string | undefined,
    artifactId: string,
): { ok: true; payload: UploadRelayTokenPayload } | { ok: false; reason: UploadRelayTokenFailureReason } {
    if (!token) {
        return { ok: false, reason: 'missing_token' };
    }

    const dotIdx = token.indexOf('.');
    if (dotIdx <= 0) {
        return { ok: false, reason: 'malformed_token' };
    }

    const payloadB64 = token.slice(0, dotIdx);
    const signature = token.slice(dotIdx + 1);
    const expected = signPayload(payloadB64);
    if (!signaturesMatch(signature, expected)) {
        return { ok: false, reason: 'bad_signature' };
    }

    const payload = decodePayload(payloadB64);
    if (!payload) {
        return { ok: false, reason: 'bad_payload' };
    }
    if (payload.artifactId !== artifactId) {
        return { ok: false, reason: 'artifact_id_mismatch' };
    }

    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now) {
        return { ok: false, reason: 'expired' };
    }

    return { ok: true, payload };
}

export function verifyArtifactUploadRelayToken(token: string | undefined, artifactId: string): UploadRelayTokenPayload | null {
    const result = verifyArtifactUploadRelayTokenResult(token, artifactId);
    return result.ok ? result.payload : null;
}
