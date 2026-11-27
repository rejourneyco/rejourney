import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { safeReturnPath } from "~/shared/lib/returnPath";
import { ConsentScreen, DYNAMIC_CLIENT_WARNING, LOOPBACK_CLIENT_NOTE, type ConsentScreenState } from "./ConsentScreen";
import {
    CONSENT_COPY,
    type ConsentDetails,
    consentLoginPath,
    loadConsent,
    submitConsentDecision,
} from "./consentApi";
import {
    type ConsentSelection,
    buildAllowBody,
    chooseMode,
    chooseTeam,
    initialSelection,
    selectionProblem,
    toggleProject,
} from "./consentSelection";

function details(overrides: Partial<ConsentDetails> = {}): ConsentDetails {
    return {
        uid: "test-uid",
        expiresAt: "2026-11-27T12:10:00.000Z",
        client: {
            id: "client-claude-code",
            name: "Claude Code",
            uri: "https://www.anthropic.com/claude-code",
            logoUri: null,
            redirectHost: "localhost",
            loopbackOnly: true,
            registration: "metadata_document",
        },
        scopes: [
            { id: "sessions:read", label: "Read sessions", description: "Search sessions and read their timelines." },
            { id: "issues:read", label: "Read issues", description: "List crashes, errors and ANRs." },
        ],
        user: { email: "sam@example.com" },
        teams: [
            {
                id: "team-acme",
                name: "Acme",
                role: "owner",
                mcpEnabled: true,
                disabledReason: null,
                projects: [
                    { id: "proj-ios", name: "Acme iOS", platform: "ios" },
                    { id: "proj-web", name: "Acme Web", platform: "web" },
                ],
            },
            {
                id: "team-off",
                name: "Side Project",
                role: "member",
                mcpEnabled: false,
                disabledReason: "A team admin has turned off MCP access for this team.",
                projects: [{ id: "proj-side", name: "Side app", platform: "android" }],
            },
        ],
        ...overrides,
    };
}

