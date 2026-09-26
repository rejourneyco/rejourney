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
import { SETUP_GATE_TOAST, isSetupSupportRoute, isSetupWizardRoute, shouldRedirectFromSetup, shouldRedirectToSetup } from "~/features/app/setup/setupUtils";
import type { Project } from "~/shared/types";
import { ErrorBoundary as ClientErrorBoundary } from "~/shared/ui/core/ErrorBoundary";
import { AuthServiceUnavailable } from "~/shared/ui/core/AuthServiceUnavailable";
import { dashboardButtonClass } from "~/shared/ui/core/dashboardStyles";
import { BootstrapTransientError, loadDashboardShellBootstrap } from "~/shell/server/dashboardBootstrap";
import { useToast } from "~/shared/providers/ToastContext";
import { TeamProvider } from "~/shared/providers/TeamContext";
import { isHostedOnlyIssueDetectionPath } from "~/shared/config/issueDetectionAccess";

export const meta: Route.MetaFunction = () => [
    // Authenticated app shell; should never be indexed by search engines.
    { name: "robots", content: "noindex, nofollow" },
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
        if (bootstrap.user.isSelfHosted && isHostedOnlyIssueDetectionPath(url.pathname)) {
            throw redirect("/dashboard/general");
        }
        const isSetupPage = isSetupSupportRoute(url.pathname);
        const isSetupWizardPage = isSetupWizardRoute(url.pathname);
        const selectedProject = bootstrap.projects.find((p) => p.id === bootstrap.selectedProjectId) ?? bootstrap.projects[0] ?? null;
        if (isSetupWizardPage && shouldRedirectFromSetup(selectedProject as unknown as Project)) {
            throw redirect("/dashboard/general");
        }
        if (!isSetupPage && shouldRedirectToSetup(bootstrap.projects as unknown as Project[])) {
            throw redirect("/dashboard/setup");
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
            <div className="min-h-screen flex items-center justify-center bg-[#f8fafd]">
                <div className="text-center">
                    <div className="w-8 h-8 border-2 border-[#1a73e8] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                    <div className="text-sm text-[#5f6368]">Loading...</div>
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
    const { projects, isLoading } = useSessionData();
    const navigate = useNavigate();
    const location = useLocation();
    const { showToast } = useToast();

    useEffect(() => {
        if (!isLoading && !isSetupSupportRoute(location.pathname) && shouldRedirectToSetup(projects)) {
            showToast(SETUP_GATE_TOAST);
            navigate("/dashboard/setup", { replace: true });
        }
    }, [isLoading, projects, location.pathname, navigate, showToast]);

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
        <TeamProvider
            initialTeams={bootstrap.teams}
            initialCurrentTeamId={bootstrap.currentTeamId}
            initialHydrated
        >
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
        </TeamProvider>
    );
}

export function ErrorBoundary() {
    const error = useRouteError();
    const isDev = import.meta.env.DEV;

    if (isRouteErrorResponse(error) && error.status === 503) {
        return (
            <AuthServiceUnavailable
                label="Service unavailable"
                title="Dashboard temporarily unavailable"
                message="Rejourney can't reach the dashboard API right now. This usually clears within seconds."
                detail="Our team has been notified. If this issue remains past a few minutes, email contact@rejourney.co for 24/7 support."
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
        <main className="min-h-screen flex items-center justify-center bg-[#f8fafd] p-4">
            <div className="w-full max-w-md rounded-none border border-[#dadce0] bg-white p-6 text-center shadow-[0_1px_3px_rgba(60,64,67,0.12)]">
                <h1 className="mb-2 text-xl font-normal text-[#202124]">Dashboard error</h1>
                <p className="mb-5 text-sm text-[#5f6368]">{message}</p>
                <button
                    type="button"
                    onClick={() => {
                        if (typeof window !== 'undefined') window.location.reload();
                    }}
                    className={dashboardButtonClass('primary')}
                >
                    Reload
                </button>
            </div>
        </main>
    );
}
