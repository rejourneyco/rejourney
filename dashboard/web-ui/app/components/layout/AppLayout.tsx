import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { Project } from '../../types';
import { ApiProject } from '../../services/api';
import { useTeam } from '../../context/TeamContext';
import { useSessionData } from '../../context/SessionContext';
import { DASHBOARD_MANUAL_REFRESH_COMPLETE, DASHBOARD_MANUAL_REFRESH_START } from '../../constants/events';
import { FolderPlus, Layers3 } from 'lucide-react';

interface AppLayoutProps {
  children: React.ReactNode;
  pathPrefix?: string; // Path prefix for navigation (e.g., '/app' or '/demo')
}

// Convert API project to Project type
function apiProjectToProject(apiProject: ApiProject): Project {
  return {
    id: apiProject.id,
    name: apiProject.name,
    platforms: apiProject.platforms as ('ios' | 'android')[],
    bundleId: apiProject.bundleId || '',
    packageName: apiProject.packageName,
    teamId: apiProject.teamId,
    publicKey: apiProject.publicKey,
    rejourneyEnabled: apiProject.rejourneyEnabled ?? true,
    recordingEnabled: apiProject.recordingEnabled,
    createdAt: apiProject.createdAt,
    sessionsLast7Days: apiProject.sessionsLast7Days || 0,
    errorsLast7Days: apiProject.errorsLast7Days || 0,

    avgUxScore: 0,
  };
}

