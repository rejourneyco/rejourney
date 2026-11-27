/**
 * Errors a tool may show to the client.
 *
 * Anything that is not an `McpToolError` is reported as a generic internal
 * error: its message never leaves the process. Every error result carries a
 * request id so a user can quote it to support.
 */

import { randomUUID } from 'node:crypto';

export type McpToolErrorCode =
    | 'not_found'
    | 'invalid_argument'
    | 'insufficient_scope'
    | 'access_revoked'
    | 'busy'
    | 'deadline_exceeded'
    | 'result_too_large'
    | 'disabled'
    | 'limit_reached'
    | 'rate_limited'
    | 'internal';

const PUBLIC_MESSAGES: Record<McpToolErrorCode, string> = {
    not_found: 'Not found.',
    invalid_argument: 'Invalid argument.',
    insufficient_scope: 'This connection was not granted the scope this tool needs.',
    access_revoked: 'This connection no longer has access. Reconnect to Rejourney.',
    busy: 'The server is busy.',
    deadline_exceeded: 'The call took too long and was stopped. Narrow the time range or filters and try again.',
    result_too_large: 'The result is too large to return. Narrow the request.',
    disabled: 'MCP access is turned off for this team or this tool. A team admin can turn it on from the MCP page in Rejourney.',
    limit_reached: 'This team has used its MCP credits for this billing period.',
    rate_limited: 'Too many calls in the last minute.',
    internal: 'Something went wrong.',
};

export class McpToolError extends Error {
    readonly code: McpToolErrorCode;
    readonly publicMessage: string;
    readonly retryAfterSeconds?: number;

    constructor(code: McpToolErrorCode, publicMessage?: string, options: { retryAfterSeconds?: number } = {}) {
        super(publicMessage ?? PUBLIC_MESSAGES[code]);
        this.name = 'McpToolError';
        this.code = code;
        this.publicMessage = publicMessage ?? PUBLIC_MESSAGES[code];
        this.retryAfterSeconds = options.retryAfterSeconds;
    }
}

/**
 * The single "not found". Used for ids that do not exist AND for ids that
 * exist outside the grant, so the two cannot be told apart.
 */
export function notFound(): McpToolError {
    return new McpToolError('not_found');
}

/** `message` must be written by us and must not echo stored data. */
export function invalidArgument(message: string): McpToolError {
    return new McpToolError('invalid_argument', message);
}

export function newRequestId(): string {
    return `req_${randomUUID().replace(/-/g, '')}`;
}

export interface McpErrorPayload {
    error: {
        code: McpToolErrorCode;
        message: string;
        requestId: string;
        retryAfterSeconds?: number;
    };
}

export interface McpErrorResult {
    [key: string]: unknown;
    isError: true;
    content: Array<{ type: 'text'; text: string }>;
}

/** Tool error result: text content only, so no output schema applies to it. */
export function toErrorResult(error: unknown, requestId: string): McpErrorResult {
    const known = error instanceof McpToolError ? error : new McpToolError('internal');
    const payload: McpErrorPayload = {
        error: {
            code: known.code,
            message: known.publicMessage,
            requestId,
            ...(known.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: known.retryAfterSeconds }),
        },
    };
    return { isError: true, content: [{ type: 'text', text: JSON.stringify(payload) }] };
}
