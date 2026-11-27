/**
 * Client for the dashboard's MCP endpoints.
 *
 * The API answers 404 on every `/api/mcp/...` route while MCP is switched off
 * on the server (`MCP_ENABLED`); the page then shows its "not enabled" state.
 * Requests follow `~/shared/api/client`: relative base URL, session cookie,
 * and the CSRF header on writes.
 */

import { API_BASE_URL, getCsrfToken } from '~/shared/config/appConfig';
import type { McpActivity, McpOverview, McpSettings } from './types';

export class McpApiError extends Error {
    readonly status: number;

    constructor(message: string, status: number) {
        super(message);
        this.name = 'McpApiError';
        this.status = status;
    }
}

/** True when the server has no MCP endpoints, as opposed to a failed request. */
export function isMcpNotEnabledError(error: unknown): boolean {
    return error instanceof McpApiError && error.status === 404;
}

function teamPath(teamId: string, suffix: string): string {
    return `/api/mcp/teams/${encodeURIComponent(teamId)}${suffix}`;
}

async function mcpRequest<T>(endpoint: string, options: { method?: 'GET' | 'PUT' | 'DELETE'; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
    const method = options.method ?? 'GET';
    const headers = new Headers({ Accept: 'application/json' });
    if (method !== 'GET') {
        const csrf = getCsrfToken();
        if (csrf) headers.set('X-CSRF-Token', csrf);
    }
    if (options.body !== undefined) headers.set('Content-Type', 'application/json');

    let response: Response;
    try {
        response = await fetch(`${API_BASE_URL}${endpoint}`, {
            method,
            headers,
            credentials: 'include',
            body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
            signal: options.signal,
        });
    } catch (error) {
        if ((error as { name?: string } | null)?.name === 'AbortError') throw error;
        throw new McpApiError('The MCP service could not be reached.', 0);
    }

    if (!response.ok) {
        const body = await response.json().catch(() => null) as { message?: unknown } | null;
        const message = typeof body?.message === 'string' ? body.message : `MCP request failed (${response.status})`;
        throw new McpApiError(message, response.status);
    }

    if (response.status === 204) return undefined as T;
    // A proxy or SPA fallback can answer 200 with HTML while the routes do not exist.
    if (!(response.headers.get('content-type') ?? '').includes('application/json')) {
        throw new McpApiError('MCP is not enabled on this server.', 404);
    }
    return response.json() as Promise<T>;
}

/** Usage, connections and the team switches for one team. */
export function getMcpOverview(teamId: string, signal?: AbortSignal): Promise<McpOverview> {
    return mcpRequest<McpOverview>(teamPath(teamId, '/overview'), { signal });
}

/** Recent MCP calls for one team, newest first. */
export function getMcpActivity(teamId: string, signal?: AbortSignal): Promise<McpActivity> {
    return mcpRequest<McpActivity>(teamPath(teamId, '/activity'), { signal });
}

/** Cuts off one connected app at once. */
export function revokeMcpConnection(teamId: string, connectionId: string): Promise<void> {
    return mcpRequest<void>(teamPath(teamId, `/connections/${encodeURIComponent(connectionId)}`), { method: 'DELETE' });
}

/** Team admin switches. Returns the saved settings. */
export function updateMcpSettings(teamId: string, settings: Partial<McpSettings>): Promise<McpSettings> {
    return mcpRequest<{ settings: McpSettings }>(teamPath(teamId, '/settings'), { method: 'PUT', body: settings })
        .then((data) => data.settings);
}
