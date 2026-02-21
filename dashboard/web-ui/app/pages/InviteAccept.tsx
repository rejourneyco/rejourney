import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router';
import { useAuth } from '../context/AuthContext';
import { useTeam } from '../context/TeamContext';
import { Button } from '../components/ui/Button';
import { getInvitationByToken, acceptInvitation, ApiTeamInvitation } from '../services/api';

export const InviteAccept: React.FC = () => {
    const { token } = useParams<{ token: string }>();
    const navigate = useNavigate();
    const { user, isLoading: authLoading } = useAuth();
    const { refreshTeams } = useTeam();

    const [invitation, setInvitation] = useState<ApiTeamInvitation | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isAccepting, setIsAccepting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);
    const [alreadyAccepted, setAlreadyAccepted] = useState(false);

    const navigateToTeamDashboard = async (teamId?: string, delayMs: number = 0) => {
        if (typeof window !== 'undefined' && teamId) {
            localStorage.setItem('selectedTeamId', teamId);
        }

        await refreshTeams();

        const go = () => navigate('/dashboard/issues');
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
                await navigateToTeamDashboard(result.team?.id || invitation?.teamId, 1500);
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to accept invitation';
            const isAlreadyAcceptedError = /already accepted|already a member/i.test(message);

            if (isAlreadyAcceptedError && invitation?.teamId) {
                setAlreadyAccepted(true);
                setSuccess(true);
                await navigateToTeamDashboard(invitation.teamId, 1500);
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
            await navigateToTeamDashboard(invitation.teamId);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to open team dashboard');
        } finally {
            setIsAccepting(false);
        }
    };

    // Redirect to login if not authenticated
    const handleLogin = () => {
        // Store the current URL to redirect back after login
        const returnUrl = window.location.pathname;
        localStorage.setItem('returnUrl', returnUrl);
        navigate('/login');
    };

    // Show loading state
    if (isLoading || authLoading) {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center p-8">
                <div className="flex flex-col items-center animate-pulse gap-2">
                    <div className="w-8 h-8 bg-black"></div>
                    <div className="text-xs font-black uppercase tracking-widest">Loading invitation...</div>
                </div>
            </div>
        );
    }

    // Show error state
    if (error && !invitation) {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center p-8">
                <div className="max-w-md w-full">
                    <div className="border-2 border-red-500 bg-white p-8 shadow-[4px_4px_0px_0px_rgba(239,68,68,1)]">
                        <div className="flex justify-center mb-4">
                            <svg className="w-12 h-12 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </div>
                        <h1 className="text-xl font-black uppercase mb-2">Invalid Invitation</h1>
                        <p className="text-sm text-gray-600 mb-6">{error}</p>
                        <Button onClick={() => navigate('/')} variant="primary">
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
            <div className="min-h-screen bg-gray-50 flex items-center justify-center p-8">
                <div className="max-w-md w-full">
                    <div className="border-2 border-green-500 bg-white p-8 shadow-[4px_4px_0px_0px_rgba(34,197,94,1)]">
                        <div className="flex justify-center mb-4">
                            <svg className="w-12 h-12 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                        </div>
                        <h1 className="text-xl font-black uppercase mb-2">Welcome to the Team!</h1>
                        <p className="text-sm text-gray-600 mb-4">
                            {alreadyAccepted || invitation?.accepted
                                ? <>You're already a member of <strong>{invitation?.teamName}</strong>.</>
                                : <>You've successfully joined <strong>{invitation?.teamName}</strong>.</>}
                        </p>
                        <p className="text-xs text-gray-400 font-mono">Redirecting to overview...</p>
                    </div>
                </div>
            </div>
        );
    }

    // Show invitation details
    return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-8">
            <div className="max-w-md w-full">
                <div className="border-2 border-black bg-white p-8 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">

                    {/* Logo/Header */}
                    <div className="text-center mb-8">
                        <div className="inline-block p-3 bg-black text-white font-black text-xl mb-4">RJ</div>
                        <h1 className="text-2xl font-black uppercase">Team Invitation</h1>
                    </div>

                    {/* Invitation Details */}
                    {invitation && (
                        <div className="space-y-4 mb-8">
                            <div className="p-4 bg-gray-50 border-2 border-black">
                                <div className="text-[10px] font-bold uppercase text-gray-500 mb-1">Team</div>
                                <div className="text-lg font-black">{invitation.teamName || 'Unknown Team'}</div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="p-4 bg-gray-50 border-2 border-black">
                                    <div className="text-[10px] font-bold uppercase text-gray-500 mb-1">Role</div>
                                    <div className="text-sm font-bold uppercase">{invitation.role}</div>
                                </div>
                                <div className="p-4 bg-gray-50 border-2 border-black">
                                    <div className="text-[10px] font-bold uppercase text-gray-500 mb-1">Invited Email</div>
                                    <div className="text-sm font-mono truncate">{invitation.email}</div>
                                </div>
                            </div>

                            {invitation.expired && (
                                <div className="p-4 bg-red-50 border-2 border-red-500 text-red-700 text-sm font-bold">
                                    This invitation has expired. Please ask the team admin to send a new one.
                                </div>
                            )}

                            {invitation.accepted && (
                                <div className="p-4 bg-yellow-50 border-2 border-yellow-500 text-yellow-700 text-sm font-bold">
                                    This invitation has already been accepted.
                                </div>
                            )}
                        </div>
                    )}

                    {/* Error message */}
                    {error && (
                        <div className="p-3 mb-4 bg-red-50 border-2 border-red-500 text-xs font-bold text-red-700 uppercase">
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
                                            className="w-full"
                                            variant="primary"
                                        >
                                            {isAccepting ? 'Joining...' : 'Accept Invitation'}
                                        </Button>
                                    ) : (
                                        <div className="space-y-4">
                                            <div className="p-4 bg-yellow-50 border-2 border-yellow-500 text-yellow-700 text-sm">
                                                <strong>Email mismatch:</strong> You're logged in as <strong>{user.email}</strong>, but this invitation was sent to <strong>{invitation?.email}</strong>.
                                            </div>
                                            <Button onClick={handleLogin} variant="secondary" className="w-full">
                                                Log in with a different account
                                            </Button>
                                        </div>
                                    )}
                                </>
                            ) : (
                                <>
                                    <p className="text-sm text-gray-600 text-center mb-4">
                                        Please log in or sign up to accept this invitation.
                                    </p>
                                    <Button onClick={handleLogin} variant="primary" className="w-full">
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
                                        className="w-full"
                                        variant="primary"
                                    >
                                        {isAccepting ? 'Opening...' : 'Open Team Dashboard'}
                                    </Button>
                                ) : (
                                    <div className="space-y-4">
                                        <div className="p-4 bg-yellow-50 border-2 border-yellow-500 text-yellow-700 text-sm">
                                            <strong>Email mismatch:</strong> You're logged in as <strong>{user.email}</strong>, but this invitation was sent to <strong>{invitation?.email}</strong>.
                                        </div>
                                        <Button onClick={handleLogin} variant="secondary" className="w-full">
                                            Log in with a different account
                                        </Button>
                                    </div>
                                )
                            ) : (
                                <>
                                    <p className="text-sm text-gray-600 text-center mb-4">
                                        Please log in to open the invited team dashboard.
                                    </p>
                                    <Button onClick={handleLogin} variant="primary" className="w-full">
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
                            className="text-xs font-bold text-gray-400 hover:text-black uppercase border-b border-dashed border-gray-300 hover:border-black transition-colors"
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
