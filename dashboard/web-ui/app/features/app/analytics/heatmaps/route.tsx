import React from 'react';
import { ScanSearch } from 'lucide-react';
import { DashboardLensControls } from '~/shared/ui/core/DashboardLensControls';
import { TouchHeatmapSection } from '~/features/app/shared/dashboard/TouchHeatmapSection';
import { useSharedRejourneyTimeRange } from '~/shared/hooks/useSharedRejourneyTimeRange';
import { platformLensToSessionPlatform, useSharedPlatformLens } from '~/shared/hooks/useSharedPlatformLens';
import { useSessionData } from '~/shared/providers/SessionContext';

export const Heatmaps: React.FC = () => {
    const { selectedProject } = useSessionData();
    const { timeRange, setTimeRange } = useSharedRejourneyTimeRange(selectedProject?.id);
    const { platformLens } = useSharedPlatformLens(selectedProject?.id, selectedProject?.platforms);
    const platform = platformLensToSessionPlatform(platformLens);

    return (
        <div className="rejourney-heatmaps-page flex min-h-screen flex-col font-sans text-slate-950 xl:h-full xl:min-h-0 xl:overflow-hidden">
            <header className="heatmap-pro-pagebar">
                <div className="heatmap-pro-page-title">
                    <span><ScanSearch className="h-4 w-4" /></span>
                    <div>
                        <small>Product intelligence</small>
                        <h1>Heatmaps</h1>
                    </div>
                </div>
                <DashboardLensControls
                    timeRange={timeRange}
                    onTimeRangeChange={setTimeRange}
                />
            </header>

            <div className="heatmap-page-main flex w-full flex-1 flex-col p-3 xl:min-h-0">
                <TouchHeatmapSection timeRange={timeRange} platform={platform} compact={false} className="xl:min-h-0 xl:flex-1" />
            </div>
        </div>
    );
};

export default Heatmaps;
