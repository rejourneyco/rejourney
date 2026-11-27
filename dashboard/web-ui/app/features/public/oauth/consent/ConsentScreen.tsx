/**
 * Consent screen markup. Stateless: the route owns loading and submitting, so
 * every state can be rendered (and tested) from props alone.
 */

import type { FormEvent } from "react";
import { AlertTriangle, Laptop, Loader2, ShieldCheck } from "lucide-react";
import type { ConsentDetails, ConsentTeam } from "./consentApi";
import {
    type ConsentSelection,
    type ProjectMode,
    findSelectedTeam,
    selectionProblem,
} from "./consentSelection";

export type ConsentPending = "allow" | "deny" | null;

export type ConsentScreenState =
    | { phase: "loading" }
    | { phase: "redirecting"; message: string }
    | { phase: "message"; title: string; body: string }
    | {
        phase: "ready";
        details: ConsentDetails;
        selection: ConsentSelection;
        pending: ConsentPending;
        formError: string | null;
        signingOut?: boolean;
    };

export interface ConsentScreenProps {
    state: ConsentScreenState;
    onTeamChange?: (teamId: string) => void;
    onModeChange?: (mode: ProjectMode) => void;
    onProjectToggle?: (projectId: string, checked: boolean) => void;
    onAllow?: () => void;
    onDeny?: () => void;
    onSignOut?: () => void;
}

export const DYNAMIC_CLIENT_WARNING =
    "This app registered itself; Rejourney has not verified who publishes it. Only continue if you started this from an app you trust.";
export const LOOPBACK_CLIENT_NOTE = "This app runs on your computer.";

const primaryButton =
    "flex min-h-11 w-full items-center justify-center gap-2 rounded-none bg-[#1a73e8] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1765cc] active:bg-[#1967d2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1a73e8] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";
const secondaryButton =
    "flex min-h-11 w-full items-center justify-center gap-2 rounded-none border border-[#dadce0] bg-white px-4 py-2.5 text-sm font-semibold text-[#3c4043] shadow-sm transition hover:bg-[#f8fafd] hover:text-[#202124] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1a73e8] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";
const sectionLabel = "text-xs font-semibold uppercase tracking-wider text-[#5f6368]";
const choiceRow =
    "flex cursor-pointer items-start gap-3 rounded-none border border-[#dadce0] bg-white px-3 py-3 transition hover:bg-[#f8fafd] focus-within:border-[#1a73e8] focus-within:ring-1 focus-within:ring-[#1a73e8]";
const choiceInput = "mt-0.5 h-4 w-4 shrink-0 accent-[#1a73e8] focus-visible:outline-none";

function trustedLogo(details: ConsentDetails): string | null {
    const { logoUri, registration } = details.client;
    // A self-registered client can claim any logo, so only show logos for clients Rejourney knows.
    if (!logoUri || registration === "dynamic") return null;
    try {
        return new URL(logoUri).protocol === "https:" ? logoUri : null;
    } catch {
        return null;
    }
}

function websiteHost(details: ConsentDetails): string | null {
    const { uri, registration } = details.client;
    if (!uri || registration === "dynamic") return null;
    try {
        const url = new URL(uri);
        return url.protocol === "https:" ? url.host : null;
    } catch {
        return null;
    }
}

function formatPlatform(platform: string | null): string | null {
    if (!platform) return null;
    const known: Record<string, string> = { ios: "iOS", android: "Android", web: "Web", "react-native": "React Native" };
    return known[platform.toLowerCase()] ?? platform;
}

