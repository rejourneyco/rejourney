/**
 * Client for the MCP OAuth consent endpoints (`/api/mcp/consent/:uid`).
 * The API host owns the OAuth flow; this page only shows the request and posts
 * the user's decision, then follows the `redirectTo` the API returns.
 */

import { buildLoginPath } from "~/shared/lib/returnPath";

export type ConsentClientRegistration = "metadata_document" | "dynamic" | "static";

export interface ConsentClient {
    id: string;
    name: string;
    uri: string | null;
    logoUri: string | null;
    redirectHost: string;
    loopbackOnly: boolean;
    registration: ConsentClientRegistration;
}

export interface ConsentScope {
    id: string;
    label: string;
    description: string;
}

export interface ConsentProject {
    id: string;
    name: string;
    platform: string | null;
}

export interface ConsentTeam {
    id: string;
    name: string;
    role: string;
    mcpEnabled: boolean;
    disabledReason: string | null;
    projects: ConsentProject[];
}

export interface ConsentDetails {
    uid: string;
    expiresAt: string;
    client: ConsentClient;
    scopes: ConsentScope[];
    user: { email: string };
    teams: ConsentTeam[];
}

export type ConsentDecisionBody =
    | { decision: "allow"; teamId: string; projectIds: string[] }
    | { decision: "deny" };

export type LoadConsentResult =
    | { kind: "ready"; details: ConsentDetails }
    | { kind: "signed_out" }
    | { kind: "expired" }
    | { kind: "disabled" }
    | { kind: "error"; message: string };

export type DecisionResult =
    | { kind: "redirect"; redirectTo: string }
    | { kind: "signed_out" }
    | { kind: "expired" }
    | { kind: "disabled" }
    | { kind: "error"; message: string };

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export const CONSENT_COPY = {
    expired: "This sign-in request has expired or was already used. Start again from your AI client.",
    disabled: "MCP is not enabled on this Rejourney server, so no AI client can connect to it.",
    missingUid: "This page needs a sign-in request from your AI client. Start again from your AI client.",
    loadFailed: "Check your connection and reload the page. If it still fails, start again from your AI client.",
    submitFailed: "We couldn't send your answer. Check your connection and try again.",
    badRedirect: "Rejourney returned an address it should not send you to, so we stopped here. Start again from your AI client.",
} as const;

export function consentApiPath(uid: string): string {
    return `/api/mcp/consent/${encodeURIComponent(uid)}`;
}

export function consentPagePath(uid: string): string {
    return `/oauth/consent?uid=${encodeURIComponent(uid)}`;
}

/** Where to send a signed-out user so the login page brings them back here. */
export function consentLoginPath(uid: string): string {
    return buildLoginPath(consentPagePath(uid));
}

async function readJson(response: Response): Promise<Record<string, unknown> | null> {
    try {
        const body: unknown = await response.json();
        return body && typeof body === "object" ? (body as Record<string, unknown>) : null;
    } catch {
        return null;
    }
}

function readString(value: unknown): string | null {
    return typeof value === "string" && value.trim() ? value : null;
}

function isConsentDetails(value: unknown): value is ConsentDetails {
    if (!value || typeof value !== "object") return false;
    const body = value as Partial<ConsentDetails>;
    return typeof body.uid === "string"
        && !!body.client && typeof body.client.name === "string"
        && Array.isArray(body.scopes)
        && !!body.user && typeof body.user.email === "string"
        && Array.isArray(body.teams);
}

/** The API answers with an absolute URL; only https (or http on a loopback host, for local dev) is followed. */
export function isFollowableRedirect(value: string): boolean {
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        return false;
    }
    if (url.protocol === "https:") return true;
    return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
}

export async function loadConsent(uid: string, fetchImpl: FetchLike = fetch): Promise<LoadConsentResult> {
    let response: Response;
    try {
        response = await fetchImpl(consentApiPath(uid), {
            method: "GET",
            credentials: "include",
            headers: { Accept: "application/json" },
            cache: "no-store",
        });
    } catch {
        return { kind: "error", message: CONSENT_COPY.loadFailed };
    }

    if (response.status === 401) return { kind: "signed_out" };
    const body = await readJson(response);
    if (response.status === 404) return { kind: "expired" };
    if (response.status === 403 && body?.error === "mcp_disabled") return { kind: "disabled" };
    if (!response.ok) {
        return { kind: "error", message: readString(body?.message) ?? CONSENT_COPY.loadFailed };
    }
    if (!isConsentDetails(body)) return { kind: "error", message: CONSENT_COPY.loadFailed };
    return { kind: "ready", details: body };
}

export async function postConsentDecision(
    uid: string,
    body: ConsentDecisionBody,
    csrfToken: string | null,
    fetchImpl: FetchLike = fetch,
): Promise<DecisionResult> {
    const headers: Record<string, string> = {
        Accept: "application/json",
        "Content-Type": "application/json",
    };
    if (csrfToken) headers["X-CSRF-Token"] = csrfToken;

    let response: Response;
    try {
        response = await fetchImpl(consentApiPath(uid), {
            method: "POST",
            credentials: "include",
            headers,
            body: JSON.stringify(body),
            cache: "no-store",
        });
    } catch {
        return { kind: "error", message: CONSENT_COPY.submitFailed };
    }

    if (response.status === 401) return { kind: "signed_out" };
    const json = await readJson(response);
    if (response.ok) {
        const redirectTo = readString(json?.redirectTo);
        if (!redirectTo || !isFollowableRedirect(redirectTo)) {
            return { kind: "error", message: CONSENT_COPY.badRedirect };
        }
        return { kind: "redirect", redirectTo };
    }
    if (response.status === 404) return { kind: "expired" };
    if (response.status === 403 && json?.error === "mcp_disabled") return { kind: "disabled" };
    return { kind: "error", message: readString(json?.message) ?? CONSENT_COPY.submitFailed };
}

/**
 * Posts the decision and, on success, hands the API's `redirectTo` to `assign`
 * (window.location.assign in the page). Returns the result so the page can show errors.
 */
export async function submitConsentDecision(options: {
    uid: string;
    body: ConsentDecisionBody;
    csrfToken: string | null;
    assign: (url: string) => void;
    fetchImpl?: FetchLike;
}): Promise<DecisionResult> {
    const result = await postConsentDecision(options.uid, options.body, options.csrfToken, options.fetchImpl);
    if (result.kind === "redirect") options.assign(result.redirectTo);
    return result;
}
