/**
 * Rejourney Dashboard - Protected Dashboard Layout
 * 
 * This layout wraps all authenticated dashboard routes under /app/*.
 * It handles auth checking and provides the sidebar, topbar, and session data context.
 */

import { Outlet, useNavigate } from "react-router";
import type { Route } from "./+types/_dashboard";
import { useEffect } from "react";
import { ProjectLayout } from "~/components/layout/AppLayout";
import { TabBar } from "~/components/layout/TabBar";
import { useAuth } from "~/context/AuthContext";
import { SessionDataProvider } from "~/context/SessionContext";
import { TabProvider } from "~/context/TabContext";
import { ErrorBoundary } from "~/components/ui/ErrorBoundary";

export const meta: Route.MetaFunction = () => [
    { name: "robots", content: "noindex" }, // Dashboard pages should not be indexed
];

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
            <div className="flex flex-col h-full bg-gray-50">
                <TabBar pathPrefix="/dashboard" />
                <div className="flex-1 overflow-y-auto">
                    <Outlet />
                </div>
            </div>
        </ProjectLayout>
    );
}

export default function DashboardLayout() {
    return (
        <ErrorBoundary>
            <ProtectedRoute>
                <SessionDataProvider>
                    <TabProvider>
                        <DashboardLayoutContent />
                    </TabProvider>
                </SessionDataProvider>
            </ProtectedRoute>
        </ErrorBoundary>
    );
}