function ClientMark({ details }: { details: ConsentDetails }) {
    const logo = trustedLogo(details);
    if (logo) {
        return (
            <img
                src={logo}
                alt=""
                referrerPolicy="no-referrer"
                className="h-12 w-12 shrink-0 rounded-none border border-[#dadce0] bg-white object-contain p-1"
            />
        );
    }
    const initial = details.client.name.trim().charAt(0).toUpperCase() || "?";
    return (
        <span aria-hidden="true" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-none border border-[#dadce0] bg-[#e8f0fe] text-lg font-bold text-[#1a73e8]">
            {initial}
        </span>
    );
}

function TeamChoice({
    team,
    checked,
    disabled,
    onChange,
}: {
    team: ConsentTeam;
    checked: boolean;
    disabled: boolean;
    onChange?: (teamId: string) => void;
}) {
    const inputId = `consent-team-${team.id}`;
    const detailId = `${inputId}-detail`;
    const unavailable = !team.mcpEnabled;
    const projectCount = team.projects.length;
    return (
        <li>
            <label
                htmlFor={inputId}
                className={`${choiceRow} ${unavailable ? "cursor-not-allowed bg-[#f8f9fa] hover:bg-[#f8f9fa]" : ""}`}
            >
                <input
                    id={inputId}
                    type="radio"
                    name="consent-team"
                    value={team.id}
                    checked={checked}
                    disabled={disabled || unavailable}
                    onChange={() => onChange?.(team.id)}
                    aria-describedby={detailId}
                    className={choiceInput}
                />
                <span className="min-w-0 flex-1">
                    <span className={`block break-words text-sm font-semibold ${unavailable ? "text-[#80868b]" : "text-[#202124]"}`}>{team.name}</span>
                    <span id={detailId} className="mt-0.5 block text-xs leading-5 text-[#5f6368]">
                        {unavailable
                            ? team.disabledReason || "MCP access is turned off for this team."
                            : `${team.role} · ${projectCount} ${projectCount === 1 ? "project" : "projects"}`}
                    </span>
                </span>
            </label>
        </li>
    );
}

function ProjectChoice({
    team,
    selection,
    disabled,
    onModeChange,
    onProjectToggle,
}: {
    team: ConsentTeam;
    selection: ConsentSelection;
    disabled: boolean;
    onModeChange?: (mode: ProjectMode) => void;
    onProjectToggle?: (projectId: string, checked: boolean) => void;
}) {
    const count = team.projects.length;
    const chosen = new Set(selection.projectIds);
    return (
        <fieldset className="space-y-2">
            <legend className={`${sectionLabel} mb-2`}>Projects</legend>
            <label htmlFor="consent-projects-all" className={choiceRow}>
                <input
                    id="consent-projects-all"
                    type="radio"
                    name="consent-project-mode"
                    value="all"
                    checked={selection.mode === "all"}
                    disabled={disabled}
                    onChange={() => onModeChange?.("all")}
                    aria-describedby="consent-projects-all-detail"
                    className={choiceInput}
                />
                <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-[#202124]">All projects in this team</span>
                    <span id="consent-projects-all-detail" className="mt-0.5 block text-xs leading-5 text-[#5f6368]">
                        {`The ${count} ${count === 1 ? "project" : "projects"} in ${team.name} today. Projects created later are not included.`}
                    </span>
                </span>
            </label>
            <label htmlFor="consent-projects-selected" className={choiceRow}>
                <input
                    id="consent-projects-selected"
                    type="radio"
                    name="consent-project-mode"
                    value="selected"
                    checked={selection.mode === "selected"}
                    disabled={disabled}
                    onChange={() => onModeChange?.("selected")}
                    className={choiceInput}
                />
                <span className="block text-sm font-semibold text-[#202124]">Only the projects I choose</span>
            </label>
            {selection.mode === "selected" && (
                <fieldset className="ml-3 border-l border-[#dadce0] pl-3 sm:ml-4 sm:pl-4">
                    <legend className="sr-only">Projects to share</legend>
                    <ul className="space-y-1.5">
                        {team.projects.map((project) => {
                            const inputId = `consent-project-${project.id}`;
                            const platform = formatPlatform(project.platform);
                            return (
                                <li key={project.id}>
                                    <label htmlFor={inputId} className={`${choiceRow} py-2.5`}>
                                        <input
                                            id={inputId}
                                            type="checkbox"
                                            name="consent-project"
                                            value={project.id}
                                            checked={chosen.has(project.id)}
                                            disabled={disabled}
                                            onChange={(event) => onProjectToggle?.(project.id, event.currentTarget.checked)}
                                            className={choiceInput}
                                        />
                                        <span className="min-w-0 flex-1 break-words text-sm text-[#202124]">
                                            {project.name}
                                            {platform && <span className="ml-2 text-xs text-[#5f6368]">{platform}</span>}
                                        </span>
                                    </label>
                                </li>
                            );
                        })}
                    </ul>
                </fieldset>
            )}
        </fieldset>
    );
}

function ReadyView({
    state,
    onTeamChange,
    onModeChange,
    onProjectToggle,
    onAllow,
    onDeny,
    onSignOut,
}: ConsentScreenProps & { state: Extract<ConsentScreenState, { phase: "ready" }> }) {
    const { details, selection, pending, formError, signingOut } = state;
    const clientName = details.client.name;
    const busy = pending !== null || Boolean(signingOut);
    const team = findSelectedTeam(details, selection);
    const problem = selectionProblem(details, selection);
    const website = websiteHost(details);

    const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (busy || problem) return;
        onAllow?.();
    };

    return (
        <div className="space-y-6">
            <div className="flex items-start gap-4">
                <ClientMark details={details} />
                <div className="min-w-0">
                    <h1 className="break-words text-[clamp(1.35rem,5vw,1.6rem)] font-bold leading-tight tracking-tight text-[#202124]">
                        Connect {clientName} to Rejourney
                    </h1>
                    <p className="mt-2 text-sm leading-6 text-[#3c4043]">
                        {clientName} is asking to read data from your Rejourney account. Choose which team and projects it can see.
                    </p>
                </div>
            </div>

            <dl className="grid gap-x-4 gap-y-1 border border-[#dadce0] bg-[#f8fafd] px-4 py-3 text-sm sm:grid-cols-[auto_1fr]">
                <dt className="text-[#5f6368]">Sends you back to</dt>
                <dd className="break-all font-mono text-[13px] text-[#202124]">{details.client.redirectHost}</dd>
                {website && (
                    <>
                        <dt className="text-[#5f6368]">Website</dt>
                        <dd className="break-all font-mono text-[13px] text-[#202124]">{website}</dd>
                    </>
                )}
            </dl>

            {details.client.loopbackOnly && (
                <p className="flex items-start gap-2 text-sm leading-6 text-[#3c4043]">
                    <Laptop aria-hidden="true" className="mt-1 h-4 w-4 shrink-0 text-[#5f6368]" />
                    {LOOPBACK_CLIENT_NOTE}
                </p>
            )}

            {details.client.registration === "dynamic" && (
                <div role="note" className="flex items-start gap-2 rounded-none border border-[#f9dfa6] bg-[#fef7e0] p-3 text-sm font-medium leading-6 text-[#7a4f01]">
                    <AlertTriangle aria-hidden="true" className="mt-1 h-4 w-4 shrink-0" />
                    <p>{DYNAMIC_CLIENT_WARNING}</p>
                </div>
            )}

            <p className="text-sm leading-6 text-[#3c4043]">
                Signed in as <span className="break-all font-semibold text-[#202124]">{details.user.email}</span>.{" "}
                <span className="whitespace-nowrap">
                    Not you?{" "}
                    <button
                        type="button"
                        onClick={onSignOut}
                        disabled={busy}
                        className="font-semibold text-[#1a73e8] underline-offset-2 hover:text-[#1765cc] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1a73e8] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:text-[#80868b]"
                    >
                        {signingOut ? "Signing out…" : "Sign out"}
                    </button>
                </span>
            </p>

            <section aria-labelledby="consent-scopes-heading" className="space-y-3">
                <h2 id="consent-scopes-heading" className={sectionLabel}>{clientName} will be able to</h2>
                {details.scopes.length > 0 && (
                    <ul className="space-y-2">
                        {details.scopes.map((scope) => (
                            <li key={scope.id} className="text-sm leading-6">
                                <span className="font-semibold text-[#202124]">{scope.label}</span>
                                {scope.description && <span className="block text-[#5f6368]">{scope.description}</span>}
                            </li>
                        ))}
                    </ul>
                )}
                <p className="flex items-start gap-2 rounded-none border border-[#ceead6] bg-[#e6f4ea] p-3 text-sm font-medium leading-6 text-[#137333]">
                    <ShieldCheck aria-hidden="true" className="mt-1 h-4 w-4 shrink-0" />
                    <span>Read-only. {clientName} cannot create, change or delete anything in Rejourney.</span>
                </p>
            </section>

            <form onSubmit={handleSubmit} noValidate className="space-y-6" aria-describedby={problem ? "consent-allow-hint" : undefined}>
                <fieldset className="space-y-2">
                    <legend className={`${sectionLabel} mb-2`}>Team</legend>
                    {details.teams.length === 0 ? (
                        <p className="text-sm text-[#3c4043]">You are not a member of any team.</p>
                    ) : (
                        <ul className="space-y-2">
                            {details.teams.map((option) => (
                                <TeamChoice
                                    key={option.id}
                                    team={option}
                                    checked={selection.teamId === option.id}
                                    disabled={busy}
                                    onChange={onTeamChange}
                                />
                            ))}
                        </ul>
                    )}
                </fieldset>

                {team && team.projects.length > 0 && (
                    <ProjectChoice
                        team={team}
                        selection={selection}
                        disabled={busy}
                        onModeChange={onModeChange}
                        onProjectToggle={onProjectToggle}
                    />
                )}

                <div aria-live="polite" className="space-y-3 empty:hidden">
                    {problem && details.teams.length > 0 && (
                        <p id="consent-allow-hint" className="text-sm font-medium leading-6 text-[#5f6368]">{problem}</p>
                    )}
                    {formError && (
                        <div role="alert" className="rounded-none border border-[#f5c6cb] bg-[#fdf7f7] p-3 text-sm font-medium text-[#721c24]">
                            {formError}
                        </div>
                    )}
                </div>

                <div className="flex flex-col-reverse gap-3 sm:flex-row">
                    <button type="button" onClick={onDeny} disabled={busy} className={secondaryButton}>
                        {pending === "deny" && <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />}
                        {pending === "deny" ? "Denying…" : "Deny"}
                    </button>
                    <button type="submit" disabled={busy || Boolean(problem)} className={primaryButton}>
                        {pending === "allow" && <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />}
                        {pending === "allow" ? "Allowing…" : "Allow"}
                    </button>
                </div>

                <p className="text-xs leading-5 text-[#5f6368]">
                    You can remove this access at any time from the MCP page in your Rejourney dashboard.
                </p>
            </form>
        </div>
    );
}

export function ConsentScreen(props: ConsentScreenProps) {
    const { state } = props;
    return (
        <main className="public-readable-scope soft-border-scope rejourney-login-page relative flex min-h-svh w-full justify-center bg-[var(--dashboard-canvas,#f8fafd)] px-4 py-8 text-[#202124] sm:px-8 sm:py-12">
            <div className="rejourney-login-panel mx-auto w-full max-w-[520px]">
                <div className="mb-6 flex justify-center sm:mb-8">
                    <a href="/" className="flex items-center gap-2.5 rounded-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1a73e8] focus-visible:ring-offset-4">
                        <img src="/rejourneyIcon-removebg-preview.png" alt="" className="h-8 w-8 object-contain" />
                        <span className="font-sans text-lg font-bold tracking-tight text-[#202124]">Rejourney</span>
                    </a>
                </div>

                <section className="rounded-none border border-[#dadce0] bg-white p-6 text-[#202124] shadow-sm sm:p-8">
                    {state.phase === "loading" && (
                        <div className="py-8 text-center" role="status" aria-live="polite">
                            <Loader2 aria-hidden="true" className="mx-auto h-7 w-7 animate-spin text-[#1a73e8]" />
                            <h1 className="mt-5 text-xl font-bold">Loading the sign-in request</h1>
                        </div>
                    )}
                    {state.phase === "redirecting" && (
                        <div className="py-8 text-center" role="status" aria-live="polite">
                            <Loader2 aria-hidden="true" className="mx-auto h-7 w-7 animate-spin text-[#1a73e8]" />
                            <h1 className="mt-5 text-xl font-bold">{state.message}</h1>
                        </div>
                    )}
                    {state.phase === "message" && (
                        <div className="py-4" role="alert">
                            <h1 className="text-[clamp(1.35rem,5vw,1.6rem)] font-bold leading-tight tracking-tight text-[#202124]">{state.title}</h1>
                            <p className="mt-3 text-sm leading-6 text-[#3c4043]">{state.body}</p>
                        </div>
                    )}
                    {state.phase === "ready" && <ReadyView {...props} state={state} />}
                </section>
            </div>
        </main>
    );
}
