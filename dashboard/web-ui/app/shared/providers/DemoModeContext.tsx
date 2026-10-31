/**
 * Demo Mode Context
 * 
 * Provides demo mode state and static demo data throughout the app.
 * When in demo mode, components use this data instead of API calls.
 */

import React, { createContext, useContext, ReactNode } from 'react';
import { demoProjects, demoSessions, demoReplaySessions, demoDashboardStats, demoDailyStats, DEMO_FEATURED_SESSION_ID, DEMO_TEAM, DEMO_NOW_ISO } from '~/shared/data/demoData';
import { Project, RecordingSession, ProjectDailyStats } from '~/shared/types';
import { ApiTeam, ApiTeamMember } from '~/shared/api/client';
import { DemoTeamContext } from './TeamContext';

interface DemoModeContextValue {
    isDemoMode: boolean;
    demoProjects: Project[];
    demoSessions: RecordingSession[];
    demoReplaySessions: RecordingSession[];
    demoDashboardStats: {
        totalSessions: number;
        avgDuration: number;
        errorRate: number;
    };
    demoDailyStats: ProjectDailyStats[];
    featuredSessionId: string;
}

const DemoModeContext = createContext<DemoModeContextValue | null>(null);

// Stable defaults: a fresh object per call would change every consumer's
// effect/memo dependencies on each render.
const NON_DEMO_CONTEXT: DemoModeContextValue = {
    isDemoMode: false,
    demoProjects: [],
    demoSessions: [],
    demoReplaySessions: [],
    demoDashboardStats: { totalSessions: 0, avgDuration: 0, errorRate: 0 },
    demoDailyStats: [],
    featuredSessionId: ''
};

const DEMO_CONTEXT: DemoModeContextValue = {
    isDemoMode: true,
    demoProjects,
    demoSessions,
    demoReplaySessions,
    demoDashboardStats,
    demoDailyStats,
    featuredSessionId: DEMO_FEATURED_SESSION_ID
};

export function useDemoMode(): DemoModeContextValue {
    const context = useContext(DemoModeContext);
    if (!context) {
        // Return a default non-demo context when not wrapped
        return NON_DEMO_CONTEXT;
    }
    return context;
}

interface DemoModeProviderProps {
    children: ReactNode;
}

export function DemoModeProvider({ children }: DemoModeProviderProps) {
    return (
        <DemoModeContext.Provider value={DEMO_CONTEXT}>
            {children}
        </DemoModeContext.Provider>
    );
}

// Demo Team Provider - provides mock team data for demo mode
// Uses the DemoTeamContext exported from TeamContext so useTeam() works

interface DemoTeamContextValue {
    teams: ApiTeam[];
    currentTeam: ApiTeam | null;
    teamMembers: ApiTeamMember[];
    isLoading: boolean;
    error: string | null;
    setCurrentTeam: (team: ApiTeam) => void;
    refreshTeams: (preferredTeamId?: string | null) => Promise<ApiTeam[]>;
    refreshMembers: () => Promise<void>;
}

const DEMO_TEAM_VALUE: ApiTeam = DEMO_TEAM;

const DEMO_MEMBER: ApiTeamMember = {
    id: 'demo-member-1',
    userId: 'demo-user',
    teamId: DEMO_TEAM.id,
    role: 'owner',
    email: 'demo@shopflow.com',
    displayName: 'Demo User',
    createdAt: DEMO_NOW_ISO,
};

// Static demo data, so one shared value keeps consumers' effects from re-running.
const DEMO_TEAM_CONTEXT: DemoTeamContextValue = {
    teams: [DEMO_TEAM_VALUE],
    currentTeam: DEMO_TEAM_VALUE,
    teamMembers: [DEMO_MEMBER],
    isLoading: false,
    error: null,
    setCurrentTeam: () => { },
    refreshTeams: async () => [DEMO_TEAM_VALUE],
    refreshMembers: async () => { },
};

export function DemoTeamProvider({ children }: { children: ReactNode }) {
    return (
        <DemoTeamContext.Provider value={DEMO_TEAM_CONTEXT}>
            {children}
        </DemoTeamContext.Provider>
    );
}
