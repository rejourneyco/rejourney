import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { Project } from '~/shared/types';
import { createProject, createTeam, ApiTeam } from '~/shared/api/client';
import { TabRegistry } from '~/shell/tabs/TabRegistry';
import { Modal } from '~/shared/ui/core/Modal';
import { Input } from '~/shared/ui/core/Input';
import { Button } from '~/shared/ui/core/Button';
import { ProjectCreatedModal } from '~/shared/ui/core/ProjectCreatedModal';
import { getAndroidPackageError, getIosBundleIdError } from '~/shared/lib/validation';
import {
  Activity,
  Smartphone,
  Globe,
  Map,
  Flame,
  Database,
  Settings,
  Users,
  User,
  Plus,
  ChevronDown,
  Check,
  Apple,
  Terminal,
  AlertOctagon,
  Clock,
  MessageSquareWarning,
  Mail,
  AlertTriangle,
  CreditCard,
  ChevronsLeft,
  ChevronsRight,
} from 'lucide-react';

const SIDEBAR_WIDTH_STORAGE_KEY = 'rj-dashboard-sidebar-width';
const SIDEBAR_COLLAPSED_STORAGE_KEY = 'rj-dashboard-sidebar-collapsed';
const DEFAULT_SIDEBAR_WIDTH = 280;
const MIN_SIDEBAR_WIDTH = 200;
const MAX_SIDEBAR_WIDTH = 440;
const COLLAPSED_SIDEBAR_WIDTH = 64;
const SIDEBAR_PREFETCH_TIME_RANGE = '30d';

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function isTimeRange(value: string | null): value is string {
  return value === '24h' || value === '7d' || value === '30d' || value === '90d' || value === '180d' || value === '1y' || value === 'all';
}

