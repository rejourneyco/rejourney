/**
 * Demo Dashboard Layout Route
 * 
 * Wraps all /demo/* routes with the demo-specific layout.
 */

import { Outlet } from "react-router";
import type { Route } from "./+types/_demo";
import { DemoModeProvider, DemoTeamProvider } from "~/context/DemoModeContext";
import { SessionDataProvider } from "~/context/SessionContext";
import { TabProvider } from "~/context/TabContext";
import { DemoDashboardLayout } from "~/components/layout/DemoDashboardLayout";
import { ErrorBoundary } from "~/components/ui/ErrorBoundary";

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
