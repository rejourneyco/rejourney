import React from 'react';
import { DashboardLensControls } from '~/shared/ui/core/DashboardLensControls';
import { DashboardPageHeader } from '~/shared/ui/core/DashboardPageHeader';
import { TouchHeatmapSection } from '~/features/app/shared/dashboard/TouchHeatmapSection';
import { useSharedRejourneyTimeRange } from '~/shared/hooks/useSharedRejourneyTimeRange';
import { platformLensToSessionPlatform, useSharedPlatformLens } from '~/shared/hooks/useSharedPlatformLens';
import { useSessionData } from '~/shared/providers/SessionContext';
import { dashboardPageHeaderProps } from '~/shell/navigation/dashboardPageMeta';

export const Heatmaps: React.FC = () => {
    const { selectedProject } = useSessionData();
    const { timeRange, setTimeRange } = useSharedRejourneyTimeRange(selectedProject?.id);
    const { platformLens } = useSharedPlatformLens(selectedProject?.id, selectedProject?.platforms);
    const platform = platformLensToSessionPlatform(platformLens);

    return (
        <div className="rejourney-heatmaps-page flex min-h-screen flex-col font-sans text-[#202124] xl:h-full xl:min-h-0 xl:overflow-hidden">
            <DashboardPageHeader
                title="Heatmaps"
                {...dashboardPageHeaderProps('heatmaps')}
            >
                <DashboardLensControls
                    timeRange={timeRange}
                    onTimeRangeChange={setTimeRange}
                />
            </DashboardPageHeader>

            <div className="heatmap-page-main flex w-full flex-1 flex-col p-3 xl:min-h-0">
                <TouchHeatmapSection timeRange={timeRange} platform={platform} compact={false} className="xl:min-h-0 xl:flex-1" />
            </div>
        </div>
    );
};

export default Heatmaps;
