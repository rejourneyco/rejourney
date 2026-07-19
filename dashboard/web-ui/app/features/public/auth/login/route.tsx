/**
 * Rejourney Dashboard - Login Page Route
 */

import type { Route } from "./+types/route";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, redirect, useNavigate, useSearchParams } from "react-router";
import { ArrowLeft, Github, Loader2, LockKeyhole, Mail, ChevronLeft, ChevronRight } from "lucide-react";
import { Input } from "~/shared/ui/core/Input";
import { useAuth } from "~/shared/providers/AuthContext";
import { AuthServiceUnavailable } from "~/shared/ui/core/AuthServiceUnavailable";
import { trackAccountActivationSignal, type AccountActivationMethod } from "~/shared/lib/edgeSignals";
import { getFingerprint } from "~/shared/lib/fingerprint";
import { loadAuthBootstrap } from "~/shell/server/dashboardBootstrap";
import { SankeyPanel } from "~/features/public/home/components/AiLeakHomepage";

const ACCOUNT_ACTIVATED_PARAM = "account_activated";
const RESEND_COOLDOWN_SECONDS = 30;

type LoginStep = "email" | "otp";
type PendingAction = "send" | "verify" | "resend" | "opening" | null;

function readAccountActivationMethod(value: string | null): AccountActivationMethod | null {
    return value === "github" || value === "otp" ? value : null;
}

function safeReturnPath(value: string | null): string | null {
    return value?.startsWith("/") && !value.startsWith("//") ? value : null;
}

export async function loader({ request }: Route.LoaderArgs) {
    const url = new URL(request.url);
    const authBootstrap = await loadAuthBootstrap(request);
    const activationMethod = readAccountActivationMethod(url.searchParams.get(ACCOUNT_ACTIVATED_PARAM));

    if (authBootstrap.user && !activationMethod) {
        throw redirect(safeReturnPath(url.searchParams.get("returnTo")) ?? "/dashboard");
    }

    return authBootstrap;
}

export const meta: Route.MetaFunction = () => [
    { title: "Sign In - Rejourney" },
    {
        name: "description",
        content: "Sign in to your Rejourney dashboard. Access session replays, crash reports, and analytics.",
    },
    { name: "robots", content: "noindex, follow" },
    { property: "og:title", content: "Sign In - Rejourney" },
    { property: "og:url", content: "https://rejourney.co/login" },
    { tagName: "link", rel: "canonical", href: "https://rejourney.co/login" },
];

