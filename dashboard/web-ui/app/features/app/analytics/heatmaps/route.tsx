import React from 'react';
import { MousePointer2 } from 'lucide-react';
import { DashboardPageHeader } from '~/shared/ui/core/DashboardPageHeader';
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
        <div className="rejourney-heatmaps-page min-h-screen bg-[#f8fafd] pb-12 font-sans text-slate-900">
            <DashboardPageHeader
                title="Heatmaps"
                icon={<MousePointer2 className="w-6 h-6" />}
                iconColor="bg-[#fce7f3]"
            >
                <DashboardLensControls timeRange={timeRange} onTimeRangeChange={setTimeRange} />
            </DashboardPageHeader>

            <div className="mx-auto w-full max-w-[1800px] px-4 py-6 sm:px-6">
                <TouchHeatmapSection timeRange={timeRange} platform={platform} compact={false} />
            </div>
        </div>
    );
};

export default Heatmaps;
