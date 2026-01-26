/**
 * Demo Dashboard Layout
 * 
 * A variant of the dashboard layout for demo mode.
 * Reuses the real Sidebar and TopBar components to maintain consistency.
 * Injects demo data instead of fetching from APIs.
 */

import React from 'react';
import { Outlet, Link } from 'react-router';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { useDemoMode } from '../../context/DemoModeContext';
import { useSessionData } from '../../context/SessionContext';

export const DemoDashboardLayout: React.FC = () => {
    const { demoProjects } = useDemoMode();
    const { selectedProject, setSelectedProject, projects } = useSessionData();

    // Use demo projects for the sidebar
    const handleProjectChange = (project: any) => {
        setSelectedProject(project);
    };

    // Demo team placeholder
    const demoTeam = {
        id: 'demo-team',
        name: 'Demo Team',
        ownerUserId: 'demo-user',
        billingPlan: 'free' as const,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };

    return (
        <div className="flex h-screen bg-background">
            {/* Same Sidebar as real dashboard, with demo path prefix */}
            <Sidebar
                currentProject={selectedProject}
                onProjectChange={handleProjectChange}
                projects={projects.length > 0 ? projects : demoProjects}
                loading={false}
                teams={[demoTeam]}
                currentTeam={demoTeam}
                onTeamChange={() => { }}
                teamsLoading={false}
                pathPrefix="/demo"
            />

            {/* Main Content */}
            <div className="flex-1 flex flex-col overflow-hidden">
                {/* Demo Banner */}
                <div className="text-white px-4 py-2 flex items-center justify-between z-10" style={{ background: 'linear-gradient(to right, #5dadec, #4ac5d8)' }}>
                    <div className="flex items-center gap-2">
                        <div className="w-2 h-2 bg-white rounded-full animate-pulse" />
                        <span className="text-sm font-medium">
                            You're viewing a demo with sample data.
                            <Link to="/" className="underline ml-1 font-bold hover:opacity-80">
                                Exit demo →
                            </Link>
                        </span>
                    </div>
                    <Link
                        to="/login"
                        className="bg-white px-3 py-1 rounded text-xs font-bold uppercase tracking-wider transition-colors hover:bg-[rgba(93,173,236,0.1)]"
                        style={{ color: '#5dadec' }}
                    >
                        Sign Up
                    </Link>
                </div>

                {/* Same TopBar as real dashboard */}
                <TopBar currentProject={selectedProject} />

                {/* Page Content */}
                <div className="flex-1 overflow-y-auto bg-background">
                    <Outlet />
                </div>
            </div>
        </div>
    );
};
