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
  const [teamUsage, setTeamUsage] = useState<TeamUsage | null>(null);
  const [teamPlan, setTeamPlan] = useState<{ planName: string; sessionLimit: number } | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedDocs, setCopiedDocs] = useState(false);

  // Handle refresh - clear cache first then refetch
  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
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
    } finally {
      setIsRefreshing(false);
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

  return (
    <div className="dashboard-topbar h-16 border-b border-slate-200/80 bg-white/90 backdrop-blur flex items-center justify-between px-6 font-sans">
      <div className="flex items-center gap-6">
        {/* Logo */}
        <Link to="/" className="hover:opacity-80 transition-opacity">
          <img src="/rejourneyIcon-removebg-preview.png" alt="Rejourney" className="w-8 h-8 object-contain" />
        </Link>
        <div className="h-8 w-px bg-slate-200"></div>

        {currentProject ? (
          <>
            <div>
              <h1 className="text-sm font-semibold text-slate-900">{currentProject.name}</h1>
              <div className="flex items-center gap-2 mt-0.5">
                {currentProject.platforms.map((platform) => (
                  <span key={platform} className="text-[10px] font-medium text-slate-500 flex items-center gap-1 border border-slate-200 px-1.5 py-0.5 rounded bg-slate-50/80">
                    {platform}
                  </span>
                ))}
                {(currentProject.sessionsLast7Days > 0 || currentProject.errorsLast7Days > 0) && (
                  <>
                    <span className="text-slate-300 mx-1">•</span>
                    <span className="text-[10px] text-slate-500 font-bold font-mono">
                      {currentProject.sessionsLast7Days} sessions
                    </span>
                  </>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="text-sm font-semibold text-slate-400">Select a project</div>
        )}
      </div>

      <div className="flex items-center gap-2">
        {/* Public Key - Truncated & Copyable */}
        {currentProject?.publicKey && (
          <button
            onClick={handleCopyPublicKey}
            className="flex items-center gap-1.5 px-2 py-1.5 h-8 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded text-xs transition-all group"
            title={`Copy Public Key: ${currentProject.publicKey}`}
          >
            <span className="font-mono text-slate-600 text-[11px]">{truncatedKey}</span>
            {copiedKey ? (
              <Check className="w-3 h-3 text-emerald-600" />
            ) : (
              <Copy className="w-3 h-3 text-slate-400 group-hover:text-slate-600" />
            )}
          </button>
        )}

        {/* AI Docs Button */}
        <button
          onClick={handleCopyDocsUrl}
          className="flex items-center gap-1.5 px-2 py-1.5 h-8 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded text-xs transition-all group"
          title="Copy AI Integration Prompt"
        >
          <BookOpen className="w-3.5 h-3.5 text-slate-500" />
          <span className="font-bold text-slate-600 uppercase text-[10px]">AI Docs</span>
          {copiedDocs ? (
            <Check className="w-3 h-3 text-emerald-600" />
          ) : (
            <Copy className="w-3 h-3 text-slate-400 group-hover:text-slate-600" />
          )}
        </button>

        {/* Refresh Button - Icon Only */}
        <button
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="flex items-center justify-center w-8 h-8 bg-white hover:bg-slate-50 border border-slate-300 rounded-md shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          title="Refresh data"
        >
          <RefreshCw className={`w-4 h-4 text-slate-700 ${isRefreshing ? 'animate-spin' : ''}`} />
        </button>

        {/* Plan / Usage - Team usage this month */}
        {user && currentTeam && (
          <Link
            to={`${pathPrefix}/team`}
            className="flex items-center gap-2 px-3 py-1.5 h-8 bg-white rounded-md text-xs border border-slate-300 shadow-sm hover:border-slate-400 transition-colors"
            title={`${currentTeam.name} - Usage this month`}
          >
            <span className="font-semibold text-slate-900">{planLabel}</span>
            <span className="h-3 w-0.5 bg-slate-300"></span>
            <span className="font-mono font-semibold text-slate-600">{sessionsUsed.toLocaleString()} sessions</span>
            <span className="text-[9px] text-slate-400">this month</span>
          </Link>
        )}

        {/* User Menu */}
        <div className="relative">
          <button
            onClick={() => setShowUserMenu(!showUserMenu)}
            className="flex items-center gap-2 px-2 py-1.5 hover:bg-slate-50 border border-transparent hover:border-slate-300 rounded-md transition-colors text-left focus:outline-none group"
          >
            <div className="w-8 h-8 bg-slate-100 rounded-md flex items-center justify-center text-slate-500 border border-slate-200">
              <UserIcon className="w-4 h-4 text-slate-700" />
            </div>
            <div className="hidden md:block">
              <div className="text-xs font-semibold text-slate-900 max-w-[120px] truncate">{displayLabel}</div>
              <div className="text-[10px] text-slate-500 truncate max-w-[120px]">View Profile</div>
            </div>
            <ChevronDown className="w-3 h-3 text-slate-500 ml-1" />
          </button>

          {showUserMenu && (
            <>
              <div className="fixed inset-0 z-[90]" onClick={() => setShowUserMenu(false)} />
              <div className="absolute right-0 top-full mt-2 bg-white border border-slate-200 shadow-lg z-[100] w-48 py-1 rounded-md">
                <div className="px-4 py-3 border-b border-slate-100 mb-1">
                  <div className="text-xs font-semibold text-slate-900 truncate">{displayLabel}</div>
                  <div className="text-[10px] text-slate-500 truncate font-mono">{userEmail}</div>
                </div>
                <button
                  onClick={() => navigate(`${pathPrefix}/account`)}
                  className="w-full text-left px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                >
                  <CreditCard className="w-3.5 h-3.5 text-slate-900" />
                  Account
                </button>
                <button
                  onClick={() => {
                    setShowUserMenu(false);
                    logout();
                  }}
                  className="w-full text-left px-4 py-2 text-xs font-medium text-red-600 hover:bg-red-50 flex items-center gap-2"
                >
                  <LogOut className="w-3.5 h-3.5" />
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
