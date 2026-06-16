import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router";
import { isIssueDetectionUiEnabled } from "~/shared/config/runtimeEnv";
import { useSessionData } from "~/shared/providers/SessionContext";
import { useTeam } from "~/shared/providers/TeamContext";

function getDefaultDashboardPath(pathname: string, search: string): string {
  const basePath = pathname.startsWith("/demo") ? "/demo" : "/dashboard";
  const defaultPage = isIssueDetectionUiEnabled() ? "leaks" : "general";
  return `${basePath}/${defaultPage}${search}`;
}

export default function AppIndexRedirect() {
  const location = useLocation();
  const navigate = useNavigate();
  const { currentTeam, isLoading: teamsLoading } = useTeam();
  const {
    projects,
    selectedProject,
    projectsLoading,
    projectsReady,
  } = useSessionData();

  useEffect(() => {
    const basePath = location.pathname.startsWith("/demo") ? "/demo" : "/dashboard";
    const isDemo = basePath === "/demo";

    if (!isDemo && (teamsLoading || projectsLoading || !projectsReady)) {
      return;
    }

    const needsSetup = !isDemo && (!currentTeam || projects.length === 0 || !selectedProject);
    const nextPath = needsSetup
      ? `${basePath}/setup${location.search}`
      : getDefaultDashboardPath(location.pathname, location.search);

    navigate(nextPath, { replace: true });
  }, [
    currentTeam,
    location.pathname,
    location.search,
    navigate,
    projects.length,
    projectsLoading,
    projectsReady,
    selectedProject,
    teamsLoading,
  ]);

  return (
    <div className="flex h-full min-h-[320px] items-center justify-center p-6 text-sm font-semibold text-slate-500">
      Opening dashboard...
    </div>
  );
}
