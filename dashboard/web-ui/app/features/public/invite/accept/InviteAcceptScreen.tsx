import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router';
import { useAuth } from '~/shared/providers/AuthContext';
import { useTeam } from '~/shared/providers/TeamContext';
import { Button } from '~/shared/ui/core/Button';
import { getInvitationByToken, acceptInvitation, ApiTeamInvitation } from '~/shared/api/client';
import { SELECTED_TEAM_COOKIE, writeSelectionCookie } from '~/shared/utils/selectionCookies';

const LOGIN_REDIRECT_GUARD_KEY = 'rejourney_login_redirect_guard';

export const InviteAccept: React.FC = () => {
    const { token } = useParams<{ token: string }>();
    const navigate = useNavigate();
    const { user, isLoading: authLoading, logout } = useAuth();
    const { refreshTeams } = useTeam();

    const [invitation, setInvitation] = useState<ApiTeamInvitation | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isAccepting, setIsAccepting] = useState(false);
    const [isSwitchingAccount, setIsSwitchingAccount] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);
    const [alreadyAccepted, setAlreadyAccepted] = useState(false);

    const navigateToTeamSetup = async (teamId?: string, delayMs: number = 0) => {
        if (typeof window !== 'undefined' && teamId) {
            localStorage.setItem('selectedTeamId', teamId);
            writeSelectionCookie(SELECTED_TEAM_COOKIE, teamId);
        }

        await refreshTeams(teamId);

        const go = () => navigate('/dashboard/setup?joinedTeam=1');
        if (delayMs > 0) {
            window.setTimeout(go, delayMs);
        } else {
            go();
        }
    };

    // Load invitation details
    useEffect(() => {
        if (!token) {
            setError('Invalid invitation link');
            setIsLoading(false);
            return;
        }

        const loadInvitation = async () => {
            try {
                setIsLoading(true);
                setError(null);
                const invite = await getInvitationByToken(token);
                setInvitation(invite);
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Failed to load invitation');
            } finally {
                setIsLoading(false);
            }
        };

        loadInvitation();
    }, [token]);

    // Handle accept
    const handleAccept = async () => {
        if (!token) return;

        try {
            setIsAccepting(true);
            setError(null);
            const result = await acceptInvitation(token);

            if (result.success) {
                setSuccess(true);
                await navigateToTeamSetup(result.team?.id || invitation?.teamId, 1500);
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to accept invitation';
            const isAlreadyAcceptedError = /already accepted|already a member/i.test(message);

            if (isAlreadyAcceptedError && invitation?.teamId) {
                setAlreadyAccepted(true);
                setSuccess(true);
                await navigateToTeamSetup(invitation.teamId, 1500);
                return;
            }

            setError(message);
        } finally {
            setIsAccepting(false);
        }
    };

    const handleOpenTeam = async () => {
        if (!invitation?.teamId) return;

        try {
            setIsAccepting(true);
            setError(null);
            await navigateToTeamSetup(invitation.teamId);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to open team setup');
        } finally {
            setIsAccepting(false);
        }
    };

    // Redirect to login if not authenticated
    const handleLogin = async () => {
        // Preserve the full invite URL so the next account returns here after login.
        const returnUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
        localStorage.setItem('returnUrl', returnUrl);
        sessionStorage.setItem(LOGIN_REDIRECT_GUARD_KEY, '1');
        setError(null);
        setIsSwitchingAccount(true);

        if (user) {
            await logout();
        }

        navigate('/login', { replace: true });
    };

    // Show loading state
    if (isLoading || authLoading) {
        return (
            <div className="public-readable-scope relative flex min-h-screen items-center justify-center bg-slate-50 dark:bg-slate-955 p-4 font-sans text-slate-700 dark:text-slate-350 overflow-x-hidden">
                <div className="relative z-10 w-full max-w-sm border border-white/45 dark:border-slate-900/40 bg-white/45 dark:bg-slate-950/45 backdrop-blur-xl p-8 text-center shadow-xl shadow-slate-100/30 dark:shadow-none hover:shadow-2xl transition-all duration-300 rounded-2xl animate-pulse">
                    <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center border border-white/40 dark:border-slate-800/40 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 rounded-xl shadow-sm backdrop-blur-md">
                        <div className="w-6 h-6 rounded-full border-2 border-t-transparent border-indigo-600 dark:border-indigo-400 animate-spin" />
                    </div>
                    <h1 className="text-base font-bold uppercase tracking-wider text-slate-900 dark:text-white">Loading invitation...</h1>
                    <p className="mt-1.5 text-xs text-slate-450 dark:text-slate-500 font-mono">Preparing workspace connection</p>
                </div>
            </div>
        );
    }

    // Show error state
    if (error && !invitation) {
        return (
            <div className="public-readable-scope relative flex min-h-screen items-center justify-center bg-slate-50 dark:bg-slate-955 p-4 font-sans text-slate-700 dark:text-slate-350 overflow-x-hidden">
                <div className="relative z-10 max-w-md w-full">
                    <div className="border border-red-500/25 bg-white/45 dark:bg-slate-950/45 backdrop-blur-xl p-8 shadow-xl shadow-slate-100/10 dark:shadow-none rounded-2xl hover:shadow-2xl transition-all duration-300 text-center">
                        <div className="flex justify-center mb-4">
                            <svg className="w-12 h-12 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </div>
                        <h1 className="text-xl font-bold uppercase mb-2 text-slate-900 dark:text-white">Invalid Invitation</h1>
                        <p className="text-sm text-slate-650 dark:text-slate-400 mb-6">{error}</p>
                        <Button
                            onClick={() => navigate('/')}
                            variant="primary"
                            className="w-full !rounded-full !bg-indigo-600 !text-white hover:!bg-indigo-700 shadow-md shadow-indigo-600/10 hover:shadow-lg hover:shadow-indigo-600/25 hover:-translate-y-0.5 hover:scale-[1.02] active:scale-[0.98] transition-all duration-300 font-bold tracking-wide uppercase text-xs py-2.5"
                        >
                            Go to Home
                        </Button>
                    </div>
                </div>
            </div>
        );
    }

    // Show success state
    if (success) {
        return (
            <div className="public-readable-scope relative flex min-h-screen items-center justify-center bg-slate-50 dark:bg-slate-955 p-4 font-sans text-slate-700 dark:text-slate-350 overflow-x-hidden">
                <div className="relative z-10 max-w-md w-full text-center">
                    <div className="border border-emerald-500/25 bg-white/45 dark:bg-slate-950/45 backdrop-blur-xl p-8 shadow-xl shadow-slate-100/10 dark:shadow-none rounded-2xl hover:shadow-2xl transition-all duration-300">
                        <div className="flex justify-center mb-4">
                            <svg className="w-12 h-12 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                        </div>
                        <h1 className="text-xl font-bold uppercase mb-2 text-slate-900 dark:text-white">Welcome to the Team!</h1>
                        <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
                            {alreadyAccepted || invitation?.accepted
                                ? <>You're already a member of <strong>{invitation?.teamName}</strong>.</>
                                : <>You've successfully joined <strong>{invitation?.teamName}</strong>.</>}
                        </p>
                        <p className="text-xs text-indigo-650 dark:text-indigo-400 font-mono animate-pulse">Opening setup...</p>
                    </div>
                </div>
            </div>
        );
    }

    // Show invitation details
    return (
        <div className="public-readable-scope relative flex min-h-screen items-center justify-center bg-slate-50 dark:bg-slate-955 p-4 font-sans text-slate-700 dark:text-slate-350 overflow-x-hidden">
            <div className="relative z-10 max-w-md w-full">
                <div className="border border-white/45 dark:border-slate-900/40 bg-white/45 dark:bg-slate-950/45 backdrop-blur-xl p-8 shadow-xl shadow-slate-100/30 dark:shadow-none hover:shadow-2xl hover:border-indigo-500/30 transition-all duration-300 rounded-2xl">

                    {/* Logo/Header */}
                    <div className="text-center mb-8">
                        <div className="inline-flex h-14 w-14 items-center justify-center border border-white/40 dark:border-slate-800/40 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 rounded-xl shadow-sm backdrop-blur-md font-semibold text-xl mb-4 relative overflow-hidden">
                            <img
                                src="/rejourneyIcon-removebg-preview.png"
                                alt=""
                                className="h-10 w-10 object-contain absolute z-10"
                                onError={(e) => {
                                    (e.target as HTMLImageElement).style.display = 'none';
                                    const fallback = e.currentTarget.parentElement?.querySelector('.logo-fallback');
                                    if (fallback) fallback.classList.remove('hidden');
                                }}
                            />
                            <span className="logo-fallback hidden">RJ</span>
                        </div>
                        <h1 className="text-2xl font-black uppercase text-slate-900 dark:text-white">Team Invitation</h1>
                    </div>

                    {/* Invitation Details */}
                    {invitation && (
                        <div className="space-y-4 mb-8">
                            <div className="p-4 border border-white/30 dark:border-slate-900/30 bg-white/20 dark:bg-slate-950/20 backdrop-blur-md rounded-xl">
                                <div className="text-[10px] font-extrabold uppercase text-slate-450 dark:text-slate-500 mb-1.5">Team</div>
                                <div className="text-lg font-bold text-slate-900 dark:text-white">{invitation.teamName || 'Unknown Team'}</div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="p-4 border border-white/30 dark:border-slate-900/30 bg-white/20 dark:bg-slate-950/20 backdrop-blur-md rounded-xl">
                                    <div className="text-[10px] font-extrabold uppercase text-slate-450 dark:text-slate-500 mb-1.5">Role</div>
                                    <div className="text-sm font-bold uppercase text-slate-900 dark:text-white">{invitation.role}</div>
                                </div>
                                <div className="p-4 border border-white/30 dark:border-slate-900/30 bg-white/20 dark:bg-slate-950/20 backdrop-blur-md rounded-xl">
                                    <div className="text-[10px] font-extrabold uppercase text-slate-450 dark:text-slate-500 mb-1.5">Invited Email</div>
                                    <div className="text-sm font-mono truncate text-slate-800 dark:text-slate-300">{invitation.email}</div>
                                </div>
                            </div>

                            {invitation.expired && (
                                <div className="p-4 border border-red-500/20 bg-red-500/10 text-red-650 dark:text-red-400 text-sm font-bold rounded-xl">
                                    This invitation has expired. Ask the team admin to resend it from Team settings.
                                </div>
                            )}

                            {invitation.accepted && (
                                <div className="p-4 border border-amber-500/20 bg-amber-500/10 text-amber-650 dark:text-amber-400 text-sm font-bold rounded-xl">
                                    This invitation has already been accepted.
                                </div>
                            )}
                        </div>
                    )}

                    {/* Error message */}
                    {error && (
                        <div className="p-3 mb-4 border border-red-500/20 bg-red-500/10 text-xs font-bold text-red-655 dark:text-red-400 uppercase rounded-xl">
                            {error}
                        </div>
                    )}

                    {/* Action Buttons */}
                    {!invitation?.expired && !invitation?.accepted && (
                        <div className="space-y-4">
                            {user ? (
                                <>
                                    {user.email.toLowerCase() === invitation?.email.toLowerCase() ? (
                                        <Button
                                            onClick={handleAccept}
                                            disabled={isAccepting}
                                            className="w-full !rounded-full !bg-indigo-600 !text-white hover:!bg-indigo-700 shadow-md shadow-indigo-600/10 hover:shadow-lg hover:shadow-indigo-600/25 hover:-translate-y-0.5 hover:scale-[1.02] active:scale-[0.98] transition-all duration-300 font-bold tracking-wide py-2.5 text-xs uppercase"
                                            variant="primary"
                                        >
                                            {isAccepting ? 'Joining...' : 'Accept Invitation'}
                                        </Button>
                                    ) : (
                                        <div className="space-y-4">
                                            <div className="p-4 border border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-400 text-sm rounded-xl">
                                                <strong>Wrong account:</strong> You're logged in as <strong>{user.email}</strong>, but this invite belongs to <strong>{invitation?.email}</strong>. Switch accounts and we'll bring you back to this invite.
                                            </div>
                                            <Button
                                                onClick={handleLogin}
                                                disabled={isSwitchingAccount}
                                                variant="secondary"
                                                className="w-full !rounded-full !bg-white/50 dark:!bg-slate-900/50 hover:!bg-white/80 dark:hover:!bg-slate-900/80 !text-slate-700 dark:!text-slate-300 hover:!text-indigo-650 dark:hover:!text-indigo-400 backdrop-blur-md border border-slate-200/60 dark:border-slate-800/60 shadow-sm hover:shadow-md hover:-translate-y-0.5 hover:scale-[1.02] active:scale-[0.98] transition-all duration-300 font-bold tracking-wide py-2.5 text-xs uppercase"
                                            >
                                                {isSwitchingAccount ? 'Redirecting...' : 'Log in with a different account'}
                                            </Button>
                                        </div>
                                    )}
                                </>
                            ) : (
                                <>
                                    <p className="text-sm text-slate-500 dark:text-slate-400 text-center mb-4 font-medium">
                                        Please log in or sign up to accept this invitation.
                                    </p>
                                    <Button
                                        onClick={handleLogin}
                                        variant="primary"
                                        className="w-full !rounded-full !bg-indigo-600 !text-white hover:!bg-indigo-700 shadow-md shadow-indigo-600/10 hover:shadow-lg hover:shadow-indigo-600/25 hover:-translate-y-0.5 hover:scale-[1.02] active:scale-[0.98] transition-all duration-300 font-bold tracking-wide py-2.5 text-xs uppercase"
                                    >
                                        Log in to Accept
                                    </Button>
                                </>
                            )}
                        </div>
                    )}

                    {invitation?.accepted && (
                        <div className="space-y-4">
                            {user ? (
                                user.email.toLowerCase() === invitation?.email.toLowerCase() ? (
                                    <Button
                                        onClick={handleOpenTeam}
                                        disabled={isAccepting}
                                        className="w-full !rounded-full !bg-indigo-600 !text-white hover:!bg-indigo-700 shadow-md shadow-indigo-600/10 hover:shadow-lg hover:shadow-indigo-600/25 hover:-translate-y-0.5 hover:scale-[1.02] active:scale-[0.98] transition-all duration-300 font-bold tracking-wide py-2.5 text-xs uppercase"
                                        variant="primary"
                                    >
                                        {isAccepting ? 'Opening...' : 'Open setup guide'}
                                    </Button>
                                ) : (
                                    <div className="space-y-4">
                                        <div className="p-4 border border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-400 text-sm rounded-xl">
                                            <strong>Wrong account:</strong> You're logged in as <strong>{user.email}</strong>, but this invite belongs to <strong>{invitation?.email}</strong>. Switch accounts and we'll bring you back to this invite.
                                        </div>
                                        <Button
                                            onClick={handleLogin}
                                            disabled={isSwitchingAccount}
                                            variant="secondary"
                                            className="w-full !rounded-full !bg-white/50 dark:!bg-slate-900/50 hover:!bg-white/80 dark:hover:!bg-slate-900/80 !text-slate-700 dark:!text-slate-300 hover:!text-indigo-650 dark:hover:!text-indigo-400 backdrop-blur-md border border-slate-200/60 dark:border-slate-800/60 shadow-sm hover:shadow-md hover:-translate-y-0.5 hover:scale-[1.02] active:scale-[0.98] transition-all duration-300 font-bold tracking-wide py-2.5 text-xs uppercase"
                                        >
                                            {isSwitchingAccount ? 'Redirecting...' : 'Log in with a different account'}
                                        </Button>
                                    </div>
                                )
                            ) : (
                                <>
                                    <p className="text-sm text-slate-500 dark:text-slate-400 text-center mb-4 font-medium">
                                        Please log in to open setup for the invited team.
                                    </p>
                                    <Button
                                        onClick={handleLogin}
                                        variant="primary"
                                        className="w-full !rounded-full !bg-indigo-600 !text-white hover:!bg-indigo-700 shadow-md shadow-indigo-600/10 hover:shadow-lg hover:shadow-indigo-600/25 hover:-translate-y-0.5 hover:scale-[1.02] active:scale-[0.98] transition-all duration-300 font-bold tracking-wide py-2.5 text-xs uppercase"
                                    >
                                        Log in
                                    </Button>
                                </>
                            )}
                        </div>
                    )}

                    {/* Back link */}
                    <div className="mt-6 text-center">
                        <button
                            onClick={() => navigate('/')}
                            className="text-xs font-bold text-slate-400 hover:text-indigo-650 dark:hover:text-indigo-400 uppercase border-b border-dashed border-slate-350 dark:border-slate-800 hover:border-indigo-650 dark:hover:border-indigo-400 transition-colors"
                        >
                            Back to Home
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default InviteAccept;
