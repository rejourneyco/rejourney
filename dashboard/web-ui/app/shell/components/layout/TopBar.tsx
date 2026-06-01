import React, { useState, useCallback, useEffect } from 'react';
import { Link, useNavigate } from 'react-router';
import { Project } from '~/shared/types';
import { useSessionData } from '~/shared/providers/SessionContext';
import { useAuth } from '~/shared/providers/AuthContext';
import { useTeam } from '~/shared/providers/TeamContext';
import { usePathPrefix } from '~/shell/routing/usePathPrefix';
import { clearCache, getTeamBillingUsage, getTeamPlan, TeamUsage } from '~/features/app/billing/api';
import { clearCacheMatching } from '~/shared/api/client';
import { RefreshCw, User as UserIcon, LogOut, ChevronDown, CreditCard, Copy, BookOpen, Check, Menu, Mail } from 'lucide-react';
import { buildProjectAIIntegrationPrompt } from '~/shared/constants/aiPrompts';
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
  const [lastRefreshTime, setLastRefreshTime] = useState<Date | null>(null);
  const [refreshCompletedPulse, setRefreshCompletedPulse] = useState(false);
  const [teamUsage, setTeamUsage] = useState<TeamUsage | null>(null);
  const [teamPlan, setTeamPlan] = useState<{ planName: string; sessionLimit: number; videoRetentionLabel: string } | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedContactEmail, setCopiedContactEmail] = useState(false);
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

  const sessionReplaysUsed = teamUsage?.sessionReplaysUsed ?? teamUsage?.sessionsUsed ?? 0;
  const sessionsCaptured = teamUsage?.sessionsCaptured ?? sessionReplaysUsed;

  const planLabel = user?.isSelfHosted
    ? 'Self-Hosted'
    : (teamPlan?.planName ? teamPlan.planName.charAt(0).toUpperCase() + teamPlan.planName.slice(1) : 'Free');

  const compactRetentionLabel = teamPlan?.videoRetentionLabel
    ?.replace(/\s+days?$/i, 'd')
    .replace(/\s+months?$/i, 'mo')
    .replace(/\s+years?$/i, 'y');

  const compactPublicKey = currentProject?.publicKey
    ? `${currentProject.publicKey.startsWith('rj_') ? 'rj' : currentProject.publicKey.slice(0, 2)}...${currentProject.publicKey.slice(-4)}`
    : '';

  // Copy handlers
  const handleCopyPublicKey = useCallback(() => {
    if (currentProject?.publicKey) {
      navigator.clipboard.writeText(currentProject.publicKey);
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2000);
    }
  }, [currentProject?.publicKey]);

  const handleCopyDocsUrl = useCallback(() => {
    navigator.clipboard.writeText(buildProjectAIIntegrationPrompt(currentProject));
    setCopiedDocs(true);
    setTimeout(() => setCopiedDocs(false), 2000);
  }, [currentProject]);

  const handleCopyContactEmail = useCallback(() => {
    navigator.clipboard.writeText('contact@rejourney.co');
    setCopiedContactEmail(true);
    setTimeout(() => setCopiedContactEmail(false), 2000);
  }, []);

  const refreshTitle = isRefreshing
    ? 'Refreshing dashboard data...'
    : lastRefreshTime
      ? `Refresh data (last: ${lastRefreshTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })})`
      : 'Refresh dashboard data';

  return (
    <div className="dashboard-topbar relative z-10 flex min-h-[44px] items-center gap-2 px-2 py-1.5 sm:px-3">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {/* Mobile Menu Button */}
        <button
          onClick={() => window.dispatchEvent(new CustomEvent('toggleMobileSidebar'))}
          className="flex h-8 w-8 shrink-0 items-center justify-center border border-slate-200 bg-white shadow-sm transition-colors hover:bg-slate-50 md:hidden"
          aria-label="Toggle sidebar"
        >
          <Menu className="h-4 w-4 stroke-[3]" />
        </button>

        {/* Logo */}
        <Link to="/" className="hidden shrink-0 transition-opacity hover:opacity-80 sm:block">
          <img src="/rejourneyIcon-removebg-preview.png" alt="Rejourney" className="h-6 w-6 object-contain opacity-80" />
        </Link>

        {currentProject ? (
          <>
            <div className="flex min-w-0 items-center gap-2">
              <h1 className="truncate text-sm font-extrabold leading-none text-slate-950">{currentProject.name}</h1>
              <div className="hidden items-center gap-1.5 sm:flex">
                {currentProject.platforms.map((platform, index) => (
                  <span key={platform} className={`flex items-center gap-1 border border-slate-200 px-1.5 py-px text-[10px] font-bold uppercase leading-none text-slate-600 ${index % 2 === 0 ? 'bg-cyan-50' : 'bg-emerald-50'}`}>
                    {platform}
                  </span>
                ))}
                {compactRetentionLabel && (
                  <span
                    className="hidden items-center gap-1 border border-slate-200 bg-pink-50 px-1.5 py-px text-[10px] font-bold uppercase leading-none text-slate-600 lg:flex"
                    title={`${teamPlan?.videoRetentionLabel} video retention`}
                  >
                    {compactRetentionLabel} video retention
                  </span>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="text-sm font-semibold text-slate-500">Select a project</div>
        )}
      </div>

      <div className="dashboard-topbar-actions flex shrink-0 flex-nowrap items-center justify-end gap-1 overflow-visible">
        {/* Public Key - Truncated & Copyable */}
        {currentProject?.publicKey && (
          <button
            onClick={handleCopyPublicKey}
            className="group hidden h-8 shrink-0 items-center justify-center gap-1.5 border border-slate-200 bg-white px-2 shadow-sm transition-all hover:border-slate-300 hover:bg-slate-50 active:shadow-none sm:flex"
            title={`Copy Public Key: ${currentProject.publicKey}`}
            aria-label="Copy public key"
          >
            <span className="font-mono text-[11px] font-black leading-none text-slate-950">{compactPublicKey}</span>
            {copiedKey ? (
              <Check className="h-4 w-4 text-black stroke-[3]" />
            ) : (
              <Copy className="h-4 w-4 text-black transition-colors group-hover:text-[#5dadec] stroke-[2]" />
            )}
          </button>
        )}

        {/* Contact Devs Button */}
        <button
          onClick={handleCopyContactEmail}
          className="group hidden h-8 w-8 shrink-0 items-center justify-center border border-[#2563eb] bg-[#3b82f6] shadow-sm transition-all hover:border-[#1d4ed8] hover:bg-[#2563eb] active:shadow-none sm:flex"
          title="Copy developer contact email: contact@rejourney.co"
          aria-label="Copy developer contact email"
        >
          {copiedContactEmail ? (
            <Check className="h-4 w-4 text-white stroke-[3]" />
          ) : (
            <Mail className="h-4 w-4 text-white stroke-[2.5]" />
          )}
        </button>

        {/* AI Docs Button */}
        <button
          onClick={handleCopyDocsUrl}
          className="group hidden h-8 w-8 shrink-0 items-center justify-center border border-slate-200 bg-white shadow-sm transition-all hover:border-slate-300 hover:bg-slate-50 active:shadow-none sm:flex"
          title="Copy AI Integration Prompt"
          aria-label="Copy AI integration prompt"
        >
          {copiedDocs ? (
            <Check className="h-4 w-4 text-black stroke-[3]" />
          ) : (
            <BookOpen className="h-4 w-4 text-black transition-colors group-hover:text-[#5dadec] stroke-[2]" />
          )}
        </button>

        {/* Refresh Button - Icon Only */}
        <button
          onClick={handleRefresh}
          disabled={isRefreshing}
          className={`flex h-8 w-8 shrink-0 items-center justify-center border border-slate-200 shadow-sm transition-all active:shadow-none disabled:cursor-not-allowed disabled:opacity-50 ${isRefreshing
            ? 'bg-white'
            : refreshCompletedPulse
              ? 'bg-emerald-100 border-emerald-200'
              : 'bg-white hover:bg-slate-50 hover:border-slate-300'
            }`}
          title={refreshTitle}
          aria-label="Refresh dashboard data"
        >
          <RefreshCw className={`h-4 w-4 text-black stroke-[3] ${isRefreshing ? 'animate-spin' : ''}`} />
        </button>

        {/* Plan / Usage - Team usage this month */}
        {user && currentTeam && (
          <Link
            to={`${pathPrefix}/billing`}
            className="hidden h-8 min-w-8 shrink-0 items-center justify-center border border-emerald-100 bg-emerald-50 px-2 shadow-sm transition-all hover:border-emerald-200 hover:bg-emerald-100 active:shadow-none lg:flex"
            title={`${currentTeam.name} - ${planLabel} plan - ${sessionReplaysUsed.toLocaleString()} session replays, ${sessionsCaptured.toLocaleString()} sessions captured this period. Open Plan & Billing.`}
            aria-label={`Open Plan & Billing for ${currentTeam.name}`}
          >
            <span className="text-xs font-black text-black">
              R {sessionReplaysUsed.toLocaleString()} / S {sessionsCaptured.toLocaleString()}
            </span>
          </Link>
        )}

        {/* User Menu */}
        <div className="relative shrink-0">
          <button
            onClick={() => setShowUserMenu(!showUserMenu)}
            className="group flex h-8 max-w-full items-center gap-1.5 border border-slate-200 bg-white px-1.5 shadow-sm transition-all hover:border-slate-300 hover:bg-slate-50 active:shadow-none focus:outline-none"
            title={displayLabel || userEmail || 'Account menu'}
            aria-label="Open account menu"
          >
            <div className="flex h-5 w-5 items-center justify-center bg-slate-700 text-white">
              <UserIcon className="h-3.5 w-3.5 stroke-[3]" />
            </div>
            <ChevronDown className="h-3.5 w-3.5 text-black stroke-[3]" />
          </button>

          {showUserMenu && (
            <>
              <div className="fixed inset-0 z-[90]" onClick={() => setShowUserMenu(false)} />
              <div className="absolute right-0 top-full mt-2 bg-white border border-slate-200 p-1 shadow-lg rounded-md z-[100] w-56 animate-in fade-in zoom-in-95 duration-100">
                <div className="mb-1 border-b border-slate-100 bg-slate-50 px-4 py-3 rounded-t-sm">
                  <div className="truncate text-xs font-bold text-black">{displayLabel}</div>
                  <div className="text-[10px] text-slate-500 truncate font-mono">{userEmail}</div>
                </div>
                <button
                  onClick={() => navigate(`${pathPrefix}/account`)}
                  className="w-full text-left px-4 py-2 text-xs font-bold text-black hover:bg-[#ecfeff] flex items-center gap-2"
                >
                  <CreditCard className="w-3.5 h-3.5 text-slate-500" />
                  Account
                </button>
                <button
                  onClick={() => {
                    setShowUserMenu(false);
                    logout();
                  }}
                  className="w-full text-left px-4 py-2 text-xs font-bold text-red-600 hover:bg-[#fecaca] flex items-center gap-2"
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
