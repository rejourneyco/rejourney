import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { Project } from '~/shared/types';
import { createTeam, ApiTeam } from '~/shared/api/client';
import { TabRegistry } from '~/shell/tabs/TabRegistry';
import { Modal } from '~/shared/ui/core/Modal';
import { Input } from '~/shared/ui/core/Input';
import { Button } from '~/shared/ui/core/Button';
import { ProjectCreatedModal } from '~/shared/ui/core/ProjectCreatedModal';
import { CreateProjectModal } from '~/features/app/setup/CreateProjectModal';
import { shouldSurfaceSetup } from '~/features/app/setup/setupUtils';
import { DASHBOARD_PAGE_META, DashboardPageKey } from '~/shell/navigation/dashboardPageMeta';
import {
  ChartNoAxesColumnIncreasing,
  Smartphone,
  Globe,
  CodeXml,
  Workflow,
  BellRing,
  Settings,
  User,
  Plus,
  ChevronDown,
  ChevronRight,
  Check,
  ChevronsLeft,
  ChevronsRight,
} from 'lucide-react';
import { isIssueDetectionUiEnabled } from '~/shared/config/runtimeEnv';

const SIDEBAR_WIDTH_STORAGE_KEY = 'rj-dashboard-sidebar-width';
const SIDEBAR_COLLAPSED_STORAGE_KEY = 'rj-dashboard-sidebar-collapsed';
const SIDEBAR_SECTION_COLLAPSED_STORAGE_KEY = 'rj-dashboard-sidebar-section-collapsed';
const DEFAULT_SIDEBAR_WIDTH = 300;
const MIN_SIDEBAR_WIDTH = 220;
const MAX_SIDEBAR_WIDTH = 440;
const COLLAPSED_SIDEBAR_WIDTH = 64;
const SIDEBAR_PREFETCH_TIME_RANGE = '30d';

type SidebarNavVisual = {
  accent: string;
  activeBg: string;
};

type SidebarNavItem = {
  path: string;
  label: string;
  icon: React.ElementType;
} & SidebarNavVisual;

