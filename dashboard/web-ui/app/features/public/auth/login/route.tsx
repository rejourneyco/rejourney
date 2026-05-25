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
import { getTurnstileSiteKey } from "~/shared/config/runtimeEnv";

const STATIC_TURNSTILE_SITE_KEY = getTurnstileSiteKey();
const TURNSTILE_SCRIPT_ID = 'cloudflare-turnstile-api';
const TURNSTILE_SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
const TURNSTILE_SCRIPT_TIMEOUT_MS = 12000;
let turnstileScriptLoadPromise: Promise<void> | null = null;

// Extend Window interface for Turnstile
declare global {
    interface Window {
        turnstile?: {
            render: (element: HTMLElement, options: {
                sitekey: string;
                callback?: (token: string) => void;
                'error-callback'?: (errorCode?: string) => boolean | void;
                'expired-callback'?: () => void;
                'timeout-callback'?: () => void;
                retry?: 'auto' | 'never';
            }) => string;
            reset: (widgetId: string) => void;
            remove: (widgetId: string) => void;
        };
    }
}

type LoginStep = 'email' | 'otp';
type AuthTransitionState = 'idle' | 'checking' | 'verifying' | 'opening';

const POST_LOGIN_TRANSITION_MIN_MS = 650;

interface AuthPublicConfig {
    turnstileRequired: boolean;
    turnstileSiteKey?: string;
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
        <div className="public-readable-scope flex min-h-screen items-center justify-center bg-white bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] p-4 font-sans text-gray-900 [background-size:16px_16px]">
            <div className="dashboard-auth-transition w-full max-w-sm border-2 border-black bg-white p-7 text-center shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]">
                <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center border-2 border-black bg-[#67e8f9] shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                    <img
                        src="/rejourneyIcon-removebg-preview.png"
                        alt=""
                        className="h-10 w-10 object-contain"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                </div>
                <h1 className="text-xl font-black uppercase text-slate-950">{copy.title}</h1>
                <p className="mt-2 text-xs font-mono font-bold uppercase text-gray-500">{copy.detail}</p>
                <div className="mt-6 h-2 overflow-hidden border-2 border-black bg-white">
                    <div className="dashboard-auth-transition-progress h-full bg-black" />
                </div>
            </div>
        </div>
    );
}

function isTurnstileReady() {
    return typeof window !== 'undefined' && typeof window.turnstile?.render === 'function';
}

