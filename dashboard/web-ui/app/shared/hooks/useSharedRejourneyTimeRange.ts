import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
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

const subscribeNoop = () => () => undefined;
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

/**
 * False while rendering on the server and during hydration, true afterwards.
 * Stored dashboard lenses live in localStorage, so they can only be read once
 * this is true; pages wait for it before fetching so the first request already
 * uses the stored lens instead of the defaults.
 */
export function useIsClientRendered(): boolean {
    return useSyncExternalStore(subscribeNoop, getClientSnapshot, getServerSnapshot);
}

function readStoredTimeRange(storageKey: string, legacyStorageKey: string): TimeRange {
    try {
        const stored = window.localStorage.getItem(storageKey) ?? window.localStorage.getItem(legacyStorageKey);
        return stored && isTimeRange(stored) ? stored : DEFAULT_TIME_RANGE;
    } catch {
        return DEFAULT_TIME_RANGE;
    }
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
    const isClient = useIsClientRendered();
    // Keyed by storage key so a project switch reads that project's stored range
    // in the same render instead of one render later.
    const [state, setState] = useState<{ key: string; value: TimeRange } | null>(null);
    const timeRange: TimeRange = state?.key === storageKey
        ? state.value
        : isClient
            ? readStoredTimeRange(storageKey, legacyStorageKey)
            : DEFAULT_TIME_RANGE;

    useEffect(() => {
        if (!isClient) return;
        const stored = window.localStorage.getItem(storageKey) ?? window.localStorage.getItem(legacyStorageKey);
        if (stored && isTimeRange(stored)) {
            setState({ key: storageKey, value: stored });
            window.localStorage.setItem(storageKey, stored);
            window.localStorage.removeItem(legacyStorageKey);
        } else {
            setState({ key: storageKey, value: DEFAULT_TIME_RANGE });
        }
    }, [isClient, legacyStorageKey, storageKey]);

    const setTimeRange = useCallback((next: TimeRange) => {
        setState({ key: storageKey, value: next });
        if (typeof window !== 'undefined') {
            window.localStorage.setItem(storageKey, next);
        }
    }, [storageKey]);

    return { timeRange, setTimeRange, ready: isClient };
}
