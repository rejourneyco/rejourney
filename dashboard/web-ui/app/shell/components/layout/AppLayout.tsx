import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { Project, Platform } from '~/shared/types';
import { ApiProject } from '~/shared/api/client';
import { useTeam } from '~/shared/providers/TeamContext';
import { useSessionData } from '~/shared/providers/SessionContext';
import { DashboardManualRefreshProvider } from '~/shared/providers/DashboardManualRefreshContext';
import { DASHBOARD_MANUAL_REFRESH_COMPLETE } from '~/shared/constants/events';
import { trackRejourneyDashboardContext } from '~/shared/compliance/rejourneyWebsiteTelemetry';
import { isSetupSupportRoute } from '~/features/app/setup/setupUtils';
import { Home, Rocket, ArrowLeft, Menu } from 'lucide-react';

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

const DemoLiveNotice: React.FC = () => (
  <div className="relative z-[9] border-b border-slate-200/50 bg-white/70 backdrop-blur-md px-3 py-2 text-slate-700 sm:px-4 shadow-sm">
    <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-2">
      <div className="flex min-w-0 items-center gap-2.5">
        {/* Mobile Menu Toggle button */}
        <button
          onClick={() => window.dispatchEvent(new CustomEvent('toggleMobileSidebar'))}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200/60 bg-white/60 backdrop-blur-sm shadow-sm transition-all hover:bg-slate-50/80 md:hidden"
          aria-label="Toggle sidebar"
        >
          <Menu className="h-4 w-4 stroke-[2]" />
        </button>
        <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500 animate-pulse ring-4 ring-emerald-500/20" aria-hidden="true" />
        <p className="min-w-0 truncate text-xs font-semibold leading-5 text-slate-800 sm:text-sm tracking-wide">
          You're in the live demo.
          <span className="hidden text-slate-500 sm:inline normal-case font-medium"> Explore freely with sample data.</span>
        </p>
      </div>
      <nav aria-label="Demo quick links" className="flex shrink-0 items-center gap-2">
        <Link
          to="/"
          className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-slate-200/80 bg-white/80 px-3.5 text-xs font-semibold text-slate-700 shadow-sm backdrop-blur-sm transition-all hover:bg-slate-50 hover:text-slate-900 hover:border-slate-300 active:scale-[0.98]"
        >
          <ArrowLeft className="h-3.5 w-3.5 stroke-[2]" aria-hidden="true" />
          <span>Back</span>
        </Link>
        <Link
          to="/login"
          className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg bg-gradient-to-r from-emerald-500 to-teal-500 px-4 text-xs font-semibold text-white shadow-md shadow-emerald-500/10 hover:shadow-emerald-500/20 transition-all hover:brightness-105 active:scale-[0.98]"
        >
          <Rocket className="h-3.5 w-3.5 stroke-[2]" aria-hidden="true" />
          <span>Get started</span>
        </Link>
      </nav>
    </div>
  </div>
);

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
  const isDemoLayout = pathPrefix === '/demo';

  const routeWithoutPrefix = useMemo(() => location.pathname.replace(/^\/(dashboard|demo)/, ''), [location.pathname]);
  const isSetupRoute = isSetupSupportRoute(location.pathname);
  const isSetupWizardRoute = routeWithoutPrefix === '/setup';

  // Changing this forces a remount of routed pages, ensuring all screens reset
  // their local state/effects when switching team/project.
  const routeScopeKey = useMemo(
    () => `${currentTeam?.id ?? 'no-team'}:${selectedProject?.id ?? 'no-project'}`,
    [currentTeam?.id, selectedProject?.id],
  );
  const contentScopeKey = isSetupWizardRoute ? 'setup-wizard' : routeScopeKey;
  const dashboardContentClassName = [
    'dashboard-content dashboard-surface-mix min-h-0 min-w-0 flex-1 overflow-x-hidden',
    isSetupWizardRoute ? 'overflow-y-hidden' : 'overflow-y-auto',
  ].join(' ');
  const isProjectDependentRoute = useMemo(() => (
    routeWithoutPrefix.startsWith('/general')
    || routeWithoutPrefix.startsWith('/sessions')
    || routeWithoutPrefix.startsWith('/analytics')
    || routeWithoutPrefix.startsWith('/stability')
    || routeWithoutPrefix.startsWith('/leaks')
    || routeWithoutPrefix.startsWith('/automations')
    || routeWithoutPrefix.startsWith('/alerts')
    || routeWithoutPrefix.startsWith('/settings')
    || routeWithoutPrefix.startsWith('/search')
  ), [routeWithoutPrefix]);
  const hasNoTeam = !projectsLoading && !teamsLoading && !currentTeam && !projectsError;
  const hasNoProjectsForCurrentTeam = projectsReady && !teamsLoading && !!currentTeam && projects.length === 0 && !projectsError;
  const shouldRouteToSetup = !isDemoLayout && !isSetupRoute && isProjectDependentRoute && (hasNoTeam || hasNoProjectsForCurrentTeam);

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

  // Manual topbar refresh is exposed as data state so routes can refetch without
  // throwing away their rendered surface.
  useEffect(() => {
    const handleManualRefreshComplete = (event: Event) => {
      const didFail = event instanceof CustomEvent && event.detail?.success === false;
      if (didFail) return;
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

  useEffect(() => {
    if (!shouldRouteToSetup) return;
    navigate(`${pathPrefix}/setup`, { replace: true });
  }, [navigate, pathPrefix, shouldRouteToSetup]);

  const handleProjectChange = (project: Project) => {
    // Sync with SessionContext - this updates both sidebar and all pages
    setSelectedProject(project);
  };

  const handleProjectCreated = () => {
    // Refresh projects list when a new project is created - now handled via events
    refreshSessions();
  };

  return (
    <div className="dashboard-modern dashboard-shell flex h-dvh min-h-screen min-w-0 font-sans text-black antialiased selection:bg-[#67e8f9] selection:text-black">
      <div className="relative z-[900] w-0 shrink-0 overflow-visible bg-white md:z-20 md:w-auto md:shrink-0">
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
      <div key={contentScopeKey} className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-[var(--dashboard-canvas)]">
        {!isDemoLayout && <TopBar currentProject={selectedProject} hideDemoHomeLink={isDemoLayout} />}
        {isDemoLayout && <DemoLiveNotice />}
        {projectsError && (
          <div className="mx-4 mt-4 border-2 border-black bg-[#f9a8d4] px-4 py-3 text-sm font-extrabold text-black shadow-neo-sm sm:mx-6">
            {projectsError}
          </div>
        )}
        <div
          className={dashboardContentClassName}
        >
          <DashboardManualRefreshProvider value={manualRefreshCycle}>
            {shouldRouteToSetup ? (
              <div className="p-6 text-sm font-semibold text-slate-500">Opening setup...</div>
            ) : children}
          </DashboardManualRefreshProvider>
        </div>
      </div>
    </div>
  );
};
