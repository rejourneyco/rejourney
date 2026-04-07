import React from 'react';
import { Flame } from 'lucide-react';
import { DashboardPageHeader } from '~/shared/ui/core/DashboardPageHeader';
import { TimeFilter, TimeRange, DEFAULT_TIME_RANGE } from '~/shared/ui/core/TimeFilter';
import { TouchHeatmapSection } from '~/features/app/shared/dashboard/TouchHeatmapSection';
import { useSharedAnalyticsTimeRange } from '~/shared/hooks/useSharedAnalyticsTimeRange';
import { useSessionData } from '~/shared/providers/SessionContext';

export const Heatmaps: React.FC = () => {
    const { selectedProject } = useSessionData();
    const { timeRange, setTimeRange } = useSharedAnalyticsTimeRange(selectedProject?.id);

    return (
        <div className="min-h-screen bg-transparent font-sans text-slate-900 pb-12">
            <DashboardPageHeader
                title="Interaction Heatmaps"
                subtitle="Visualize where users tap, fail, and abandon — then jump directly to evidence replay."
                icon={<Flame className="w-6 h-6" />}
                iconColor="bg-rose-500"
            >
                <TimeFilter value={timeRange} onChange={setTimeRange} />
            </DashboardPageHeader>

            <div className="mx-auto w-full max-w-[1600px] px-6 py-6">
                <TouchHeatmapSection timeRange={timeRange} compact={false} />
            </div>
        </div>
    );
};

export default Heatmaps;
