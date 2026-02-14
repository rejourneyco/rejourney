/**
 * Session Data Context
 * 
 * Provides real session data from the API to all components.
 * Falls back to mock data if API is unavailable.
 * In demo mode, returns static demo data.
 */

import { useSafeTeam } from './TeamContext';
import { useDemoMode } from './DemoModeContext';
import { useAuth } from './AuthContext';
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api, getProjects, ApiProject, clearCache } from '../services/api';
import { RecordingSession, Project, ProjectDailyStats, TimeRange } from '../types';

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
    maxRecordingMinutes: apiProject.maxRecordingMinutes,
    createdAt: apiProject.createdAt,
    sessionsLast7Days: apiProject.sessionsLast7Days || 0,
    errorsLast7Days: apiProject.errorsLast7Days || 0,

    avgUxScore: 0,
  };
}

const SELECTED_PROJECT_ID_KEY_PREFIX = 'rejourney_selected_project_id';

function selectedProjectStorageKey(teamId?: string | null): string {
  return teamId ? `${SELECTED_PROJECT_ID_KEY_PREFIX}:${teamId}` : SELECTED_PROJECT_ID_KEY_PREFIX;
}

interface SessionContextValue {
  // Data
  sessions: RecordingSession[];
  projects: Project[];

  dailyStats: ProjectDailyStats[];

  // Selected project (synced with sidebar selection)
  selectedProject: Project | null;
  setSelectedProject: (project: Project | null) => void;

  // Time range filter
  timeRange: TimeRange;
  setTimeRange: (range: TimeRange) => void;

  // Loading states
  isLoading: boolean;
  error: string | null;

  // Actions
  refreshSessions: () => Promise<void>;
  getSession: (id: string) => Promise<RecordingSession | null>;


