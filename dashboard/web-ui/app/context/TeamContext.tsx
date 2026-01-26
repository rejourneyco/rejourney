/**
 * Team Context
 * 
 * Manages team selection and team data across the app.
 * Teams own projects and billing.
 */

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { getTeams, getTeamMembers, ApiTeam, ApiTeamMember, clearCache } from '../services/api';
import { useAuth } from './AuthContext';

interface TeamContextValue {
  teams: ApiTeam[];
  currentTeam: ApiTeam | null;
  teamMembers: ApiTeamMember[];
  isLoading: boolean;
  error: string | null;
  setCurrentTeam: (team: ApiTeam) => void;
  refreshTeams: () => Promise<void>;
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
      refreshTeams: async () => { },
      refreshMembers: async () => { },
    };
  }
  return context;
}

interface Props {
  children: React.ReactNode;
}

export function TeamProvider({ children }: Props) {
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const [teams, setTeams] = useState<ApiTeam[]>([]);
  const [currentTeam, setCurrentTeamState] = useState<ApiTeam | null>(null);
  const [teamMembers, setTeamMembers] = useState<ApiTeamMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshTeams = useCallback(async () => {
    // SSR guard - skip during server-side rendering
    if (typeof window === 'undefined') {
      return;
    }
    try {
      setIsLoading(true);
      setError(null);
      const fetchedTeams = await getTeams();
      setTeams(fetchedTeams);

      // Always ensure a team is selected if teams exist
      if (fetchedTeams.length > 0) {
        // Check localStorage for previously selected team
        const savedTeamId = typeof window !== 'undefined' ? localStorage.getItem('selectedTeamId') : null;
        const savedTeam = savedTeamId
          ? fetchedTeams.find(t => t.id === savedTeamId)
          : null;

        // If saved team found, use it; otherwise use first team (default team)
        const teamToSelect = savedTeam || fetchedTeams[0];

        // Always set current team to ensure it's available for new accounts
        setCurrentTeamState(teamToSelect);
        if (typeof window !== 'undefined') {
          localStorage.setItem('selectedTeamId', teamToSelect.id);
        }
      }
    } catch (err) {
      console.error('Failed to fetch teams:', err);
      setError(err instanceof Error ? err.message : 'Failed to load teams');
    } finally {
      setIsLoading(false);
    }
  }, []); // No dependencies - SSR guard handles client-side check

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
      // Clear API cache to ensure fresh data for new team
      clearCache();
    }
  }, []);

  // Initial load - wait for auth to be ready
  useEffect(() => {
    if (isAuthLoading || !isAuthenticated) return;
    refreshTeams();
  }, [isAuthLoading, isAuthenticated, refreshTeams]);

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

