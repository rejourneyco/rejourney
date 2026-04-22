/**
 * Session Data Context
 *
 * Keeps project bootstrap + selection state lightweight so dashboard chrome
 * can render immediately, while heavier session/analytics screens fetch their
 * own data locally.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from './AuthContext';
import { useDemoMode } from './DemoModeContext';
import { useSafeTeam } from './TeamContext';
import { api, ApiProject, clearCache, clearCacheByPrefixes, getProjects } from '~/shared/api/client';
import { RecordingSession, Project, ProjectDailyStats, TimeRange } from '~/shared/types';
import { clearSelectionCookie, SELECTED_PROJECT_COOKIE, writeSelectionCookie } from '~/shared/utils/selectionCookies';

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
    maxRecordingMinutes: apiProject.maxRecordingMinutes,
    createdAt: apiProject.createdAt,
    sessionsLast7Days: apiProject.sessionsLast7Days || 0,
    errorsLast7Days: apiProject.errorsLast7Days || 0,
  };
}

const SELECTED_PROJECT_ID_KEY_PREFIX = 'rejourney_selected_project_id';

function selectedProjectStorageKey(teamId?: string | null): string {
  return teamId ? `${SELECTED_PROJECT_ID_KEY_PREFIX}:${teamId}` : SELECTED_PROJECT_ID_KEY_PREFIX;
}

function readStoredSelectedProjectId(teamId: string | null | undefined): string | null {
  if (typeof window === 'undefined') {
    return null;
  }

  return localStorage.getItem(selectedProjectStorageKey(teamId));
}

interface SelectProjectForTeamOptions {
  preferredProjectId?: string | null;
  preferStoredSelection?: boolean;
}

function selectProjectForTeam(
  teamProjects: Project[],
  teamId: string | null | undefined,
  {
    preferredProjectId,
    preferStoredSelection = false,
  }: SelectProjectForTeamOptions = {},
): Project | null {
  if (teamProjects.length === 0) return null;

  const savedProjectId = readStoredSelectedProjectId(teamId);
  const candidateIds = preferStoredSelection
    ? [savedProjectId, preferredProjectId]
    : [preferredProjectId, savedProjectId];

  for (const candidateId of candidateIds) {
    if (!candidateId) continue;
    const selected = teamProjects.find((project) => project.id === candidateId) || null;
    if (selected) {
      return selected;
    }
  }

  return teamProjects[0] || null;
}

interface SessionContextValue {
  sessions: RecordingSession[];
  projects: Project[];
  dailyStats: ProjectDailyStats[];
  selectedProject: Project | null;
  setSelectedProject: (project: Project | null) => void;
  timeRange: TimeRange;
  setTimeRange: (range: TimeRange) => void;
  isLoading: boolean;
  error: string | null;
  projectsLoading: boolean;
  projectsReady: boolean;
  projectsError: string | null;
  refreshSessions: () => Promise<void>;
  getSession: (id: string) => Promise<RecordingSession | null>;
  dashboardStats: {
    totalSessions: number;
    avgDuration: number;
    errorRate: number;
  };
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function useSessionData(): SessionContextValue {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error('useSessionData must be used within a SessionDataProvider');
  }
  return context;
}

interface Props {
  children: React.ReactNode;
  initialProjects?: ApiProject[];
  initialProjectsTeamId?: string | null;
  initialSelectedProjectId?: string | null;
}

export function SessionDataProvider({
  children,
  initialProjects = [],
  initialProjectsTeamId,
  initialSelectedProjectId = null,
}: Props) {
  const { currentTeam, isLoading: isTeamLoading } = useSafeTeam();
  const { isAuthenticated, isLoading: isAuthLoading, refreshUser } = useAuth();
  const demoMode = useDemoMode();

  const bootstrappedProjects = useMemo(
    () => initialProjects.map(apiProjectToProject),
    [initialProjects],
  );

  const [sessions, setSessions] = useState<RecordingSession[]>([]);
  const [projects, setProjects] = useState<Project[]>(bootstrappedProjects);
  const [selectedProject, setSelectedProjectState] = useState<Project | null>(() => (
    selectProjectForTeam(bootstrappedProjects, initialProjectsTeamId, { preferredProjectId: initialSelectedProjectId })
  ));
  const [dailyStats, setDailyStats] = useState<ProjectDailyStats[]>([]);
  const [dashboardStats, setDashboardStats] = useState({
    totalSessions: 0,
    avgDuration: 0,
    errorRate: 0,
  });
  const [timeRange, setTimeRange] = useState<TimeRange>('all');
  const [projectsLoading, setProjectsLoading] = useState(!demoMode.isDemoMode && initialProjectsTeamId === undefined);
  const [projectsReady, setProjectsReady] = useState(demoMode.isDemoMode || initialProjectsTeamId !== undefined);
  const [projectsError, setProjectsError] = useState<string | null>(null);

  const latestRequestIdRef = useRef(0);
  const lastTeamIdRef = useRef<string | null>(currentTeam?.id ?? null);
  const bootstrapConsumedRef = useRef(false);

  const applyProjectsForTeam = useCallback((
    fetchedProjects: ApiProject[],
    teamId: string | null | undefined,
    {
      preferredProjectId,
      preferStoredSelection = false,
    }: SelectProjectForTeamOptions = {},
  ) => {
    const teamProjects = fetchedProjects
      .filter((project) => !teamId || !project.teamId || project.teamId === teamId)
      .map(apiProjectToProject);
    const nextSelectedProject = selectProjectForTeam(teamProjects, teamId, {
      preferredProjectId,
      preferStoredSelection,
    });

    setProjects(teamProjects);
    setSelectedProjectState(nextSelectedProject);
    setProjectsReady(true);
    setProjectsError(null);
    setProjectsLoading(false);

    if (typeof window !== 'undefined') {
      const storageKey = selectedProjectStorageKey(teamId);
      if (nextSelectedProject) {
        localStorage.setItem(storageKey, nextSelectedProject.id);
        writeSelectionCookie(SELECTED_PROJECT_COOKIE, nextSelectedProject.id);
      } else {
        localStorage.removeItem(storageKey);
        clearSelectionCookie(SELECTED_PROJECT_COOKIE);
      }
    }

  }, []);

  const refreshProjects = useCallback(async (options: { silent?: boolean; force?: boolean } = {}) => {
    if (demoMode.isDemoMode || !isAuthenticated || !currentTeam?.id) {
      return;
    }

    const requestId = ++latestRequestIdRef.current;
    const isStale = () => latestRequestIdRef.current !== requestId;

    if (!options.silent) {
      setProjectsLoading(true);
    }
    setProjectsError(null);

    try {
      if (options.force) {
        clearCache('projects:list');
      }
      const fetchedProjects = await getProjects();
      if (isStale()) return;
      applyProjectsForTeam(fetchedProjects, currentTeam.id);
    } catch (err) {
      if (isStale()) return;
      console.error('Failed to fetch projects:', err);
      setProjectsLoading(false);
      setProjectsReady(true);
      setProjectsError('Unable to load projects right now. Existing project data is still available.');
    }
  }, [applyProjectsForTeam, currentTeam?.id, demoMode.isDemoMode, isAuthenticated]);

  useEffect(() => {
    if (!demoMode.isDemoMode) return;

    setSessions(demoMode.demoSessions);
    setProjects(demoMode.demoProjects);
    setDailyStats(demoMode.demoDailyStats);
    setDashboardStats(demoMode.demoDashboardStats);
    setSelectedProjectState(demoMode.demoProjects[0] ?? null);
    setProjectsLoading(false);
    setProjectsReady(true);
    setProjectsError(null);
  }, [
    demoMode.demoDailyStats,
    demoMode.demoDashboardStats,
    demoMode.demoProjects,
    demoMode.demoSessions,
    demoMode.isDemoMode,
  ]);

  useEffect(() => {
    if (demoMode.isDemoMode) return;
    if (isTeamLoading || isAuthLoading) return;

    if (!isAuthenticated) {
      setProjects([]);
      setSelectedProjectState(null);
      setSessions([]);
      setProjectsLoading(false);
      setProjectsReady(true);
      setProjectsError(null);
      return;
    }

    const teamId = currentTeam?.id ?? null;
    const previousTeamId = lastTeamIdRef.current;
    const teamChanged = teamId !== previousTeamId;

    if (teamChanged) {
      lastTeamIdRef.current = teamId;
      setProjects([]);
      setSelectedProjectState(null);
      setProjectsLoading(Boolean(teamId));
      setProjectsReady(!teamId);
      setProjectsError(null);
    }

    if (!teamId) {
      setProjects([]);
      setSelectedProjectState(null);
      setProjectsLoading(false);
      setProjectsReady(true);
      return;
    }

    if (
      !bootstrapConsumedRef.current
      && initialProjectsTeamId
      && teamId === initialProjectsTeamId
    ) {
      bootstrapConsumedRef.current = true;
      applyProjectsForTeam(initialProjects, teamId, {
        preferredProjectId: initialSelectedProjectId,
        preferStoredSelection: true,
      });
      return;
    }

    void refreshProjects({ silent: false, force: teamChanged });
  }, [
    applyProjectsForTeam,
    currentTeam?.id,
    demoMode.isDemoMode,
    initialProjects,
    initialProjectsTeamId,
    initialSelectedProjectId,
    isAuthenticated,
    isAuthLoading,
    isTeamLoading,
    refreshProjects,
  ]);

  useEffect(() => {
    if (demoMode.isDemoMode) return;

    const interval = setInterval(() => {
      if (isTeamLoading || isAuthLoading || !isAuthenticated || !currentTeam?.id) return;
      void refreshProjects({ silent: true, force: true });
    }, 30000);

    return () => clearInterval(interval);
  }, [currentTeam?.id, demoMode.isDemoMode, isAuthLoading, isAuthenticated, isTeamLoading, refreshProjects]);

  useEffect(() => {
    if (demoMode.isDemoMode) return;

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const runRefetch = () => {
      if (isTeamLoading || isAuthLoading || !isAuthenticated || !currentTeam?.id) return;
      clearCache('projects:list');
      void refreshUser().finally(() => {
        void refreshProjects({ silent: true, force: false });
      });
    };

    const scheduleRefetch = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(runRefetch, 400);
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        scheduleRefetch();
      }
    };

    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        scheduleRefetch();
      }
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pageshow', onPageShow);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pageshow', onPageShow);
      if (debounceTimer) clearTimeout(debounceTimer);
    };
  }, [currentTeam?.id, demoMode.isDemoMode, isAuthLoading, isAuthenticated, isTeamLoading, refreshProjects, refreshUser]);

  const setSelectedProject = useCallback((project: Project | null) => {
    setSelectedProjectState(project);

    if (typeof window !== 'undefined') {
      const storageKey = selectedProjectStorageKey(currentTeam?.id);
      if (project) {
        localStorage.setItem(storageKey, project.id);
        writeSelectionCookie(SELECTED_PROJECT_COOKIE, project.id);
      } else {
        localStorage.removeItem(storageKey);
        clearSelectionCookie(SELECTED_PROJECT_COOKIE);
      }
    }

    if (project?.id) {
      clearCacheByPrefixes([
        '/api/workspace',
      ]);
    }
  }, [currentTeam?.id]);

  const getSession = useCallback(async (id: string): Promise<RecordingSession | null> => {
    if (demoMode.isDemoMode) {
      return sessions.find((session) => session.id === id) || null;
    }

    try {
      return await api.getRecordingSession(id);
    } catch (err) {
      console.error('Failed to fetch session:', err);
      return null;
    }
  }, [demoMode.isDemoMode, sessions]);

  const value: SessionContextValue = {
    sessions,
    projects,
    dailyStats,
    selectedProject,
    setSelectedProject,
    timeRange,
    setTimeRange,
    isLoading: projectsLoading,
    error: projectsError,
    projectsLoading,
    projectsReady,
    projectsError,
    refreshSessions: () => refreshProjects({ force: true }),
    getSession,
    dashboardStats,
  };

  return (
    <SessionContext.Provider value={value}>
      {children}
    </SessionContext.Provider>
  );
}

export default SessionDataProvider;
