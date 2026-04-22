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
import { ProjectLayout } from "~/shell/components/layout/AppLayout";
import { TabWorkspace } from "~/shell/components/layout/TabWorkspace";
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
                            <ProjectLayout pathPrefix="/demo">
                                <div className="flex flex-col h-full min-h-0 bg-transparent">
                                    <TabWorkspace>
                                        <Outlet />
                                    </TabWorkspace>
                                </div>
                            </ProjectLayout>
                        </TabProvider>
                    </SessionDataProvider>
                </DemoTeamProvider>
            </DemoModeProvider>
        </ErrorBoundary>
    );
}
