/**
 * Team Context
 * 
 * Manages team selection and team data across the app.
 * Teams own projects and billing.
 */

import React, { createContext, startTransition, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { getTeams, getTeamMembers, ApiTeam, ApiTeamMember, clearCache, clearCacheByPrefixes } from '~/shared/api/client';
import { clearSelectionCookie, SELECTED_TEAM_COOKIE, writeSelectionCookie } from '~/shared/utils/selectionCookies';
import { useAuth } from './AuthContext';

interface TeamContextValue {
  teams: ApiTeam[];
  currentTeam: ApiTeam | null;
  teamMembers: ApiTeamMember[];
  isLoading: boolean;
  error: string | null;
  setCurrentTeam: (team: ApiTeam) => void;
  refreshTeams: (preferredTeamId?: string | null) => Promise<ApiTeam[]>;
  refreshMembers: () => Promise<void>;
}

const TeamContext = createContext<TeamContextValue | null>(null);

// Demo team context (provided by DemoTeamProvider in demo mode)
// Import separately to avoid circular dependency
const DemoTeamContext = createContext<TeamContextValue | null>(null);

// Export for use by DemoModeContext
export { DemoTeamContext };

export function useTeam(): TeamContextValue {
  // Call both hooks unconditionally (React Hooks rules)
  const demoContext = useContext(DemoTeamContext);
  const context = useContext(TeamContext);

  // Demo context takes priority if available
  if (demoContext) {
    return demoContext;
  }

  // Fall back to regular team context
  if (!context) {
    throw new Error('useTeam must be used within a TeamProvider');
  }
  return context;
}

// Safe version that returns defaults when not in provider (for demo mode)
export function useSafeTeam(): TeamContextValue {
  // Call both hooks unconditionally (React Hooks rules)
  const demoContext = useContext(DemoTeamContext);
  const context = useContext(TeamContext);

  // Demo context takes priority if available
  if (demoContext) {
    return demoContext;
  }

  if (!context) {
    return {
      teams: [],
      currentTeam: null,
      teamMembers: [],
      isLoading: false,
      error: null,
      setCurrentTeam: () => { },
      refreshTeams: async () => [],
      refreshMembers: async () => { },
    };
  }
  return context;
}

interface Props {
  children: React.ReactNode;
  initialCurrentTeamId?: string | null;
  initialHydrated?: boolean;
  initialTeams?: ApiTeam[];
}

const EMPTY_TEAMS: ApiTeam[] = [];

function readStoredTeamId(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }

  return localStorage.getItem('selectedTeamId');
}

function normalizeTeams(teams: unknown): ApiTeam[] {
  if (Array.isArray(teams)) {
    return teams;
  }

  if (teams && typeof teams === "object" && Array.isArray((teams as { teams?: unknown }).teams)) {
    return (teams as { teams: ApiTeam[] }).teams;
  }

  return EMPTY_TEAMS;
}

interface SelectTeamFromListOptions {
  preferredTeamId?: string | null;
  currentTeamId?: string | null;
  preferStoredSelection?: boolean;
}

function selectTeamFromList(
  availableTeams: unknown,
  {
    preferredTeamId,
    currentTeamId,
    preferStoredSelection = false,
  }: SelectTeamFromListOptions = {},
): ApiTeam | null {
  const normalizedTeams = normalizeTeams(availableTeams);

  if (normalizedTeams.length === 0) return null;

  const preferredTeam = preferredTeamId
    ? normalizedTeams.find((team) => team.id === preferredTeamId)
    : null;
  const savedTeamId = readStoredTeamId();
  const savedTeam = savedTeamId
    ? normalizedTeams.find((team) => team.id === savedTeamId)
    : null;
  const currentTeam = currentTeamId
    ? normalizedTeams.find((team) => team.id === currentTeamId)
    : null;

  const orderedCandidates = preferStoredSelection
    ? [savedTeam, preferredTeam, currentTeam]
    : [preferredTeam, savedTeam, currentTeam];

  for (const candidate of orderedCandidates) {
    if (candidate) {
      return candidate;
    }
  }

  return normalizedTeams[0];
}

