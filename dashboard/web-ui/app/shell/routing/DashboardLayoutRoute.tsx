/**
 * Rejourney Dashboard - Protected Dashboard Layout
 * 
 * This layout wraps all authenticated dashboard routes under /app/*.
 * It handles auth checking and provides the sidebar, topbar, and session data context.
 */

import { isRouteErrorResponse, Outlet, redirect, useLoaderData, useNavigate, useRouteError, useLocation } from "react-router";
import type { Route } from "./+types/DashboardLayoutRoute";
import { useEffect, useState } from "react";
import { ProjectLayout } from "~/shell/components/layout/AppLayout";
import { TabWorkspace } from "~/shell/components/layout/TabWorkspace";
import { useAuth } from "~/shared/providers/AuthContext";
import { SessionDataProvider, useSessionData } from "~/shared/providers/SessionContext";
import { TabProvider } from "~/shared/providers/TabContext";
import { shouldSurfaceSetup } from "~/features/app/setup/setupUtils";
import type { Project } from "~/shared/types";
import { readCookieValue } from "~/shared/utils/selectionCookies";
import { ErrorBoundary as ClientErrorBoundary } from "~/shared/ui/core/ErrorBoundary";
import { AuthServiceUnavailable } from "~/shared/ui/core/AuthServiceUnavailable";
import { BootstrapTransientError, loadDashboardShellBootstrap } from "~/shell/server/dashboardBootstrap";

export const meta: Route.MetaFunction = () => [
    // Authenticated app; crawlers without a session get redirected to /login.
    { name: "robots", content: "index, follow" },
];

export async function loader({ request }: Route.LoaderArgs) {
    let bootstrap: Awaited<ReturnType<typeof loadDashboardShellBootstrap>>;
    try {
        bootstrap = await loadDashboardShellBootstrap(request);
    } catch (error) {
        // Transient upstream failure (rolling deploy, brief DB blip). Do NOT
        // redirect to /login — the user's session cookie is still valid and
        // bouncing them looks like a forced logout. Render an error boundary;
        // the client retries and recovers within seconds.
        if (error instanceof BootstrapTransientError) {
            throw new Response("Service temporarily unavailable", {
                status: 503,
                headers: { "Retry-After": "2" },
            });
        }
        throw error;
    }

    if (bootstrap) {
        const url = new URL(request.url);
        const isSetupPage = url.pathname === "/dashboard/setup" || url.pathname.endsWith("/setup");
        if (!isSetupPage) {
            const selectedProject = bootstrap.projects.find((p) => p.id === bootstrap.selectedProjectId) ?? bootstrap.projects[0] ?? null;
            const cookieHeader = request.headers.get("cookie");
            const isBypassed = selectedProject && readCookieValue(cookieHeader, `bypass_setup_${selectedProject.id}`) === "true";
            if (!isBypassed && shouldSurfaceSetup(bootstrap.projects as unknown as Project[], selectedProject as unknown as Project)) {
                throw redirect("/dashboard/setup");
            }
        }
        return bootstrap;
    }

    const url = new URL(request.url);
    const returnTo = `${url.pathname}${url.search}`;
    throw redirect(`/login?returnTo=${encodeURIComponent(returnTo)}`);
}

// Protected route wrapper - redirects to login if not authenticated
function ProtectedRoute({ children }: { children: React.ReactNode }) {
    const { authServiceUnavailable, error, isAuthenticated, isLoading, refreshUser } = useAuth();
    const navigate = useNavigate();
    const [isRetryingAuth, setIsRetryingAuth] = useState(false);

    useEffect(() => {
        if (!isLoading && !isAuthenticated && !authServiceUnavailable) {
            // Store the intended destination so we can redirect back after login
            if (typeof window !== 'undefined') {
                localStorage.setItem('returnUrl', `${window.location.pathname}${window.location.search}`);
            }
            navigate('/login', { replace: true });
        }
    }, [authServiceUnavailable, isAuthenticated, isLoading, navigate]);

    const handleRetryAuth = async () => {
        setIsRetryingAuth(true);
        try {
            await refreshUser();
        } finally {
            setIsRetryingAuth(false);
        }
    };

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

    if (!isAuthenticated && authServiceUnavailable) {
        return (
            <AuthServiceUnavailable
                detail={error}
                isRetrying={isRetryingAuth}
                onRetry={handleRetryAuth}
            />
        );
    }

    if (!isAuthenticated) {
        return null; // Will redirect in useEffect
    }

    return <>{children}</>;
}

function DashboardLayoutContent() {
    const { projects, selectedProject, isLoading } = useSessionData();
    const navigate = useNavigate();
    const location = useLocation();

    useEffect(() => {
        if (!isLoading) {
            const isSetupPage = location.pathname === "/dashboard/setup" || location.pathname.endsWith("/setup");
            const isBypassed = selectedProject && typeof document !== "undefined" && document.cookie.includes(`bypass_setup_${selectedProject.id}=true`);
            if (!isBypassed && shouldSurfaceSetup(projects, selectedProject) && !isSetupPage) {
                navigate("/dashboard/setup", { replace: true });
            }
        }
    }, [isLoading, projects, selectedProject, location.pathname, navigate]);

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
        <ClientErrorBoundary>
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
        </ClientErrorBoundary>
    );
}

export function ErrorBoundary() {
    const error = useRouteError();
    const isDev = import.meta.env.DEV;

    if (isRouteErrorResponse(error) && error.status === 503) {
        return (
            <AuthServiceUnavailable
                detail="The dashboard API is temporarily unavailable. Our team has been notified. If this issue remains past a few minutes, email contact@rejourney.co for 24/7 support."
                onRetry={() => {
                    if (typeof window !== 'undefined') {
                        window.location.reload();
                    }
                }}
            />
        );
    }

    const message = isRouteErrorResponse(error)
        ? error.statusText || `Dashboard error ${error.status}`
        : isDev && error instanceof Error
            ? error.message
            : "An unexpected dashboard error occurred.";

    return (
        <main className="min-h-screen flex items-center justify-center bg-background p-4">
            <div className="max-w-md border-2 border-red-500 bg-red-50 p-6 text-center">
                <h1 className="mb-3 text-xl font-black uppercase text-red-800">Dashboard error</h1>
                <p className="mb-5 text-sm font-semibold text-red-700">{message}</p>
                <button
                    type="button"
                    onClick={() => {
                        if (typeof window !== 'undefined') window.location.reload();
                    }}
                    className="px-4 py-2 bg-red-600 text-white font-bold uppercase hover:bg-red-700"
                >
                    Reload
                </button>
            </div>
        </main>
    );
}
