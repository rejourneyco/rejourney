/**
 * Session Data Context
 *
 * Keeps project bootstrap + selection state lightweight so dashboard chrome
 * can render immediately, while heavier session/analytics screens fetch their
 * own data locally.
 */

import React, { createContext, startTransition, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from './AuthContext';
import { useDemoMode } from './DemoModeContext';
import { useSafeTeam } from './TeamContext';
import { api, ApiProject, clearCache, clearCacheByPrefixes, getProjects } from '~/shared/api/client';
import { RecordingSession, Project, ProjectDailyStats, TimeRange, Platform } from '~/shared/types';
import { clearSelectionCookie, SELECTED_PROJECT_COOKIE, writeSelectionCookie } from '~/shared/utils/selectionCookies';

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
    sessionsTotal: apiProject.sessionsTotal || 0,
    sessionsLast7Days: apiProject.sessionsLast7Days || 0,
    errorsTotal: apiProject.errorsTotal || 0,
    errorsLast7Days: apiProject.errorsLast7Days || 0,
  };
}

const SELECTED_PROJECT_ID_KEY_PREFIX = 'rejourney_selected_project_id';
const MIN_HIDDEN_MS_BEFORE_VISIBLE_REFETCH = 15000;

function selectedProjectStorageKey(teamId?: string | null): string {
  return teamId ? `${SELECTED_PROJECT_ID_KEY_PREFIX}:${teamId}` : SELECTED_PROJECT_ID_KEY_PREFIX;
}

function readStoredSelectedProjectId(teamId: string | null | undefined): string | null {
  if (typeof window === 'undefined') {
    return null;
  }

  return localStorage.getItem(selectedProjectStorageKey(teamId));
}