export default function LoginPage() {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const {
        user,
        sendOtp,
        login,
        loginWithGitHub,
        refreshUser,
        error: authError,
        isAuthenticated,
        isLoading: authLoading,
        authServiceUnavailable,
    } = useAuth();
    const pendingAccountActivationMethod = readAccountActivationMethod(searchParams.get(ACCOUNT_ACTIVATED_PARAM));
    const [step, setStep] = useState<LoginStep>("email");
    const [email, setEmail] = useState("");
    const [otp, setOtp] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [statusMessage, setStatusMessage] = useState<string | null>(null);
    const [pendingAction, setPendingAction] = useState<PendingAction>(
        pendingAccountActivationMethod ? "opening" : null,
    );
    const [resendCooldown, setResendCooldown] = useState(0);
    const [isRetryingAuth, setIsRetryingAuth] = useState(false);
    const postLoginNavigationStarted = useRef(false);
    const [activeSuccessStory, setActiveSuccessStory] = useState<'burst' | 'merch'>('burst');

    const getPostLoginDestination = useCallback(() => {
        if (typeof window === "undefined") return "/dashboard";

        const returnUrl = safeReturnPath(localStorage.getItem("returnUrl"));
        if (returnUrl) {
            localStorage.removeItem("returnUrl");
            return returnUrl;
        }

        return "/dashboard";
    }, []);

    const navigateToPostLoginDestination = useCallback((
        accountActivationMethod?: AccountActivationMethod | null,
        conversionIdentity?: { userId: string; email: string } | null,
    ) => {
        if (postLoginNavigationStarted.current) return;

        postLoginNavigationStarted.current = true;
        setPendingAction("opening");
        if (accountActivationMethod) {
            void trackAccountActivationSignal(accountActivationMethod, conversionIdentity ?? undefined);
        }
        navigate(getPostLoginDestination(), { replace: true });
    }, [getPostLoginDestination, navigate]);

    useEffect(() => {
        if (typeof window === "undefined") return;
        const returnTo = safeReturnPath(searchParams.get("returnTo"));
        if (returnTo) localStorage.setItem("returnUrl", returnTo);
    }, [searchParams]);

    useEffect(() => {
        if (!pendingAccountActivationMethod || typeof window === "undefined") return;
        const url = new URL(window.location.href);
        url.searchParams.delete(ACCOUNT_ACTIVATED_PARAM);
        window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    }, [pendingAccountActivationMethod]);

    useEffect(() => {
        if (authLoading || !isAuthenticated) return;
        navigateToPostLoginDestination(
            pendingAccountActivationMethod,
            user ? { userId: user.id, email: user.email } : null,
        );
    }, [authLoading, isAuthenticated, navigateToPostLoginDestination, pendingAccountActivationMethod, user]);

    useEffect(() => {
        if (typeof window === "undefined") return;
        const idleWindow = window as typeof window & {
            cancelIdleCallback?: (handle: number) => void;
            requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
        };

        if (idleWindow.requestIdleCallback) {
            const handle = idleWindow.requestIdleCallback(() => void getFingerprint(), { timeout: 1500 });
            return () => idleWindow.cancelIdleCallback?.(handle);
        }

        const timeout = window.setTimeout(() => void getFingerprint(), 250);
        return () => window.clearTimeout(timeout);
    }, []);

    useEffect(() => {
        if (resendCooldown <= 0) return;
        const timer = window.setTimeout(() => setResendCooldown((seconds) => Math.max(seconds - 1, 0)), 1000);
        return () => window.clearTimeout(timer);
    }, [resendCooldown]);

    const handleRetryAuthCheck = useCallback(async () => {
        setIsRetryingAuth(true);
        setError(null);
        try {
            const freshUser = await refreshUser();
            if (freshUser) navigateToPostLoginDestination(pendingAccountActivationMethod);
        } finally {
            setIsRetryingAuth(false);
        }
    }, [navigateToPostLoginDestination, pendingAccountActivationMethod, refreshUser]);

    const handleSendOtp = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const targetEmail = email.trim();
        if (!targetEmail) {
            setError("Enter your email address.");
            return;
        }

        setEmail(targetEmail);
        setError(null);
        setStatusMessage(null);
        setPendingAction("send");
        try {
            const result = await sendOtp(targetEmail);
            if (!result.ok) {
                setError(result.message || authError || "We couldn't send a sign-in code.");
                return;
            }
            setStep("otp");
            setResendCooldown(RESEND_COOLDOWN_SECONDS);
        } catch (caughtError) {
            setError(caughtError instanceof Error ? caughtError.message : "We couldn't send a sign-in code.");
        } finally {
            setPendingAction(null);
        }
    };

    const handleVerifyOtp = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (otp.length !== 10) return;

        setError(null);
        setStatusMessage(null);
        setPendingAction("verify");
        try {
            const result = await login(email, otp);
            if (!result.ok) {
                setError(result.message || authError || "That code is invalid or has expired.");
                setPendingAction(null);
                return;
            }
            navigateToPostLoginDestination(
                result.accountActivated ? "otp" : null,
                result.userId && result.email ? { userId: result.userId, email: result.email } : null,
            );
        } catch (caughtError) {
            setPendingAction(null);
            setError(caughtError instanceof Error ? caughtError.message : "That code is invalid or has expired.");
        }
    };

    const handleResendOtp = async () => {
        if (pendingAction || resendCooldown > 0) return;

        setError(null);
        setStatusMessage(null);
        setPendingAction("resend");
        try {
            const result = await sendOtp(email);
            if (!result.ok) {
                setError(result.message || authError || "We couldn't resend the code.");
                return;
            }
            setOtp("");
            setResendCooldown(RESEND_COOLDOWN_SECONDS);
            setStatusMessage("A new sign-in code was sent.");
        } catch (caughtError) {
            setError(caughtError instanceof Error ? caughtError.message : "We couldn't resend the code.");
        } finally {
            setPendingAction(null);
        }
    };

    const handleChangeEmail = () => {
        setStep("email");
        setOtp("");
        setError(null);
        setStatusMessage(null);
        setResendCooldown(0);
    };

    const handleGitHubLogin = () => {
        setPendingAction("opening");
        loginWithGitHub();
    };

    const isOpening = pendingAction === "opening" || authLoading || isAuthenticated;

    return (
        <main className="rejourney-login-page relative grid min-h-svh w-full bg-[#fdfbf7] text-slate-900 xl:grid-cols-[minmax(0,1.08fr)_minmax(440px,0.92fr)]">
            <a
                href="#login-form"
                className="sr-only z-[100] border-2 border-black bg-white px-4 py-3 font-bold text-black shadow-neo-sm focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
            >
                Skip to sign in
            </a>

            {/* Left side: supporting context, reserved for genuinely wide screens. */}
            <div className="relative hidden min-h-0 select-none grid-rows-[auto_1fr_auto] gap-8 overflow-hidden border-r border-black/15 bg-white px-10 py-9 xl:grid 2xl:px-16 2xl:py-12">
                <div className="pointer-events-none absolute inset-0 opacity-[0.03] [background-image:radial-gradient(#000_1px,transparent_1px)] [background-size:20px_20px]" />

                {/* Logo top left */}
                <div>
                    <Link to="/" className="inline-flex items-center gap-2.5 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-4">
                        <img src="/rejourneyIcon-removebg-preview.png" alt="" className="h-8 w-8 object-contain" />
                        <span className="text-lg font-black uppercase tracking-tight text-slate-950 font-sans">Rejourney</span>
                    </Link>
                </div>

                {/* Inline Customer Success Gallery */}
                <div className="w-full max-w-[640px] self-center justify-self-center">
                    <div className="mb-5 flex items-end justify-between gap-5">
                        <div>
                            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Customer success</p>
                            <h2 className="mt-1 max-w-md text-2xl font-black uppercase tracking-tight text-slate-955 2xl:text-[1.7rem]">One story at a time.</h2>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                            <button
                                type="button"
                                onClick={() => setActiveSuccessStory(activeSuccessStory === 'burst' ? 'merch' : 'burst')}
                                className="flex h-11 w-11 items-center justify-center rounded-none border-2 border-black bg-white text-black shadow-neo-sm transition-[background-color,box-shadow,transform] motion-safe:hover:-translate-y-0.5 hover:bg-slate-50 active:translate-y-0 active:shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2"
                                aria-label="Previous story"
                            >
                                <ChevronLeft className="h-4 w-4 stroke-[2.5px]" />
                            </button>
                            <button
                                type="button"
                                onClick={() => setActiveSuccessStory(activeSuccessStory === 'burst' ? 'merch' : 'burst')}
                                className="flex h-11 w-11 items-center justify-center rounded-none border-2 border-black bg-white text-black shadow-neo-sm transition-[background-color,box-shadow,transform] motion-safe:hover:-translate-y-0.5 hover:bg-slate-50 active:translate-y-0 active:shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2"
                                aria-label="Next story"
                            >
                                <ChevronRight className="h-4 w-4 stroke-[2.5px]" />
                            </button>
                        </div>
                    </div>

                    {/* Case study card — yellow background to match homepage */}
                    <div className="overflow-hidden rounded-none border-2 border-black bg-[#fef08a] p-5 shadow-neo text-black 2xl:p-6">
                        {activeSuccessStory === 'burst' ? (
                            <div>
                                <div className="mb-5 flex items-center gap-3">
                                    <div className="h-10 w-10 shrink-0 overflow-hidden rounded-full border border-black bg-white shadow-neo-sm">
                                        <img src="/images/burst-creatine-logo-red.png" alt="Burst Creatine" className="h-full w-full object-cover" />
                                    </div>
                                    <div>
                                        <h3 className="font-sans text-base font-black uppercase leading-tight text-slate-955">Burst Creatine</h3>
                                        <p className="text-[11px] font-bold text-slate-800">Increased sales by 103%</p>
                                    </div>
                                </div>

                                <div className="grid gap-4 sm:grid-cols-2">
                                    <SankeyPanel
                                        title="Before Rejourney"
                                        addToCart={6810}
                                        checkout={2130}
                                        accent="#f87171"
                                        accentLight="rgba(248,113,113,0.22)"
                                        dropColor="#94a3b8"
                                        dropLight="rgba(148,163,184,0.14)"
                                    />
                                    <SankeyPanel
                                        title="After Rejourney"
                                        addToCart={6810}
                                        checkout={4319}
                                        accent="#34d399"
                                        accentLight="rgba(52,211,153,0.22)"
                                        dropColor="#94a3b8"
                                        dropLight="rgba(148,163,184,0.12)"
                                    />
                                </div>

                                <p className="mt-5 text-center text-xs font-bold leading-relaxed text-slate-800">
                                    Same Meta Ads Budget. <span className="text-emerald-700 font-extrabold">+2,189 more checkouts</span> from fixing easy UX leaks.
                                </p>
                            </div>
                        ) : (
                            <div>
                                <div className="mb-5 flex items-center gap-3">
                                    <div className="h-10 w-10 shrink-0 overflow-hidden rounded-full border border-black bg-white shadow-neo-sm">
                                        <img src="/images/customer-onboarding-logo.png" alt="Campus Merch Live" className="h-full w-full object-cover" />
                                    </div>
                                    <div>
                                        <h3 className="font-sans text-base font-black uppercase leading-tight text-slate-955 animate-fade-in">Campus Merch Live</h3>
                                        <p className="text-[11px] font-bold text-slate-800">79% to 93% onboarding rate</p>
                                    </div>
                                </div>

                                <div className="grid gap-4 sm:grid-cols-2">
                                    <SankeyPanel
                                        title="Before Rejourney"
                                        addToCart={4500}
                                        checkout={3555}
                                        accent="#f87171"
                                        accentLight="rgba(248,113,113,0.22)"
                                        dropColor="#94a3b8"
                                        dropLight="rgba(148,163,184,0.14)"
                                    />
                                    <SankeyPanel
                                        title="After Rejourney"
                                        addToCart={4500}
                                        checkout={4185}
                                        accent="#34d399"
                                        accentLight="rgba(52,211,153,0.22)"
                                        dropColor="#94a3b8"
                                        dropLight="rgba(148,163,184,0.12)"
                                    />
                                </div>

                                <p className="mt-5 text-center text-xs font-bold leading-relaxed text-slate-800">
                                    Same Onboarding Traffic. <span className="text-emerald-700 font-extrabold">+630 more verified users</span> from fixing safari layout bug.
                                </p>
                            </div>
                        )}
                    </div>
                </div>

                {/* Footer note */}
                <div>
                    <p className="text-[10px] font-semibold text-slate-400">© {new Date().getFullYear()} Rejourney. All rights reserved.</p>
                </div>
            </div>

            {/* Right side: Login Form */}
            <div className="rejourney-login-panel relative flex min-h-svh items-center justify-center bg-[#fdfbf7] px-4 py-8 sm:px-8 sm:py-10 xl:min-h-0 xl:px-10 2xl:px-14">
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(99,102,241,0.03),_transparent_42%)]" />
                <div className="relative mx-auto w-full max-w-[460px]">
                    {/* Small logo for mobile */}
                    <div className="mb-6 flex flex-col items-center xl:hidden sm:mb-8">
                        <Link to="/" className="flex items-center gap-2.5 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-4">
                            <img src="/rejourneyIcon-removebg-preview.png" alt="" className="h-8 w-8 object-contain" />
                            <span className="text-lg font-black uppercase tracking-tight text-slate-950 font-sans">Rejourney</span>
                        </Link>
                    </div>

                    <section id="login-form" tabIndex={-1} className="scroll-mt-6 rounded-none border-2 border-black bg-white p-5 text-black shadow-neo sm:p-8">
                        {authServiceUnavailable && step === "email" && !isOpening ? (
                            <AuthServiceUnavailable
                                variant="panel"
                                detail={authError}
                                isRetrying={isRetryingAuth}
                                onRetry={handleRetryAuthCheck}
                            />
                        ) : isOpening ? (
                            <div className="py-8 text-center" aria-live="polite">
                                <Loader2 className="mx-auto h-7 w-7 animate-spin text-black" />
                                <h1 className="mt-5 text-xl font-black uppercase">Opening your workspace</h1>
                                <p className="mt-2 text-sm font-bold text-slate-700">Your dashboard is loading now.</p>
                            </div>
                        ) : step === "email" ? (
                            <form onSubmit={handleSendOtp} className="space-y-6" aria-describedby="login-security-note">
                                <div>
                                    <h1 className="text-[clamp(1.45rem,5.5vw,1.75rem)] font-black uppercase leading-[1.08] tracking-tight">Welcome to Rejourney</h1>
                                    <p className="mt-2.5 text-sm font-semibold leading-6 text-slate-700">
                                        Sign in or create an account with your work email.
                                    </p>
                                </div>

                                <div className="space-y-1.5">
                                    <label htmlFor="login-email" className="text-xs font-black uppercase tracking-wider text-slate-800">Email address</label>
                                    <Input
                                        id="login-email"
                                        type="email"
                                        value={email}
                                        onChange={(event) => setEmail(event.target.value)}
                                        placeholder="you@company.com"
                                        autoComplete="email"
                                        inputMode="email"
                                        aria-invalid={error ? true : undefined}
                                        autoFocus
                                        className="h-12 rounded-none border-2 border-black bg-white text-base text-black shadow-neo-sm focus-visible:border-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200"
                                    />
                                </div>

                                {error && (
                                    <div role="alert" className="rounded-none border border-black bg-[#fee2e2] p-3 text-sm font-bold text-red-955 shadow-neo-sm">
                                        {error}
                                    </div>
                                )}

                                <button
                                    type="submit"
                                    disabled={!email.trim() || pendingAction === "send"}
                                    className="flex min-h-12 w-full items-center justify-center gap-2 rounded-none border-2 border-black bg-[#86efac] px-4 py-3 text-sm font-black uppercase text-black shadow-neo-sm transition-[background-color,box-shadow,transform] motion-safe:hover:-translate-y-0.5 hover:bg-[#6ee7a0] active:translate-y-0 active:shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:translate-y-0"
                                >
                                    {pendingAction === "send" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                                    {pendingAction === "send" ? "Sending code…" : "Email me a sign-in code"}
                                </button>

                                <div className="flex items-center gap-3" aria-hidden="true">
                                    <span className="h-px flex-1 bg-black/20" />
                                    <span className="text-xs font-black uppercase text-slate-550">or</span>
                                    <span className="h-px flex-1 bg-black/20" />
                                </div>

                                <button
                                    type="button"
                                    onClick={handleGitHubLogin}
                                    className="flex min-h-12 w-full items-center justify-center gap-2 rounded-none border-2 border-black bg-white px-4 py-3 text-sm font-black uppercase text-black shadow-neo-sm transition-[background-color,box-shadow,transform] motion-safe:hover:-translate-y-0.5 hover:bg-[#ecfeff] active:translate-y-0 active:shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2"
                                >
                                    <Github className="h-4 w-4" />
                                    Continue with GitHub
                                </button>
                            </form>
                        ) : (
                            <form onSubmit={handleVerifyOtp} className="space-y-6" aria-describedby="login-security-note">
                                <div>
                                    <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-none border border-black bg-[#c4b5fd] text-black shadow-neo-sm">
                                        <LockKeyhole className="h-5 w-5" />
                                    </div>
                                    <h1 className="text-[clamp(1.45rem,5.5vw,1.75rem)] font-black uppercase leading-[1.08] tracking-tight">Check your email</h1>
                                    <p className="mt-2 text-sm font-bold leading-6 text-slate-700">
                                        Enter the 10-character code sent to <span className="font-black text-black">{email}</span>.
                                    </p>
                                </div>

                                <div className="space-y-1.5">
                                    <label htmlFor="login-otp" className="text-xs font-black uppercase tracking-wider text-slate-800">Sign-in code</label>
                                    <Input
                                        id="login-otp"
                                        type="text"
                                        value={otp}
                                        onChange={(event) => setOtp(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10))}
                                        placeholder="XXXXXXXXXX"
                                        autoComplete="one-time-code"
                                        autoCapitalize="characters"
                                        spellCheck={false}
                                        maxLength={10}
                                        aria-invalid={error ? true : undefined}
                                        autoFocus
                                        className="h-14 rounded-none border-2 border-black bg-white text-center font-mono text-lg uppercase tracking-[0.22em] text-black shadow-neo-sm focus-visible:border-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 sm:text-xl sm:tracking-[0.35em]"
                                    />
                                </div>

                                <div aria-live="polite">
                                    {error && (
                                        <div role="alert" className="rounded-none border border-black bg-[#fee2e2] p-3 text-sm font-bold text-red-955 shadow-neo-sm">
                                            {error}
                                        </div>
                                    )}
                                    {statusMessage && !error && (
                                        <div className="rounded-none border border-black bg-[#86efac] p-3 text-sm font-bold text-emerald-955 shadow-neo-sm">
                                            {statusMessage}
                                        </div>
                                    )}
                                </div>

                                <button
                                    type="submit"
                                    disabled={otp.length !== 10 || pendingAction !== null}
                                    className="flex min-h-12 w-full items-center justify-center gap-2 rounded-none border-2 border-black bg-[#86efac] px-4 py-3 text-sm font-black uppercase text-black shadow-neo-sm transition-[background-color,box-shadow,transform] motion-safe:hover:-translate-y-0.5 hover:bg-[#6ee7a0] active:translate-y-0 active:shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:translate-y-0"
                                >
                                    {pendingAction === "verify" && <Loader2 className="h-4 w-4 animate-spin" />}
                                    {pendingAction === "verify" ? "Verifying…" : "Enter dashboard"}
                                </button>

                                <div className="flex flex-col items-start justify-between gap-3 text-sm min-[380px]:flex-row min-[380px]:items-center">
                                    <button type="button" onClick={handleChangeEmail} disabled={pendingAction !== null} className="inline-flex min-h-11 items-center gap-1.5 rounded-sm font-black uppercase text-slate-700 hover:text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2 disabled:opacity-50">
                                        <ArrowLeft className="h-3.5 w-3.5" /> Change email
                                    </button>
                                    <button type="button" onClick={handleResendOtp} disabled={pendingAction !== null || resendCooldown > 0} className="min-h-11 rounded-sm font-black uppercase text-indigo-700 hover:text-indigo-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:text-slate-400">
                                        {pendingAction === "resend" ? "Sending…" : resendCooldown > 0 ? `Resend in ${resendCooldown}s` : "Resend code"}
                                    </button>
                                </div>
                            </form>
                        )}
                    </section>

                    <p id="login-security-note" className="mt-5 text-center text-xs font-semibold leading-5 text-slate-500 sm:mt-6">
                        Secure passwordless sign-in · Codes expire after 5 minutes
                    </p>
                </div>
            </div>
        </main>
    );
}
