/**
 * Rejourney Dashboard - Login Page Route
 */

import type { Route } from "./+types/login";
import { useState, useRef, useEffect } from "react";
import { useNavigate, Link } from "react-router";
import { Input } from "~/components/ui/Input";
import { Button } from "~/components/ui/Button";
import { useAuth } from "~/context/AuthContext";

import { API_BASE_URL } from "~/config";

// Cloudflare Turnstile site key
const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || '0x4AAAAAACFAymkezoYB_TBw';

// Extend Window interface for Turnstile
declare global {
    interface Window {
        turnstile?: {
            render: (element: HTMLElement, options: {
                sitekey: string;
                callback?: (token: string) => void;
                'error-callback'?: () => void;
                'expired-callback'?: () => void;
            }) => string;
            reset: (widgetId: string) => void;
            remove: (widgetId: string) => void;
        };
    }
}

type LoginStep = 'email' | 'otp';

export const meta: Route.MetaFunction = () => [
    { title: "Sign In - Rejourney" },
    {
        name: "description",
        content: "Sign in to your Rejourney dashboard. Access session replays, crash reports, and analytics.",
    },
    { property: "og:title", content: "Sign In - Rejourney" },
    { property: "og:url", content: "https://rejourney.co/login" },
];

export default function LoginPage() {
    const navigate = useNavigate();
    const { sendOtp, login, loginWithGitHub, error: authError, isAuthenticated, isLoading: authLoading } = useAuth();
    const [step, setStep] = useState<LoginStep>('email');
    const [email, setEmail] = useState('');
    const [otp, setOtp] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
    const turnstileRef = useRef<HTMLDivElement>(null);
    const turnstileWidgetId = useRef<string | null>(null);

    // Redirect if already authenticated
    useEffect(() => {
        if (!authLoading && isAuthenticated) {
            const returnUrl = localStorage.getItem('returnUrl');
            if (returnUrl) {
                localStorage.removeItem('returnUrl');
                navigate(returnUrl, { replace: true });
            } else {
                // Check if user has projects - if not, trigger project creation
                fetch(`${API_BASE_URL || ''}/api/projects`, {
                    credentials: 'include',
                })
                    .then((response) => {
                        if (response.ok) {
                            return response.json();
                        }
                        return [];
                    })
                    .then((projects) => {
                        if (projects.length === 0) {
                            // No projects - redirect to dashboard and trigger project creation modal
                            navigate('/dashboard/issues', { replace: true });
                            // Trigger the add project modal after a short delay to ensure the page loads
                            setTimeout(() => {
                                window.dispatchEvent(new CustomEvent('openAddProjectModal'));
                            }, 500);
                        } else {
                            // Default redirect for users with projects
                            navigate('/dashboard/issues', { replace: true });
                        }
                    })
                    .catch(() => {
                        // Default redirect if project check fails
                        navigate('/dashboard/issues', { replace: true });
                    });
            }
        }
    }, [isAuthenticated, authLoading, navigate]);

    // Fetch CSRF token on mount (silently fail if network error)
    useEffect(() => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

        fetch(`${API_BASE_URL || ''}/api/auth/me`, {
            method: 'GET',
            credentials: 'include',
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
        if (step === 'email' && turnstileRef.current && !turnstileWidgetId.current) {
            const checkTurnstile = setInterval(() => {
                if (window.turnstile && turnstileRef.current) {
                    clearInterval(checkTurnstile);
                    try {
                        const widgetId = window.turnstile.render(turnstileRef.current, {
                            sitekey: TURNSTILE_SITE_KEY,
                            callback: (token: string) => setTurnstileToken(token),
                            'error-callback': () => {
                                setError('Turnstile verification failed. Please refresh the page.');
                                setTurnstileToken(null);
                            },
                            'expired-callback': () => setTurnstileToken(null),
                        });
                        turnstileWidgetId.current = widgetId;
                    } catch (err) {
                        console.error('Failed to render Turnstile widget:', err);
                    }
                }
            }, 100);

            const timeout = setTimeout(() => clearInterval(checkTurnstile), 10000);
            return () => {
                clearInterval(checkTurnstile);
                clearTimeout(timeout);
            };
        }
    }, [step]);

    useEffect(() => {
        if (step === 'email' && turnstileWidgetId.current && window.turnstile) {
            window.turnstile.reset(turnstileWidgetId.current);
            setTurnstileToken(null);
        }
    }, [step]);

    const handleSendOtp = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        if (!turnstileToken) {
            setError('Please complete the security verification');
            return;
        }
        setIsLoading(true);
        try {
            const success = await sendOtp(email, turnstileToken);
            if (success) {
                setStep('otp');
                setTurnstileToken(null);
                if (turnstileWidgetId.current && window.turnstile) {
                    window.turnstile.reset(turnstileWidgetId.current);
                }
            } else {
                setError(authError || 'Failed to send verification code');
                if (turnstileWidgetId.current && window.turnstile) {
                    window.turnstile.reset(turnstileWidgetId.current);
                    setTurnstileToken(null);
                }
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to send verification code');
            if (turnstileWidgetId.current && window.turnstile) {
                window.turnstile.reset(turnstileWidgetId.current);
                setTurnstileToken(null);
            }
        } finally {
            setIsLoading(false);
        }
    };

    const handleVerifyOtp = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setIsLoading(true);
        try {
            const success = await login(email, otp);
            if (success) {
                const returnUrl = localStorage.getItem('returnUrl');
                if (returnUrl) {
                    localStorage.removeItem('returnUrl');
                    navigate(returnUrl);
                } else {
                    // Check if user has projects - if not, trigger project creation
                    try {
                        const response = await fetch(`${API_BASE_URL || ''}/api/projects`, {
                            credentials: 'include',
                        });
                        if (response.ok) {
                            const projects = await response.json();
                            if (projects.length === 0) {
                                // No projects - redirect to dashboard and trigger project creation modal
                                navigate('/dashboard/issues');
                                // Trigger the add project modal after a short delay to ensure the page loads
                                setTimeout(() => {
                                    window.dispatchEvent(new CustomEvent('openAddProjectModal'));
                                }, 500);
                                return;
                            }
                        }
                    } catch (err) {
                        console.warn('Failed to check projects:', err);
                    }
                    // Default redirect for users with projects
                    navigate('/dashboard/issues');
                }
            } else {
                setError(authError || 'Invalid verification code');
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Invalid verification code');
        } finally {
            setIsLoading(false);
        }
    };

    const handleResendOtp = async () => {
        setStep('email');
        setOtp('');
        setError(null);
        if (turnstileWidgetId.current && window.turnstile) {
            window.turnstile.remove(turnstileWidgetId.current);
            turnstileWidgetId.current = null;
        }
        setTurnstileToken(null);
    };

    // Show loading state while checking authentication
    if (authLoading) {
        return (
            <div className="min-h-screen bg-white bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] [background-size:16px_16px] flex items-center justify-center p-4 font-sans text-gray-900">
                <div className="text-center">
                    <div className="w-8 h-8 border-2 border-black border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                    <div className="text-sm text-gray-500 font-mono uppercase">Checking authentication...</div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-white bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] [background-size:16px_16px] flex items-center justify-center p-4 font-sans text-gray-900">
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
                        Session Replay for Mobile Apps
                    </p>
                </div>

                {/* Login Form */}
                <div className="bg-white border-2 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] p-8 rounded-none">
                    {step === 'email' ? (
                        <form onSubmit={handleSendOtp} className="space-y-6">
                            <div className="text-center mb-6">
                                <h1 className="text-2xl font-black uppercase mb-2">Welcome Back</h1>
                                <p className="text-xs font-mono text-gray-500 uppercase">Sign in to continue</p>
                            </div>

                            {/* GitHub OAuth Button */}
                            <button
                                type="button"
                                onClick={loginWithGitHub}
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

                                {/* Cloudflare Turnstile Widget */}
                                <div className="flex justify-center my-4">
                                    <div ref={turnstileRef} id="turnstile-widget"></div>
                                </div>

                                {error && (
                                    <div className="text-xs font-bold text-red-600 bg-red-50 border-2 border-red-500 p-3 uppercase">
                                        {error}
                                    </div>
                                )}

                                <Button
                                    type="submit"
                                    variant="primary"
                                    disabled={!email || !turnstileToken || isLoading}
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
                            </div>

                            <div className="space-y-4">
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
                                        onClick={() => {
                                            setStep('email');
                                            setOtp('');
                                            setError(null);
                                        }}
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
