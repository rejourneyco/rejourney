/**
 * Express router for the MCP resource server.
 *
 *   POST /mcp                                        bearer-authenticated, stateless, JSON responses
 *   GET  /.well-known/oauth-protected-resource/mcp   RFC 9728 metadata (path-aware location)
 *   GET  /.well-known/oauth-protected-resource       RFC 9728 metadata (root fallback)
 *
 * This router never reads cookies and mounts no cookie parser. The only
 * credential it looks at is the `Authorization` header.
 */

import cors from 'cors';
import express, { Router } from 'express';
import type { Request as ExpressRequest, Response as ExpressResponse } from 'express';
import { requireBearerAuth } from '@modelcontextprotocol/express';
import { toNodeHandler } from '@modelcontextprotocol/node';
import {
    WebStandardStreamableHTTPServerTransport,
    createMcpHandler,
    getOAuthProtectedResourceMetadataUrl,
    isLegacyRequest,
} from '@modelcontextprotocol/server';
import type {
    McpHandlerRequestOptions,
    McpServerFactory,
    OAuthProtectedResourceMetadata,
} from '@modelcontextprotocol/server';
import { createMcpTokenVerifier } from './auth.js';
import type { McpTokenStore } from './auth.js';
import type { McpAccessChecker } from './context.js';
import type { McpScopedData } from './data/types.js';
import { createDashboardLinks } from './links.js';
import type { KillSwitches, McpGate } from './metering.js';
import { createToolRuntime } from './runtime.js';
import type { McpCallRecord } from './runtime.js';
import { createMcpServerFactory } from './server.js';
import { createUnmeteredUsageProvider } from './usage.js';
import type { McpUsageProvider } from './usage.js';

export const MCP_SCOPES = ['sessions:read', 'replay:read', 'issues:read', 'analytics:read'] as const;

/** §6.3: request bodies are capped at 256 KB. */
const MCP_MAX_BODY_BYTES = 256 * 1024;

export interface McpRouterOptions {
    /** Public URL of the MCP endpoint, e.g. `https://mcp.rejourney.co/mcp`. Also the RFC 8707 resource. */
    publicUrl: string;
    /** Issuer of the OAuth authorization server that mints `rjm_` tokens. */
    authorizationServerIssuer: string;
    tokenStore: McpTokenStore;
    /** The scoped data layer. The only way tools reach tenant data. */
    data: McpScopedData;
    /** Live membership and project check, run before every tool call. */
    access: McpAccessChecker;
    /** Base URL of the dashboard, for deep links (e.g. `https://rejourney.co`). */
    dashboardBaseUrl: string;
    /** Allowance numbers for `get_usage`. Defaults to "unmetered" until metering exists. */
    usage?: McpUsageProvider;
    now?: () => Date;
    /** Per-call deadline in milliseconds. Default 20 s. */
    toolDeadlineMs?: number;
    /** Tools executing at once in this process. Beyond it callers are told to retry. */
    maxConcurrentTools?: number;
    /** How long a call waits for a free slot before the busy answer. Default 1.5 s; 0 never waits. */
    toolSlotWaitMs?: number;
    busyRetrySeconds?: number;
    /** Byte cap per credit charged. Default 64 KB. */
    bytesPerCredit?: number;
    /** Sizes and ids of every tool call. The metering seam. */
    onToolCall?: (record: McpCallRecord) => void;
    /** Transport errors, and the real error behind any "internal" tool result (with its request id). */
    onError?: (error: Error, requestId?: string) => void;
    /** Allowance and per-user limits (see metering.ts). Without it calls are not metered. */
    gate?: McpGate;
    /** Server, tool, team and connection switches. */
    switches?: KillSwitches;
    /** True when the database is under pressure: MCP calls are refused first. */
    shouldShed?: () => boolean;
}

export function buildProtectedResourceMetadata(options: Pick<McpRouterOptions, 'publicUrl' | 'authorizationServerIssuer'>): OAuthProtectedResourceMetadata {
    return {
        resource: options.publicUrl,
        authorization_servers: [options.authorizationServerIssuer],
        scopes_supported: [...MCP_SCOPES],
        bearer_methods_supported: ['header'],
        resource_name: 'Rejourney MCP',
    };
}

/**
 * One stateless handler for both protocol eras, answering every exchange with
 * a single JSON body.
 *
 * `createMcpHandler(factory)` on its own already serves both eras, but its
 * built-in 2025-era leg (`legacy: 'stateless'`) frames each POST response as a
 * short SSE stream and has no JSON switch. So the modern leg runs strict
 * (`legacy: 'reject'`) and 2025-era requests are routed, with the SDK's own
 * `isLegacyRequest` classifier, to a per-request transport in JSON mode. This
 * is the hand-wired composition the SDK documents for `isLegacyRequest`.
 */
