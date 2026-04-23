import React, { useState, useCallback, useEffect } from 'react';
import { Link, useNavigate } from 'react-router';
import { Project } from '~/shared/types';
import { useSessionData } from '~/shared/providers/SessionContext';
import { useAuth } from '~/shared/providers/AuthContext';
import { useTeam } from '~/shared/providers/TeamContext';
import { usePathPrefix } from '~/shell/routing/usePathPrefix';
import { clearCache, getTeamBillingUsage, getTeamPlan, TeamUsage } from '~/features/app/billing/api';
import { clearCacheMatching } from '~/shared/api/client';
import { RefreshCw, User as UserIcon, LogOut, ChevronDown, CreditCard, Copy, BookOpen, Check, Menu } from 'lucide-react';
import { AI_INTEGRATION_PROMPT } from '~/shared/constants/aiPrompts';
import { DASHBOARD_MANUAL_REFRESH_COMPLETE, DASHBOARD_MANUAL_REFRESH_START } from '~/shared/constants/events';

interface TopBarProps {
  currentProject: Project | null;
}

export const TopBar: React.FC<TopBarProps> = ({ currentProject }) => {
  const [showUserMenu, setShowUserMenu] = useState(false);
  const navigate = useNavigate();
  const { refreshSessions } = useSessionData();
  const { user, logout } = useAuth();
  const { currentTeam } = useTeam();
  const pathPrefix = usePathPrefix();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastRefreshTime, setLastRefreshTime] = useState<Date>(new Date());
  const [refreshCompletedPulse, setRefreshCompletedPulse] = useState(false);
  const [teamUsage, setTeamUsage] = useState<TeamUsage | null>(null);
  const [teamPlan, setTeamPlan] = useState<{ planName: string; sessionLimit: number; videoRetentionLabel: string } | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedDocs, setCopiedDocs] = useState(false);
  const refreshPulseTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearDashboardCachesForRefresh = useCallback(() => {
    clearCache('projects:list');
    if (currentTeam?.id) {
      clearCache(`/api/teams/${currentTeam.id}/billing/plan`);
      clearCache(`/api/teams/${currentTeam.id}/billing/usage`);
      clearCache(`/api/teams/${currentTeam.id}/billing/dashboard`);
    }

    if (!currentProject?.id) return;
    clearCacheMatching((key) => (
      key.includes(`projectId=${currentProject.id}`)
      || key.includes(`:${currentProject.id}:`)
      || key.startsWith(`/api/projects/${currentProject.id}`)
      || key.startsWith(`/api/session/`)
    ));
  }, [currentProject?.id, currentTeam?.id]);

  // Handle refresh - clear cache first then refetch
  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    window.dispatchEvent(new CustomEvent(DASHBOARD_MANUAL_REFRESH_START, { detail: { at: Date.now() } }));
    let success = false;

    try {
      clearDashboardCachesForRefresh();
      await refreshSessions();
      // Also refresh team usage and plan
      if (currentTeam) {
        try {
          const [planData, usageData] = await Promise.all([
            getTeamPlan(currentTeam.id).catch(() => null),
            getTeamBillingUsage(currentTeam.id).catch(() => null),
          ]);

          if (planData) {
            setTeamPlan({
              planName: planData.planName || 'free',
              sessionLimit: planData.sessionLimit || 5000,
              videoRetentionLabel: planData.videoRetentionLabel || '7 days',
            });
          }

          setTeamUsage(usageData?.usage ?? null);
        } catch (e) {
          console.error("Failed to refresh team billing data", e);
        }
      }
      const now = new Date();
      setLastRefreshTime(now);
      setRefreshCompletedPulse(true);
      if (refreshPulseTimeoutRef.current) {
        clearTimeout(refreshPulseTimeoutRef.current);
      }
      refreshPulseTimeoutRef.current = setTimeout(() => {
        setRefreshCompletedPulse(false);
      }, 700);
      success = true;
    } catch (error) {
      console.error('Failed to refresh dashboard data:', error);
    } finally {
      setIsRefreshing(false);
      window.dispatchEvent(new CustomEvent(DASHBOARD_MANUAL_REFRESH_COMPLETE, { detail: { at: Date.now(), success } }));
    }
  }, [clearDashboardCachesForRefresh, refreshSessions, currentTeam]);

  // Fetch team usage and plan when team changes
  useEffect(() => {
    if (currentTeam) {
      Promise.all([
        getTeamPlan(currentTeam.id).catch(() => null),
        getTeamBillingUsage(currentTeam.id).catch(() => null),
      ]).then(([planData, usageData]) => {
        if (planData) {
          setTeamPlan({
            planName: planData.planName || 'free',
            sessionLimit: planData.sessionLimit || 5000,
            videoRetentionLabel: planData.videoRetentionLabel || '7 days',
          });
        }
        setTeamUsage(usageData?.usage ?? null);
      }).catch(err => console.error("Failed to load team billing data:", err));
    } else {
      setTeamUsage(null);
      setTeamPlan(null);
    }
  }, [currentTeam]);

  // Listen for plan changes to refresh usage and plan
  useEffect(() => {
    const handlePlanChanged = (event: CustomEvent) => {
      if (currentTeam && event.detail?.teamId === currentTeam.id) {
        clearCache(`/api/teams/${currentTeam.id}/billing/plan`);
        clearCache(`/api/teams/${currentTeam.id}/billing/usage`);
        clearCache(`/api/teams/${currentTeam.id}/billing/dashboard`);
        Promise.all([
          getTeamPlan(currentTeam.id).catch(() => null),
          getTeamBillingUsage(currentTeam.id).catch(() => null),
        ]).then(([planData, usageData]) => {
          if (planData) {
            setTeamPlan({
              planName: planData.planName || 'free',
              sessionLimit: planData.sessionLimit || 5000,
              videoRetentionLabel: planData.videoRetentionLabel || '7 days',
            });
          }
          setTeamUsage(usageData?.usage ?? null);
        }).catch(err => console.error("Failed to refresh team billing data:", err));
      }
    };

    window.addEventListener('planChanged', handlePlanChanged as EventListener);
    return () => {
      window.removeEventListener('planChanged', handlePlanChanged as EventListener);
    };
  }, [currentTeam]);

  useEffect(() => {
    return () => {
      if (refreshPulseTimeoutRef.current) {
        clearTimeout(refreshPulseTimeoutRef.current);
      }
    };
  }, []);

  // Display Name Logic - prioritize email
  const userEmail = user?.email || '';
  const userName = user?.name || '';
  const displayLabel = userName
    ? (userName.length > 20 ? `${userName.substring(0, 18)}...` : userName)
    : (userEmail.length > 20 ? `${userEmail.substring(0, 18)}...` : userEmail);

  const sessionsUsed = teamUsage?.sessionsUsed ?? 0;

  const planLabel = user?.isSelfHosted
    ? 'Self-Hosted'
    : (teamPlan?.planName ? teamPlan.planName.charAt(0).toUpperCase() + teamPlan.planName.slice(1) : 'Free');

  // Copy handlers
  const handleCopyPublicKey = useCallback(() => {
    if (currentProject?.publicKey) {
      navigator.clipboard.writeText(currentProject.publicKey);
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2000);
    }
  }, [currentProject?.publicKey]);

  const handleCopyDocsUrl = useCallback(() => {
    navigator.clipboard.writeText(AI_INTEGRATION_PROMPT);
    setCopiedDocs(true);
    setTimeout(() => setCopiedDocs(false), 2000);
  }, []);

  // Truncate public key for display
  const truncatedKey = currentProject?.publicKey
    ? `${currentProject.publicKey.slice(0, 8)}...${currentProject.publicKey.slice(-4)}`
    : '';

  const refreshTitle = isRefreshing
    ? 'Refreshing dashboard data...'
    : `Refresh data (last: ${lastRefreshTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })})`;

  return (
    <div className="relative z-10 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b-2 border-black bg-white px-4 py-3 sm:px-6">
      <div className="flex min-w-0 flex-1 items-center gap-3 sm:gap-4">
        {/* Mobile Menu Button */}
        <button
          onClick={() => window.dispatchEvent(new CustomEvent('toggleMobileSidebar'))}
          className="mr-1 flex h-8 w-8 items-center justify-center border-2 border-black bg-white hover:bg-[#5dadec] md:hidden transition-colors shadow-neo-sm"
          aria-label="Toggle sidebar"
        >
          <Menu className="h-4 w-4 stroke-[3]" />
        </button>

        {/* Logo */}
        <Link to="/" className="shrink-0 hover:scale-105 transition-transform active:scale-95">
          <img src="/rejourneyIcon-removebg-preview.png" alt="Rejourney" className="w-8 h-8 object-contain drop-shadow-[2px_2px_0px_rgba(0,0,0,1)]" />
        </Link>
        <div className="hidden h-6 w-0.5 bg-black/10 sm:block"></div>

        {currentProject ? (
          <>
            <div className="min-w-0 flex flex-col justify-center">
              <h1 className="truncate text-sm font-black uppercase tracking-widest text-black leading-none">{currentProject.name}</h1>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                {currentProject.platforms.map((platform) => (
                  <span key={platform} className="flex items-center gap-1 bg-[#5dadec] px-1.5 py-px text-[10px] font-black uppercase tracking-wider text-black border border-black shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]">
                    {platform}
                  </span>
                ))}
                {teamPlan?.videoRetentionLabel && (
                  <span className="flex items-center gap-1 bg-[#fef08a] px-1.5 py-px text-[10px] font-black uppercase tracking-wider text-black border border-black shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]">
                    {teamPlan.videoRetentionLabel} video retention
                  </span>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="text-sm font-black uppercase tracking-widest text-slate-400">Select a project</div>
        )}
      </div>

      <div className="flex w-full min-w-0 flex-wrap items-center justify-start gap-3 sm:w-auto sm:justify-end sm:flex-nowrap">
        {/* Public Key - Truncated & Copyable */}
        {currentProject?.publicKey && (
          <button
            onClick={handleCopyPublicKey}
            className="group hidden h-9 items-center gap-2 border-2 border-black bg-white px-3 shadow-neo-sm transition-all hover:-translate-y-0.5 hover:shadow-neo active:translate-y-0 active:shadow-none md:flex"
            title={`Copy Public Key: ${currentProject.publicKey}`}
          >
            <span className="font-mono text-black font-bold text-xs">{truncatedKey}</span>
            {copiedKey ? (
              <Check className="w-4 h-4 text-black stroke-[3]" />
            ) : (
              <Copy className="w-4 h-4 text-black group-hover:text-[#5dadec] transition-colors stroke-[2]" />
            )}
          </button>
        )}

        {/* AI Docs Button */}
        <button
          onClick={handleCopyDocsUrl}
          className="group flex h-9 items-center gap-2 border-2 border-black bg-white px-3 shadow-neo-sm transition-all hover:-translate-y-0.5 hover:shadow-neo active:translate-y-0 active:shadow-none"
          title="Copy AI Integration Prompt"
        >
          <BookOpen className="w-4 h-4 text-black stroke-[2]" />
          <span className="hidden sm:inline text-xs font-black uppercase tracking-widest">AI Docs</span>
          {copiedDocs ? (
            <Check className="w-4 h-4 text-black stroke-[3]" />
          ) : (
             <span />
          )}
        </button>

        {/* Refresh Button - Icon Only */}
        <button
          onClick={handleRefresh}
          disabled={isRefreshing}
          className={`flex items-center justify-center w-9 h-9 border-2 border-black shadow-neo-sm transition-all active:translate-y-0 active:shadow-none disabled:opacity-50 disabled:cursor-not-allowed ${isRefreshing
            ? 'bg-white'
            : refreshCompletedPulse
              ? 'bg-[#34d399]'
              : 'bg-white hover:-translate-y-0.5 hover:shadow-neo hover:bg-[#5dadec]'
            }`}
          title={refreshTitle}
        >
          <RefreshCw className={`w-4 h-4 text-black stroke-[3] ${isRefreshing ? 'animate-spin' : ''}`} />
        </button>

        {/* Plan / Usage - Team usage this month */}
        {user && currentTeam && (
          <Link
            to={`${pathPrefix}/team`}
            className="hidden h-9 items-center gap-2 border-2 border-black bg-white px-3 shadow-neo-sm transition-all hover:-translate-y-0.5 hover:shadow-neo active:translate-y-0 active:shadow-none xl:flex"
            title={`${currentTeam.name} - Usage this month`}
          >
            <span className="font-black text-black uppercase tracking-wider text-xs">{planLabel}</span>
            <span className="h-4 w-0.5 bg-black"></span>
            <span className="font-mono font-black text-black text-sm">{sessionsUsed.toLocaleString()}</span>
          </Link>
        )}

        {/* User Menu */}
        <div className="relative">
          <button
            onClick={() => setShowUserMenu(!showUserMenu)}
            className="group flex h-9 max-w-full items-center gap-2 border-2 border-black bg-white px-2 py-1 shadow-neo-sm transition-all hover:-translate-y-0.5 hover:shadow-neo active:translate-y-0 active:shadow-none focus:outline-none"
          >
            <div className="w-5 h-5 bg-black flex items-center justify-center text-white">
              <UserIcon className="w-3.5 h-3.5 stroke-[3]" />
            </div>
            <div className="hidden min-w-0 md:block">
              <div className="text-xs font-black uppercase tracking-wider text-black max-w-[100px] truncate">{displayLabel}</div>
            </div>
            <ChevronDown className="w-4 h-4 text-black stroke-[3]" />
          </button>

          {showUserMenu && (
            <>
              <div className="fixed inset-0 z-[90]" onClick={() => setShowUserMenu(false)} />
              <div className="absolute right-0 top-full mt-2 bg-white border-2 border-black p-1 shadow-neo-lg z-[100] w-56 animate-in fade-in zoom-in-95 duration-100">
                <div className="px-4 py-3 border-b border-gray-200 mb-1">
                  <div className="text-xs font-semibold text-slate-800 truncate">{displayLabel}</div>
                  <div className="text-[10px] text-slate-500 truncate font-mono">{userEmail}</div>
                </div>
                <button
                  onClick={() => navigate(`${pathPrefix}/account`)}
                  className="w-full text-left px-4 py-2 text-xs font-medium text-black hover:bg-gray-100 flex items-center gap-2"
                >
                  <CreditCard className="w-3.5 h-3.5 text-slate-500" />
                  Account
                </button>
                <button
                  onClick={() => {
                    setShowUserMenu(false);
                    logout();
                  }}
                  className="w-full text-left px-4 py-2 text-xs font-medium text-red-600 hover:bg-red-50 flex items-center gap-2"
                >
                  <LogOut className="w-3.5 h-3.5 stroke-[2px]" />
                  Logout
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
