import { createHash } from 'crypto';
import type { Request } from 'express';
import {
    extractDeviceIdFromUploadToken,
    extractProjectIdFromUploadToken,
} from '../services/ingestProtocol.js';

type IngestRateLimitRequest = Pick<Request, 'headers' | 'body' | 'path'> & {
    project?: {
        id?: string | null;
    } | null;
};

function firstHeaderValue(value: string | string[] | undefined): string {
    if (Array.isArray(value)) {
        return value[0]?.trim() || '';
    }

    return value?.trim() || '';
}

function normalizeIdentifier(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null;
    }

    const trimmed = value.trim();
    return trimmed ? trimmed : null;
}

function asRecord(value: unknown): Record<string, unknown> {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        return value as Record<string, unknown>;
    }

    return {};
}

function getProjectKeyFingerprint(req: IngestRateLimitRequest): string | null {
    const projectKey = normalizeIdentifier(
        firstHeaderValue(req.headers['x-rejourney-key'])
        || firstHeaderValue(req.headers['x-api-key']),
    );

    if (!projectKey) {
        return null;
    }

    return createHash('sha256').update(projectKey).digest('hex').slice(0, 16);
}

function getProjectId(req: IngestRateLimitRequest): string | null {
    const requestProjectId = normalizeIdentifier(req.project?.id);
    if (requestProjectId) {
        return requestProjectId;
    }

    return normalizeIdentifier(extractProjectIdFromUploadToken(req));
}

function getProjectScope(req: IngestRateLimitRequest): string {
    const projectId = getProjectId(req);
    if (projectId) {
        return `project:${projectId}`;
    }

    const projectKeyFingerprint = getProjectKeyFingerprint(req);
    if (projectKeyFingerprint) {
        return `project-key:${projectKeyFingerprint}`;
    }

    return 'unscoped';
}

function getDeviceIdFromBody(req: IngestRateLimitRequest): string | null {
    const body = asRecord(req.body);
    return normalizeIdentifier(body.deviceId);
}

function getSessionId(req: IngestRateLimitRequest): string | null {
    const headerSessionId = normalizeIdentifier(firstHeaderValue(req.headers['x-session-id']));
    if (headerSessionId) {
        return headerSessionId;
    }

    const body = asRecord(req.body);
    return normalizeIdentifier(body.sessionId);
}

export function buildIngestProjectRateLimitKey(req: IngestRateLimitRequest): string {
    const projectId = getProjectId(req);
    if (projectId) {
        return `rate:ingest:project:${projectId}`;
    }

    const projectKeyFingerprint = getProjectKeyFingerprint(req);
    if (projectKeyFingerprint) {
        return `rate:ingest:project-key:${projectKeyFingerprint}`;
    }

    return `rate:ingest:project-invalid:${req.path || 'unknown'}`;
}

export function buildIngestDeviceRateLimitKey(req: IngestRateLimitRequest): string {
    const projectScope = getProjectScope(req);

    const tokenDeviceId = normalizeIdentifier(extractDeviceIdFromUploadToken(req));
    if (tokenDeviceId) {
        return `rate:ingest:device:${projectScope}:${tokenDeviceId}`;
    }

    const bodyDeviceId = getDeviceIdFromBody(req);
    if (bodyDeviceId) {
        return `rate:ingest:device:${projectScope}:${bodyDeviceId}`;
    }

    const sessionId = getSessionId(req);
    if (sessionId) {
        return `rate:ingest:session:${projectScope}:${sessionId}`;
    }

    return `rate:ingest:invalid:${projectScope}:${req.path || 'unknown'}`;
}