function ensureTurnstileScript(forceReload = false): Promise<void> {
    if (typeof window === 'undefined') {
        return Promise.reject(new Error('Turnstile can only load in the browser.'));
    }

    if (isTurnstileReady() && !forceReload) {
        return Promise.resolve();
    }

    if (turnstileScriptLoadPromise && !forceReload) {
        return turnstileScriptLoadPromise;
    }

    turnstileScriptLoadPromise = new Promise<void>((resolve, reject) => {
        const existing = document.querySelector<HTMLScriptElement>(
            `#${TURNSTILE_SCRIPT_ID}, script[src^="https://challenges.cloudflare.com/turnstile/v0/api.js"]`
        );

        if (existing && forceReload) {
            existing.remove();
        }

        const script = !forceReload && existing
            ? existing
            : document.createElement('script');

        let settled = false;
        const finish = (err?: Error) => {
            if (settled) return;
            settled = true;
            window.clearTimeout(timeoutId);
            script.removeEventListener('load', handleLoad);
            script.removeEventListener('error', handleError);
            if (err) {
                turnstileScriptLoadPromise = null;
                reject(err);
                return;
            }
            resolve();
        };

        const handleLoad = () => {
            if (isTurnstileReady()) {
                finish();
            } else {
                window.setTimeout(() => {
                    if (isTurnstileReady()) finish();
                    else finish(new Error('Turnstile script loaded without exposing the API.'));
                }, 150);
            }
        };

        const handleError = () => finish(new Error('Turnstile script failed to load.'));

        const timeoutId = window.setTimeout(() => {
            if (isTurnstileReady()) finish();
            else finish(new Error('Turnstile script timed out.'));
        }, TURNSTILE_SCRIPT_TIMEOUT_MS);

        script.addEventListener('load', handleLoad, { once: true });
        script.addEventListener('error', handleError, { once: true });

        if (!script.parentElement) {
            script.id = TURNSTILE_SCRIPT_ID;
            script.src = TURNSTILE_SCRIPT_SRC;
            script.async = true;
            script.defer = true;
            document.head.appendChild(script);
        }

        // Script was already in the DOM and api may already be live.
        if (isTurnstileReady()) {
            finish();
        }
    });

    return turnstileScriptLoadPromise;
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
    const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
    const [turnstileSiteKey, setTurnstileSiteKey] = useState(STATIC_TURNSTILE_SITE_KEY);
    const [isTurnstileRequired, setIsTurnstileRequired] = useState(Boolean(STATIC_TURNSTILE_SITE_KEY));
    const [isTurnstileConfigLoading, setIsTurnstileConfigLoading] = useState(!STATIC_TURNSTILE_SITE_KEY);
    const [turnstileConfigError, setTurnstileConfigError] = useState<string | null>(null);
    const [turnstileRenderKey, setTurnstileRenderKey] = useState(0);
    const [isTurnstileLoading, setIsTurnstileLoading] = useState(Boolean(STATIC_TURNSTILE_SITE_KEY));
    const [turnstileLoadError, setTurnstileLoadError] = useState<string | null>(null);
    const [isRetryingAuth, setIsRetryingAuth] = useState(false);
    const [isValidatingExistingSession, setIsValidatingExistingSession] = useState(false);
    const [authTransitionState, setAuthTransitionState] = useState<AuthTransitionState>('idle');
    const turnstileRef = useRef<HTMLDivElement>(null);
    const turnstileWidgetId = useRef<string | null>(null);
    const turnstileForceReload = useRef(false);
    const authTransitionStartedAt = useRef<number | null>(null);
    const postLoginNavigationStarted = useRef(false);
    const postLoginNavigationTimer = useRef<number | null>(null);
    const isTurnstileEnabled = isTurnstileRequired && Boolean(turnstileSiteKey);
    const shouldShowTurnstileArea = isTurnstileConfigLoading || isTurnstileRequired || Boolean(turnstileConfigError);

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

    const removeTurnstileWidget = useCallback(() => {
        if (typeof window !== 'undefined' && window.turnstile && turnstileWidgetId.current) {
            try {
                window.turnstile.remove(turnstileWidgetId.current);
            } catch (err) {
                console.debug('Unable to remove Turnstile widget:', err);
            }
        }

        turnstileWidgetId.current = null;
        turnstileRef.current?.replaceChildren();
        setTurnstileToken(null);
    }, []);

    const requestFreshTurnstileWidget = useCallback((options?: { reloadScript?: boolean }) => {
        if (!isTurnstileEnabled) {
            setTurnstileLoadError(null);
            setIsTurnstileLoading(false);
            setTurnstileToken(null);
            return;
        }

        turnstileForceReload.current = !!options?.reloadScript;
        setTurnstileLoadError(null);
        setIsTurnstileLoading(true);
        removeTurnstileWidget();
        setTurnstileRenderKey((key) => key + 1);
    }, [isTurnstileEnabled, removeTurnstileWidget]);

    const resetTurnstileWidget = useCallback(() => {
        if (!isTurnstileEnabled) {
            setTurnstileToken(null);
            setIsTurnstileLoading(false);
            setTurnstileLoadError(null);
            return;
        }

        if (typeof window === 'undefined') {
            setTurnstileToken(null);
            return;
        }

        if (!window.turnstile || !turnstileWidgetId.current) {
            requestFreshTurnstileWidget();
            return;
        }

        try {
            window.turnstile.reset(turnstileWidgetId.current);
            setTurnstileToken(null);
        } catch (err) {
            console.debug('Unable to reset Turnstile widget:', err);
            requestFreshTurnstileWidget();
        }
    }, [isTurnstileEnabled, requestFreshTurnstileWidget]);

    const getPostLoginDestination = useCallback(() => {
        if (typeof window === 'undefined') {
            return '/dashboard/general';
        }
        const returnUrl = localStorage.getItem('returnUrl');
        if (returnUrl && returnUrl.startsWith('/')) {
            localStorage.removeItem('returnUrl');
            return returnUrl;
        }

        return '/dashboard/general';
    }, []);

    const navigateToPostLoginDestination = useCallback(() => {
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
            navigate(destination, { replace: true });
        }, delay);
    }, [getPostLoginDestination, navigate, startAuthTransition]);

    const handleRetryAuthCheck = useCallback(async () => {
        setIsRetryingAuth(true);
        setError(null);
        try {
            const freshUser = await refreshUser();
            if (freshUser) {
                navigateToPostLoginDestination();
            }
        } finally {
            setIsRetryingAuth(false);
        }
    }, [navigateToPostLoginDestination, refreshUser]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        const returnTo = searchParams.get('returnTo');
        if (returnTo && returnTo.startsWith('/')) {
            localStorage.setItem('returnUrl', returnTo);
        }
    }, [searchParams]);

    useEffect(() => {
        return () => {
            if (postLoginNavigationTimer.current !== null) {
                window.clearTimeout(postLoginNavigationTimer.current);
            }
        };
    }, []);

    useEffect(() => {
        if (typeof window === 'undefined') return;

        const controller = new AbortController();
        setTurnstileConfigError(null);
        if (!STATIC_TURNSTILE_SITE_KEY) {
            setIsTurnstileConfigLoading(true);
        }

        fetch(`${API_BASE_URL || ''}/api/auth/config?_=${Date.now()}`, {
            method: 'GET',
            credentials: 'include',
            cache: 'no-store',
            headers: {
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache',
            },
            signal: controller.signal,
        })
            .then(async (response) => {
                if (!response.ok) {
                    throw new Error('Unable to load auth configuration.');
                }
                return response.json() as Promise<AuthPublicConfig>;
            })
            .then((config) => {
                const apiSiteKey = config.turnstileSiteKey?.trim() || '';
                const nextSiteKey = apiSiteKey || STATIC_TURNSTILE_SITE_KEY;
                const nextRequired = Boolean(config.turnstileRequired);

                if (turnstileSiteKey !== nextSiteKey || isTurnstileRequired !== nextRequired) {
                    setTurnstileToken(null);
                }
                setTurnstileSiteKey(nextSiteKey);
                setIsTurnstileRequired(nextRequired);
                setTurnstileConfigError(
                    nextRequired && !nextSiteKey
                        ? 'Security verification is required, but the public site key is not configured.'
                        : null
                );
                setIsTurnstileLoading(nextRequired && Boolean(nextSiteKey));
            })
            .catch((err) => {
                if (controller.signal.aborted) return;
                if (STATIC_TURNSTILE_SITE_KEY) {
                    setTurnstileSiteKey(STATIC_TURNSTILE_SITE_KEY);
                    setIsTurnstileRequired(true);
                    setIsTurnstileLoading(true);
                    return;
                }

                // Auth config is a UX hint. The backend still enforces Turnstile
                // on OTP requests when it is configured, so don't block local
                // sign-in if this preflight route is unreachable.
                console.warn('Unable to load auth configuration; continuing without a client-side security prompt.', err);
                setIsTurnstileRequired(false);
                setTurnstileSiteKey('');
                setTurnstileToken(null);
                setTurnstileLoadError(null);
                setIsTurnstileLoading(false);
                setTurnstileConfigError(null);
            })
            .finally(() => {
                if (!controller.signal.aborted) {
                    setIsTurnstileConfigLoading(false);
                }
            });

        return () => controller.abort();
    }, []);

    // Redirect if already authenticated
    useEffect(() => {
        if (authLoading || !isAuthenticated || postLoginNavigationStarted.current) return;

        let cancelled = false;
        setIsValidatingExistingSession(true);

        refreshUser()
            .then((freshUser) => {
                if (cancelled || !freshUser) return;
                navigateToPostLoginDestination();
            })
            .finally(() => {
                if (!cancelled) setIsValidatingExistingSession(false);
            });

        return () => {
            cancelled = true;
        };
    }, [authLoading, isAuthenticated, navigateToPostLoginDestination, refreshUser]);

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

    // Initialize Turnstile widget
    useEffect(() => {
        if (!isTurnstileEnabled) {
            setIsTurnstileLoading(false);
            setTurnstileLoadError(null);
            setTurnstileToken(null);
            return;
        }

        if (step !== 'email' || typeof window === 'undefined') {
            return;
        }

        let cancelled = false;
        const forceReload = turnstileForceReload.current;
        turnstileForceReload.current = false;

        const renderTurnstile = () => {
            if (cancelled || !window.turnstile || !turnstileRef.current) return;

            // Tear down any stale widget instance before re-rendering.
            if (turnstileWidgetId.current) {
                try { window.turnstile.remove(turnstileWidgetId.current); } catch { /* noop */ }
                turnstileWidgetId.current = null;
            }
            turnstileRef.current.replaceChildren();
            setTurnstileToken(null);

            try {
                const widgetId = window.turnstile.render(turnstileRef.current, {
                    sitekey: turnstileSiteKey,
                    callback: (token: string) => {
                        if (cancelled) return;
                        setTurnstileToken(token);
                        setIsTurnstileLoading(false);
                        setTurnstileLoadError(null);
                    },
                    'error-callback': (errorCode?: string) => {
                        if (!cancelled) {
                            console.debug('Turnstile reported a retryable issue:', errorCode);
                            setTurnstileToken(null);
                            setIsTurnstileLoading(false);
                        }
                        return true;
                    },
                    'expired-callback': () => {
                        if (cancelled) return;
                        setTurnstileToken(null);
                        if (window.turnstile && turnstileWidgetId.current) {
                            try { window.turnstile.reset(turnstileWidgetId.current); } catch { /* noop */ }
                        }
                    },
                    'timeout-callback': () => {
                        if (cancelled) return;
                        if (window.turnstile && turnstileWidgetId.current) {
                            try { window.turnstile.reset(turnstileWidgetId.current); } catch { /* noop */ }
                        }
                    },
                    retry: 'auto',
                });
                turnstileWidgetId.current = widgetId;
                setIsTurnstileLoading(false);
                setTurnstileLoadError(null);
            } catch (err) {
                console.error('Failed to render Turnstile widget:', err);
                turnstileWidgetId.current = null;
                setIsTurnstileLoading(false);
                setTurnstileLoadError('Security check could not start.');
            }
        };

        setIsTurnstileLoading(true);
        setTurnstileLoadError(null);

        ensureTurnstileScript(forceReload)
            .then(() => {
                if (cancelled) return;
                renderTurnstile();
            })
            .catch((err) => {
                if (cancelled) return;
                setIsTurnstileLoading(false);
                setTurnstileLoadError(err instanceof Error ? err.message : 'Failed to load security check.');
            });

        return () => {
            cancelled = true;
        };
    }, [step, turnstileRenderKey, isTurnstileEnabled, turnstileSiteKey]);

    useEffect(() => {
        if (!isTurnstileEnabled) return;
        if (step !== 'email') {
            removeTurnstileWidget();
        }
    }, [step, removeTurnstileWidget, isTurnstileEnabled]);

    const handleSendOtp = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        if (isTurnstileConfigLoading) {
            setError('Security verification is still loading. Please wait a moment.');
            return;
        }
        if (isTurnstileRequired && !turnstileSiteKey) {
            setError(turnstileConfigError || 'Security verification is required, but the prompt could not load.');
            return;
        }
        if (isTurnstileRequired && !turnstileToken) {
            setError('Security verification...');
            return;
        }
        setIsLoading(true);
        try {
            const result = await sendOtp(email, turnstileToken);
            if (result.ok) {
                setStep('otp');
            } else {
                setError(result.message || authError || 'Failed to send verification code');
                if (isTurnstileEnabled) {
                    resetTurnstileWidget();
                }
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to send verification code');
            if (isTurnstileEnabled) {
                resetTurnstileWidget();
            }
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
                navigateToPostLoginDestination();
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
        if (isTurnstileEnabled) {
            requestFreshTurnstileWidget();
        }
    };

    const handleChangeEmail = () => {
        setStep('email');
        setOtp('');
        setError(null);
        if (isTurnstileEnabled) {
            requestFreshTurnstileWidget();
        }
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
        <div className="public-readable-scope min-h-screen bg-white bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] [background-size:16px_16px] flex items-center justify-center p-4 font-sans text-gray-900">
            <div className="w-full max-w-md">
                {/* Logo */}
                <div className="text-center mb-10">
                    <Link to="/" className="inline-flex items-center justify-center gap-3 mb-4 hover:opacity-80 transition-opacity">
                        <img
                            src="/rejourneyIcon-removebg-preview.png"
                            alt="Rejourney"
                            className="w-10 h-10 object-contain"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                        />
                        <span className="text-3xl font-black tracking-tighter uppercase font-mono text-slate-900">REJOURNEY</span>
                    </Link>
                    <p className="text-sm font-mono font-bold uppercase tracking-widest text-gray-500">
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
                <div className="bg-white border-2 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] p-8 rounded-none">
                    {step === 'email' ? (
                        <form onSubmit={handleSendOtp} className="space-y-6">
                            <div className="text-center mb-6">
                                <h1 className="text-2xl font-black uppercase mb-2">Login/Sign up</h1>
                                <p className="text-xs font-mono text-gray-500 uppercase">Login in to continue</p>
                            </div>

                            {/* GitHub OAuth Button */}
                            <button
                                type="button"
                                onClick={handleGitHubLogin}
                                className="w-full flex items-center justify-center gap-3 rounded-none bg-[#24292f] text-white border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-none transition-all h-12 font-black uppercase tracking-widest text-sm"
                            >
                                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                                    <path fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clipRule="evenodd" />
                                </svg>
                                SIGN IN WITH GITHUB
                            </button>

                            {/* Divider */}
                            <div className="relative">
                                <div className="absolute inset-0 flex items-center">
                                    <div className="w-full border-t-2 border-gray-300"></div>
                                </div>
                                <div className="relative flex justify-center">
                                    <span className="bg-white px-4 text-xs font-mono font-bold text-gray-500 uppercase">
                                        Or continue with email
                                    </span>
                                </div>
                            </div>

                            <div className="space-y-4">
                                <Input
                                    type="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    placeholder="YOU@EXAMPLE.COM"
                                    label="EMAIL ADDRESS"
                                    className="w-full rounded-none border-2 border-black focus-visible:ring-0 focus-visible:ring-offset-0 font-mono text-sm placeholder:normal-case h-12"
                                />

                                {shouldShowTurnstileArea && (
                                    <div className="flex flex-col items-center justify-center my-4 min-h-[65px]">
                                        {isTurnstileEnabled && (
                                            <div ref={turnstileRef} id="turnstile-widget" key={turnstileRenderKey}></div>
                                        )}
                                        {(isTurnstileConfigLoading || (isTurnstileLoading && !turnstileLoadError)) && !turnstileConfigError && (
                                            <div className="flex items-center gap-2 text-[10px] font-mono uppercase text-gray-500 mt-2">
                                                <div className="w-3 h-3 border border-gray-400 border-t-transparent rounded-full animate-spin" />
                                                {isTurnstileConfigLoading ? 'Preparing security check...' : 'Loading security check...'}
                                            </div>
                                        )}
                                        {isTurnstileEnabled && !turnstileToken && !isTurnstileLoading && !turnstileLoadError && !turnstileConfigError && (
                                            <div className="mt-2 text-center text-[10px] font-mono uppercase text-gray-500">
                                                Security check...
                                            </div>
                                        )}
                                        {(turnstileLoadError || turnstileConfigError) && (
                                            <div className="flex flex-col items-center gap-2 mt-2">
                                                <div className="text-[10px] font-mono uppercase text-red-600 text-center">
                                                    {turnstileConfigError || turnstileLoadError}
                                                </div>
                                                {isTurnstileEnabled && (
                                                    <button
                                                        type="button"
                                                        onClick={() => requestFreshTurnstileWidget({ reloadScript: true })}
                                                        className="text-[10px] font-mono uppercase font-bold underline decoration-2 underline-offset-4 text-black hover:text-gray-700"
                                                    >
                                                        Reload security check
                                                    </button>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                )}

                                {error && (
                                    <div className="text-xs font-bold text-red-600 bg-red-50 border-2 border-red-500 p-3 uppercase">
                                        {error}
                                    </div>
                                )}

                                <Button
                                    type="submit"
                                    variant="primary"
                                    disabled={
                                        !email
                                        || isTurnstileConfigLoading
                                        || (isTurnstileRequired && (!turnstileSiteKey || !turnstileToken))
                                        || isLoading
                                    }
                                    className="w-full rounded-none bg-black text-white border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-none transition-all h-12 font-black uppercase tracking-widest text-sm hover:bg-gray-900"
                                >
                                    {isLoading ? 'SENDING...' : 'PASSWORDLESS OTP'}
                                </Button>
                            </div>
                        </form>
                    ) : (
                        <form onSubmit={handleVerifyOtp} className="space-y-6">
                            <div className="text-center mb-6">
                                <h1 className="text-2xl font-black uppercase mb-2">Verify Access</h1>
                                <p className="text-xs font-mono text-gray-500 uppercase mb-1">
                                    We sent a 10-character code to
                                </p>
                                <div className="inline-block bg-black text-white px-2 py-1 font-mono text-xs">
                                    {email}
                                </div>
                                <p className="mt-3 text-[10px] font-mono font-bold uppercase text-gray-500">
                                    If it is not there after 2 minutes, check your spam folder.
                                </p>
                            </div>

                            <div className="space-y-4">
                                {authServiceUnavailable && (
                                    <div className="border-2 border-amber-500 bg-amber-50 p-3 text-xs font-bold uppercase text-amber-700">
                                        Authentication is temporarily unavailable. Keep this code open and try again shortly.
                                    </div>
                                )}

                                <Input
                                    type="text"
                                    value={otp}
                                    onChange={(e) => setOtp(e.target.value.toUpperCase())}
                                    placeholder="XXXXXXXXXX"
                                    label="VERIFICATION CODE"
                                    className="w-full font-mono tracking-[0.5em] text-center text-xl uppercase rounded-none border-2 border-black h-14 focus-visible:ring-0 focus-visible:ring-offset-0"
                                />

                                {error && (
                                    <div className="text-xs font-bold text-red-600 bg-red-50 border-2 border-red-500 p-3 uppercase">
                                        {error}
                                    </div>
                                )}

                                <Button
                                    type="submit"
                                    variant="primary"
                                    disabled={otp.length !== 10 || isLoading}
                                    className="w-full rounded-none bg-black text-white border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-none transition-all h-12 font-black uppercase tracking-widest text-sm hover:bg-gray-900"
                                >
                                    {isLoading ? 'VERIFYING...' : 'ENTER DASHBOARD'}
                                </Button>

                                <div className="flex justify-between items-center text-xs font-mono font-bold uppercase pt-2">
                                    <button
                                        type="button"
                                        onClick={handleChangeEmail}
                                        className="text-gray-500 hover:text-black hover:underline decoration-2 underline-offset-4"
                                    >
                                        ← Change email
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleResendOtp}
                                        disabled={isLoading}
                                        className="text-gray-500 hover:text-black hover:underline decoration-2 underline-offset-4 disabled:opacity-50"
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
                    <p className="text-[10px] font-mono text-gray-400 uppercase">
                        Code expires in 5 minutes • Secure Login
                    </p>
                </div>
            </div>
        </div>
    );
}