function createSidebarNavItem(path: string, pageKey: DashboardPageKey): SidebarNavItem {
  const meta = DASHBOARD_PAGE_META[pageKey];

  return {
    path,
    label: meta.sidebarLabel,
    icon: meta.icon,
    accent: meta.accent,
    activeBg: meta.activeBg,
  };
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function isTimeRange(value: string | null): value is string {
  return value === '24h' || value === '7d' || value === '30d' || value === '90d' || value === '180d' || value === '1y' || value === 'all';
}

function readSidebarPrefetchTimeRange(projectId?: string | null): string {
  if (typeof window === 'undefined') return SIDEBAR_PREFETCH_TIME_RANGE;
  const keySuffix = projectId || 'global';
  const stored =
    window.localStorage.getItem(`rejourney.dashboard.timeRange.${keySuffix}`) ??
    window.localStorage.getItem(`rejourney.analytics.timeRange.${keySuffix}`);
  return isTimeRange(stored) ? stored : SIDEBAR_PREFETCH_TIME_RANGE;
}

interface SidebarProps {
  currentProject: Project | null;
  onProjectChange: (project: Project) => void;
  projects: Project[];
  loading?: boolean;
  onProjectCreated?: () => void;
  teams?: ApiTeam[];
  currentTeam?: ApiTeam | null;
  onTeamChange?: (team: ApiTeam) => void;
  teamsLoading?: boolean;
  pathPrefix?: string; // Optional prefix for paths (e.g., '/demo' for demo mode)
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentProject,
  onProjectChange,
  projects,
  loading,
  onProjectCreated,
  teams = [],
  currentTeam,
  onTeamChange,
  teamsLoading = false,
  pathPrefix = '' // Default to no prefix for normal dashboard
}) => {
  const location = useLocation();
  const navigate = useNavigate();
  const [showAppSelector, setShowAppSelector] = useState(false);
  const [showTeamSelector, setShowTeamSelector] = useState(false);
  const [showAddAppModal, setShowAddAppModal] = useState(false);
  const [isCreatingTeam, setIsCreatingTeam] = useState(false);
  const [showCreateTeamModal, setShowCreateTeamModal] = useState(false);
  const [newTeamName, setNewTeamName] = useState('');
  const [createTeamError, setCreateTeamError] = useState<string | null>(null);

  // Project created modal state
  const [showProjectCreatedModal, setShowProjectCreatedModal] = useState(false);
  const [createdProject, setCreatedProject] = useState<Project | null>(null);
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const [collapsed, setCollapsed] = useState(false);
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const [sectionPrefsLoaded, setSectionPrefsLoaded] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const resizeRef = React.useRef<{ startX: number; startWidth: number } | null>(null);

  React.useEffect(() => {
    try {
      const w = localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
      if (w) {
        const n = parseInt(w, 10);
        if (!Number.isNaN(n)) setSidebarWidth(clamp(n, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH));
      }
      if (localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === '1') setCollapsed(true);
    } catch {
      /* ignore */
    }
  }, []);

  React.useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(sidebarWidth));
    } catch {
      /* ignore */
    }
  }, [sidebarWidth]);

  React.useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, collapsed ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [collapsed]);

  React.useEffect(() => {
    try {
      const raw = localStorage.getItem(SIDEBAR_SECTION_COLLAPSED_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const next: Record<string, boolean> = {};
        Object.entries(parsed).forEach(([key, value]) => {
          if (value === true) next[key] = true;
        });
        setCollapsedSections(next);
      }
    } catch {
      /* ignore */
    } finally {
      setSectionPrefsLoaded(true);
    }
  }, []);

  React.useEffect(() => {
    if (!sectionPrefsLoaded) return;
    try {
      localStorage.setItem(SIDEBAR_SECTION_COLLAPSED_STORAGE_KEY, JSON.stringify(collapsedSections));
    } catch {
      /* ignore */
    }
  }, [collapsedSections, sectionPrefsLoaded]);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(min-width: 768px)');
    const set = () => setIsDesktop(mq.matches);
    set();
    mq.addEventListener('change', set);
    return () => mq.removeEventListener('change', set);
  }, []);

  React.useEffect(() => {
    if (!isResizing) return;
    const onMove = (e: PointerEvent) => {
      if (!resizeRef.current) return;
      const delta = e.clientX - resizeRef.current.startX;
      const next = resizeRef.current.startWidth + delta;
      if (isDesktop) {
        setSidebarWidth(clamp(next, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH));
      } else {
        const maxW = Math.min(MAX_SIDEBAR_WIDTH, Math.floor(window.innerWidth * 0.92));
        setSidebarWidth(clamp(next, MIN_SIDEBAR_WIDTH, maxW));
      }
    };
    const onUp = () => {
      resizeRef.current = null;
      setIsResizing(false);
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
    return () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
    };
  }, [isResizing, isDesktop]);

  const effectiveWidthPx = React.useMemo(() => {
    if (isDesktop && collapsed) return COLLAPSED_SIDEBAR_WIDTH;
    return sidebarWidth;
  }, [isDesktop, collapsed, sidebarWidth]);

  // Resize only on desktop — a full-height strip on mobile steals touches and breaks the drawer.
  const showResizeHandle = isDesktop && !collapsed;
  const showIssueDetectionUi = isIssueDetectionUiEnabled();
  const showSetupNavItem = !currentTeam || shouldSurfaceSetup(projects, currentProject);

  const startResize = (e: React.PointerEvent) => {
    if (typeof window === 'undefined') return;
    if (isDesktop && collapsed) return;
    e.preventDefault();
    const maxW = isDesktop ? MAX_SIDEBAR_WIDTH : Math.min(MAX_SIDEBAR_WIDTH, Math.floor(window.innerWidth * 0.92));
    const w = clamp(sidebarWidth, MIN_SIDEBAR_WIDTH, maxW);
    resizeRef.current = { startX: e.clientX, startWidth: w };
    setIsResizing(true);
  };

  React.useEffect(() => {
    const handleToggleMobile = () => setIsMobileOpen(prev => !prev);
    const handleCloseMobile = () => setIsMobileOpen(false);
    window.addEventListener('toggleMobileSidebar', handleToggleMobile);
    window.addEventListener('closeMobileSidebar', handleCloseMobile);
    
    return () => {
      window.removeEventListener('toggleMobileSidebar', handleToggleMobile);
      window.removeEventListener('closeMobileSidebar', handleCloseMobile);
    };
  }, []);

  React.useEffect(() => {
    if (isDesktop) return;
    setIsMobileOpen(false);
    setShowAppSelector(false);
    setShowTeamSelector(false);
  }, [isDesktop, location.pathname]);

  React.useEffect(() => {
    if (typeof window === 'undefined' || isDesktop || !isMobileOpen) return;

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsMobileOpen(false);
      }
    };

    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isDesktop, isMobileOpen]);

  React.useEffect(() => {
    const handleOpenAddProjectModal = () => {
      setShowAddAppModal(true);
    };
    const handleOpenCreateTeamModal = () => {
      setCreateTeamError(null);
      setNewTeamName('');
      setShowCreateTeamModal(true);
    };
    window.addEventListener('openAddProjectModal', handleOpenAddProjectModal);
    window.addEventListener('openCreateTeamModal', handleOpenCreateTeamModal);
    return () => {
      window.removeEventListener('openAddProjectModal', handleOpenAddProjectModal);
      window.removeEventListener('openCreateTeamModal', handleOpenCreateTeamModal);
    };
  }, []);

  // Helper to prefix paths for demo mode
  const p = (path: string) => pathPrefix + path;
  const defaultDashboardPath = p(showSetupNavItem ? '/setup' : isIssueDetectionUiEnabled() ? '/leaks' : '/general');

  const closeCreateTeamModal = () => {
    setShowCreateTeamModal(false);
    setNewTeamName('');
    setCreateTeamError(null);
  };

  const navSections = React.useMemo<Array<{
    id: string;
    section: string;
    icon: React.ElementType;
    accent: string;
    items: SidebarNavItem[];
  }>>(() => [
    ...(showIssueDetectionUi ? [{
      id: 'automations',
      section: 'Automations',
      icon: Workflow,
      accent: '#0891b2',
      items: [
        createSidebarNavItem(p('/leaks'), 'leaks'),
      ],
    }] : []),
    {
      id: 'growth',
      section: 'Growth',
      icon: ChartNoAxesColumnIncreasing,
      accent: '#2563eb',
      items: [
        createSidebarNavItem(p('/general'), 'general'),
        createSidebarNavItem(p('/sessions'), 'sessions'),
        createSidebarNavItem(p('/geo'), 'geo'),
        createSidebarNavItem(p('/journeys'), 'journeys'),
        createSidebarNavItem(p('/heatmaps'), 'heatmaps'),
      ],
    },
    {
      id: 'developer',
      section: 'Developer',
      icon: CodeXml,
      accent: '#7c3aed',
      items: [
        createSidebarNavItem(p('/stability'), 'stability'),
        createSidebarNavItem(p('/api'), 'api'),
        createSidebarNavItem(p('/devices'), 'devices'),
      ],
    },
    {
      id: 'alerts',
      section: 'Alerts',
      icon: BellRing,
      accent: '#b45309',
      items: [
        createSidebarNavItem(p('/alerts/emails'), 'emails'),
      ],
    },
    {
      id: 'workspace',
      section: 'Workspace',
      icon: Settings,
      accent: '#475569',
      items: [
        ...(showSetupNavItem ? [createSidebarNavItem(p('/setup'), 'setup')] : []),
        ...(currentProject ? [createSidebarNavItem(p(`/settings/${currentProject.id}`), 'project')] : []),
        createSidebarNavItem(p('/team'), 'team'),
        createSidebarNavItem(p('/billing'), 'billing'),
      ],
    },
    {
      id: 'you',
      section: 'You',
      icon: User,
      accent: '#64748b',
      items: [
        createSidebarNavItem(p('/account'), 'account'),
      ],
    },
  ], [currentProject, pathPrefix, projects, showIssueDetectionUi, showSetupNavItem]);

  // isActive needs to check if path matches, accounting for demo prefix
  const isActive = (path: string) => location.pathname === path;
  const collapsedDesktop = isDesktop && collapsed;
  const prefetchTimeRange = readSidebarPrefetchTimeRange(currentProject?.id);

  const prefetchPath = React.useCallback((path: string) => {
    TabRegistry.prefetch(path, {
      projectId: currentProject?.id,
      timeRange: prefetchTimeRange,
    });
  }, [currentProject?.id, prefetchTimeRange]);

  const toggleSection = React.useCallback((sectionId: string) => {
    setCollapsedSections((prev) => {
      const next = { ...prev };
      if (next[sectionId]) {
        delete next[sectionId];
      } else {
        next[sectionId] = true;
      }
      return next;
    });
  }, []);

  React.useEffect(() => {
    if (typeof window === 'undefined' || isDesktop || !isMobileOpen) return;
    const maxW = Math.min(MAX_SIDEBAR_WIDTH, Math.floor(window.innerWidth * 0.92));
    setSidebarWidth((w) => (w > maxW ? maxW : w));
  }, [isDesktop, isMobileOpen]);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;

    const candidates = navSections
      .flatMap((section) => section.items)
      .filter((item) => item.path !== location.pathname)
      .slice(0, 2);

    if (candidates.length === 0) return;

    const schedule = () => {
      candidates.forEach((item) => prefetchPath(item.path));
    };

    if ('requestIdleCallback' in window) {
      const idleId = (window as Window & { requestIdleCallback: (cb: () => void, options?: { timeout: number }) => number }).requestIdleCallback(
        schedule,
        { timeout: 900 },
      );
      return () => {
        (window as Window & { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback?.(idleId);
      };
    }

    const timeoutId = globalThis.setTimeout(schedule, 350);
    return () => globalThis.clearTimeout(timeoutId);
  }, [location.pathname, navSections, prefetchPath]);

  return (
    <>
      {/* Mobile backdrop */}
      {isMobileOpen && (
        <div 
          className="fixed inset-0 z-[900] bg-black/45 md:hidden"
          onClick={() => setIsMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      <div
        className={`
        dashboard-sidebar flex-shrink-0 h-[100dvh] min-h-0 flex flex-col bg-white border-r-2 border-black
        fixed left-0 top-0 z-[910] md:relative md:left-auto md:top-auto md:z-auto transition-transform duration-300 ease-in-out
        max-w-[100vw] min-w-0
        ${isResizing ? '' : 'md:transition-[width] md:duration-200 md:ease-out'}
        ${isMobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
      `}
        style={{ width: effectiveWidthPx, maxWidth: isDesktop ? undefined : 'min(92vw, 440px)' }}
      >
        {showResizeHandle && (
          <button
            type="button"
            aria-label="Drag to resize sidebar"
            onPointerDown={startResize}
            className="absolute right-0 top-0 z-30 h-full w-1.5 cursor-col-resize touch-none border-0 bg-transparent p-0 hover:bg-[#5dadec]/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-black"
          />
        )}
        {/* Brand & Team Switcher */}
        <div className={`border-b-2 border-black bg-white ${collapsedDesktop ? 'p-2' : 'p-4'}`}>
          <div className="relative mb-3">
            <button
              type="button"
              title={collapsedDesktop ? (currentTeam?.name || 'Team') : undefined}
              onClick={() => {
                setShowTeamSelector(!showTeamSelector);
                setShowAppSelector(false);
              }}
              className={`w-full flex bg-white border border-black/20 hover:bg-slate-50 hover:border-black/40 text-slate-800 transition-all text-sm font-semibold ${collapsedDesktop ? 'justify-center px-2 py-2.5' : 'items-center justify-between px-3 py-2'}`}
            >
              <div className={`flex min-w-0 items-center overflow-hidden ${collapsedDesktop ? '' : 'gap-2'}`}>
                <div className="w-5 h-5 bg-[#e0f7ff] border border-black/20 flex items-center justify-center text-slate-700 font-bold text-xs shrink-0">
                  {currentTeam?.name?.[0] || 'R'}
                </div>
                {!collapsedDesktop && (
                  <span className="truncate">
                    {currentTeam?.name || 'Select Team'}
                  </span>
                )}
              </div>
              {!collapsedDesktop && <ChevronDown className="w-4 h-4 text-black shrink-0" />}
            </button>

            {showTeamSelector && (
              <div className={`absolute top-full mt-1 bg-white border-2 border-black shadow-[4px_4px_0_0_rgba(0,0,0,1)] z-[920] animate-in fade-in zoom-in-95 duration-100 ${collapsedDesktop ? 'left-0 w-64' : 'left-0 right-0'}`}>
                <div className="border-b-2 border-black bg-slate-50 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
                  Switch Team
                </div>
                <div className="max-h-[200px] overflow-y-auto custom-scrollbar">
                  {teams.map((team) => (
                    <button
                      key={team.id}
                      onClick={() => {
                        if (currentTeam?.id === team.id) {
                          setShowTeamSelector(false);
                          return;
                        }
                        if (onTeamChange) onTeamChange(team);
                        setShowTeamSelector(false);
                        setShowAppSelector(false);
                        setIsMobileOpen(false);
                        navigate(defaultDashboardPath);
                      }}
                      className={`w-full text-left px-3 py-2 text-sm font-semibold flex items-center justify-between gap-2 border-b border-slate-100 last:border-0 ${currentTeam?.id === team.id ? 'bg-[#e0f7ff] text-slate-900 font-bold' : 'text-slate-700 hover:bg-slate-50'}`}
                    >
                      <span className="truncate">
                        {team.name || `Team ${team.id.slice(0, 8)}...`}
                      </span>
                      {currentTeam?.id === team.id && <Check className="w-4 h-4 text-slate-600" />}
                    </button>
                  ))}
                </div>
                <div className="border-t-2 border-black p-2 bg-slate-50">
                  <button
                    onClick={() => {
                      setShowTeamSelector(false);
                      setCreateTeamError(null);
                      setNewTeamName('');
                      setShowCreateTeamModal(true);
                    }}
                    className="w-full text-left px-3 py-1.5 text-xs text-black hover:bg-[#ecfeff] font-black uppercase tracking-wide flex items-center gap-2"
                  >
                    <Plus className="w-3 h-3" /> Create Team
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Project Selector */}
          <div className="relative">
            <button
              type="button"
              disabled={loading}
              title={collapsedDesktop ? (currentProject?.name || 'Project') : undefined}
              onClick={() => {
                if (loading) return;
                setShowAppSelector(!showAppSelector);
                setShowTeamSelector(false);
              }}
              className={`w-full flex bg-white border border-black/20 transition-all text-sm ${loading ? 'cursor-wait opacity-80' : 'hover:bg-slate-50 hover:border-black/40'} ${showAppSelector ? 'bg-slate-50 border-black/40' : ''} ${collapsedDesktop ? 'justify-center px-2 py-2.5' : 'items-center justify-between px-3 py-2'}`}
            >
              {collapsedDesktop ? (
                <span className="flex h-6 w-6 items-center justify-center border border-black/20 bg-emerald-50 text-[11px] font-bold text-slate-700">
                  {(currentProject?.name || 'P').slice(0, 1).toUpperCase()}
                </span>
              ) : (
                <>
                  <span className="min-w-0 truncate font-semibold text-black">
                    {loading ? 'Loading projects...' : (currentProject?.name || 'Select Project')}
                  </span>
                  <ChevronDown className="w-4 h-4 text-black shrink-0" />
                </>
              )}
            </button>

            {showAppSelector && (
              <div className={`absolute top-full mt-1 bg-white border-2 border-black shadow-[4px_4px_0_0_rgba(0,0,0,1)] z-[920] animate-in fade-in zoom-in-95 duration-100 ${collapsedDesktop ? 'left-0 w-64' : 'left-0 right-0'}`}>
                <div className="border-b-2 border-black bg-slate-50 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
                  Projects
                </div>
                <div className="max-h-[300px] overflow-y-auto custom-scrollbar">
                  {loading ? (
                    <div className="space-y-2 p-3">
                      {Array.from({ length: 3 }).map((_, index) => (
                        <div key={index} className="h-9 animate-pulse border border-slate-200 bg-slate-50" />
                      ))}
                    </div>
                  ) : projects.length > 0 ? (
                    projects.map((project) => (
                      <button
                        key={project.id}
                        onClick={() => {
                          onProjectChange(project);
                          setShowAppSelector(false);
                          setIsMobileOpen(false);
                        }}
                        className={`w-full text-left px-3 py-2 text-sm font-semibold flex items-center justify-between gap-2 border-b border-slate-100 last:border-0 ${currentProject?.id === project.id ? 'bg-[#e0f7ff] text-slate-900 font-bold' : 'text-slate-700 hover:bg-slate-50'
                          }`}
                      >
                        <span className="truncate">{project.name}</span>
                        {currentProject?.id === project.id && <Check className="w-4 h-4 text-slate-600" />}
                      </button>
                    ))
                  ) : (
                    <div className="px-3 py-4 text-sm font-semibold text-slate-600">
                      No projects yet for this team.
                    </div>
                  )}
                </div>
                <div className="border-t-2 border-black p-2 bg-slate-50">
                  <button
                    onClick={() => {
                      setShowAppSelector(false);
                      setShowAddAppModal(true);
                    }}
                    className="w-full text-left px-3 py-1.5 text-xs text-black hover:bg-[#ecfeff] font-black uppercase tracking-wide flex items-center gap-2"
                  >
                    <Plus className="w-3 h-3" /> New Project
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Navigation */}
        <div className={`flex-1 overflow-y-auto custom-scrollbar ${collapsedDesktop ? 'space-y-4 px-2 py-3' : 'space-y-4 px-3 py-4'}`}>
          {navSections.map((section) => {
            if (section.items.length === 0) return null;

            const activeInSection = section.items.some((item) => isActive(item.path));
            const sectionCollapsed = !collapsedDesktop && Boolean(collapsedSections[section.id]);
            const sectionDomId = `sidebar-section-${section.id}`;
            const SectionIcon = section.icon;

            return (
              <div key={section.id} className={collapsedDesktop ? '' : 'border-b border-slate-100 pb-3 last:border-b-0 last:pb-0'}>
                {!collapsedDesktop && (
                  <button
                    type="button"
                    onClick={() => toggleSection(section.id)}
                    aria-expanded={!sectionCollapsed}
                    aria-controls={sectionDomId}
                    className={`group mb-2 flex w-full items-center justify-between rounded-[6px] px-3 py-2.5 text-left transition-colors ${
                      activeInSection
                        ? 'bg-slate-50 text-slate-900'
                        : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'
                    }`}
                  >
                    <span className="flex min-w-0 items-center gap-2.5">
                      <SectionIcon
                        className="h-5 w-5 shrink-0"
                        strokeWidth={2.7}
                        style={{ color: section.accent }}
                      />
                      <span className="truncate text-base font-black tracking-normal">
                        {section.section}
                      </span>
                    </span>
                    {sectionCollapsed ? (
                      <ChevronRight className="h-4 w-4 shrink-0" strokeWidth={2.5} />
                    ) : (
                      <ChevronDown className="h-4 w-4 shrink-0" strokeWidth={2.5} />
                    )}
                  </button>
                )}
                {(!sectionCollapsed || collapsedDesktop) && (
                  <div id={sectionDomId} className="space-y-1">
                    {section.items.map((item) => {
                      const itemActive = isActive(item.path);

                      return (
                        <Link
                          key={item.path}
                          to={item.path}
                          aria-current={itemActive ? 'page' : undefined}
                          title={collapsedDesktop ? item.label : undefined}
                          onClick={() => setIsMobileOpen(false)}
                          onMouseEnter={() => prefetchPath(item.path)}
                          onFocus={() => prefetchPath(item.path)}
                          className={`
                            dashboard-nav-item relative flex items-center overflow-hidden rounded-[6px] text-[0.95rem] transition-colors
                            ${collapsedDesktop ? 'justify-center px-2 py-2.5' : 'gap-3.5 px-4 py-3'}
                            ${itemActive
                              ? 'text-[#202124] font-bold shadow-[inset_0_0_0_1px_rgba(15,23,42,0.06)]'
                              : 'text-[#4b5563] font-semibold hover:bg-[#f8fafd] hover:text-[#202124]'
                            }
                          `}
                          style={{ backgroundColor: itemActive ? item.activeBg : undefined }}
                        >
                          <span
                            className="absolute left-0 top-0 bottom-0 w-[3px] transition-opacity duration-150"
                            style={{
                              background: item.accent,
                              opacity: itemActive ? 1 : 0,
                            }}
                          />
                          <item.icon
                            className="h-[18px] w-[18px] shrink-0"
                            strokeWidth={2.25}
                            style={{ color: item.accent, opacity: itemActive ? 1 : 0.78 }}
                          />
                          {!collapsedDesktop && <span className="min-w-0 flex-1 truncate">{item.label}</span>}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {isDesktop && (
          <div className="mt-auto border-t-2 border-black bg-white p-2">
            <button
              type="button"
              onClick={() => setCollapsed((c) => !c)}
              className="flex w-full items-center justify-center gap-2 py-2 text-slate-400 transition-all hover:bg-slate-50 hover:text-slate-700"
              title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              aria-expanded={!collapsed}
            >
              {collapsed ? <ChevronsRight className="h-4 w-4 shrink-0" /> : <ChevronsLeft className="h-4 w-4 shrink-0" />}
              {!collapsed && <span className="text-sm font-semibold">Collapse</span>}
            </button>
          </div>
        )}
      </div>

      <CreateProjectModal
        isOpen={showAddAppModal}
        onClose={() => setShowAddAppModal(false)}
        currentTeam={currentTeam}
        onCreated={async (project) => {
          setCreatedProject(project);
          setShowProjectCreatedModal(true);
          onProjectChange(project);
          if (onProjectCreated) onProjectCreated();
          window.dispatchEvent(new CustomEvent('projectCreated', { detail: project }));
          navigate(defaultDashboardPath);
        }}
      />

      {/* Create Team Modal */}
      <Modal
        isOpen={showCreateTeamModal}
        onClose={closeCreateTeamModal}
        title="Create Team"
        panelClassName="rounded-none border-2 border-black shadow-[8px_8px_0_0_rgba(0,0,0,1)]"
        bodyClassName="p-0"
        footer={
          <>
            <Button
              variant="secondary"
              className="rounded-none border-2 border-black bg-white px-5 font-black uppercase text-black shadow-neo-sm hover:bg-[#ecfeff] hover:border-black"
              onClick={closeCreateTeamModal}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              className="rounded-none border-2 border-black bg-[#67e8f9] px-5 font-black uppercase text-black shadow-neo-sm hover:bg-[#22d3ee]"
              disabled={isCreatingTeam || !newTeamName.trim()}
              onClick={async () => {
                const teamName = newTeamName.trim();
                if (!teamName) {
                  setCreateTeamError('Team name is required.');
                  return;
                }

                try {
                  setIsCreatingTeam(true);
                  setCreateTeamError(null);
                  const newTeam = await createTeam(teamName);
                  if (onTeamChange) onTeamChange(newTeam);
                  window.dispatchEvent(new CustomEvent('teamCreated', { detail: { teamId: newTeam.id } }));
                  closeCreateTeamModal();
                  navigate(defaultDashboardPath);
                } catch (e) {
                  setCreateTeamError(e instanceof Error ? e.message : 'Failed to create team');
                } finally {
                  setIsCreatingTeam(false);
                }
              }}
            >
              {isCreatingTeam ? 'Creating...' : 'Create Team'}
            </Button>
          </>
        }
      >
        <div className="space-y-4 p-6">
          {createTeamError && (
            <div className="border-2 border-black bg-[#fecaca] p-3 text-sm font-black uppercase text-black shadow-neo-sm">
              {createTeamError}
            </div>
          )}
          <Input
            label="Team Name"
            placeholder="e.g. Engineering"
            value={newTeamName}
            onChange={(e) => setNewTeamName(e.target.value)}
            className="h-11 rounded-none border-2 border-black bg-white font-medium text-black placeholder:text-slate-500 focus-visible:ring-0 focus-visible:border-black"
          />
        </div>
      </Modal>

      {/* Project Created Success Modal */}
      <ProjectCreatedModal
        isOpen={showProjectCreatedModal}
        onClose={() => {
          setShowProjectCreatedModal(false);
          setCreatedProject(null);
        }}
        project={createdProject}
      />
    </>
  );
};