function jsonResponse(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function render(state: ConsentScreenState): string {
    return renderToStaticMarkup(createElement(ConsentScreen, { state }));
}

function ready(data: ConsentDetails, selection: ConsentSelection = initialSelection(data)): ConsentScreenState {
    return { phase: "ready", details: data, selection, pending: null, formError: null };
}

describe("loading the consent request", () => {
    it("shows a loading state, then the request details", async () => {
        expect(render({ phase: "loading" })).toContain("Loading the sign-in request");

        const fetchMock = vi.fn(async () => jsonResponse(200, details()));
        const result = await loadConsent("test-uid", fetchMock);

        expect(fetchMock).toHaveBeenCalledWith("/api/mcp/consent/test-uid", expect.objectContaining({
            method: "GET",
            credentials: "include",
        }));
        expect(result.kind).toBe("ready");
        if (result.kind !== "ready") return;

        const html = render(ready(result.details));
        expect(html).toContain("Connect Claude Code to Rejourney");
        expect(html).toContain("Sends you back to");
        expect(html).toContain("localhost");
        expect(html).toContain("sam@example.com");
        expect(html).toContain("Not you?");
        expect(html).toContain("Sign out");
        expect(html).toContain("Read sessions");
        expect(html).toContain("List crashes, errors and ANRs.");
        expect(html).toContain("Read-only. Claude Code cannot create, change or delete anything in Rejourney.");
        expect(html).toContain(LOOPBACK_CLIENT_NOTE);
        expect(html).not.toContain(DYNAMIC_CLIENT_WARNING);
    });

    it("escapes the uid in the API path", async () => {
        const fetchMock = vi.fn(async (_input: string, _init?: RequestInit) => jsonResponse(200, details()));
        await loadConsent("a/b?c", fetchMock);
        expect(fetchMock.mock.calls[0][0]).toBe("/api/mcp/consent/a%2Fb%3Fc");
    });

    it("sends a signed-out user to login with a return target back to this request", async () => {
        const result = await loadConsent("abc", vi.fn(async () => jsonResponse(401, { error: "unauthorized" })));
        expect(result).toEqual({ kind: "signed_out" });

        const loginPath = consentLoginPath("abc");
        expect(loginPath).toBe("/login?returnTo=%2Foauth%2Fconsent%3Fuid%3Dabc");

        const returnTo = new URL(loginPath, "https://rejourney.co").searchParams.get("returnTo");
        expect(returnTo).toBe("/oauth/consent?uid=abc");
        expect(safeReturnPath(returnTo)).toBe("/oauth/consent?uid=abc");
    });

    it("keeps an unusual uid intact through the login round trip", () => {
        const returnTo = new URL(consentLoginPath("x&y=1#z"), "https://rejourney.co").searchParams.get("returnTo");
        expect(returnTo).toBe("/oauth/consent?uid=x%26y%3D1%23z");
        expect(new URL(returnTo!, "https://rejourney.co").searchParams.get("uid")).toBe("x&y=1#z");
    });

    it("explains an expired or used request (404)", async () => {
        const result = await loadConsent("gone", vi.fn(async () => jsonResponse(404, { error: "interaction_not_found" })));
        expect(result).toEqual({ kind: "expired" });
        expect(CONSENT_COPY.expired).toBe("This sign-in request has expired or was already used. Start again from your AI client.");

        const html = render({ phase: "message", title: "This sign-in request is no longer valid", body: CONSENT_COPY.expired });
        expect(html).toContain(CONSENT_COPY.expired);
        expect(html).not.toContain("Allow");
    });

    it("reports MCP turned off on the server (403 mcp_disabled)", async () => {
        const result = await loadConsent("x", vi.fn(async () => jsonResponse(403, { error: "mcp_disabled" })));
        expect(result).toEqual({ kind: "disabled" });
    });

    it("shows the API message for other errors and a fallback when the network fails", async () => {
        const withMessage = await loadConsent("x", vi.fn(async () => jsonResponse(500, { error: "boom", message: "Database unavailable." })));
        expect(withMessage).toEqual({ kind: "error", message: "Database unavailable." });

        const offline = await loadConsent("x", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
        expect(offline).toEqual({ kind: "error", message: CONSENT_COPY.loadFailed });
    });
});

describe("client trust notes", () => {
    it("warns about a self-registered client and hides its logo", () => {
        const data = details({
            client: {
                ...details().client,
                registration: "dynamic",
                loopbackOnly: false,
                logoUri: "https://example.com/logo.png",
                redirectHost: "example.com",
            },
        });
        const html = render(ready(data));
        expect(html).toContain(DYNAMIC_CLIENT_WARNING);
        expect(html).not.toContain(LOOPBACK_CLIENT_NOTE);
        expect(html).not.toContain("https://example.com/logo.png");
    });
});

describe("team and project choice", () => {
    it("shows a team without MCP as disabled with its reason, and never preselects it", () => {
        const data = details();
        const selection = initialSelection(data);
        expect(selection.teamId).toBe("team-acme");

        const html = render(ready(data, selection));
        expect(html).toMatch(/id="consent-team-team-off"[^>]*disabled=""/);
        expect(html).not.toMatch(/id="consent-team-team-acme"[^>]*disabled=""/);
        expect(html).toContain("A team admin has turned off MCP access for this team.");

        expect(buildAllowBody(data, chooseTeam(selection, "team-off"))).toBeNull();
    });

    it("asks the user to pick when several teams can be chosen", () => {
        const data = details();
        data.teams[1] = { ...data.teams[1], mcpEnabled: true, disabledReason: null };
        const selection = initialSelection(data);
        expect(selection.teamId).toBeNull();
        expect(selectionProblem(data, selection)).toBe("Choose a team.");
        expect(render(ready(data, selection))).toMatch(/<button type="submit" disabled=""/);
    });

    it("explains when no team has MCP turned on", () => {
        const data = details({ teams: [details().teams[1]] });
        const selection = initialSelection(data);
        expect(selection.teamId).toBeNull();
        expect(selectionProblem(data, selection)).toContain("None of your teams has MCP access turned on");
    });

    it("requires at least one project when sharing selected projects", () => {
        const data = details();
        const selected = chooseMode(initialSelection(data), "selected");

        expect(selectionProblem(data, selected)).toBe("Choose at least one project, or choose All projects in this team.");
        expect(buildAllowBody(data, selected)).toBeNull();
        const html = render(ready(data, selected));
        expect(html).toMatch(/<button type="submit" disabled=""/);
        expect(html).toContain("Choose at least one project");
        expect(html).toContain('id="consent-project-proj-ios"');

        const oneProject = toggleProject(selected, "proj-web", true);
        expect(selectionProblem(data, oneProject)).toBeNull();
        expect(buildAllowBody(data, oneProject)).toEqual({ decision: "allow", teamId: "team-acme", projectIds: ["proj-web"] });
        expect(render(ready(data, oneProject))).not.toMatch(/<button type="submit" disabled=""/);

        expect(selectionProblem(data, toggleProject(oneProject, "proj-web", false))).not.toBeNull();
    });

    it("sends the explicit project list for All projects", () => {
        const data = details();
        expect(buildAllowBody(data, initialSelection(data))).toEqual({
            decision: "allow",
            teamId: "team-acme",
            projectIds: ["proj-ios", "proj-web"],
        });
    });

    it("disables both buttons while a decision is in flight", () => {
        const data = details();
        const html = render({ ...ready(data), pending: "allow" } as ConsentScreenState);
        expect(html).toContain("Allowing…");
        expect(html).toMatch(/<button type="button" disabled=""[^>]*>(?:<svg[^>]*>.*?<\/svg>)?Deny/);
        expect(html).toMatch(/<button type="submit" disabled=""/);
    });
});

describe("submitting the decision", () => {
    it("Allow posts the team and projects with the CSRF header and follows redirectTo", async () => {
        const data = details();
        const body = buildAllowBody(data, initialSelection(data));
        expect(body).not.toBeNull();

        const redirectTo = "https://api.rejourney.co/oauth/authorize/test-uid/resume";
        const fetchMock = vi.fn(async (_input: string, _init?: RequestInit) => jsonResponse(200, { redirectTo }));
        const assign = vi.fn();

        const result = await submitConsentDecision({ uid: "test-uid", body: body!, csrfToken: "csrf-123", assign, fetchImpl: fetchMock });

        expect(result).toEqual({ kind: "redirect", redirectTo });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe("/api/mcp/consent/test-uid");
        expect(init?.method).toBe("POST");
        expect(init?.credentials).toBe("include");
        expect((init?.headers as Record<string, string>)["X-CSRF-Token"]).toBe("csrf-123");
        expect((init?.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
        expect(JSON.parse(init?.body as string)).toEqual({
            decision: "allow",
            teamId: "team-acme",
            projectIds: ["proj-ios", "proj-web"],
        });
        expect(assign).toHaveBeenCalledWith(redirectTo);
    });

    it("Deny posts only the decision", async () => {
        const redirectTo = "http://127.0.0.1:53682/callback?error=access_denied&state=s";
        const fetchMock = vi.fn(async (_input: string, _init?: RequestInit) => jsonResponse(200, { redirectTo }));
        const assign = vi.fn();

        await submitConsentDecision({ uid: "test-uid", body: { decision: "deny" }, csrfToken: "csrf-123", assign, fetchImpl: fetchMock });

        expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toEqual({ decision: "deny" });
        expect((fetchMock.mock.calls[0][1]?.headers as Record<string, string>)["X-CSRF-Token"]).toBe("csrf-123");
        expect(assign).toHaveBeenCalledWith(redirectTo);
    });

    it("shows the API message on a 400 and does not navigate", async () => {
        const assign = vi.fn();
        const result = await submitConsentDecision({
            uid: "test-uid",
            body: { decision: "allow", teamId: "team-acme", projectIds: ["proj-ios"] },
            csrfToken: "csrf-123",
            assign,
            fetchImpl: vi.fn(async () => jsonResponse(400, { error: "invalid_project", message: "You no longer have access to Acme iOS." })),
        });
        expect(result).toEqual({ kind: "error", message: "You no longer have access to Acme iOS." });
        expect(assign).not.toHaveBeenCalled();

        const html = render({ ...ready(details()), formError: "You no longer have access to Acme iOS." } as ConsentScreenState);
        expect(html).toContain('role="alert"');
        expect(html).toContain("You no longer have access to Acme iOS.");
        expect(html).not.toMatch(/<button type="submit" disabled=""/);
    });

    it("maps 404 and 401 on submit, and refuses a redirect that is not https", async () => {
        const body = { decision: "deny" } as const;
        const assign = vi.fn();
        expect(await submitConsentDecision({ uid: "u", body, csrfToken: null, assign, fetchImpl: vi.fn(async () => jsonResponse(404, { error: "interaction_not_found", message: "Not found" })) }))
            .toEqual({ kind: "expired" });
        expect(await submitConsentDecision({ uid: "u", body, csrfToken: null, assign, fetchImpl: vi.fn(async () => jsonResponse(401, {})) }))
            .toEqual({ kind: "signed_out" });
        expect(await submitConsentDecision({ uid: "u", body, csrfToken: null, assign, fetchImpl: vi.fn(async () => jsonResponse(200, { redirectTo: "javascript:alert(1)" })) }))
            .toEqual({ kind: "error", message: CONSENT_COPY.badRedirect });
        expect(await submitConsentDecision({ uid: "u", body, csrfToken: null, assign, fetchImpl: vi.fn(async () => jsonResponse(200, { redirectTo: "http://evil.example/cb" })) }))
            .toEqual({ kind: "error", message: CONSENT_COPY.badRedirect });
        expect(assign).not.toHaveBeenCalled();
    });

    it("omits the CSRF header when there is no token", async () => {
        const fetchMock = vi.fn(async (_input: string, _init?: RequestInit) => jsonResponse(200, { redirectTo: "https://api.rejourney.co/x" }));
        await submitConsentDecision({ uid: "u", body: { decision: "deny" }, csrfToken: null, assign: vi.fn(), fetchImpl: fetchMock });
        expect(fetchMock.mock.calls[0][1]?.headers).not.toHaveProperty("X-CSRF-Token");
    });
});