  // Stats
  dashboardStats: {
    totalSessions: number;
    avgDuration: number;
    avgUxScore: number;
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
}

export function SessionDataProvider({ children }: Props) {
  const { currentTeam, isLoading: isTeamLoading } = useSafeTeam();
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const demoMode = useDemoMode();
  const [sessions, setSessions] = useState<RecordingSession[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProjectState] = useState<Project | null>(null);
  const [lastTeamId, setLastTeamId] = useState<string | null>(null);

  const [dailyStats, setDailyStats] = useState<ProjectDailyStats[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState<TimeRange>('all');
  const [hasInitialLoad, setHasInitialLoad] = useState(false);
  const [dashboardStats, setDashboardStats] = useState({
    totalSessions: 0,
    avgDuration: 0,
    avgUxScore: 0,
    errorRate: 0,

  });

  // Clear state when team changes to ensure pages show fresh data
  useEffect(() => {
    if (demoMode.isDemoMode) return;
    
    // If team changed and we had a previous team
    if (currentTeam?.id && lastTeamId && currentTeam.id !== lastTeamId) {
      // Clear current selection to force refresh
      setSelectedProjectState(null);
      setProjects([]);
      setSessions([]);
      setIsLoading(true);
    }
    
    // Track the current team
    if (currentTeam?.id) {
      setLastTeamId(currentTeam.id);
    }
  }, [currentTeam?.id, lastTeamId, demoMode.isDemoMode]);

  // Demo mode: return static demo data
  useEffect(() => {
    if (demoMode.isDemoMode) {
      setSessions(demoMode.demoSessions);
      setProjects(demoMode.demoProjects);
      setDailyStats(demoMode.demoDailyStats);
      setDashboardStats(demoMode.demoDashboardStats);
      if (demoMode.demoProjects.length > 0) {
        setSelectedProjectState(demoMode.demoProjects[0]);
      }
      setIsLoading(false);
      setHasInitialLoad(true);
      return;
    }
  }, [demoMode.isDemoMode, demoMode.demoSessions, demoMode.demoProjects, demoMode.demoDailyStats, demoMode.demoDashboardStats]);

  // Track if we're currently fetching to prevent duplicate calls
  const isFetchingRef = React.useRef(false);

  // Fetch sessions from API (skip in demo mode)
  const fetchSessions = useCallback(async (options: { silent?: boolean } = {}) => {
    // Skip API calls in demo mode or when not authenticated
    if (demoMode.isDemoMode || !isAuthenticated) {
      return;
    }

    // Prevent duplicate concurrent fetches
    if (isFetchingRef.current && !options.silent) {
      return;
    }
    isFetchingRef.current = true;

    try {
      if (!options.silent) {
        setIsLoading(true);
      }
      setError(null);

      // Use Promise.allSettled so a failure in sessions/analytics doesn't
      // prevent projects from loading. Projects are critical for navigation;
      // analytics are not.
      const [sessionsResult, statsResult, projectsResult, trendsResult] = await Promise.allSettled([
        api.getRecordingSessions(timeRange) as Promise<any[]>,
        api.getDashboardStatsWithTimeRange(timeRange),
        getProjects(),
        api.getInsightsTrends(undefined, timeRange)
      ]);

      // Collect partial errors for display without blocking what succeeded
      const partialErrors: string[] = [];

      const apiSessions = sessionsResult.status === 'fulfilled' ? sessionsResult.value : (() => { partialErrors.push('sessions'); return []; })();
      const stats = statsResult.status === 'fulfilled' ? statsResult.value : (() => { partialErrors.push('stats'); return { totalSessions: 0, avgDuration: 0, avgUxScore: 0, errorRate: 0 }; })();
      const apiProjects = projectsResult.status === 'fulfilled' ? projectsResult.value : (() => { partialErrors.push('projects'); return []; })();
      const trends = trendsResult.status === 'fulfilled' ? trendsResult.value : (() => { partialErrors.push('trends'); return { daily: [] }; })();

      if (partialErrors.length > 0) {
        console.error('Partial data fetch failures:', partialErrors);
        if (partialErrors.includes('projects')) {
          setError('Unable to reach server. Please try again soon. Your projects could not be loaded right now.');
        } else {
          setError(`Some data failed to load: ${partialErrors.join(', ')}. The dashboard may show incomplete information.`);
        }
      }

      // Filter projects to only those belonging to the current team
      const teamProjects = currentTeam
        ? apiProjects.filter(p => !p.teamId || p.teamId === currentTeam.id)
        : apiProjects;

      // Filter sessions to only those for the team's projects
      const teamProjectIds = new Set(teamProjects.map(p => p.id));
      const filteredSessions = currentTeam
        ? apiSessions.filter(s => teamProjectIds.has((s as any).projectId || (s as any).appId))
        : apiSessions;



      // Convert trends to ProjectDailyStats
      const convertedDailyStats: ProjectDailyStats[] = (trends.daily || []).map(day => ({
        projectId: 'aggregate', // Trends are often aggregated
        date: day.date,
        totalSessions: day.sessions,
        completedSessions: day.sessions,
        avgDurationSeconds: 0,
        avgInteractionScore: 0,
        avgUxScore: day.avgUxScore,
        avgApiErrorRate: 0,
        p50Duration: 0,
        p90Duration: 0,
        p50InteractionScore: 0,
        p90InteractionScore: 0
      }));

      setSessions(filteredSessions);
      const convertedProjects = teamProjects.map(apiProjectToProject);
      setProjects(convertedProjects);
      setDashboardStats({
        totalSessions: stats.totalSessions,
        avgDuration: stats.avgDuration,
        avgUxScore: stats.avgUxScore,
        errorRate: stats.errorRate,
      });

      // Auto-select project from localStorage (scoped per team) or default to first one
      if (convertedProjects.length > 0) {
        const key = selectedProjectStorageKey(currentTeam?.id);
        const savedProjectId = localStorage.getItem(key);
        const projectToSelect = savedProjectId
          ? convertedProjects.find(p => p.id === savedProjectId) || convertedProjects[0]
          : convertedProjects[0];
        setSelectedProjectState(projectToSelect);
        localStorage.setItem(key, projectToSelect.id);
      } else if (projectsResult.status === 'fulfilled') {
        // Only clear project selection if we successfully fetched and got 0 projects.
        // If the projects fetch FAILED, keep the previous selection (stale is better than wrong).
        setSelectedProjectState(null);
        localStorage.removeItem(selectedProjectStorageKey(currentTeam?.id));
      }
    } catch (err) {
      console.error('Failed to fetch sessions:', err);
      setError(err instanceof Error ? err.message : 'Failed to load sessions');
      // Don't clear sessions/projects on error - keep showing stale data
    } finally {
      isFetchingRef.current = false;
      if (!options.silent) {
        setIsLoading(false);
      }
    }
  }, [timeRange, currentTeam?.id, demoMode.isDemoMode, isAuthenticated]);

  // Get a specific session
  const getSession = useCallback(async (id: string): Promise<RecordingSession | null> => {
    // In demo mode, just return from cached sessions
    if (demoMode.isDemoMode) {
      return sessions.find(s => s.id === id) || null;
    }

    try {
      return await api.getRecordingSession(id);
    } catch (err) {
      console.error('Failed to fetch session:', err);
      // Try to find in cached sessions
      return sessions.find(s => s.id === id) || null;
    }
  }, [sessions, demoMode.isDemoMode]);




  // Initial fetch and refetch when time range or team changes
  // Wait for team context and auth to finish loading before first fetch
  // In demo mode, we skip this since demo data is already loaded via the other useEffect
  useEffect(() => {
    if (demoMode.isDemoMode) return; // Demo mode loads data separately
    if (isTeamLoading || isAuthLoading || !isAuthenticated) return;
    fetchSessions().then(() => setHasInitialLoad(true));
    // Use stable dependencies instead of fetchSessions to prevent infinite loops
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeRange, currentTeam?.id, isTeamLoading, isAuthLoading, isAuthenticated, demoMode.isDemoMode]);

  // Subscribe to updates - use ref to avoid recreating subscription
  const fetchSessionsRef = React.useRef(fetchSessions);
  useEffect(() => {
    fetchSessionsRef.current = fetchSessions;
  }, [fetchSessions]);

  useEffect(() => {
    const unsubscribe = api.subscribeToUpdates(() => {
      fetchSessionsRef.current({ silent: true });
    });
    return unsubscribe;
  }, []); // Empty deps - subscription doesn't need to be recreated

  // Listen for project creation events to refresh list
  useEffect(() => {
    const handleProjectCreated = () => {
      fetchSessionsRef.current();
    };

    window.addEventListener('projectCreated', handleProjectCreated);
    return () => {
      window.removeEventListener('projectCreated', handleProjectCreated);
    };
  }, []); // Empty deps - event listener doesn't need to be recreated

  // Refresh every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      // Quietly refresh in the background
      // Clear cache to ensure we get fresh data
      clearCache();
      fetchSessionsRef.current({ silent: true });
    }, 30000);
    return () => clearInterval(interval);
  }, []); // Empty deps - interval doesn't need to be recreated

  // Wrapper to set selected project and persist
  const setSelectedProject = useCallback((project: Project | null) => {
    setSelectedProjectState(project);
    if (project) {
      localStorage.setItem(selectedProjectStorageKey(currentTeam?.id), project.id);
      // Clear API cache to ensure fresh data for new project
      clearCache();
    } else {
      localStorage.removeItem(selectedProjectStorageKey(currentTeam?.id));
    }
  }, [currentTeam?.id]);

  const value: SessionContextValue = {
    sessions,
    projects,
    selectedProject,
    setSelectedProject,

    dailyStats,
    timeRange,
    setTimeRange,
    isLoading,
    error,
    refreshSessions: fetchSessions,
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