function arraysEqual(left: readonly unknown[] | undefined, right: readonly unknown[] | undefined): boolean {
  const a = left ?? [];
  const b = right ?? [];
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

function projectsEqual(left: Project, right: Project): boolean {
  return left.id === right.id
    && left.name === right.name
    && left.bundleId === right.bundleId
    && left.packageName === right.packageName
    && left.webDomain === right.webDomain
    && left.teamId === right.teamId
    && left.publicKey === right.publicKey
    && left.rejourneyEnabled === right.rejourneyEnabled
    && left.recordingEnabled === right.recordingEnabled
    && left.textInputMasking === right.textInputMasking
    && left.imageVideoMasking === right.imageVideoMasking
    && left.recordingFps === right.recordingFps
    && left.sampleRate === right.sampleRate
    && left.maxRecordingMinutes === right.maxRecordingMinutes
    && left.webMaxObservabilityMinutes === right.webMaxObservabilityMinutes
    && left.createdAt === right.createdAt
    && left.sessionsTotal === right.sessionsTotal
    && left.sessionsLast7Days === right.sessionsLast7Days
    && left.errorsTotal === right.errorsTotal
    && left.errorsLast7Days === right.errorsLast7Days
    && arraysEqual(left.platforms, right.platforms)
    && arraysEqual(left.webAllowedDomains, right.webAllowedDomains);
}

function projectListsEqual(left: Project[], right: Project[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((project, index) => projectsEqual(project, right[index]));
}

function preserveStableProjectList(currentProjects: Project[], nextProjects: Project[]): Project[] {
  return projectListsEqual(currentProjects, nextProjects) ? currentProjects : nextProjects;
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
  refreshSessions: (options?: { silent?: boolean }) => Promise<void>;
  getSession: (id: string) => Promise<RecordingSession | null>;
  dashboardStats: {
    totalSessions: number;
    avgDuration: number;
    errorRate: number;
  };
}

const SessionContext = createContext<SessionContextValue | null>(null);
const EMPTY_INITIAL_PROJECTS: ApiProject[] = [];

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
  initialProjects = EMPTY_INITIAL_PROJECTS,
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
  const lastVisibilityProjectRefreshAtRef = useRef(0);
  const lastHiddenAtRef = useRef<number | null>(null);
  const hasCompletedInitialProjectLoadRef = useRef(
    demoMode.isDemoMode || initialProjectsTeamId !== undefined,
  );

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

    setProjects((currentProjects) => preserveStableProjectList(currentProjects, teamProjects));
    setSelectedProjectState((currentSelectedProject) => {
      if (!currentSelectedProject || !nextSelectedProject) return nextSelectedProject;
      return projectsEqual(currentSelectedProject, nextSelectedProject)
        ? currentSelectedProject
        : nextSelectedProject;
    });
    setProjectsReady(true);
    setProjectsError(null);
    setProjectsLoading(false);
    hasCompletedInitialProjectLoadRef.current = true;

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

    if (!options.silent && !hasCompletedInitialProjectLoadRef.current) {
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
      setProjectsError('Network Error. Please Reconnect.');
      hasCompletedInitialProjectLoadRef.current = true;
    }
  }, [applyProjectsForTeam, currentTeam?.id, demoMode.isDemoMode, isAuthenticated]);

  useEffect(() => {
    if (!demoMode.isDemoMode) return;

    startTransition(() => {
      setSessions(demoMode.demoSessions);
      setProjects(demoMode.demoProjects);
      setDailyStats(demoMode.demoDailyStats);
      setDashboardStats(demoMode.demoDashboardStats);
      setSelectedProjectState(demoMode.demoProjects[0] ?? null);
      setProjectsLoading(false);
      setProjectsReady(true);
      setProjectsError(null);
    });
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
      hasCompletedInitialProjectLoadRef.current = true;
      return;
    }

    const teamId = currentTeam?.id ?? null;
    const previousTeamId = lastTeamIdRef.current;
    const teamChanged = teamId !== previousTeamId;

    if (teamChanged) {
      lastTeamIdRef.current = teamId;
      hasCompletedInitialProjectLoadRef.current = false;
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
      hasCompletedInitialProjectLoadRef.current = true;
      return;
    }

    if (
      !bootstrapConsumedRef.current
      && initialProjectsTeamId
      && teamId === initialProjectsTeamId
    ) {
      bootstrapConsumedRef.current = true;
      startTransition(() => {
        applyProjectsForTeam(initialProjects, teamId, {
          preferredProjectId: initialSelectedProjectId,
          preferStoredSelection: true,
        });
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
      if (document.visibilityState !== 'visible') return;
      void refreshProjects({ silent: true, force: false });
    }, 120000);

    return () => clearInterval(interval);
  }, [currentTeam?.id, demoMode.isDemoMode, isAuthLoading, isAuthenticated, isTeamLoading, refreshProjects]);

  useEffect(() => {
    if (demoMode.isDemoMode) return;

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const isLikelyViewportOnlyInterruption = () => {
      const hiddenAt = lastHiddenAtRef.current;
      if (hiddenAt !== null && Date.now() - hiddenAt < MIN_HIDDEN_MS_BEFORE_VISIBLE_REFETCH) {
        return true;
      }

      const visualViewport = window.visualViewport;
      return Boolean(visualViewport && visualViewport.scale && visualViewport.scale !== 1);
    };

    const runRefetch = () => {
      if (isTeamLoading || isAuthLoading || !isAuthenticated || !currentTeam?.id) return;
      if (isLikelyViewportOnlyInterruption()) return;
      const now = Date.now();
      if (now - lastVisibilityProjectRefreshAtRef.current < 60000) return;
      lastVisibilityProjectRefreshAtRef.current = now;
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
      if (document.visibilityState === 'hidden') {
        lastHiddenAtRef.current = Date.now();
        return;
      }

      if (document.visibilityState === 'visible') {
        scheduleRefetch();
      }
    };

    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        lastHiddenAtRef.current = null;
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
    // Page routes receive a separate manual-refresh signal. Refreshing this
    // lightweight project list should not blank their already-rendered data.
    refreshSessions: (options?: { silent?: boolean }) => refreshProjects({ force: true, silent: options?.silent ?? true }),
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