export function TeamProvider({
  children,
  initialCurrentTeamId = null,
  initialHydrated = false,
  initialTeams = [],
}: Props) {
  const normalizedInitialTeams = normalizeTeams(initialTeams);
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const [teams, setTeams] = useState<ApiTeam[]>(initialHydrated ? normalizedInitialTeams : []);
  const [currentTeam, setCurrentTeamState] = useState<ApiTeam | null>(() => (
    initialHydrated ? selectTeamFromList(normalizedInitialTeams, { preferredTeamId: initialCurrentTeamId }) : null
  ));
  const [teamMembers, setTeamMembers] = useState<ApiTeamMember[]>([]);
  const [isLoading, setIsLoading] = useState(!initialHydrated);
  const [error, setError] = useState<string | null>(null);
  const latestRefreshRequestIdRef = useRef(0);
  const currentTeamIdRef = useRef<string | null>(null);

  useEffect(() => {
    currentTeamIdRef.current = currentTeam?.id ?? null;
  }, [currentTeam?.id]);

  useEffect(() => {
    if (!initialHydrated) return;

    const bootstrappedTeam = selectTeamFromList(normalizedInitialTeams, {
      preferredTeamId: initialCurrentTeamId,
      currentTeamId: currentTeamIdRef.current,
      preferStoredSelection: true,
    });
    startTransition(() => {
      setTeams(normalizedInitialTeams);
      setCurrentTeamState(bootstrappedTeam);
      setTeamMembers([]);
      setError(null);
      setIsLoading(false);
    });

    if (typeof window !== 'undefined') {
      if (bootstrappedTeam) {
        localStorage.setItem('selectedTeamId', bootstrappedTeam.id);
        writeSelectionCookie(SELECTED_TEAM_COOKIE, bootstrappedTeam.id);
      } else {
        localStorage.removeItem('selectedTeamId');
        clearSelectionCookie(SELECTED_TEAM_COOKIE);
      }
    }
  }, [initialCurrentTeamId, initialHydrated, normalizedInitialTeams]);

  const refreshTeams = useCallback(async (preferredTeamId?: string | null): Promise<ApiTeam[]> => {
    // SSR guard - skip during server-side rendering
    if (typeof window === 'undefined') {
      return [];
    }
    const requestId = ++latestRefreshRequestIdRef.current;
    try {
      setIsLoading(true);
      setError(null);
      const fetchedTeams = await getTeams();
      if (requestId !== latestRefreshRequestIdRef.current) {
        return fetchedTeams;
      }

      setTeams(fetchedTeams);

      // Always ensure a team is selected if teams exist
      if (fetchedTeams.length > 0) {
        const teamToSelect = selectTeamFromList(fetchedTeams, {
          preferredTeamId,
          currentTeamId: currentTeamIdRef.current,
        }) || fetchedTeams[0];

        // Always set current team to ensure it's available for new accounts
        setCurrentTeamState(teamToSelect);
        if (typeof window !== 'undefined') {
          localStorage.setItem('selectedTeamId', teamToSelect.id);
          writeSelectionCookie(SELECTED_TEAM_COOKIE, teamToSelect.id);
        }
      } else {
        setCurrentTeamState(null);
        setTeamMembers([]);
        if (typeof window !== 'undefined') {
          localStorage.removeItem('selectedTeamId');
          clearSelectionCookie(SELECTED_TEAM_COOKIE);
        }
      }
      return fetchedTeams;
    } catch (err) {
      if (requestId !== latestRefreshRequestIdRef.current) {
        return [];
      }
      console.error('Failed to fetch teams:', err);
      setError(err instanceof Error ? err.message : 'Failed to load teams');
      return [];
    } finally {
      if (requestId === latestRefreshRequestIdRef.current) {
        setIsLoading(false);
      }
    }
  }, []); // SSR guard handles client-side check

  const refreshMembers = useCallback(async () => {
    if (!currentTeam) {
      setTeamMembers([]);
      return;
    }
    try {
      const members = await getTeamMembers(currentTeam.id);
      setTeamMembers(members);
    } catch (err) {
      console.error('Failed to fetch team members:', err);
    }
  }, [currentTeam]);

  const setCurrentTeam = useCallback((team: ApiTeam) => {
    setTeams((prev) => {
      if (prev.find((t) => t.id === team.id)) return prev;
      return [...prev, team];
    });
    setCurrentTeamState(team);
    if (typeof window !== 'undefined') {
      localStorage.setItem('selectedTeamId', team.id);
      writeSelectionCookie(SELECTED_TEAM_COOKIE, team.id);
      clearCache('/api/teams');
      clearCache('projects:list');
      clearCacheByPrefixes(['/api/workspace']);
    }
  }, []);

  // Initial load - wait for auth to be ready
  useEffect(() => {
    if (isAuthLoading) return;
    if (!isAuthenticated) {
      setIsLoading(false);
      setTeams([]);
      setCurrentTeamState(null);
      setTeamMembers([]);
      return;
    }
    if (initialHydrated) return;
    refreshTeams();
  }, [initialHydrated, isAuthLoading, isAuthenticated, refreshTeams]);

  // Load members when team changes
  useEffect(() => {
    if (currentTeam) {
      refreshMembers();
    }
  }, [currentTeam?.id]);

  // Listen for teamCreated events to refresh the list
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleTeamCreated = () => {
      refreshTeams();
    };
    window.addEventListener('teamCreated', handleTeamCreated);
    return () => {
      window.removeEventListener('teamCreated', handleTeamCreated);
    };
  }, [refreshTeams]);

  const value: TeamContextValue = {
    teams,
    currentTeam,
    teamMembers,
    isLoading,
    error,
    setCurrentTeam,
    refreshTeams,
    refreshMembers,
  };

  return (
    <TeamContext.Provider value={value}>
      {children}
    </TeamContext.Provider>
  );
}

export default TeamProvider;
