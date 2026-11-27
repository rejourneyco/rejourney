/**
 * Express mount for the OAuth authorization server.
 *
 *   app.use('/oauth', createOAuthRouter(...))                 authorize, token, register, revoke, interaction
 *   app.get(oauthMetadataPath(issuer), createOAuthMetadataHandler(...))   RFC 8414 location for a path issuer
 *
 * The interaction step, in production (`dashboardConsent`):
 *   GET /oauth/interaction/:uid          → 303 to the dashboard consent page
 *   (the page reads the request and posts the user's choice to the API,
 *    which stores it as a short-lived `McpConsentDecision` record)
 *   GET /oauth/interaction/:uid/finish   → checks the provider's interaction
 *    cookie (so only the browser that started the request can finish it) and
 *    the dashboard session (so only the user who decided can), then creates
 *    the grant and sends the browser back to the AI client.
 * Tests may instead pass `resolveConsent`, which decides at once.
 */

import { Router } from 'express';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type Provider from 'oidc-provider';
import type { McpGrantRecord, McpGrantRecordStore } from './grants.js';

export interface ConsentRequest {
    interactionUid: string;
    clientId: string;
    redirectUri: string | undefined;
    requestedScopes: string[];
    resource: string | undefined;
}

export type ConsentDecision =
    | { approved: false }
    | { approved: true; userId: string; teamId: string; projectIds: string[]; scopes: string[] };

/** Decides an authorization request. Production: the signed-in dashboard user's choice on the consent page. */
export type ConsentResolver = (request: ConsentRequest) => Promise<ConsentDecision>;

/** What the dashboard consent page stored for one interaction. */
export interface StoredConsentDecision {
    userId: string;
    decision: 'allow' | 'deny';
    teamId?: string;
    projectIds?: string[];
    scopes?: string[];
}

export const CONSENT_DECISION_MODEL = 'McpConsentDecision';

export interface DashboardConsentOptions {
    /** Absolute URL of the consent page; `?uid=` is appended. */
    consentPageUrl: string;
    /** The signed-in dashboard user, from the session cookie; null when not signed in. */
    resolveSessionUser: (req: Request) => Promise<{ id: string } | null>;
    /** Reads and deletes the stored decision for the interaction (single use). */
    takeDecision: (uid: string) => Promise<StoredConsentDecision | null>;
    /** Re-checks an "allow" right before the grant is created (membership, team switch, projects). */
    confirm?: (decision: StoredConsentDecision & { decision: 'allow' }) => Promise<boolean>;
    /** Called after a grant is saved: audit log, email. Must not throw. */
    onGrantCreated?: (record: McpGrantRecord, req: Request) => void;
}

export interface OAuthRouterOptions {
    provider: Provider;
    /** The MCP resource scopes are granted for. */
    resource: string;
    grants: McpGrantRecordStore;
    /** Tests: decide at once. */
    resolveConsent?: ConsentResolver;
    /** Production: the dashboard consent page. */
    dashboardConsent?: DashboardConsentOptions;
}

const OFFLINE_ACCESS_SCOPE = 'offline_access';

function firstString(value: unknown): string | undefined {
    if (typeof value === 'string') return value;
    if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
    return undefined;
}

