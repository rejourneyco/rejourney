import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { Project, Platform } from '~/shared/types';
import { ApiProject } from '~/shared/api/client';
import { useTeam } from '~/shared/providers/TeamContext';
import { useSessionData } from '~/shared/providers/SessionContext';
import { DASHBOARD_MANUAL_REFRESH_COMPLETE } from '~/shared/constants/events';
import { FolderPlus, Layers3 } from 'lucide-react';
import { trackRejourneyDashboardContext } from '~/shared/compliance/rejourneyWebsiteTelemetry';

interface AppLayoutProps {
  children: React.ReactNode;
  pathPrefix?: string; // Path prefix for navigation (e.g., '/app' or '/demo')
}

// Convert API project to Project type
function apiProjectToProject(apiProject: ApiProject): Project {
  return {
    id: apiProject.id,
    name: apiProject.name,
    platforms: apiProject.platforms as Platform[],
    bundleId: apiProject.bundleId || '',
    packageName: apiProject.packageName,
    webDomain: apiProject.webDomain,
    webAllowedDomains: apiProject.webAllowedDomains || [],
    teamId: apiProject.teamId,
    publicKey: apiProject.publicKey,
    rejourneyEnabled: apiProject.rejourneyEnabled ?? true,
    recordingEnabled: apiProject.recordingEnabled,
    textInputMasking: apiProject.textInputMasking,
    imageVideoMasking: apiProject.imageVideoMasking,
    recordingFps: apiProject.recordingFps,
    sampleRate: apiProject.sampleRate,
    maxRecordingMinutes: apiProject.maxRecordingMinutes,
    webMaxObservabilityMinutes: apiProject.webMaxObservabilityMinutes,
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
    const handleManualRefreshComplete = () => {
      setManualRefreshCycle(prev => prev + 1);
    };

    window.addEventListener(DASHBOARD_MANUAL_REFRESH_COMPLETE, handleManualRefreshComplete);

    return () => {
      window.removeEventListener(DASHBOARD_MANUAL_REFRESH_COMPLETE, handleManualRefreshComplete);
    };
  }, []);

  useEffect(() => {
    trackRejourneyDashboardContext({
      pathname: location.pathname,
      currentTeam,
      teams,
      selectedProject,
      projectCount: projects.length,
    });
  }, [currentTeam, location.pathname, projects.length, selectedProject, teams]);

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
    <div className="dashboard-modern dashboard-shell flex h-dvh min-h-screen min-w-0 font-sans text-black antialiased selection:bg-[#67e8f9] selection:text-black">
      {!isWarehouseRoute && (
        <div className="z-20 w-0 shrink-0 overflow-visible bg-white md:w-auto md:shrink-0">
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
      <div key={routeScopeKey} className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-[var(--dashboard-canvas)]">
        {!isWarehouseRoute && <TopBar currentProject={selectedProject} />}
        {!isWarehouseRoute && projectsError && (
          <div className="mx-4 mt-4 border-2 border-black bg-[#f9a8d4] px-4 py-3 text-sm font-extrabold text-black shadow-neo-sm sm:mx-6">
            {projectsError}
          </div>
        )}
        <div
          key={contentScopeKey}
          className={isWarehouseRoute ? 'dashboard-content dashboard-surface-mix min-w-0 flex-1 overflow-hidden' : 'dashboard-content dashboard-surface-mix min-w-0 flex-1 overflow-x-hidden overflow-y-auto'}
        >
          {isWarehouseRoute ? children : hasNoTeam ? (
            <div className="mx-auto flex h-full w-full max-w-4xl items-center justify-center p-4 sm:p-8">
              <div className="w-full border-2 border-black bg-white p-5 shadow-neo sm:p-8">
                <div className="mb-4 inline-flex h-12 w-12 items-center justify-center border-2 border-black bg-[#67e8f9] text-black shadow-neo-sm">
                  <Layers3 className="h-6 w-6 stroke-[3]" />
                </div>
                <h2 className="text-xl font-extrabold text-black">Create a team to start</h2>
                <p className="mt-3 text-base font-medium text-slate-600">
                  Teams hold your projects, members, and billing. Once a team exists, you can add a project and data will appear here.
                </p>
                <div className="mt-8 flex flex-wrap gap-4">
                  <button
                    onClick={openCreateTeamModal}
                    className="inline-flex items-center gap-2 border-2 border-black bg-black px-5 py-2.5 text-sm font-bold text-white shadow-neo-sm transition-all hover:-translate-y-0.5 hover:shadow-neo"
                  >
                    Create Team
                  </button>
                </div>
              </div>
            </div>
          ) : shouldShowNoProjectState ? (
            <div className="mx-auto flex h-full w-full max-w-4xl items-center justify-center p-4 sm:p-8">
              <div className="w-full border-2 border-black bg-white p-5 shadow-neo sm:p-8">
                <div className="mb-4 inline-flex h-12 w-12 items-center justify-center border-2 border-black bg-[#86efac] text-black shadow-neo-sm">
                  <FolderPlus className="h-6 w-6 stroke-[3]" />
                </div>
                <h2 className="text-xl font-extrabold text-black">Empty Team Workspace</h2>
                <p className="mt-3 text-base font-medium text-slate-600">
                  You can create a project now, or continue managing your team and come back later.
                </p>
                <div className="mt-8 flex flex-wrap gap-4">
                  <button
                    onClick={openCreateProjectModal}
                    className="inline-flex items-center gap-2 border-2 border-black bg-[#67e8f9] px-5 py-2.5 text-sm font-bold text-black shadow-neo-sm transition-all hover:-translate-y-0.5 hover:shadow-neo"
                  >
                    <FolderPlus className="h-4 w-4 stroke-[3]" />
                    Create Project
                  </button>
                  <button
                    onClick={() => navigate(`${pathPrefix}/team`)}
                    className="inline-flex items-center gap-2 border-2 border-black bg-white px-5 py-2.5 text-sm font-bold text-black shadow-neo-sm transition-all hover:-translate-y-0.5 hover:shadow-neo"
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
