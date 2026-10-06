import { PanelsTopLeft } from 'lucide-react';
import { useDashboardPreferences } from '~/shared/providers/useDashboardPreferences';
import { NeoCard } from '~/shared/ui/core/neo/NeoCard';
import { dashboardSectionTitleClass } from '~/shared/ui/core/dashboardStyles';

export function DashboardPreferences() {
    const { workspaceTabsEnabled, setWorkspaceTabsEnabled } = useDashboardPreferences();

    return (
        <section id="dashboard-preferences" className="space-y-3 scroll-mt-6">
            <h2 className={`flex items-center gap-2 ${dashboardSectionTitleClass}`}>
                <PanelsTopLeft className="h-4 w-4 text-[#5f6368]" /> Preferences
            </h2>
            <NeoCard className="p-4">
                <div className="flex items-center justify-between gap-6">
                    <span id="workspace-tabs-label" className="text-sm font-medium text-[#202124]">Workspace tabs</span>
                    <button
                        type="button"
                        role="switch"
                        aria-checked={workspaceTabsEnabled}
                        aria-labelledby="workspace-tabs-label"
                        onClick={() => setWorkspaceTabsEnabled(!workspaceTabsEnabled)}
                        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1a73e8] focus-visible:ring-offset-2 ${workspaceTabsEnabled ? 'bg-[#1a73e8]' : 'bg-[#bdc1c6]'}`}
                    >
                        <span className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${workspaceTabsEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                    </button>
                </div>
            </NeoCard>
        </section>
    );
}
