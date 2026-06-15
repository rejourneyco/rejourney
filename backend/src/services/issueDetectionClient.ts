/**
 * Shared client for the Rejourney → issue-detection (edge `/v1`) calls. Extracted
 * from issueDetectionLeaks so the Leaks proxy and the new GitHub-link proxy sign
 * with the same HMAC, gate on the same feature flag, and enforce project access
 * identically.
 */

import { config } from '../config.js';
import { ApiError } from '../middleware/index.js';
import { signInternalServiceRequest } from './internalServiceAuth.js';
import { userCanAccessProject } from './projectAccess.js';

/** Closed by default: the integration 404s unless SHOW_ISSUE_DETECTION_UI is on. */
export function ensureIssueDetectionEnabled(): void {
    if (!config.SHOW_ISSUE_DETECTION_UI) {
        throw ApiError.notFound('Not found');
    }
}

function getIssueDetectionBaseUrl(): URL {
    ensureIssueDetectionEnabled();
    if (!config.ISSUE_DETECTION_API_URL || !config.ISSUE_DETECTION_SERVICE_SECRET) {
        throw ApiError.serviceUnavailable('Issue detection is not configured');
    }
    return new URL(config.ISSUE_DETECTION_API_URL);
}

function buildUpstreamUrl(pathWithQuery: string): URL {
    return new URL(pathWithQuery, getIssueDetectionBaseUrl().toString());
}

export async function callIssueDetection<T>(input: {
    body?: unknown;
    method?: string;
    pathWithQuery: string;
    raw?: boolean;
}): Promise<T> {
    const method = input.method ?? 'GET';
    const headers = new Headers({
        ...signInternalServiceRequest({
            body: input.body,
            method,
            pathWithQuery: input.pathWithQuery,
            secret: config.ISSUE_DETECTION_SERVICE_SECRET!,
            service: 'rejourney',
        }),
    });

    let body: string | undefined;
    if (input.body !== undefined) {
        body = JSON.stringify(input.body);
        headers.set('Content-Type', 'application/json');
    }

    const response = await fetch(buildUpstreamUrl(input.pathWithQuery), { method, headers, body });

    if (!response.ok) {
        if (response.status === 404) throw ApiError.notFound('Not found');
        if (response.status === 409) throw ApiError.conflict('Issue detection rejected the request');
        if (response.status === 400) throw ApiError.badRequest('Issue detection rejected the request');
        if (response.status === 429) throw ApiError.tooManyRequests('Issue detection is rate limited');
        if (response.status === 503) throw ApiError.serviceUnavailable('Issue detection is not configured');
        throw ApiError.serviceUnavailable('Issue detection service unavailable');
    }

    if (input.raw) return response as T;
    return (await response.json()) as T;
}

export async function requireProjectAccess(userId: string, projectId: string): Promise<void> {
    const allowed = await userCanAccessProject(userId, projectId);
    if (!allowed) throw ApiError.forbidden('Access denied');
}
