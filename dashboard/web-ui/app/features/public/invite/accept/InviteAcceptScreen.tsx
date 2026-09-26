import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router';
import { useAuth } from '~/shared/providers/AuthContext';
import { useTeam } from '~/shared/providers/TeamContext';
import { dashboardButtonClass } from '~/shared/ui/core/dashboardStyles';
import { getInvitationByToken, acceptInvitation, ApiTeamInvitation } from '~/shared/api/client';
import { SELECTED_TEAM_COOKIE, writeSelectionCookie } from '~/shared/utils/selectionCookies';

const LOGIN_REDIRECT_GUARD_KEY = 'rejourney_login_redirect_guard';

const invitePageClass = 'public-readable-scope relative flex min-h-screen items-center justify-center overflow-x-hidden bg-[#f8fafd] p-4 font-sans text-[#3c4043]';
const inviteCardClass = 'rounded-none border border-[#dadce0] bg-white p-8';
const invitePrimaryButtonClass = `${dashboardButtonClass('primary', 'lg')} w-full`;
const inviteSecondaryButtonClass = `${dashboardButtonClass('secondary', 'lg')} w-full`;
const inviteDetailClass = 'rounded-none border border-[#e8eaed] bg-[#f8fafd] p-4';
const inviteDetailLabelClass = 'mb-1.5 text-xs font-medium text-[#5f6368]';

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
            <div className={invitePageClass}>
                <div className={`${inviteCardClass} w-full max-w-sm text-center`}>
                    <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-none bg-[#e8f0fe]">
                        <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#1a73e8] border-t-transparent" />
                    </div>
                    <h1 className="text-base font-medium text-[#202124]">Loading invitation...</h1>
                    <p className="mt-1.5 text-xs text-[#5f6368]">Preparing workspace connection</p>
                </div>
            </div>
        );
    }

    // Show error state
    if (error && !invitation) {
        return (
            <div className={invitePageClass}>
                <div className="w-full max-w-md">
                    <div className={`${inviteCardClass} text-center`}>
                        <div className="mb-4 flex justify-center">
                            <svg className="h-12 w-12 text-[#c5221f]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </div>
                        <h1 className="mb-2 text-xl font-medium text-[#202124]">Invalid invitation</h1>
                        <p className="mb-6 text-sm text-[#3c4043]">{error}</p>
                        <button
                            type="button"
                            onClick={() => navigate('/')}
                            className={invitePrimaryButtonClass}
                        >
                            Go to homepage
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // Show success state
    if (success) {
        return (
            <div className={invitePageClass}>
                <div className="w-full max-w-md text-center">
                    <div className={inviteCardClass}>
                        <div className="mb-4 flex justify-center">
                            <svg className="h-12 w-12 text-[#137333]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                        </div>
                        <h1 className="mb-2 text-xl font-medium text-[#202124]">Welcome to the team</h1>
                        <p className="mb-4 text-sm text-[#3c4043]">
                            {alreadyAccepted || invitation?.accepted
                                ? <>You're already a member of <strong className="font-medium text-[#202124]">{invitation?.teamName}</strong>.</>
                                : <>You've successfully joined <strong className="font-medium text-[#202124]">{invitation?.teamName}</strong>.</>}
                        </p>
                        <p className="text-xs text-[#5f6368]">Opening setup...</p>
                    </div>
                </div>
            </div>
        );
    }

    // Show invitation details
    return (
        <div className={invitePageClass}>
            <div className="w-full max-w-md">
                <div className={inviteCardClass}>

                    {/* Logo/Header */}
                    <div className="mb-8 text-center">
                        <div className="relative mb-4 inline-flex h-14 w-14 items-center justify-center overflow-hidden rounded-none border border-[#dadce0] bg-white text-xl font-medium text-[#1a73e8]">
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
                        <h1 className="text-xl font-medium text-[#202124]">Team invitation</h1>
                    </div>

                    {/* Invitation Details */}
                    {invitation && (
                        <div className="mb-8 space-y-4">
                            <div className={inviteDetailClass}>
                                <div className={inviteDetailLabelClass}>Team</div>
                                <div className="text-lg font-medium text-[#202124]">{invitation.teamName || 'Unknown team'}</div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className={inviteDetailClass}>
                                    <div className={inviteDetailLabelClass}>Role</div>
                                    <div className="text-sm font-medium capitalize text-[#202124]">{invitation.role}</div>
                                </div>
                                <div className={inviteDetailClass}>
                                    <div className={inviteDetailLabelClass}>Invited email</div>
                                    <div className="truncate font-mono text-sm text-[#3c4043]">{invitation.email}</div>
                                </div>
                            </div>

                            {invitation.expired && (
                                <div className="rounded-none border border-[#f6aea9] bg-[#fce8e6] p-4 text-sm text-[#c5221f]">
                                    This invitation has expired. Ask the team admin to resend it from Team settings.
                                </div>
                            )}

                            {invitation.accepted && (
                                <div className="rounded-none border border-[#fde293] bg-[#fef7e0] p-4 text-sm text-[#b06000]">
                                    This invitation has already been accepted.
                                </div>
                            )}
                        </div>
                    )}

                    {/* Error message */}
                    {error && (
                        <div className="mb-4 rounded-none border border-[#f6aea9] bg-[#fce8e6] p-3 text-xs font-medium text-[#c5221f]">
                            {error}
                        </div>
                    )}

                    {/* Action Buttons */}
                    {!invitation?.expired && !invitation?.accepted && (
                        <div className="space-y-4">
                            {user ? (
                                <>
                                    {user.email.toLowerCase() === invitation?.email.toLowerCase() ? (
                                        <button
                                            type="button"
                                            onClick={handleAccept}
                                            disabled={isAccepting}
                                            className={invitePrimaryButtonClass}
                                        >
                                            {isAccepting ? 'Joining...' : 'Accept invitation'}
                                        </button>
                                    ) : (
                                        <div className="space-y-4">
                                            <div className="rounded-none border border-[#fde293] bg-[#fef7e0] p-4 text-sm text-[#b06000]">
                                                <strong className="font-medium">Wrong account:</strong> You're logged in as <strong className="font-medium">{user.email}</strong>, but this invite belongs to <strong className="font-medium">{invitation?.email}</strong>. Switch accounts and we'll bring you back to this invite.
                                            </div>
                                            <button
                                                type="button"
                                                onClick={handleLogin}
                                                disabled={isSwitchingAccount}
                                                className={inviteSecondaryButtonClass}
                                            >
                                                {isSwitchingAccount ? 'Redirecting...' : 'Log in with a different account'}
                                            </button>
                                        </div>
                                    )}
                                </>
                            ) : (
                                <>
                                    <p className="mb-4 text-center text-sm text-[#5f6368]">
                                        Log in or sign up to accept this invitation.
                                    </p>
                                    <button
                                        type="button"
                                        onClick={handleLogin}
                                        className={invitePrimaryButtonClass}
                                    >
                                        Log in to accept
                                    </button>
                                </>
                            )}
                        </div>
                    )}

                    {invitation?.accepted && (
                        <div className="space-y-4">
                            {user ? (
                                user.email.toLowerCase() === invitation?.email.toLowerCase() ? (
                                    <button
                                        type="button"
                                        onClick={handleOpenTeam}
                                        disabled={isAccepting}
                                        className={invitePrimaryButtonClass}
                                    >
                                        {isAccepting ? 'Opening...' : 'Open setup guide'}
                                    </button>
                                ) : (
                                    <div className="space-y-4">
                                        <div className="rounded-none border border-[#fde293] bg-[#fef7e0] p-4 text-sm text-[#b06000]">
                                            <strong className="font-medium">Wrong account:</strong> You're logged in as <strong className="font-medium">{user.email}</strong>, but this invite belongs to <strong className="font-medium">{invitation?.email}</strong>. Switch accounts and we'll bring you back to this invite.
                                        </div>
                                        <button
                                            type="button"
                                            onClick={handleLogin}
                                            disabled={isSwitchingAccount}
                                            className={inviteSecondaryButtonClass}
                                        >
                                            {isSwitchingAccount ? 'Redirecting...' : 'Log in with a different account'}
                                        </button>
                                    </div>
                                )
                            ) : (
                                <>
                                    <p className="mb-4 text-center text-sm text-[#5f6368]">
                                        Log in to open setup for the invited team.
                                    </p>
                                    <button
                                        type="button"
                                        onClick={handleLogin}
                                        className={invitePrimaryButtonClass}
                                    >
                                        Log in
                                    </button>
                                </>
                            )}
                        </div>
                    )}

                    {/* Back link */}
                    <div className="mt-6 text-center">
                        <button
                            type="button"
                            onClick={() => navigate('/')}
                            className="text-xs font-medium text-[#5f6368] underline-offset-4 transition-colors hover:text-[#1a73e8] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1a73e8]/40"
                        >
                            Back to home
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default InviteAccept;
