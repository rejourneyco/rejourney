/**
 * Rejourney Dashboard - Login Page Route
 */

import type { Route } from "./+types/route";
import { useState, useRef, useEffect, useCallback } from "react";
import { useNavigate, Link, useSearchParams } from "react-router";
import { Input } from "~/shared/ui/core/Input";
import { Button } from "~/shared/ui/core/Button";
import { useAuth } from "~/shared/providers/AuthContext";
import { AuthServiceUnavailable } from "~/shared/ui/core/AuthServiceUnavailable";

import { API_BASE_URL } from "~/shared/config/appConfig";
import { trackAccountActivationSignal, type AccountActivationMethod } from "~/shared/lib/edgeSignals";
import { PricingThreeField } from "~/features/public/home/components/PricingThreeField";

const ACCOUNT_ACTIVATED_PARAM = 'account_activated';

type LoginStep = 'email' | 'otp';
type AuthTransitionState = 'idle' | 'checking' | 'verifying' | 'opening';

const POST_LOGIN_TRANSITION_MIN_MS = 650;

function readAccountActivationMethod(value: string | null): AccountActivationMethod | null {
    return value === 'github' || value === 'otp' ? value : null;
}

function AuthTransitionScreen({ state }: { state: Exclude<AuthTransitionState, 'idle'> }) {
    const copy = state === 'verifying'
        ? {
            title: 'Verifying code',
            detail: 'Preparing your dashboard session...',
        }
        : state === 'opening'
            ? {
                title: 'Opening dashboard',
                detail: 'Loading your workspace...',
            }
            : {
                title: 'Checking authentication',
                detail: 'One moment...',
            };

    return (
        <div className="public-readable-scope relative flex min-h-screen items-center justify-center bg-slate-50 dark:bg-slate-950 p-4 font-sans text-slate-700 dark:text-slate-350 overflow-x-hidden">
            {/* 3js Particle Background */}
            <PricingThreeField variant="icosahedron" seed={24} layout="center" className="pointer-events-none absolute inset-0 z-0 h-full w-full opacity-65" />
            
            <div className="relative z-10 dashboard-auth-transition w-full max-w-sm border border-white/45 dark:border-slate-900/40 bg-white/45 dark:bg-slate-950/45 backdrop-blur-xl p-8 text-center shadow-xl shadow-slate-100/30 dark:shadow-none hover:shadow-2xl transition-all duration-300 rounded-2xl">
                <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center border border-white/40 dark:border-slate-800/40 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 rounded-xl shadow-sm backdrop-blur-md">
                    <img
                        src="/rejourneyIcon-removebg-preview.png"
                        alt=""
                        className="h-10 w-10 object-contain"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                </div>
                <h1 className="text-xl font-black uppercase text-slate-900 dark:text-white tracking-wide">{copy.title}</h1>
                <p className="mt-2 text-xs font-mono font-bold uppercase text-slate-400 dark:text-slate-500">{copy.detail}</p>
                <div className="mt-6 h-2 overflow-hidden rounded-full border border-white/40 dark:border-slate-800 bg-white/30 dark:bg-slate-900/30">
                    <div className="dashboard-auth-transition-progress h-full bg-indigo-600 dark:bg-indigo-500 rounded-full" />
                </div>
            </div>
        </div>
    );
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
        sendOtp,
        login,
        loginWithGitHub,
        refreshUser,
        error: authError,
        isAuthenticated,
        isLoading: authLoading,
        authServiceUnavailable,
    } = useAuth();
    const [step, setStep] = useState<LoginStep>('email');
    const [email, setEmail] = useState('');
    const [otp, setOtp] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isRetryingAuth, setIsRetryingAuth] = useState(false);
    const [isValidatingExistingSession, setIsValidatingExistingSession] = useState(false);
    const [authTransitionState, setAuthTransitionState] = useState<AuthTransitionState>('idle');
    const authTransitionStartedAt = useRef<number | null>(null);
    const postLoginNavigationStarted = useRef(false);
    const postLoginNavigationTimer = useRef<number | null>(null);
    const pendingAccountActivationMethod = readAccountActivationMethod(searchParams.get(ACCOUNT_ACTIVATED_PARAM));

    const startAuthTransition = useCallback((state: Exclude<AuthTransitionState, 'idle'>) => {
        if (authTransitionStartedAt.current === null) {
            authTransitionStartedAt.current = Date.now();
        }
        setAuthTransitionState(state);
    }, []);

    const resetAuthTransition = useCallback(() => {
        authTransitionStartedAt.current = null;
        postLoginNavigationStarted.current = false;
        if (postLoginNavigationTimer.current !== null) {
            window.clearTimeout(postLoginNavigationTimer.current);
            postLoginNavigationTimer.current = null;
        }
        setAuthTransitionState('idle');
    }, []);

    const getPostLoginDestination = useCallback(() => {
        if (typeof window === 'undefined') {
            return '/dashboard';
        }
        const returnUrl = localStorage.getItem('returnUrl');
        if (returnUrl && returnUrl.startsWith('/')) {
            localStorage.removeItem('returnUrl');
            return returnUrl;
        }

        return '/dashboard';
    }, []);

    const navigateToPostLoginDestination = useCallback((options?: { accountActivationMethod?: AccountActivationMethod | null }) => {
        if (postLoginNavigationStarted.current) {
            return;
        }

        postLoginNavigationStarted.current = true;
        startAuthTransition('opening');

        const destination = getPostLoginDestination();
        const startedAt = authTransitionStartedAt.current ?? Date.now();
        const elapsed = Date.now() - startedAt;
        const delay = Math.max(POST_LOGIN_TRANSITION_MIN_MS - elapsed, 0);

        if (typeof window === 'undefined') {
            navigate(destination, { replace: true });
            return;
        }

        postLoginNavigationTimer.current = window.setTimeout(() => {
            postLoginNavigationTimer.current = null;
            const finishNavigation = async () => {
                if (options?.accountActivationMethod) {
                    await trackAccountActivationSignal(options.accountActivationMethod);
                }
                navigate(destination, { replace: true });
            };

            void finishNavigation();
        }, delay);
    }, [getPostLoginDestination, navigate, startAuthTransition]);

    const handleRetryAuthCheck = useCallback(async () => {
        setIsRetryingAuth(true);
        setError(null);
        try {
            const freshUser = await refreshUser();
            if (freshUser) {
                navigateToPostLoginDestination({ accountActivationMethod: pendingAccountActivationMethod });
            }
        } finally {
            setIsRetryingAuth(false);
        }
    }, [navigateToPostLoginDestination, pendingAccountActivationMethod, refreshUser]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        const returnTo = searchParams.get('returnTo');
        if (returnTo && returnTo.startsWith('/')) {
            localStorage.setItem('returnUrl', returnTo);
        }
    }, [searchParams]);

    useEffect(() => {
        if (!pendingAccountActivationMethod || typeof window === 'undefined') return;

        const url = new URL(window.location.href);
        url.searchParams.delete(ACCOUNT_ACTIVATED_PARAM);
        window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    }, [pendingAccountActivationMethod]);

    useEffect(() => {
        return () => {
            if (postLoginNavigationTimer.current !== null) {
                window.clearTimeout(postLoginNavigationTimer.current);
            }
        };
    }, []);

    // Redirect if already authenticated
    useEffect(() => {
        if (authLoading || !isAuthenticated || postLoginNavigationStarted.current) return;

        let cancelled = false;
        setIsValidatingExistingSession(true);

        refreshUser()
            .then((freshUser) => {
                if (cancelled || !freshUser) return;
                navigateToPostLoginDestination({ accountActivationMethod: pendingAccountActivationMethod });
            })
            .finally(() => {
                if (!cancelled) setIsValidatingExistingSession(false);
            });

        return () => {
            cancelled = true;
        };
    }, [authLoading, isAuthenticated, navigateToPostLoginDestination, pendingAccountActivationMethod, refreshUser]);

    // Fetch CSRF token on mount (silently fail if network error)
    useEffect(() => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

        fetch(`${API_BASE_URL || ''}/api/auth/me?_=${Date.now()}`, {
            method: 'GET',
            credentials: 'include',
            cache: 'no-store',
            headers: {
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache',
            },
            signal: controller.signal,
        })
            .catch((err) => {
                // Silently handle network errors for CSRF token fetch
                // This is just to establish session, not critical for login flow
                if (err.name !== 'AbortError') {
                    console.debug('CSRF token fetch failed (non-critical):', err);
                }
            })
            .finally(() => {
                clearTimeout(timeoutId);
            });

        return () => {
            clearTimeout(timeoutId);
            controller.abort();
        };
    }, []);

    const handleSendOtp = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        const targetEmail = email.trim();

        if (!targetEmail) {
            setError('Email address is required.');
            return;
        }

        if (targetEmail !== email) {
            setEmail(targetEmail);
        }

        if (isAuthenticated) {
            navigateToPostLoginDestination({ accountActivationMethod: pendingAccountActivationMethod });
            return;
        }

        setIsLoading(true);
        try {
            const result = await sendOtp(targetEmail);
            if (result.ok) {
                setStep('otp');
            } else {
                setError(result.message || authError || 'Failed to send verification code');
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to send verification code');
        } finally {
            setIsLoading(false);
        }
    };

    const handleVerifyOtp = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        startAuthTransition('verifying');
        setIsLoading(true);
        try {
            const result = await login(email, otp);
            if (result.ok) {
                navigateToPostLoginDestination({ accountActivationMethod: result.accountActivated ? 'otp' : null });
                return;
            } else {
                resetAuthTransition();
                setError(result.message || authError || 'Invalid verification code');
            }
        } catch (err) {
            resetAuthTransition();
            setError(err instanceof Error ? err.message : 'Invalid verification code');
        } finally {
            setIsLoading(false);
        }
    };

    const handleGitHubLogin = useCallback(() => {
        startAuthTransition('opening');
        loginWithGitHub();
    }, [loginWithGitHub, startAuthTransition]);

    const handleResendOtp = async () => {
        setStep('email');
        setOtp('');
        setError(null);
    };

    const handleChangeEmail = () => {
        setStep('email');
        setOtp('');
        setError(null);
    };

    // Show loading state while checking authentication
    if (authTransitionState !== 'idle' || authLoading || isValidatingExistingSession) {
        return (
            <AuthTransitionScreen
                state={authTransitionState !== 'idle'
                    ? authTransitionState
                    : isValidatingExistingSession
                        ? 'opening'
                        : 'checking'}
            />
        );
    }

    return (
        <div className="public-readable-scope relative min-h-screen bg-slate-50 dark:bg-slate-955 flex items-center justify-center p-4 font-sans text-slate-700 dark:text-slate-350 overflow-x-hidden">
            {/* ThreeJS Background */}
            <PricingThreeField variant="icosahedron" seed={24} layout="center" className="pointer-events-none absolute inset-0 z-0 h-full w-full opacity-65" />
            
            <div className="relative z-10 w-full max-w-md">
                {/* Logo */}
                <div className="text-center mb-10">
                    <Link to="/" className="inline-flex items-center justify-center gap-3 mb-4 hover:opacity-80 transition-opacity">
                        <img
                            src="/rejourneyIcon-removebg-preview.png"
                            alt="Rejourney"
                            className="w-10 h-10 object-contain"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                        />
                        <span className="text-3xl font-black tracking-tighter uppercase font-mono text-slate-900 dark:text-white">REJOURNEY</span>
                    </Link>
                    <p className="text-xs font-mono font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">
                        Session Replay for Mobile & Web Apps
                    </p>
                </div>

                {/* Login Form */}
                {authServiceUnavailable && step === 'email' ? (
                    <AuthServiceUnavailable
                        variant="panel"
                        detail={authError}
                        isRetrying={isRetryingAuth}
                        onRetry={handleRetryAuthCheck}
                    />
                ) : (
                <div className="border border-white/45 dark:border-slate-900/40 bg-white/45 dark:bg-slate-950/45 backdrop-blur-xl p-8 shadow-xl shadow-slate-100/30 dark:shadow-none hover:shadow-2xl hover:border-indigo-500/30 transition-all duration-300 rounded-2xl">
                    {step === 'email' ? (
                        <form onSubmit={handleSendOtp} className="space-y-6">
                            <div className="text-center mb-6">
                                <h1 className="text-2xl font-black uppercase mb-2 text-slate-900 dark:text-white font-sans">Login / Sign up</h1>
                                <p className="text-xs font-mono font-semibold text-slate-455 dark:text-slate-500 uppercase">Sign in to your workspace</p>
                            </div>

                            {/* GitHub OAuth Button */}
                            <button
                                type="button"
                                onClick={handleGitHubLogin}
                                className="w-full flex items-center justify-center gap-3 rounded-full bg-slate-900 text-white hover:bg-black dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100 shadow-md hover:-translate-y-0.5 hover:scale-[1.02] active:scale-[0.98] transition-all duration-300 h-12 font-bold uppercase tracking-wide text-xs"
                            >
                                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                                    <path fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clipRule="evenodd" />
                                </svg>
                                SIGN IN WITH GITHUB
                            </button>

                            {/* Divider */}
                            <div className="relative">
                                <div className="absolute inset-0 flex items-center">
                                    <div className="w-full border-t border-slate-200 dark:border-slate-800/80"></div>
                                </div>
                                <div className="relative flex justify-center">
                                    <span className="bg-transparent px-4 text-[10px] font-extrabold uppercase tracking-wider text-slate-450 dark:text-slate-500">
                                        Or continue with email
                                    </span>
                                </div>
                            </div>

                            <div className="space-y-4">
                                <Input
                                    type="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    placeholder="you@company.com"
                                    label="EMAIL ADDRESS"
                                    className="w-full rounded-xl border-white/30 dark:border-slate-900/30 bg-white/45 dark:bg-slate-950/45 backdrop-blur-md focus-visible:ring-indigo-500/10 focus-visible:border-indigo-500 font-medium text-sm h-12"
                                />

                                {error && (
                                    <div className="text-xs font-bold text-red-500 bg-red-500/10 border border-red-500/20 p-3 rounded-xl uppercase">
                                        {error}
                                    </div>
                                )}

                                <Button
                                    type="submit"
                                    variant="primary"
                                    disabled={!email.trim() || isLoading}
                                    className="w-full !rounded-full !bg-indigo-600 !text-white hover:!bg-indigo-700 shadow-md shadow-indigo-600/10 hover:shadow-lg hover:shadow-indigo-600/25 hover:-translate-y-0.5 hover:scale-[1.02] active:scale-[0.98] transition-all duration-300 h-12 font-bold uppercase tracking-wide text-xs"
                                >
                                    {isLoading ? 'SENDING...' : 'PASSWORDLESS OTP'}
                                </Button>
                            </div>
                        </form>
                    ) : (
                        <form onSubmit={handleVerifyOtp} className="space-y-6">
                            <div className="text-center mb-6">
                                <h1 className="text-2xl font-black uppercase mb-2 text-slate-900 dark:text-white">Verify Access</h1>
                                <p className="text-xs font-mono text-slate-400 dark:text-slate-500 uppercase mb-1.5">
                                    We sent a 10-character code to
                                </p>
                                <div className="inline-block bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 px-3 py-1 rounded-lg font-mono text-xs font-bold border border-indigo-500/20">
                                    {email}
                                </div>
                                <p className="mt-3 text-[10px] font-mono font-bold uppercase text-slate-400 dark:text-slate-500">
                                    Check your spam folder.
                                </p>
                            </div>

                            <div className="space-y-4">
                                {authServiceUnavailable && (
                                    <div className="border border-amber-500/20 bg-amber-500/10 p-3 text-xs font-bold uppercase text-amber-600 rounded-xl">
                                        Authentication is temporarily unavailable. Keep this code open and try again shortly.
                                    </div>
                                )}

                                <Input
                                    type="text"
                                    value={otp}
                                    onChange={(e) => setOtp(e.target.value.toUpperCase())}
                                    placeholder="XXXXXXXXXX"
                                    label="VERIFICATION CODE"
                                    className="w-full font-mono tracking-[0.5em] text-center text-xl uppercase rounded-xl border-white/30 dark:border-slate-900/30 bg-white/45 dark:bg-slate-950/45 backdrop-blur-md focus-visible:ring-indigo-500/10 focus-visible:border-indigo-500 h-14"
                                />

                                {error && (
                                    <div className="text-xs font-bold text-red-500 bg-red-500/10 border border-red-500/20 p-3 rounded-xl uppercase">
                                        {error}
                                    </div>
                                )}

                                <Button
                                    type="submit"
                                    variant="primary"
                                    disabled={otp.length !== 10 || isLoading}
                                    className="w-full !rounded-full !bg-indigo-600 !text-white hover:!bg-indigo-700 shadow-md shadow-indigo-600/10 hover:shadow-lg hover:shadow-indigo-600/25 hover:-translate-y-0.5 hover:scale-[1.02] active:scale-[0.98] transition-all duration-300 h-12 font-bold uppercase tracking-wide text-xs"
                                >
                                    {isLoading ? 'VERIFYING...' : 'ENTER DASHBOARD'}
                                </Button>

                                <div className="flex justify-between items-center text-xs font-mono font-bold uppercase pt-2">
                                    <button
                                        type="button"
                                        onClick={handleChangeEmail}
                                        className="text-slate-400 hover:text-indigo-655 dark:text-slate-550 dark:hover:text-indigo-400 hover:underline decoration-2 underline-offset-4 transition-colors"
                                    >
                                        ← Change email
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleResendOtp}
                                        disabled={isLoading}
                                        className="text-slate-400 hover:text-indigo-655 dark:text-slate-550 dark:hover:text-indigo-400 hover:underline decoration-2 underline-offset-4 disabled:opacity-50 transition-colors"
                                    >
                                        Resend code
                                    </button>
                                </div>
                            </div>
                        </form>
                    )}
                </div>
                )}

                {/* Footer */}
                <div className="text-center mt-8">
                    <p className="text-[10px] font-mono text-slate-400 dark:text-slate-500 uppercase">
                        Code expires in 5 minutes • Secure Login
                    </p>
                </div>
            </div>
        </div>
    );
}
