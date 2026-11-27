/**
 * /oauth/consent?uid=<interaction id>
 *
 * The API's /oauth/authorize sends the browser here when an AI client (for
 * example Claude Code) asks to connect to Rejourney's MCP server. The page loads
 * the request from /api/mcp/consent/:uid, lets the user pick a team and
 * projects, and posts Allow or Deny. The API answers with the URL to return to.
 */

import type { Route } from "./+types/route";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { getCsrfToken } from "~/shared/config/appConfig";
import { useAuth } from "~/shared/providers/AuthContext";
import { ConsentScreen, type ConsentScreenState } from "./ConsentScreen";
import {
    CONSENT_COPY,
    type ConsentDecisionBody,
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
    toggleProject,
} from "./consentSelection";

export const meta: Route.MetaFunction = () => [
    { title: "Connect an AI client - Rejourney" },
    { name: "robots", content: "noindex, nofollow" },
    { name: "referrer", content: "no-referrer" },
];

export const headers: Route.HeadersFunction = () => ({
    "Cache-Control": "no-store, max-age=0",
    "Referrer-Policy": "no-referrer",
    "X-Robots-Tag": "noindex, nofollow",
    "X-Frame-Options": "DENY",
    "Content-Security-Policy": "frame-ancestors 'none'",
});

const EXPIRED_STATE: ConsentScreenState = {
    phase: "message",
    title: "This sign-in request is no longer valid",
    body: CONSENT_COPY.expired,
};
const DISABLED_STATE: ConsentScreenState = {
    phase: "message",
    title: "MCP is not available",
    body: CONSENT_COPY.disabled,
};
const MISSING_UID_STATE: ConsentScreenState = {
    phase: "message",
    title: "No sign-in request",
    body: CONSENT_COPY.missingUid,
};

export default function OAuthConsentRoute() {
    const [searchParams] = useSearchParams();
    const uid = searchParams.get("uid")?.trim() ?? "";
    const navigate = useNavigate();
    const { logout } = useAuth();
    const [state, setState] = useState<ConsentScreenState>(uid ? { phase: "loading" } : MISSING_UID_STATE);
    // Blocks a second decision while one is in flight or after the API accepted one.
    const decisionLocked = useRef(false);

    const goToLogin = useCallback(() => {
        setState({ phase: "redirecting", message: "Opening the sign-in page" });
        navigate(consentLoginPath(uid), { replace: true });
    }, [navigate, uid]);

    useEffect(() => {
        if (!uid) {
            setState(MISSING_UID_STATE);
            return;
        }
        let cancelled = false;
        decisionLocked.current = false;
        setState({ phase: "loading" });
        void loadConsent(uid).then((result) => {
            if (cancelled) return;
            switch (result.kind) {
                case "ready":
                    document.title = `Connect ${result.details.client.name} to Rejourney`;
                    setState({
                        phase: "ready",
                        details: result.details,
                        selection: initialSelection(result.details),
                        pending: null,
                        formError: null,
                    });
                    return;
                case "signed_out":
                    goToLogin();
                    return;
                case "expired":
                    setState(EXPIRED_STATE);
                    return;
                case "disabled":
                    setState(DISABLED_STATE);
                    return;
                case "error":
                    setState({ phase: "message", title: "We couldn't load this sign-in request", body: result.message });
                    return;
            }
        });
        return () => {
            cancelled = true;
        };
    }, [goToLogin, uid]);

    const updateSelection = useCallback((update: (selection: ConsentSelection) => ConsentSelection) => {
        setState((current) => (
            current.phase === "ready" && current.pending === null
                ? { ...current, selection: update(current.selection), formError: null }
                : current
        ));
    }, []);

    const decide = useCallback(async (decision: "allow" | "deny") => {
        if (state.phase !== "ready" || state.pending !== null || state.signingOut || decisionLocked.current) return;
        const body: ConsentDecisionBody | null = decision === "allow"
            ? buildAllowBody(state.details, state.selection)
            : { decision: "deny" };
        if (!body) return;

        const clientName = state.details.client.name;
        decisionLocked.current = true;
        setState((current) => (current.phase === "ready" ? { ...current, pending: decision, formError: null } : current));

        const result = await submitConsentDecision({
            uid,
            body,
            csrfToken: getCsrfToken(),
            assign: (url) => window.location.assign(url),
        });

        switch (result.kind) {
            case "redirect":
                setState({
                    phase: "redirecting",
                    message: decision === "allow" ? `Returning you to ${clientName}` : `Request denied. Returning you to ${clientName}`,
                });
                return;
            case "signed_out":
                goToLogin();
                return;
            case "expired":
                setState(EXPIRED_STATE);
                return;
            case "disabled":
                setState(DISABLED_STATE);
                return;
            case "error":
                decisionLocked.current = false;
                setState((current) => (current.phase === "ready" ? { ...current, pending: null, formError: result.message } : current));
                return;
        }
    }, [goToLogin, state, uid]);

    const signOut = useCallback(async () => {
        if (state.phase !== "ready" || state.pending !== null || state.signingOut) return;
        setState((current) => (current.phase === "ready" ? { ...current, signingOut: true } : current));
        await logout();
        // Full page load so the login page starts clean and brings the user back here.
        window.location.assign(consentLoginPath(uid));
    }, [logout, state, uid]);

    return (
        <ConsentScreen
            state={state}
            onTeamChange={(teamId) => updateSelection((selection) => chooseTeam(selection, teamId))}
            onModeChange={(mode) => updateSelection((selection) => chooseMode(selection, mode))}
            onProjectToggle={(projectId, checked) => updateSelection((selection) => toggleProject(selection, projectId, checked))}
            onAllow={() => void decide("allow")}
            onDeny={() => void decide("deny")}
            onSignOut={() => void signOut()}
        />
    );
}
