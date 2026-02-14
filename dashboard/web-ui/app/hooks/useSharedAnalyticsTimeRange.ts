import { useCallback, useEffect, useMemo, useState } from 'react';
import { DEFAULT_TIME_RANGE, TimeRange } from '../components/ui/TimeFilter';

function isTimeRange(value: string): value is TimeRange {
    return value === '24h' || value === '7d' || value === '30d' || value === '90d' || value === 'all';
}

export function useSharedAnalyticsTimeRange(projectId?: string | null) {
    const storageKey = useMemo(
        () => `rejourney.analytics.timeRange.${projectId || 'global'}`,
        [projectId],
    );
    const [timeRange, setTimeRangeState] = useState<TimeRange>(DEFAULT_TIME_RANGE);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        const stored = window.localStorage.getItem(storageKey);
        if (stored && isTimeRange(stored)) {
            setTimeRangeState(stored);
        } else {
            setTimeRangeState(DEFAULT_TIME_RANGE);
        }
    }, [storageKey]);

    const setTimeRange = useCallback((next: TimeRange) => {
        setTimeRangeState(next);
        if (typeof window !== 'undefined') {
            window.localStorage.setItem(storageKey, next);
        }
    }, [storageKey]);

    return { timeRange, setTimeRange };
}
