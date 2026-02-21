import React, { useState, useCallback, useEffect } from 'react';
import { Link, useNavigate } from 'react-router';
import { Project } from '../../types';
import { useSessionData } from '../../context/SessionContext';
import { useAuth } from '../../context/AuthContext';
import { useTeam } from '../../context/TeamContext';
import { usePathPrefix } from '../../hooks/usePathPrefix';
import { getTeamBillingUsage, getTeamPlan, TeamUsage, clearCache } from '../../services/api';
import { RefreshCw, User as UserIcon, LogOut, ChevronDown, CreditCard, Copy, BookOpen, Check } from 'lucide-react';
import { AI_INTEGRATION_PROMPT } from '../../constants/aiPrompts';
import { DASHBOARD_MANUAL_REFRESH_COMPLETE, DASHBOARD_MANUAL_REFRESH_START } from '../../constants/events';

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
  const [teamPlan, setTeamPlan] = useState<{ planName: string; sessionLimit: number } | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedDocs, setCopiedDocs] = useState(false);
  const refreshPulseTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Handle refresh - clear cache first then refetch
  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    window.dispatchEvent(new CustomEvent(DASHBOARD_MANUAL_REFRESH_START, { detail: { at: Date.now() } }));
    let success = false;

    try {
      // Clear API cache to force fresh data
      clearCache();
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
  }, [refreshSessions, currentTeam]);

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
      if (event.detail?.teamId === currentTeam?.id) {
        // Clear cache and refresh
        clearCache();
        if (currentTeam) {
          Promise.all([
            getTeamPlan(currentTeam.id).catch(() => null),
            getTeamBillingUsage(currentTeam.id).catch(() => null),
          ]).then(([planData, usageData]) => {
            if (planData) {
              setTeamPlan({
                planName: planData.planName || 'free',
                sessionLimit: planData.sessionLimit || 5000,
              });
            }
            setTeamUsage(usageData?.usage ?? null);
          }).catch(err => console.error("Failed to refresh team billing data:", err));
        }
      }
    };

    window.addEventListener('planChanged', handlePlanChanged as EventListener);
    return () => {
      window.removeEventListener('planChanged', handlePlanChanged as EventListener);
    };
  }, [currentTeam]);

  // Set initial refresh time on mount
  useEffect(() => {
    setLastRefreshTime(new Date());
  }, []);

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
    <div className="dashboard-topbar flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b border-slate-200 bg-white px-4 py-2 font-sans sm:px-6">
      <div className="flex min-w-0 flex-1 items-center gap-3 sm:gap-6">
        {/* Logo */}
        <Link to="/" className="shrink-0 hover:opacity-80 transition-opacity">
          <img src="/rejourneyIcon-removebg-preview.png" alt="Rejourney" className="w-8 h-8 object-contain" />
        </Link>
        <div className="hidden h-8 w-px bg-slate-200 sm:block"></div>

        {currentProject ? (
          <>
            <div className="min-w-0">
              <h1 className="truncate text-sm font-bold tracking-tight text-slate-800">{currentProject.name}</h1>
              <div className="mt-0.5 flex flex-wrap items-center gap-2">
                {currentProject.platforms.map((platform) => (
                  <span key={platform} className="flex items-center gap-1 rounded-sm border border-slate-200 bg-slate-50 px-1.5 py-0 text-[10px] font-semibold uppercase text-slate-500">
                    {platform}
                  </span>
                ))}
                {(currentProject.sessionsLast7Days > 0 || currentProject.errorsLast7Days > 0) && (
                  <>
                    <span className="text-slate-300 mx-1">•</span>
                    <span className="font-mono text-[10px] font-bold text-slate-500">
                      {currentProject.sessionsLast7Days} sessions
                    </span>
                  </>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="text-sm font-medium text-slate-400">Select a project</div>
        )}
      </div>

      <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto sm:flex-nowrap sm:gap-3">
        {/* Public Key - Truncated & Copyable */}
        {currentProject?.publicKey && (
          <button
            onClick={handleCopyPublicKey}
            className="group hidden h-8 items-center gap-1.5 rounded border border-slate-200 bg-white px-3 py-1.5 text-xs transition-all hover:bg-slate-50 md:flex"
            title={`Copy Public Key: ${currentProject.publicKey}`}
          >
            <span className="font-mono text-slate-500 font-medium text-[11px]">{truncatedKey}</span>
            {copiedKey ? (
              <Check className="w-3 h-3 text-green-600" />
            ) : (
              <Copy className="w-3 h-3 text-slate-400 group-hover:text-slate-600" />
            )}
          </button>
        )}

        {/* AI Docs Button */}
        <button
          onClick={handleCopyDocsUrl}
          className="group flex h-8 items-center gap-1.5 rounded border border-purple-200 bg-purple-50 px-2.5 py-1.5 text-xs transition-all hover:bg-purple-100 sm:px-3"
          title="Copy AI Integration Prompt"
        >
          <BookOpen className="w-3.5 h-3.5 text-purple-600" />
          <span className="hidden text-[10px] font-semibold uppercase text-purple-700 sm:inline">AI Docs</span>
          {copiedDocs ? (
            <Check className="w-3 h-3 text-purple-600" />
          ) : (
            <Copy className="w-3 h-3 text-purple-400 group-hover:text-purple-600" />
          )}
        </button>

        {/* Refresh Button - Icon Only */}
        <button
          onClick={handleRefresh}
          disabled={isRefreshing}
          className={`flex items-center justify-center w-8 h-8 rounded-md shadow-sm transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed ${isRefreshing
            ? 'bg-sky-50 border border-sky-300'
            : refreshCompletedPulse
              ? 'bg-emerald-50 border border-emerald-300'
              : 'bg-white hover:bg-slate-50 border border-slate-200'
            }`}
          title={refreshTitle}
        >
          <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'text-sky-600 animate-spin' : refreshCompletedPulse ? 'text-emerald-600' : 'text-slate-500'}`} />
        </button>

        {/* Plan / Usage - Team usage this month */}
        {user && currentTeam && (
          <Link
            to={`${pathPrefix}/team`}
            className="hidden h-8 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs shadow-sm transition-colors hover:border-slate-300 xl:flex"
            title={`${currentTeam.name} - Usage this month`}
          >
            <span className="font-semibold text-slate-700 uppercase">{planLabel}</span>
            <span className="h-3 w-px bg-slate-200"></span>
            <span className="font-mono font-medium text-slate-500">{sessionsUsed.toLocaleString()}</span>
          </Link>
        )}

        {/* User Menu */}
        <div className="relative">
          <button
            onClick={() => setShowUserMenu(!showUserMenu)}
            className="group flex items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-left transition-colors hover:border-slate-200 hover:bg-slate-50 focus:outline-none"
          >
            <div className="w-8 h-8 bg-purple-100 rounded-md flex items-center justify-center text-purple-600 border border-purple-200">
              <UserIcon className="w-4 h-4" />
            </div>
            <div className="hidden md:block">
              <div className="text-xs font-semibold text-slate-700 max-w-[120px] truncate">{displayLabel}</div>
            </div>
            <ChevronDown className="w-3 h-3 text-slate-400 ml-1" />
          </button>

          {showUserMenu && (
            <>
              <div className="fixed inset-0 z-[90]" onClick={() => setShowUserMenu(false)} />
              <div className="absolute right-0 top-full mt-2 bg-white border border-slate-200 shadow-lg z-[100] w-56 py-1 rounded-md animate-in fade-in zoom-in-95 duration-100">
                <div className="px-4 py-3 border-b border-slate-100 mb-1">
                  <div className="text-xs font-semibold text-slate-800 truncate">{displayLabel}</div>
                  <div className="text-[10px] text-slate-500 truncate font-mono">{userEmail}</div>
                </div>
                <button
                  onClick={() => navigate(`${pathPrefix}/account`)}
                  className="w-full text-left px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 flex items-center gap-2"
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