export function createDualEraJsonHandler(factory: McpServerFactory, reportError?: (error: Error) => void) {
    // Clients probe for `subscriptions/listen` on connect. Refusing it is the
    // configured behaviour, not a fault, so it is not reported as one.
    const onError = reportError
        ? (error: Error) => {
            if (typeof error?.message === 'string' && error.message.startsWith('subscriptions/listen refused')) return;
            reportError(error);
        }
        : undefined;
    const modern = createMcpHandler(factory, {
        legacy: 'reject',
        // Never upgrade a modern exchange to an SSE stream.
        responseMode: 'json',
        // No `subscriptions/listen` streams: nothing here changes at runtime.
        maxSubscriptions: 0,
        maxRequestBodySize: MCP_MAX_BODY_BYTES,
        onerror: onError,
    });

    async function serveLegacy(request: Request, requestOptions?: McpHandlerRequestOptions): Promise<Response> {
        if (request.method.toUpperCase() !== 'POST') {
            // Stateless: no standalone SSE stream (GET) and no session to end (DELETE).
            return Response.json(
                { jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null },
                { status: 405, headers: { Allow: 'POST' } },
            );
        }

        const server = await factory({ era: 'legacy', authInfo: requestOptions?.authInfo, requestInfo: request });
        const transport = new WebStandardStreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
            enableJsonResponse: true,
        });
        transport.onerror = onError;
        try {
            await server.connect(transport);
            return await transport.handleRequest(request, {
                authInfo: requestOptions?.authInfo,
                parsedBody: requestOptions?.parsedBody,
            });
        } finally {
            await transport.close().catch(() => undefined);
            await server.close().catch(() => undefined);
        }
    }

    return {
        async fetch(request: Request, requestOptions?: McpHandlerRequestOptions): Promise<Response> {
            const legacy = await isLegacyRequest(request, requestOptions?.parsedBody, {
                maxRequestBodySize: MCP_MAX_BODY_BYTES,
            });
            return legacy ? serveLegacy(request, requestOptions) : modern.fetch(request, requestOptions);
        },
        close: () => modern.close(),
    };
}

export function createMcpRouter(options: McpRouterOptions): Router {
    const publicUrl = new URL(options.publicUrl);
    const mcpPath = publicUrl.pathname;
    const resourceMetadataUrl = getOAuthProtectedResourceMetadataUrl(publicUrl);
    const metadata = buildProtectedResourceMetadata(options);

    const router = Router();

    // --- RFC 9728 Protected Resource Metadata -------------------------------
    const metadataRouter = Router();
    metadataRouter.use(cors({ origin: '*', methods: ['GET', 'OPTIONS'], credentials: false }));
    metadataRouter.get('/', (_req: ExpressRequest, res: ExpressResponse) => {
        res.setHeader('Cache-Control', 'public, max-age=300');
        res.json(metadata);
    });
    metadataRouter.all('/', (_req: ExpressRequest, res: ExpressResponse) => {
        res.setHeader('Allow', 'GET, OPTIONS');
        res.status(405).json({ error: 'method_not_allowed' });
    });
    router.use(new URL(resourceMetadataUrl).pathname, metadataRouter);
    router.use('/.well-known/oauth-protected-resource', metadataRouter);

    // --- MCP endpoint -------------------------------------------------------
    const now = options.now ?? (() => new Date());
    const runtime = createToolRuntime({
        access: options.access,
        deps: {
            data: options.data,
            usage: options.usage ?? createUnmeteredUsageProvider(now),
            links: createDashboardLinks(options.dashboardBaseUrl),
            now,
        },
        deadlineMs: options.toolDeadlineMs,
        maxConcurrent: options.maxConcurrentTools,
        slotWaitMs: options.toolSlotWaitMs,
        busyRetrySeconds: options.busyRetrySeconds,
        bytesPerCredit: options.bytesPerCredit,
        onError: options.onError,
        onCall: options.onToolCall,
        gate: options.gate,
        switches: options.switches,
        shouldShed: options.shouldShed,
    });
    const handler = createDualEraJsonHandler(createMcpServerFactory({ runtime }), options.onError);
    const nodeHandler = toNodeHandler(handler, { maxRequestBodySize: MCP_MAX_BODY_BYTES, onerror: options.onError });

    const bearerAuth = requireBearerAuth({
        verifier: createMcpTokenVerifier(options.tokenStore),
        resourceMetadataUrl,
        // Audience binding: a token minted for any other resource is refused.
        expectedResource: publicUrl,
    });

    router.all(
        mcpPath,
        (_req, res, next) => {
            res.setHeader('Cache-Control', 'no-store');
            next();
        },
        bearerAuth,
        express.json({ limit: MCP_MAX_BODY_BYTES, type: 'application/json' }),
        (req: ExpressRequest, res: ExpressResponse) => {
            void nodeHandler(req, res, req.method === 'POST' ? req.body : undefined);
        },
    );

    return router;
}