export const ProjectLayout: React.FC<AppLayoutProps> = ({ children, pathPrefix = '' }) => {
  const { teams, currentTeam, setCurrentTeam, isLoading: teamsLoading } = useTeam();
  const { selectedProject, setSelectedProject, refreshSessions, projects, isLoading: projectsLoading, error: sessionError } = useSessionData();
  const location = useLocation();
  const navigate = useNavigate();
  const [manualRefreshCycle, setManualRefreshCycle] = useState(0);
  const [isManualRefreshing, setIsManualRefreshing] = useState(false);
  const [showRefreshCompleteBar, setShowRefreshCompleteBar] = useState(false);

  const routeWithoutPrefix = useMemo(() => location.pathname.replace(/^\/(dashboard|demo)/, ''), [location.pathname]);
  const isWarehouseRoute = useMemo(() => routeWithoutPrefix.startsWith('/warehouse'), [routeWithoutPrefix]);

  // Changing this forces a remount of routed pages, ensuring all screens reset
  // their local state/effects when switching team/project.
  const routeScopeKey = useMemo(() => (
    isWarehouseRoute
      ? `${currentTeam?.id ?? 'no-team'}:warehouse`
      : `${currentTeam?.id ?? 'no-team'}:${selectedProject?.id ?? 'no-project'}`
  ), [isWarehouseRoute, currentTeam?.id, selectedProject?.id]);
  const contentScopeKey = `${routeScopeKey}:refresh-${manualRefreshCycle}`;
  const isProjectDependentRoute = useMemo(() => (
    routeWithoutPrefix.startsWith('/issues')
    || routeWithoutPrefix.startsWith('/sessions')
    || routeWithoutPrefix.startsWith('/analytics')
    || routeWithoutPrefix.startsWith('/stability')
    || routeWithoutPrefix.startsWith('/alerts')
    || routeWithoutPrefix.startsWith('/settings')
    || routeWithoutPrefix.startsWith('/search')
  ), [routeWithoutPrefix]);
  const hasNoTeam = !projectsLoading && !teamsLoading && !currentTeam && !sessionError;
  const hasNoProjectsForCurrentTeam = !projectsLoading && !teamsLoading && !!currentTeam && projects.length === 0 && !sessionError;
  const shouldShowNoProjectState = hasNoProjectsForCurrentTeam && isProjectDependentRoute;

  // Handle first-time users with no projects
  useEffect(() => {
    if (typeof window === 'undefined') return;
    // Only trigger after loading if the current team has no projects.
    // IMPORTANT: skip when there's an API error — empty could be a transient failure.
    if (!hasNoProjectsForCurrentTeam || !currentTeam?.id) return;

    // Scope the one-time modal per team so creating/switching teams still prompts correctly.
    const modalSeenKey = `hasShownFirstProjectModal:${currentTeam.id}`;
    if (sessionStorage.getItem(modalSeenKey)) return;

    sessionStorage.setItem(modalSeenKey, 'true');
    const timer = window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent('openAddProjectModal'));
    }, 450);

    return () => window.clearTimeout(timer);
  }, [hasNoProjectsForCurrentTeam, currentTeam?.id]);

  // Listen for project/team creation events to refresh list
  useEffect(() => {
    const handleProjectCreated = (event: any) => {
      // Refresh the SessionContext
      refreshSessions().then(() => {
        // Auto-switch to the newly created project if provided
        if (event.detail) {
          const newProject = apiProjectToProject(event.detail);
          setSelectedProject(newProject);
        }
      });
    };
    const handleTeamCreated = () => {
      refreshSessions();
    };

    window.addEventListener('projectCreated', handleProjectCreated);
    window.addEventListener('teamCreated', handleTeamCreated);
    return () => {
      window.removeEventListener('projectCreated', handleProjectCreated);
      window.removeEventListener('teamCreated', handleTeamCreated);
    };
  }, [setSelectedProject, refreshSessions]);

  // Manual topbar refresh should remount page content so route-level fetchers run again.
  useEffect(() => {
    let completeBarTimeout: ReturnType<typeof setTimeout> | null = null;

    const handleManualRefreshStart = () => {
      setIsManualRefreshing(true);
      setShowRefreshCompleteBar(false);
      if (completeBarTimeout) {
        clearTimeout(completeBarTimeout);
        completeBarTimeout = null;
      }
    };

    const handleManualRefreshComplete = () => {
      setIsManualRefreshing(false);
      setManualRefreshCycle(prev => prev + 1);
      setShowRefreshCompleteBar(true);
      completeBarTimeout = setTimeout(() => {
        setShowRefreshCompleteBar(false);
      }, 600);
    };

    window.addEventListener(DASHBOARD_MANUAL_REFRESH_START, handleManualRefreshStart);
    window.addEventListener(DASHBOARD_MANUAL_REFRESH_COMPLETE, handleManualRefreshComplete);

    return () => {
      window.removeEventListener(DASHBOARD_MANUAL_REFRESH_START, handleManualRefreshStart);
      window.removeEventListener(DASHBOARD_MANUAL_REFRESH_COMPLETE, handleManualRefreshComplete);
      if (completeBarTimeout) {
        clearTimeout(completeBarTimeout);
      }
    };
  }, []);

  const handleProjectChange = (project: Project) => {
    // Sync with SessionContext - this updates both sidebar and all pages
    setSelectedProject(project);
  };

  const handleProjectCreated = () => {
    // Refresh projects list when a new project is created - now handled via events
    refreshSessions();
  };

  const openCreateProjectModal = () => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent('openAddProjectModal'));
  };

  const openCreateTeamModal = () => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent('openCreateTeamModal'));
  };

  return (
    <div className="dashboard-modern dashboard-shell flex h-screen">
      {!isWarehouseRoute && (
        <Sidebar
          currentProject={selectedProject}
          onProjectChange={handleProjectChange}
          projects={projects}
          loading={projectsLoading}
          onProjectCreated={handleProjectCreated}
          teams={teams}
          currentTeam={currentTeam}
          onTeamChange={setCurrentTeam}
          teamsLoading={teamsLoading}
          pathPrefix={pathPrefix}
        />
      )}
      <div key={routeScopeKey} className="flex-1 flex flex-col overflow-hidden">
        {!isWarehouseRoute && <TopBar currentProject={selectedProject} />}
        {!isWarehouseRoute && (isManualRefreshing || showRefreshCompleteBar) && (
          <div className="h-1 border-b border-slate-200 bg-slate-100 overflow-hidden">
            <div className={`h-full ${isManualRefreshing
              ? 'w-1/3 bg-gradient-to-r from-sky-500 via-cyan-400 to-sky-500 animate-[shimmer_1.1s_linear_infinite]'
              : 'w-full bg-emerald-500 transition-all duration-300'
              }`} />
          </div>
        )}
        {!isWarehouseRoute && sessionError && (
          <div className="mx-4 mt-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
            {sessionError}
          </div>
        )}
        <div
          key={contentScopeKey}
          className={isWarehouseRoute ? 'flex-1 overflow-hidden' : 'flex-1 overflow-y-auto dashboard-content'}
        >
          {isWarehouseRoute ? children : hasNoTeam ? (
            <div className="mx-auto flex h-full w-full max-w-4xl items-center justify-center p-6">
              <div className="w-full rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
                <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-sky-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-sky-700">
                  <Layers3 className="h-3.5 w-3.5" />
                  No Team Yet
                </div>
                <h2 className="text-2xl font-semibold text-slate-900">Create a team to start using the dashboard.</h2>
                <p className="mt-2 text-sm text-slate-600">
                  Teams hold your projects, members, and billing. Once a team exists, you can add a project and data will appear here.
                </p>
                <div className="mt-6 flex flex-wrap gap-3">
                  <button
                    onClick={openCreateTeamModal}
                    className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
                  >
                    Create Team
                  </button>
                </div>
              </div>
            </div>
          ) : shouldShowNoProjectState ? (
            <div className="mx-auto flex h-full w-full max-w-4xl items-center justify-center p-6">
              <div className="w-full rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
                <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-indigo-700">
                  <Layers3 className="h-3.5 w-3.5" />
                  Empty Team Workspace
                </div>
                <h2 className="text-2xl font-semibold text-slate-900">This team has no projects yet.</h2>
                <p className="mt-2 text-sm text-slate-600">
                  You can create a project now, or continue managing your team and come back later.
                </p>
                <div className="mt-6 flex flex-wrap gap-3">
                  <button
                    onClick={openCreateProjectModal}
                    className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
                  >
                    <FolderPlus className="h-4 w-4" />
                    Create Project
                  </button>
                  <button
                    onClick={() => navigate(`${pathPrefix}/team`)}
                    className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Go to Team Settings
                  </button>
                </div>
              </div>
            </div>
          ) : children}
        </div>
      </div>
    </div>
  );
};
