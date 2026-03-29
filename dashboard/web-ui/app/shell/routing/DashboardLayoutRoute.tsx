/**
 * Rejourney Dashboard - Protected Dashboard Layout
 * 
 * This layout wraps all authenticated dashboard routes under /app/*.
 * It handles auth checking and provides the sidebar, topbar, and session data context.
 */

import { Outlet, redirect, useLoaderData, useNavigate } from "react-router";
import type { Route } from "./+types/DashboardLayoutRoute";
import { useEffect } from "react";
import { ProjectLayout } from "~/shell/components/layout/AppLayout";
import { TabWorkspace } from "~/shell/components/layout/TabWorkspace";
import { useAuth } from "~/shared/providers/AuthContext";
import { SessionDataProvider } from "~/shared/providers/SessionContext";
import { TabProvider } from "~/shared/providers/TabContext";
import { ErrorBoundary } from "~/shared/ui/core/ErrorBoundary";
import { loadDashboardShellBootstrap } from "~/shell/server/dashboardBootstrap";

export const meta: Route.MetaFunction = () => [
    { name: "robots", content: "noindex" }, // Dashboard pages should not be indexed
];

export async function loader({ request }: Route.LoaderArgs) {
    const bootstrap = await loadDashboardShellBootstrap(request);
    if (bootstrap) {
        return bootstrap;
    }

    const url = new URL(request.url);
    const returnTo = `${url.pathname}${url.search}`;
    throw redirect(`/login?returnTo=${encodeURIComponent(returnTo)}`);
}

// Protected route wrapper - redirects to login if not authenticated
function ProtectedRoute({ children }: { children: React.ReactNode }) {
    const { isAuthenticated, isLoading } = useAuth();
    const navigate = useNavigate();

    useEffect(() => {
        if (!isLoading && !isAuthenticated) {
            // Store the intended destination so we can redirect back after login
            if (typeof window !== 'undefined') {
                localStorage.setItem('returnUrl', window.location.pathname);
            }
            navigate('/login', { replace: true });
        }
    }, [isAuthenticated, isLoading, navigate]);

    if (isLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-background">
                <div className="text-center">
                    <div className="w-8 h-8 border-2 border-black border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                    <div className="text-sm text-muted-foreground font-mono uppercase">Loading...</div>
                </div>
            </div>
        );
    }

    if (!isAuthenticated) {
        return null; // Will redirect in useEffect
    }

    return <>{children}</>;
}

// Dashboard Layout - wraps protected content with sidebar and tabs
function DashboardLayoutContent() {
    return (
        <ProjectLayout pathPrefix="/dashboard">
            <div className="flex flex-col h-full min-h-0 bg-transparent">
                <TabWorkspace>
                    <Outlet />
                </TabWorkspace>
            </div>
        </ProjectLayout>
    );
}

export default function DashboardLayout() {
    const bootstrap = useLoaderData<typeof loader>();

    return (
        <ErrorBoundary>
            <ProtectedRoute>
                <SessionDataProvider
                    initialProjects={bootstrap.projects}
                    initialProjectsTeamId={bootstrap.projectsTeamId}
                    initialSelectedProjectId={bootstrap.selectedProjectId}
                >
                    <TabProvider>
                        <DashboardLayoutContent />
                    </TabProvider>
                </SessionDataProvider>
            </ProtectedRoute>
        </ErrorBoundary>
    );
}