function readSidebarPrefetchTimeRange(projectId?: string | null): string {
  if (typeof window === 'undefined') return SIDEBAR_PREFETCH_TIME_RANGE;
  const stored = window.localStorage.getItem(`rejourney.analytics.timeRange.${projectId || 'global'}`);
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
  const [newAppName, setNewAppName] = useState('');
  const [newBundleId, setNewBundleId] = useState('');
  const [newPackageName, setNewPackageName] = useState('');
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
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

  const closeCreateTeamModal = () => {
    setShowCreateTeamModal(false);
    setNewTeamName('');
    setCreateTeamError(null);
  };

  const navSections = React.useMemo(() => [
    {
      section: 'Monitor',
      items: [
        { path: p('/general'), label: 'General', icon: MessageSquareWarning },
        { path: p('/sessions'), label: 'Replays', icon: Database },
      ],
    },
    {
      section: 'Analytics',
      items: [
        { path: p('/analytics/api'), label: 'API Insights', icon: Activity },
        { path: p('/analytics/journeys'), label: 'User Journeys', icon: Map },
        { path: p('/analytics/heatmaps'), label: 'Heatmaps', icon: Flame },
        { path: p('/analytics/devices'), label: 'Devices', icon: Smartphone },
        { path: p('/analytics/geo'), label: 'Geographic', icon: Globe },
      ],
    },
    {
      section: 'Stability',
      items: [
        { path: p('/stability/crashes'), label: 'Crashes', icon: AlertOctagon },
        { path: p('/stability/anrs'), label: 'ANRs', icon: Clock },
        { path: p('/stability/errors'), label: 'Errors', icon: Terminal },
      ],
    },
    {
      section: 'Alerts',
      items: [
        { path: p('/alerts/emails'), label: 'Emails', icon: Mail },
      ],
    },
    {
      section: 'Workspace',
      items: [
        ...(currentProject ? [{ path: p(`/settings/${currentProject.id}`), label: 'Project', icon: Settings }] : []),
        { path: p('/team'), label: 'Team', icon: Users },
        { path: p('/billing'), label: 'Plan & Billing', icon: CreditCard },
      ],
    },
    {
      section: 'You',
      items: [
        { path: p('/account'), label: 'Account', icon: User },
      ],
    },
  ], [currentProject, pathPrefix]);

  // isActive needs to check if path matches, accounting for demo prefix
  const isActive = (path: string) => location.pathname === path;
  const warehousePath = p('/warehouse');
  const isWarehouseActive = isActive(warehousePath);
  const collapsedDesktop = isDesktop && collapsed;
  const prefetchTimeRange = readSidebarPrefetchTimeRange(currentProject?.id);

  const prefetchPath = React.useCallback((path: string) => {
    TabRegistry.prefetch(path, {
      projectId: currentProject?.id,
      timeRange: prefetchTimeRange,
    });
  }, [currentProject?.id, prefetchTimeRange]);

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
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={() => setIsMobileOpen(false)}
        />
      )}

      <div
        className={`
        bg-zinc-50 flex-shrink-0 h-screen min-h-0 flex flex-col border-r border-zinc-200/50
        fixed left-0 top-0 md:relative md:left-auto md:top-auto z-50 transition-transform duration-300 ease-in-out
        max-w-[100vw] min-w-0
        ${isResizing ? '' : 'md:transition-[width] md:duration-200 md:ease-out'}
        ${isMobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
      `}
        style={{ width: effectiveWidthPx }}
      >
        {showResizeHandle && (
          <button
            type="button"
            aria-label="Drag to resize sidebar"
            onPointerDown={startResize}
            className="absolute right-0 top-0 z-30 h-full w-2 cursor-col-resize touch-none border-0 bg-transparent p-0 hover:bg-sky-400/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60"
          />
        )}
        {/* Brand & Team Switcher */}
        <div className={`border-b border-slate-200 bg-transparent ${collapsedDesktop ? 'p-2' : 'p-4'}`}>
          {collapsedDesktop ? (
            <Link
              to={warehousePath}
              title="Warehouse (Alpha)"
              onClick={() => {
                setShowTeamSelector(false);
                setShowAppSelector(false);
                setIsMobileOpen(false);
              }}
              className={`mb-3 flex h-10 w-full items-center justify-center rounded-lg border transition-colors ${isWarehouseActive
                ? 'border-sky-300 bg-white text-black shadow-sm'
                : 'border-slate-200 bg-white text-black hover:border-slate-300 hover:shadow-sm'
                }`}
            >
              <Database className="h-4 w-4" />
            </Link>
          ) : (
            <Link
              to={warehousePath}
              onClick={() => {
                setShowTeamSelector(false);
                setShowAppSelector(false);
                setIsMobileOpen(false);
              }}
              className={`mb-3 flex w-full items-center justify-between rounded-lg border px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] transition-colors ${isWarehouseActive
                ? 'border-sky-300 bg-white text-black shadow-sm'
                : 'border-slate-200 bg-white text-black hover:border-slate-300 hover:shadow-sm'
                }`}
            >
              <span className="inline-flex items-center gap-2">
                <Database className="h-3.5 w-3.5" />
                Warehouse
              </span>
              <span className="rounded-full border border-current px-1.5 py-0.5 text-[9px] tracking-[0.1em]">Alpha</span>
            </Link>
          )}

          <div className="relative mb-3">
            <button
              type="button"
              title={collapsedDesktop ? (currentTeam?.name || 'Team') : undefined}
              onClick={() => {
                setShowTeamSelector(!showTeamSelector);
                setShowAppSelector(false);
              }}
              className={`w-full flex bg-white border border-slate-200 hover:border-slate-300 hover:shadow-sm text-black transition-all rounded-lg text-sm font-medium ${collapsedDesktop ? 'justify-center px-2 py-2.5' : 'items-center justify-between px-3 py-2'}`}
            >
              <div className={`flex items-center overflow-hidden ${collapsedDesktop ? '' : 'gap-2'}`}>
                <div className="w-5 h-5 bg-slate-100 border border-slate-200 rounded-md flex items-center justify-center text-black font-semibold text-xs shrink-0">
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
              <div className={`absolute top-full mt-2 bg-white border border-slate-200 shadow-lg rounded-xl z-50 animate-in fade-in zoom-in-95 duration-100 ${collapsedDesktop ? 'left-0 w-64' : 'left-0 right-0'}`}>
                <div className="px-3 py-2 text-xs font-semibold text-slate-700 border-b border-slate-100 uppercase">
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
                        navigate(p('/general'));
                      }}
                      className={`w-full text-left px-3 py-2 text-sm font-medium hover:bg-slate-50 flex items-center justify-between group border-b border-slate-100 last:border-0 ${currentTeam?.id === team.id ? 'bg-sky-50 text-black font-semibold' : 'text-black'}`}
                    >
                      <span className="truncate">
                        {team.name || `Team ${team.id.slice(0, 8)}...`}
                      </span>
                      {currentTeam?.id === team.id && <Check className="w-4 h-4 text-[#5dadec]" />}
                    </button>
                  ))}
                </div>
                <div className="border-t border-slate-100 p-2 bg-white">
                  <button
                    onClick={() => {
                      setShowTeamSelector(false);
                      setCreateTeamError(null);
                      setNewTeamName('');
                      setShowCreateTeamModal(true);
                    }}
                    className="w-full text-left px-3 py-1.5 text-xs text-black hover:text-[#5dadec] font-medium flex items-center gap-2"
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
              className={`w-full flex bg-white border border-slate-200 transition-all rounded-lg text-sm ${loading ? 'cursor-wait opacity-80' : 'hover:border-slate-300 hover:shadow-sm'} ${showAppSelector ? 'border-slate-300' : ''} ${collapsedDesktop ? 'justify-center px-2 py-2.5' : 'items-center justify-between px-3 py-2'}`}
            >
              {collapsedDesktop ? (
                <span className="flex h-6 w-6 items-center justify-center rounded-md border border-slate-200 bg-white text-[11px] font-semibold text-black">
                  {(currentProject?.name || 'P').slice(0, 1).toUpperCase()}
                </span>
              ) : (
                <>
                  <span className="font-medium text-black truncate">
                    {loading ? 'Loading projects...' : (currentProject?.name || 'Select Project')}
                  </span>
                  <ChevronDown className="w-4 h-4 text-black shrink-0" />
                </>
              )}
            </button>

            {showAppSelector && (
              <div className={`absolute top-full mt-2 bg-white border border-slate-200 shadow-lg rounded-xl z-50 animate-in fade-in zoom-in-95 duration-100 ${collapsedDesktop ? 'left-0 w-64' : 'left-0 right-0'}`}>
                <div className="px-3 py-2 text-xs font-semibold text-slate-700 border-b border-slate-100 uppercase">
                  Projects
                </div>
                <div className="max-h-[300px] overflow-y-auto custom-scrollbar">
                  {loading ? (
                    <div className="space-y-2 p-3">
                      {Array.from({ length: 3 }).map((_, index) => (
                        <div key={index} className="h-9 animate-pulse rounded-md bg-gray-200" />
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
                        className={`w-full text-left px-3 py-2 text-sm font-medium flex items-center justify-between border-b border-slate-100 last:border-0 ${currentProject?.id === project.id ? 'bg-sky-50 text-black font-semibold' : 'text-black hover:bg-slate-50'
                          }`}
                      >
                        <span className="truncate">{project.name}</span>
                        {currentProject?.id === project.id && <Check className="w-4 h-4 text-[#5dadec]" />}
                      </button>
                    ))
                  ) : (
                    <div className="px-3 py-4 text-sm text-gray-500">
                      No projects yet for this team.
                    </div>
                  )}
                </div>
                <div className="border-t border-slate-100 p-2 bg-white">
                  <button
                    onClick={() => {
                      setShowAppSelector(false);
                      setShowAddAppModal(true);
                    }}
                    className="w-full text-left px-3 py-1.5 text-xs text-black hover:text-[#5dadec] font-medium flex items-center gap-2"
                  >
                    <Plus className="w-3 h-3" /> New Project
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Navigation */}
        <div className={`flex-1 overflow-y-auto space-y-7 custom-scrollbar ${collapsedDesktop ? 'px-2 py-3' : 'px-4 py-4'}`}>
          {navSections.map((section) => (
            section.items.length > 0 && (
              <div key={section.section} className="space-y-2">
                {!collapsedDesktop && (
                  <div className="px-2 text-[10px] font-bold text-gray-500 tracking-widest uppercase font-mono pb-1 mb-1">
                    {section.section}
                  </div>
                )}
                <div className="space-y-1">
                  {section.items.map((item) => (
                    <Link
                      key={item.path}
                      to={item.path}
                      title={collapsedDesktop ? item.label : undefined}
                      onClick={() => setIsMobileOpen(false)}
                      onMouseEnter={() => prefetchPath(item.path)}
                      onFocus={() => prefetchPath(item.path)}
                      className={`
                        dashboard-nav-item flex items-center text-[0.8rem] font-black uppercase tracking-wider transition-all border-2
                        ${collapsedDesktop ? 'justify-center px-2 py-2.5' : 'gap-3 px-3 py-2.5'}
                        ${isActive(item.path)
                          ? 'border-black bg-black text-white shadow-neo-sm translate-x-1 -translate-y-0.5'
                          : 'border-transparent text-gray-600 hover:border-black hover:bg-[#f1f5f9] hover:text-black hover:shadow-neo-sm hover:translate-x-1 hover:-translate-y-0.5'
                        }
                      `}
                    >
                      <item.icon className={`w-4 h-4 shrink-0 ${isActive(item.path) ? 'text-white' : 'text-current'}`} strokeWidth={2.5} />
                      {!collapsedDesktop && <span>{item.label}</span>}
                    </Link>
                  ))}
                </div>
              </div>
            )
          ))}
        </div>

        {isDesktop && (
          <div className="mt-auto border-t border-slate-200 p-2">
            <button
              type="button"
              onClick={() => setCollapsed((c) => !c)}
              className="flex w-full items-center justify-center gap-2 py-2 text-gray-500 transition-colors hover:text-black hover:bg-white rounded-none"
              title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              aria-expanded={!collapsed}
            >
              {collapsed ? <ChevronsRight className="h-4 w-4 shrink-0" /> : <ChevronsLeft className="h-4 w-4 shrink-0" />}
              {!collapsed && <span className="text-xs font-medium">Collapse</span>}
            </button>
          </div>
        )}
      </div>

      {/* Add Project Modal */}
      <Modal
        isOpen={showAddAppModal}
        onClose={() => {
          setShowAddAppModal(false);
          setNewAppName('');
          setNewBundleId('');
          setNewPackageName('');
          setSelectedPlatforms([]);
        }}
        title="Create New Project"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setShowAddAppModal(false);
                setNewAppName('');
                setNewBundleId('');
                setNewPackageName('');
                setSelectedPlatforms([]);
                setCreateError(null);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={async () => {
                if (!newAppName || selectedPlatforms.length === 0) return;
                if (selectedPlatforms.includes('ios') && !newBundleId) return;
                if (selectedPlatforms.includes('android') && !newPackageName) return;

                try {
                  setIsCreating(true);
                  setCreateError(null);

                  const newProject = await createProject({
                    name: newAppName,
                    bundleId: newBundleId || undefined,
                    packageName: newPackageName || undefined,
                    teamId: currentTeam?.id,
                    platforms: selectedPlatforms,
                  });

                  const createdProjectData: Project = { ...newProject } as any;

                  setShowAddAppModal(false);
                  setNewAppName('');
                  setNewBundleId('');
                  setNewPackageName('');
                  setSelectedPlatforms([]);

                  setCreatedProject(createdProjectData);
                  setShowProjectCreatedModal(true);

                  onProjectChange(createdProjectData);
                  if (onProjectCreated) onProjectCreated();
                  window.dispatchEvent(new CustomEvent('projectCreated', { detail: newProject }));
                  navigate(p('/general'));
                } catch (error) {
                  setCreateError(error instanceof Error ? error.message : 'Failed to create project');
                } finally {
                  setIsCreating(false);
                }
              }}
              disabled={
                isCreating ||
                !newAppName ||
                selectedPlatforms.length === 0 ||
                (selectedPlatforms.includes('ios') && !newBundleId) ||
                (selectedPlatforms.includes('android') && !newPackageName) ||
                (selectedPlatforms.includes('ios') && !!getIosBundleIdError(newBundleId)) ||
                (selectedPlatforms.includes('android') && !!getAndroidPackageError(newPackageName))
              }
            >
              {isCreating ? 'Creating...' : 'Create Project'}
            </Button>
          </>
        }
      >
        <div className="space-y-4 pt-2">
          {createError && (
            <div className="bg-red-50 border-2 border-red-200 p-3 text-sm text-red-600 font-mono font-bold">
              {createError}
            </div>
          )}
          <Input
            label="Project Name"
            placeholder="e.g. Consumer iOS App"
            value={newAppName}
            onChange={(e) => setNewAppName(e.target.value)}
          />

          <div className="space-y-2">
            <label className="text-sm font-bold font-mono uppercase text-slate-700">Platforms</label>
            <div className="grid grid-cols-2 gap-3">
              {[
                { id: 'ios', label: 'iOS App', icon: Apple },
                { id: 'android', label: 'Android App', icon: Smartphone }
              ].map(platform => (
                <div
                  key={platform.id}
                  onClick={() => {
                    if (selectedPlatforms.includes(platform.id)) {
                      setSelectedPlatforms(selectedPlatforms.filter(p => p !== platform.id));
                    } else {
                      setSelectedPlatforms([...selectedPlatforms, platform.id]);
                    }
                  }}
                  className={`
                      cursor-pointer border-2 rounded p-3 flex flex-col items-center gap-2 transition-all shadow-sm
                      ${selectedPlatforms.includes(platform.id)
                      ? 'border-slate-900 bg-slate-900 text-white shadow-[4px_4px_0_0_#94a3b8]'
                      : 'border-slate-200 hover:border-slate-900 hover:shadow-[2px_2px_0_0_#94a3b8]'
                    }
                   `}
                >
                  <platform.icon className={`w-6 h-6 ${selectedPlatforms.includes(platform.id) ? 'text-white' : 'text-slate-400'}`} />
                  <span className={`text-sm font-bold font-mono uppercase ${selectedPlatforms.includes(platform.id) ? 'text-white' : 'text-slate-600'}`}>{platform.label}</span>
                </div>
              ))}
            </div>
          </div>

          {selectedPlatforms.includes('ios') && (
            <div className="space-y-3 p-4 bg-slate-50 border-2 border-slate-200">
              <div className="flex items-center gap-2 mb-2">
                <Apple className="w-4 h-4 text-slate-900" />
                <h4 className="text-sm font-bold text-slate-900 font-mono uppercase">iOS Configuration</h4>
              </div>
              <Input
                label="Bundle Identifier"
                placeholder="com.example.app"
                value={newBundleId}
                onChange={(e) => setNewBundleId(e.target.value)}
              />
              {getIosBundleIdError(newBundleId) && (
                <p className="text-xs font-bold text-red-600 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> {getIosBundleIdError(newBundleId)}
                </p>
              )}
            </div>
          )}

          {selectedPlatforms.includes('android') && (
            <div className="space-y-3 p-4 bg-slate-50 border-2 border-slate-200">
              <div className="flex items-center gap-2 mb-2">
                <Smartphone className="w-4 h-4 text-slate-900" />
                <h4 className="text-sm font-bold text-slate-900 font-mono uppercase">Android Configuration</h4>
              </div>
              <Input
                label="Package Name"
                placeholder="com.example.app"
                value={newPackageName}
                onChange={(e) => setNewPackageName(e.target.value)}
              />
              {getAndroidPackageError(newPackageName) && (
                <p className="text-xs font-bold text-red-600 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> {getAndroidPackageError(newPackageName)}
                </p>
              )}
            </div>
          )}
        </div>
      </Modal>

      {/* Create Team Modal */}
      <Modal
        isOpen={showCreateTeamModal}
        onClose={closeCreateTeamModal}
        title="Create Team"
        footer={
          <>
            <Button variant="secondary" onClick={closeCreateTeamModal}>Cancel</Button>
            <Button
              variant="primary"
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
                  navigate(p('/general'));
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
        <div className="space-y-4 pt-2">
          {createTeamError && (
            <div className="bg-red-50 border-2 border-red-200 p-3 text-sm text-red-600 font-mono font-bold">
              {createTeamError}
            </div>
          )}
          <Input
            label="Team Name"
            placeholder="e.g. Engineering"
            value={newTeamName}
            onChange={(e) => setNewTeamName(e.target.value)}
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
