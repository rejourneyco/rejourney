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
type AccountActivationMethod = "otp" | "github";
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
        <main className="public-readable-scope soft-border-scope rejourney-login-page relative grid min-h-svh w-full bg-[var(--dashboard-canvas,#f8fafd)] text-[#202124] xl:grid-cols-[minmax(0,1.08fr)_minmax(440px,0.92fr)]">
            <a
                href="#login-form"
                className="sr-only z-[100] border border-[#dadce0] bg-white px-4 py-3 font-semibold text-[#202124] shadow-sm focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
            >
                Skip to sign in
            </a>

            {/* Left side: supporting context, reserved for genuinely wide screens. */}
            <div className="relative hidden min-h-0 select-none grid-rows-[auto_1fr_auto] gap-8 overflow-hidden border-r border-[#dadce0] bg-white px-10 py-9 xl:grid 2xl:px-16 2xl:py-12">
                <div className="pointer-events-none absolute inset-0 opacity-[0.03] [background-image:radial-gradient(#000_1px,transparent_1px)] [background-size:20px_20px]" />

                {/* Logo top left */}
                <div>
                    <Link to="/" className="inline-flex items-center gap-2.5 rounded-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1a73e8] focus-visible:ring-offset-4">
                        <img src="/rejourneyIcon-removebg-preview.png" alt="" className="h-8 w-8 object-contain" />
                        <span className="text-lg font-bold tracking-tight text-[#202124] font-sans">Rejourney</span>
                    </Link>
                </div>

                {/* Inline Customer Success Gallery */}
                <div className="w-full max-w-[760px] self-center justify-self-center px-4">
                    <div className="mb-5 flex items-end justify-between gap-5">
                        <div>
                            <p className="text-xs font-semibold uppercase tracking-wider text-[#5f6368]">Customer success</p>
                            <h2 className="mt-1 max-w-md text-2xl font-bold tracking-tight text-[#202124] 2xl:text-[1.7rem]">One story at a time.</h2>
                        </div>
                    </div>

                    <div className="relative px-14 sm:px-20">
                        {/* Side Gallery Navigation */}
                        <button
                            type="button"
                            onClick={() => setActiveSuccessStory(activeSuccessStory === 'burst' ? 'merch' : 'burst')}
                            className="absolute left-0 sm:left-2 top-1/2 -translate-y-1/2 z-20 flex h-10 w-10 items-center justify-center rounded-none border border-[#dadce0] bg-white text-[#3c4043] shadow-sm transition-all hover:bg-[#f8fafd] hover:text-[#202124] shrink-0"
                            aria-label="Previous story"
                        >
                            <ChevronLeft className="h-4 w-4" />
                        </button>
                        <button
                            type="button"
                            onClick={() => setActiveSuccessStory(activeSuccessStory === 'burst' ? 'merch' : 'burst')}
                            className="absolute right-0 sm:right-2 top-1/2 -translate-y-1/2 z-20 flex h-10 w-10 items-center justify-center rounded-none border border-[#dadce0] bg-white text-[#3c4043] shadow-sm transition-all hover:bg-[#f8fafd] hover:text-[#202124] shrink-0"
                            aria-label="Next story"
                        >
                            <ChevronRight className="h-4 w-4" />
                        </button>

                        {/* Case study card — white background */}
                        <div className="overflow-hidden rounded-none border border-[#dadce0] bg-white p-5 shadow-sm text-[#202124] 2xl:p-6">
                            {activeSuccessStory === 'burst' ? (
                                <div>
                                    <div className="mb-5 flex items-center gap-3">
                                        <div className="h-10 w-10 shrink-0 overflow-hidden rounded-none border border-[#dadce0] bg-white shadow-sm">
                                            <img src="/images/burst-creatine-logo-red.png" alt="Burst Creatine" className="h-full w-full object-cover" />
                                        </div>
                                        <div>
                                            <h3 className="font-sans text-base font-bold leading-tight text-[#202124]">Burst Creatine</h3>
                                            <p className="text-[11px] font-medium text-[#5f6368]">Increased sales by 103%</p>
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

                                    <p className="mt-5 text-center text-xs font-medium leading-relaxed text-[#3c4043]">
                                        Same Meta Ads Budget. <span className="text-[#137333] font-semibold">+2,189 more checkouts</span> from fixing easy UX leaks.
                                    </p>
                                </div>
                            ) : (
                                <div>
                                    <div className="mb-5 flex items-center gap-3">
                                        <div className="h-10 w-10 shrink-0 overflow-hidden rounded-none border border-[#dadce0] bg-white shadow-sm">
                                            <img src="/images/customer-onboarding-logo.png" alt="Campus Merch Live" className="h-full w-full object-cover" />
                                        </div>
                                        <div>
                                            <h3 className="font-sans text-base font-bold leading-tight text-[#202124] animate-fade-in">Campus Merch Live</h3>
                                            <p className="text-[11px] font-medium text-[#5f6368]">79% to 93% onboarding rate</p>
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

                                    <p className="mt-5 text-center text-xs font-medium leading-relaxed text-[#3c4043]">
                                        Same Onboarding Traffic. <span className="text-[#137333] font-semibold">+630 more verified users</span> from fixing safari layout bug.
                                    </p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Footer note */}
                <div>
                    <p className="text-[10px] font-medium text-[#5f6368]">© {new Date().getFullYear()} Rejourney. All rights reserved.</p>
                </div>
            </div>

            {/* Right side: Login Form */}
            <div className="rejourney-login-panel relative flex min-h-svh items-center justify-center bg-[var(--dashboard-canvas,#f8fafd)] px-4 py-8 sm:px-8 sm:py-10 xl:min-h-0 xl:px-10 2xl:px-14">
                <div className="relative mx-auto w-full max-w-[460px]">
                    {/* Small logo for mobile */}
                    <div className="mb-6 flex flex-col items-center xl:hidden sm:mb-8">
                        <Link to="/" className="flex items-center gap-2.5 rounded-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1a73e8] focus-visible:ring-offset-4">
                            <img src="/rejourneyIcon-removebg-preview.png" alt="" className="h-8 w-8 object-contain" />
                            <span className="text-lg font-bold tracking-tight text-[#202124] font-sans">Rejourney</span>
                        </Link>
                    </div>

                    <section id="login-form" tabIndex={-1} className="scroll-mt-6 rounded-none border border-[#dadce0] bg-white p-6 text-[#202124] shadow-sm sm:p-8">
                        {authServiceUnavailable && step === "email" && !isOpening ? (
                            <AuthServiceUnavailable
                                variant="panel"
                                detail={authError}
                                isRetrying={isRetryingAuth}
                                onRetry={handleRetryAuthCheck}
                            />
                        ) : isOpening ? (
                            <div className="py-8 text-center" aria-live="polite">
                                <Loader2 className="mx-auto h-7 w-7 animate-spin text-[#1a73e8]" />
                                <h1 className="mt-5 text-xl font-bold">Opening your workspace</h1>
                                <p className="mt-2 text-sm font-medium text-[#5f6368]">Your dashboard is loading now.</p>
                            </div>
                        ) : step === "email" ? (
                            <form onSubmit={handleSendOtp} className="space-y-6" aria-describedby="login-security-note">
                                <div>
                                    <h1 className="text-[clamp(1.45rem,5.5vw,1.75rem)] font-bold leading-tight tracking-tight text-[#202124]">Welcome to Rejourney</h1>
                                    <p className="mt-2 text-sm font-normal leading-6 text-[#3c4043]">
                                        Sign in or create an account with your work email.
                                    </p>
                                </div>

                                <div className="space-y-1.5">
                                    <label htmlFor="login-email" className="text-xs font-semibold uppercase tracking-wider text-[#5f6368]">Email address</label>
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
                                        className="h-11 rounded-none border border-[#dadce0] bg-white text-sm text-[#202124] focus-visible:border-[#1a73e8] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#1a73e8]"
                                    />
                                </div>

                                {error && (
                                    <div role="alert" className="rounded-none border border-[#f5c6cb] bg-[#fdf7f7] p-3 text-sm font-medium text-[#721c24]">
                                        {error}
                                    </div>
                                )}

                                <button
                                    type="submit"
                                    disabled={!email.trim() || pendingAction === "send"}
                                    className="flex min-h-11 w-full items-center justify-center gap-2 rounded-none bg-[#1a73e8] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1765cc] active:bg-[#1967d2] disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    {pendingAction === "send" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                                    {pendingAction === "send" ? "Sending code…" : "Email me a sign-in code"}
                                </button>

                                <div className="flex items-center gap-3" aria-hidden="true">
                                    <span className="h-px flex-1 bg-[#dadce0]" />
                                    <span className="text-xs font-medium uppercase text-[#5f6368]">or</span>
                                    <span className="h-px flex-1 bg-[#dadce0]" />
                                </div>

                                <button
                                    type="button"
                                    onClick={handleGitHubLogin}
                                    className="flex min-h-11 w-full items-center justify-center gap-2 rounded-none border border-[#dadce0] bg-white px-4 py-2.5 text-sm font-semibold text-[#3c4043] shadow-sm transition hover:bg-[#f8fafd] hover:text-[#202124]"
                                >
                                    <Github className="h-4 w-4" />
                                    Continue with GitHub
                                </button>
                            </form>
                        ) : (
                            <form onSubmit={handleVerifyOtp} className="space-y-6" aria-describedby="login-security-note">
                                <div>
                                    <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-none border border-[#dadce0] bg-[#e8f0fe] text-[#1a73e8]">
                                        <LockKeyhole className="h-5 w-5" />
                                    </div>
                                    <h1 className="text-[clamp(1.45rem,5.5vw,1.75rem)] font-bold leading-tight tracking-tight text-[#202124]">Check your email</h1>
                                    <p className="mt-2 text-sm font-normal leading-6 text-[#3c4043]">
                                        Enter the 10-character code sent to <span className="font-semibold text-[#202124]">{email}</span>.
                                    </p>
                                </div>

                                <div className="space-y-1.5">
                                    <label htmlFor="login-otp" className="text-xs font-semibold uppercase tracking-wider text-[#5f6368]">Sign-in code</label>
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
                                        className="h-12 rounded-none border border-[#dadce0] bg-white text-center font-mono text-lg uppercase tracking-[0.22em] text-[#202124] focus-visible:border-[#1a73e8] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#1a73e8] sm:text-xl sm:tracking-[0.35em]"
                                    />
                                </div>

                                <div aria-live="polite">
                                    {error && (
                                        <div role="alert" className="rounded-none border border-[#f5c6cb] bg-[#fdf7f7] p-3 text-sm font-medium text-[#721c24]">
                                            {error}
                                        </div>
                                    )}
                                    {statusMessage && !error && (
                                        <div className="rounded-none border border-[#ceead6] bg-[#e6f4ea] p-3 text-sm font-medium text-[#137333]">
                                            {statusMessage}
                                        </div>
                                    )}
                                </div>

                                <button
                                    type="submit"
                                    disabled={otp.length !== 10 || pendingAction !== null}
                                    className="flex min-h-11 w-full items-center justify-center gap-2 rounded-none bg-[#1a73e8] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1765cc] active:bg-[#1967d2] disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    {pendingAction === "verify" && <Loader2 className="h-4 w-4 animate-spin" />}
                                    {pendingAction === "verify" ? "Verifying…" : "Enter dashboard"}
                                </button>

                                <div className="flex flex-col items-start justify-between gap-3 text-sm min-[380px]:flex-row min-[380px]:items-center">
                                    <button type="button" onClick={handleChangeEmail} disabled={pendingAction !== null} className="inline-flex min-h-9 items-center gap-1.5 rounded-none text-xs font-semibold uppercase text-[#5f6368] hover:text-[#202124] disabled:opacity-50">
                                        <ArrowLeft className="h-3.5 w-3.5" /> Change email
                                    </button>
                                    <button type="button" onClick={handleResendOtp} disabled={pendingAction !== null || resendCooldown > 0} className="min-h-9 rounded-none text-xs font-semibold uppercase text-[#1a73e8] hover:text-[#1765cc] disabled:cursor-not-allowed disabled:text-[#80868b]">
                                        {pendingAction === "resend" ? "Sending…" : resendCooldown > 0 ? `Resend in ${resendCooldown}s` : "Resend code"}
                                    </button>
                                </div>
                            </form>
                        )}
                    </section>

                    <p id="login-security-note" className="mt-5 text-center text-xs font-medium leading-5 text-[#5f6368] sm:mt-6">
                        Secure passwordless sign-in · Codes expire after 5 minutes
                    </p>
                </div>
            </div>
        </main>
    );
}
