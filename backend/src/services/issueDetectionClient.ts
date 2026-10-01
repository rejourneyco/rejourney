/**
 * Shared client for the Rejourney → issue-detection (edge `/v1`) calls. Extracted
 * from issueDetectionLeaks so the Leaks proxy and the new GitHub-link proxy sign
 * with the same HMAC, gate on the same feature flag, and enforce project access
 * identically.
 */

import { setTimeout, clearTimeout } from 'node:timers';
import { config } from '../config.js';
import { IssueReadCache } from './issueReadCache.js';

import { ApiError } from '../middleware/index.js';
import { signInternalServiceRequest } from './internalServiceAuth.js';
import { userCanAccessProject } from './projectAccess.js';

const issueReads = new IssueReadCache();

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

type IssueDetectionRequest = {
    body?: unknown;
    method?: string;
    pathWithQuery: string;
    raw?: boolean;
};

export async function callIssueDetection<T>(input: IssueDetectionRequest): Promise<T> {
    // Validate configuration even on hits; cache only issue JSON, never streams
    // or GitHub state. Project permissions are checked by each proxy route.
    const origin = getIssueDetectionBaseUrl().origin;
    const method = input.method ?? 'GET';
    const cacheable = method === 'GET' && !input.raw && input.body === undefined
        && /^\/v1\/(?:projects\/[^/]+\/leaks(?:\?|$)|leaks\/[^/?]+(?:\?|$))/.test(input.pathWithQuery);
    if (cacheable) {
        return issueReads.read(`${origin}${input.pathWithQuery}`, () => requestIssueDetection<T>(input));
    }
    if (method !== 'GET') issueReads.clear();
    try {
        return await requestIssueDetection<T>(input);
    } finally {
        if (method !== 'GET') issueReads.clear();
    }
}

async function requestIssueDetection<T>(input: IssueDetectionRequest): Promise<T> {
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

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
        const response = await fetch(buildUpstreamUrl(input.pathWithQuery), { method, headers, body, signal: controller.signal });

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
    } finally {
        clearTimeout(timer);
    }
}

export async function requireProjectAccess(userId: string, projectId: string): Promise<void> {
    const allowed = await userCanAccessProject(userId, projectId);
    if (!allowed) throw ApiError.forbidden('Access denied');
}
