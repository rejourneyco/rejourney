import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { Project } from '~/shared/types';
import { ApiProject } from '~/shared/api/client';
import { useTeam } from '~/shared/providers/TeamContext';
import { useSessionData } from '~/shared/providers/SessionContext';
import { DASHBOARD_MANUAL_REFRESH_COMPLETE, DASHBOARD_MANUAL_REFRESH_START } from '~/shared/constants/events';
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
  };
}

export const ProjectLayout: React.FC<AppLayoutProps> = ({ children, pathPrefix = '' }) => {
  const { teams, currentTeam, setCurrentTeam, isLoading: teamsLoading } = useTeam();
  const {
    selectedProject,
    setSelectedProject,
    refreshSessions,
    projects,
    projectsLoading,
    projectsReady,
    projectsError,
  } = useSessionData();
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
    routeWithoutPrefix.startsWith('/general')
    || routeWithoutPrefix.startsWith('/sessions')
    || routeWithoutPrefix.startsWith('/analytics')
    || routeWithoutPrefix.startsWith('/stability')
    || routeWithoutPrefix.startsWith('/alerts')
    || routeWithoutPrefix.startsWith('/settings')
    || routeWithoutPrefix.startsWith('/search')
  ), [routeWithoutPrefix]);
  const hasNoTeam = !projectsLoading && !teamsLoading && !currentTeam && !projectsError;
  const hasNoProjectsForCurrentTeam = projectsReady && !teamsLoading && !!currentTeam && projects.length === 0 && !projectsError;
  const shouldShowNoProjectState = hasNoProjectsForCurrentTeam && isProjectDependentRoute;

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
    <div className="bg-slate-50 text-black font-sans flex h-screen antialiased selection:bg-[#5dadec] selection:text-black">
      {!isWarehouseRoute && (
        <div className="w-0 shrink-0 overflow-visible md:w-auto md:shrink-0 border-r-2 border-black bg-white z-20 shadow-[2px_0_0_0_rgba(0,0,0,1)]">
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
        </div>
      )}
      <div key={routeScopeKey} className="flex-1 flex flex-col overflow-hidden bg-slate-50 relative">
        {!isWarehouseRoute && <TopBar currentProject={selectedProject} />}
        {!isWarehouseRoute && (isManualRefreshing || showRefreshCompleteBar) && (
          <div className="h-1 bg-slate-200 overflow-hidden border-b-2 border-black relative z-10">
            <div className={`h-full ${isManualRefreshing
              ? 'w-1/3 bg-black animate-[shimmer_1.1s_linear_infinite]'
              : 'w-full bg-[#5dadec] transition-all duration-300'
              }`} />
          </div>
        )}
        {!isWarehouseRoute && projectsError && (
          <div className="mx-6 mt-4 border-2 border-black bg-red-100 shadow-neo-sm px-4 py-3 font-bold uppercase tracking-wider text-sm text-red-900">
            {projectsError}
          </div>
        )}
        <div
          key={contentScopeKey}
          className={isWarehouseRoute ? 'flex-1 overflow-hidden bg-slate-50' : 'flex-1 overflow-y-auto bg-slate-50'}
        >
          {isWarehouseRoute ? children : hasNoTeam ? (
            <div className="mx-auto flex h-full w-full max-w-4xl items-center justify-center p-8">
              <div className="w-full bg-white border-2 border-black p-10 shadow-neo">
                <div className="mb-4 inline-flex h-12 w-12 items-center justify-center border-2 border-black bg-[#5dadec] text-black shadow-neo-sm">
                  <Layers3 className="h-6 w-6 stroke-[3]" />
                </div>
                <h2 className="text-2xl font-black uppercase tracking-tight text-black">Create a team to start</h2>
                <p className="mt-3 text-base font-medium text-slate-600">
                  Teams hold your projects, members, and billing. Once a team exists, you can add a project and data will appear here.
                </p>
                <div className="mt-8 flex gap-4">
                  <button
                    onClick={openCreateTeamModal}
                    className="inline-flex items-center gap-2 border-2 border-black bg-black px-6 py-3 text-sm font-black uppercase tracking-widest text-white shadow-neo-sm hover:-translate-y-0.5 hover:shadow-neo transition-all"
                  >
                    Create Team
                  </button>
                </div>
              </div>
            </div>
          ) : shouldShowNoProjectState ? (
            <div className="mx-auto flex h-full w-full max-w-4xl items-center justify-center p-8">
              <div className="w-full bg-white border-2 border-black p-10 shadow-neo">
                <div className="mb-4 inline-flex h-12 w-12 items-center justify-center border-2 border-black bg-[#fef08a] text-black shadow-neo-sm">
                  <FolderPlus className="h-6 w-6 stroke-[3]" />
                </div>
                <h2 className="text-2xl font-black uppercase tracking-tight text-black">Empty Team Workspace</h2>
                <p className="mt-3 text-base font-medium text-slate-600">
                  You can create a project now, or continue managing your team and come back later.
                </p>
                <div className="mt-8 flex flex-wrap gap-4">
                  <button
                    onClick={openCreateProjectModal}
                    className="inline-flex items-center gap-2 border-2 border-black bg-[#5dadec] px-6 py-3 text-sm font-black uppercase tracking-widest text-black shadow-neo-sm hover:-translate-y-0.5 hover:shadow-neo transition-all"
                  >
                    <FolderPlus className="h-4 w-4 stroke-[3]" />
                    Create Project
                  </button>
                  <button
                    onClick={() => navigate(`${pathPrefix}/team`)}
                    className="inline-flex items-center gap-2 border-2 border-black bg-white px-6 py-3 text-sm font-black uppercase tracking-widest text-black shadow-neo-sm hover:-translate-y-0.5 hover:shadow-neo transition-all"
                  >
                    Team Settings
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
