import React from 'react';
import { MousePointer2 } from 'lucide-react';
import { DashboardPageHeader } from '~/shared/ui/core/DashboardPageHeader';
import { TimeFilter, TimeRange, DEFAULT_TIME_RANGE } from '~/shared/ui/core/TimeFilter';
import { TouchHeatmapSection } from '~/features/app/shared/dashboard/TouchHeatmapSection';
import { useSharedAnalyticsTimeRange } from '~/shared/hooks/useSharedAnalyticsTimeRange';
import { useSessionData } from '~/shared/providers/SessionContext';

export const Heatmaps: React.FC = () => {
    const { selectedProject } = useSessionData();
    const { timeRange, setTimeRange } = useSharedAnalyticsTimeRange(selectedProject?.id);

    return (
        <div className="min-h-screen bg-[#f8fafc] pb-12 font-sans text-slate-900">
            <DashboardPageHeader
                title="Heatmaps"
                icon={<MousePointer2 className="w-6 h-6" />}
                iconColor="bg-[#fce7f3]"
            >
                <TimeFilter value={timeRange} onChange={setTimeRange} />
            </DashboardPageHeader>

            <div className="mx-auto w-full max-w-[1800px] px-4 py-6 sm:px-6">
                <TouchHeatmapSection timeRange={timeRange} compact={false} />
            </div>
        </div>
    );
};

export default Heatmaps;