export function createOAuthRouter(options: OAuthRouterOptions): Router {
    const { provider, grants } = options;
    const router = Router();

    // Keep the Rejourney side of a grant in step with the provider's.
    provider.on('grant.revoked', (_ctx, grantId) => {
        void grants.delete(grantId);
    });

    async function clientName(clientId: string): Promise<string | undefined> {
        try {
            const client = await provider.Client.find(clientId);
            const name = (client as { clientName?: unknown } | undefined)?.clientName;
            return typeof name === 'string' && name.trim() ? name.trim().slice(0, 255) : undefined;
        } catch {
            return undefined;
        }
    }

    /** Saves the provider grant and the Rejourney grant record, then finishes the interaction. */
    async function grantAndFinish(
        req: Request,
        res: Response,
        interaction: Awaited<ReturnType<Provider['interactionDetails']>>,
        decision: { userId: string; teamId: string; projectIds: string[]; scopes: string[] },
    ): Promise<McpGrantRecord> {
        const clientId = String(interaction.params.client_id);
        const requestedScopes = (firstString(interaction.params.scope) ?? '').split(' ').filter(Boolean);
        const grant = new provider.Grant({ accountId: decision.userId, clientId });
        // Scopes are registered both with the authorization server and
        // with the resource (see provider.ts), so settle them on both sides.
        // Every requested scope must end up granted or rejected: a scope
        // the provider has not "encountered" re-triggers the consent prompt.
        const granted = new Set(decision.scopes);
        if (requestedScopes.includes(OFFLINE_ACCESS_SCOPE)) granted.add(OFFLINE_ACCESS_SCOPE);
        const declined = requestedScopes.filter((scope) => !granted.has(scope));
        grant.addOIDCScope(granted);
        grant.addResourceScope(options.resource, decision.scopes);
        if (declined.length > 0) {
            grant.rejectOIDCScope(declined);
            grant.rejectResourceScope(options.resource, declined);
        }
        const grantId = await grant.save();

        const record: McpGrantRecord = {
            grantId,
            clientId,
            clientName: await clientName(clientId),
            userId: decision.userId,
            teamId: decision.teamId,
            projectIds: decision.projectIds,
            scopes: decision.scopes,
            createdAt: Date.now(),
        };
        await grants.save(record);

        await provider.interactionFinished(
            req,
            res,
            // `remember: false`: a session cookie only, never a persistent provider login.
            { login: { accountId: decision.userId, remember: false }, consent: { grantId } },
            { mergeWithLastSubmission: false },
        );
        return record;
    }

    async function deny(req: Request, res: Response): Promise<void> {
        await provider.interactionFinished(
            req,
            res,
            { error: 'access_denied', error_description: 'End-user denied the request' },
            { mergeWithLastSubmission: false },
        );
    }

    const dashboard = options.dashboardConsent;
    if (dashboard) {
        router.get('/interaction/:uid', async (req: Request, res: Response, next: NextFunction) => {
            try {
                res.setHeader('Cache-Control', 'no-store');
                // Validates the interaction cookie; throws when it is missing or stale.
                const interaction = await provider.interactionDetails(req, res);
                const target = new URL(dashboard.consentPageUrl);
                target.searchParams.set('uid', interaction.uid);
                res.redirect(303, target.toString());
            } catch (error) {
                next(error);
            }
        });

        router.get('/interaction/:uid/finish', async (req: Request, res: Response, next: NextFunction) => {
            try {
                res.setHeader('Cache-Control', 'no-store');
                res.setHeader('Referrer-Policy', 'no-referrer');
                const interaction = await provider.interactionDetails(req, res);
                const backToConsent = () => {
                    const target = new URL(dashboard.consentPageUrl);
                    target.searchParams.set('uid', interaction.uid);
                    res.redirect(303, target.toString());
                };
                const user = await dashboard.resolveSessionUser(req);
                if (!user) {
                    backToConsent();
                    return;
                }
                const decision = await dashboard.takeDecision(interaction.uid);
                if (!decision || decision.userId !== user.id) {
                    backToConsent();
                    return;
                }
                if (decision.decision === 'deny') {
                    await deny(req, res);
                    return;
                }
                if (!decision.teamId || !decision.projectIds?.length || !decision.scopes?.length) {
                    backToConsent();
                    return;
                }
                const allow = { ...decision, decision: 'allow' as const };
                if (dashboard.confirm && !(await dashboard.confirm(allow))) {
                    backToConsent();
                    return;
                }
                const record = await grantAndFinish(req, res, interaction, {
                    userId: user.id,
                    teamId: decision.teamId,
                    projectIds: decision.projectIds,
                    scopes: decision.scopes,
                });
                try {
                    dashboard.onGrantCreated?.(record, req);
                } catch {
                    // Never fail a finished sign-in over a notification.
                }
            } catch (error) {
                next(error);
            }
        });
    } else {
        router.get('/interaction/:uid', async (req: Request, res: Response, next: NextFunction) => {
            try {
                res.setHeader('Cache-Control', 'no-store');
                const interaction = await provider.interactionDetails(req, res);
                const clientId = String(interaction.params.client_id);
                const requestedScopes = (firstString(interaction.params.scope) ?? '').split(' ').filter(Boolean);
                const resolve = options.resolveConsent;
                const decision = resolve
                    ? await resolve({
                        interactionUid: interaction.uid,
                        clientId,
                        redirectUri: firstString(interaction.params.redirect_uri),
                        requestedScopes,
                        resource: firstString(interaction.params.resource),
                    })
                    : { approved: false as const };
                if (!decision.approved) {
                    await deny(req, res);
                    return;
                }
                await grantAndFinish(req, res, interaction, decision);
            } catch (error) {
                next(error);
            }
        });
    }

    router.use(provider.callback());
    return router;
}

/** RFC 8414 §3.1 metadata path for an issuer that has a path component. */
export function oauthMetadataPath(issuer: string): string {
    const path = new URL(issuer).pathname.replace(/\/$/, '');
    return `/.well-known/oauth-authorization-server${path}`;
}

/**
 * Serves the provider's metadata at the app-root well-known location.
 * `oidc-provider` only answers `<mount>/.well-known/oauth-authorization-server`;
 * for an issuer with a path, RFC 8414 puts the document at
 * `/.well-known/oauth-authorization-server<path>` instead, so forward it.
 */
export function createOAuthMetadataHandler(provider: Provider): RequestHandler {
    const mountPath = new URL(provider.issuer).pathname.replace(/\/$/, '');
    const callback = provider.callback();
    return (req, res) => {
        req.url = '/.well-known/oauth-authorization-server';
        req.originalUrl = `${mountPath}${req.url}`;
        req.baseUrl = mountPath;
        void callback(req, res);
    };
}
