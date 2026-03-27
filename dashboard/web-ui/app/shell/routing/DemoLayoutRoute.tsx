/**
 * Demo Dashboard Layout Route
 * 
 * Wraps all /demo/* routes with the demo-specific layout.
 */

import { Outlet } from "react-router";
import type { Route } from "./+types/DemoLayoutRoute";
import { DemoModeProvider, DemoTeamProvider } from "~/shared/providers/DemoModeContext";
import { SessionDataProvider } from "~/shared/providers/SessionContext";
import { TabProvider } from "~/shared/providers/TabContext";
import { DemoDashboardLayout } from "~/shell/components/layout/DemoDashboardLayout";
import { ErrorBoundary } from "~/shared/ui/core/ErrorBoundary";

export const meta: Route.MetaFunction = () => [
    { name: "robots", content: "noindex" },
    { title: "Rejourney Demo - Session Replay" },
];

export default function DemoLayout() {
    return (
        <ErrorBoundary>
            <DemoModeProvider>
                <DemoTeamProvider>
                    <SessionDataProvider>
                        <TabProvider>
                            <DemoDashboardLayout />
                        </TabProvider>
                    </SessionDataProvider>
                </DemoTeamProvider>
            </DemoModeProvider>
        </ErrorBoundary>
    );
}
