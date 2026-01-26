/**
 * Demo Mode Context
 * 
 * Provides demo mode state and static demo data throughout the app.
 * When in demo mode, components use this data instead of API calls.
 */

import React, { createContext, useContext, ReactNode } from 'react';
import { demoProjects, demoSessions, demoDashboardStats, demoDailyStats, DEMO_FEATURED_SESSION_ID, DEMO_TEAM } from '../data/demoData';
import { Project, RecordingSession, ProjectDailyStats } from '../types';
import { ApiTeam, ApiTeamMember } from '../services/api';
import { DemoTeamContext } from './TeamContext';

interface DemoModeContextValue {
    isDemoMode: boolean;
    demoProjects: Project[];
    demoSessions: RecordingSession[];
    demoDashboardStats: {
        totalSessions: number;
        avgDuration: number;
        avgUxScore: number;
        errorRate: number;
    };
    demoDailyStats: ProjectDailyStats[];
    featuredSessionId: string;
}

const DemoModeContext = createContext<DemoModeContextValue | null>(null);

export function useDemoMode(): DemoModeContextValue {
    const context = useContext(DemoModeContext);
    if (!context) {
        // Return a default non-demo context when not wrapped
        return {
            isDemoMode: false,
            demoProjects: [],
            demoSessions: [],
            demoDashboardStats: { totalSessions: 0, avgDuration: 0, avgUxScore: 0, errorRate: 0 },
            demoDailyStats: [],
            featuredSessionId: ''
        };
    }
    return context;
}

interface DemoModeProviderProps {
    children: ReactNode;
}

export function DemoModeProvider({ children }: DemoModeProviderProps) {
    const value: DemoModeContextValue = {
        isDemoMode: true,
        demoProjects,
        demoSessions,
        demoDashboardStats,
        demoDailyStats,
        featuredSessionId: DEMO_FEATURED_SESSION_ID
    };

    return (
        <DemoModeContext.Provider value={value}>
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
    refreshTeams: () => Promise<void>;
    refreshMembers: () => Promise<void>;
}

export function DemoTeamProvider({ children }: { children: ReactNode }) {
    const demoTeam: ApiTeam = DEMO_TEAM;

    const demoMember: ApiTeamMember = {
        id: 'demo-member-1',
        userId: 'demo-user',
        teamId: DEMO_TEAM.id,
        role: 'owner',
        email: 'demo@shopflow.com',
        displayName: 'Demo User',
        createdAt: new Date().toISOString(),
    };

    const value: DemoTeamContextValue = {
        teams: [demoTeam],
        currentTeam: demoTeam,
        teamMembers: [demoMember],
        isLoading: false,
        error: null,
        setCurrentTeam: () => { },
        refreshTeams: async () => { },
        refreshMembers: async () => { },
    };

    return (
        <DemoTeamContext.Provider value={value}>
            {children}
        </DemoTeamContext.Provider>
    );
}
