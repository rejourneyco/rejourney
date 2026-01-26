import React, { useEffect } from 'react';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { Project } from '../../types';
import { ApiProject } from '../../services/api';
import { useTeam } from '../../context/TeamContext';
import { useSessionData } from '../../context/SessionContext';

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
  const { selectedProject, setSelectedProject, refreshSessions, projects, isLoading: projectsLoading } = useSessionData();

  // Changing this forces a remount of routed pages, ensuring all screens reset
  // their local state/effects when switching team/project.
  const routeScopeKey = `${currentTeam?.id ?? 'no-team'}:${selectedProject?.id ?? 'no-project'}`;

  // Handle first-time users with no projects
  useEffect(() => {
    // Only trigger for first-time users after loading is complete
    if (!projectsLoading && !teamsLoading && projects.length === 0 && currentTeam) {
      // Check if we've already shown the modal for this session
      const hasShownModal = sessionStorage.getItem('hasShownFirstProjectModal');
      if (!hasShownModal) {
        sessionStorage.setItem('hasShownFirstProjectModal', 'true');
        // Trigger the add project modal after a short delay
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('openAddProjectModal'));
        }, 1000);
      }
    }
  }, [projects.length, projectsLoading, teamsLoading, currentTeam]);

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

  const handleProjectChange = (project: Project) => {
    // Sync with SessionContext - this updates both sidebar and all pages
    setSelectedProject(project);
  };

  const handleProjectCreated = () => {
    // Refresh projects list when a new project is created - now handled via events
    refreshSessions();
  };

  return (
    <div className="flex h-screen bg-background">
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
      <div key={routeScopeKey} className="flex-1 flex flex-col overflow-hidden">
        <TopBar currentProject={selectedProject} />
        <div className="flex-1 overflow-y-auto bg-background">{children}</div>
      </div>
    </div>
  );
};

