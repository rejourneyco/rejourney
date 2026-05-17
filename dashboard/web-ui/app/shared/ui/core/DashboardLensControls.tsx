import React from 'react';
import { useSessionData } from '~/shared/providers/SessionContext';
import { useSharedPlatformLens } from '~/shared/hooks/useSharedPlatformLens';
import { PlatformLensFilter } from './PlatformLensFilter';
import { TimeFilter, type TimeRange } from './TimeFilter';

interface DashboardLensControlsProps {
    timeRange: TimeRange;
    onTimeRangeChange: (range: TimeRange) => void;
    className?: string;
}

export const DashboardLensControls: React.FC<DashboardLensControlsProps> = ({
    timeRange,
    onTimeRangeChange,
    className = '',
}) => {
    const { selectedProject } = useSessionData();
    const { platformLens, setPlatformLens, availablePlatformLenses } = useSharedPlatformLens(
        selectedProject?.id,
        selectedProject?.platforms,
    );

    return (
        <div className={`flex w-full min-w-0 max-w-full flex-wrap items-end justify-start gap-2 sm:w-auto sm:items-center sm:justify-end ${className}`.trim()}>
            <PlatformLensFilter
                value={platformLens}
                onChange={setPlatformLens}
                availableValues={availablePlatformLenses}
            />
            <TimeFilter value={timeRange} onChange={onTimeRangeChange} />
        </div>
    );
};
