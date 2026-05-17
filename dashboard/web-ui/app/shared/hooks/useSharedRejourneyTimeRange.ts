import { useCallback, useEffect, useMemo, useState } from 'react';
import { DEFAULT_TIME_RANGE, TimeRange } from '~/shared/ui/core/TimeFilter';

function isTimeRange(value: string): value is TimeRange {
    return (
        value === '24h' ||
        value === '7d' ||
        value === '30d' ||
        value === '90d' ||
        value === '180d' ||
        value === '1y' ||
        value === 'all'
    );
}

export function useSharedRejourneyTimeRange(projectId?: string | null) {
    const storageKey = useMemo(
        () => `rejourney.dashboard.timeRange.${projectId || 'global'}`,
        [projectId],
    );
    const legacyStorageKey = useMemo(
        () => `rejourney.analytics.timeRange.${projectId || 'global'}`,
        [projectId],
    );
    const [timeRange, setTimeRangeState] = useState<TimeRange>(DEFAULT_TIME_RANGE);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        const stored = window.localStorage.getItem(storageKey) ?? window.localStorage.getItem(legacyStorageKey);
        if (stored && isTimeRange(stored)) {
            setTimeRangeState(stored);
            window.localStorage.setItem(storageKey, stored);
            window.localStorage.removeItem(legacyStorageKey);
        } else {
            setTimeRangeState(DEFAULT_TIME_RANGE);
        }
    }, [legacyStorageKey, storageKey]);

    const setTimeRange = useCallback((next: TimeRange) => {
        setTimeRangeState(next);
        if (typeof window !== 'undefined') {
            window.localStorage.setItem(storageKey, next);
        }
    }, [storageKey]);

    return { timeRange, setTimeRange };
}
