import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Platform } from '~/shared/types';
import { useIsClientRendered } from '~/shared/hooks/useSharedRejourneyTimeRange';

export type PlatformLens = 'all' | 'mobile' | 'web';

export const DEFAULT_PLATFORM_LENS: PlatformLens = 'all';
export const PLATFORM_LENS_CHANGED_EVENT = 'rejourney:platform-lens-changed';
const ALL_PLATFORM_LENSES: PlatformLens[] = ['all', 'mobile', 'web'];

function isPlatformLens(value: string | null): value is PlatformLens {
    return value === 'all' || value === 'mobile' || value === 'web';
}

function hasMobilePlatform(platforms?: readonly Platform[] | null): boolean {
    return Boolean(platforms?.some((platform) => (
        platform === 'ios'
        || platform === 'android'
        || platform === 'react-native'
        || platform === 'flutter'
    )));
}

function hasWebPlatform(platforms?: readonly Platform[] | null): boolean {
    return Boolean(platforms?.some((platform) => platform === 'web'));
}

export function getAvailablePlatformLenses(platforms?: readonly Platform[] | null): PlatformLens[] {
    if (!platforms) return ALL_PLATFORM_LENSES;
    const lenses: PlatformLens[] = ['all'];
    if (hasMobilePlatform(platforms)) lenses.push('mobile');
    if (hasWebPlatform(platforms)) lenses.push('web');
    return lenses;
}

export function getDefaultPlatformLens(platforms?: readonly Platform[] | null): PlatformLens {
    const hasMobile = hasMobilePlatform(platforms);
    const hasWeb = hasWebPlatform(platforms);
    if (hasWeb && !hasMobile) return 'web';
    if (hasMobile && !hasWeb) return 'mobile';
    return DEFAULT_PLATFORM_LENS;
}

function readStoredPlatformLens(storageKey: string, legacyStorageKey: string): string | null {
    try {
        return window.localStorage.getItem(storageKey) ?? window.localStorage.getItem(legacyStorageKey);
    } catch {
        return null;
    }
}

export function platformLensToSessionPlatform(lens: PlatformLens): string | undefined {
    if (lens === 'all') return undefined;
    return lens;
}

export function useSharedPlatformLens(projectId?: string | null, platforms?: readonly Platform[] | null) {
    const storageKey = useMemo(
        () => `rejourney.dashboard.platformLens.${projectId || 'global'}`,
        [projectId],
    );
    const legacyStorageKey = useMemo(
        () => `rejourney.analytics.platformLens.${projectId || 'global'}`,
        [projectId],
    );
    const availablePlatformLenses = useMemo(() => getAvailablePlatformLenses(platforms), [platforms]);
    const defaultLens = useMemo(() => getDefaultPlatformLens(platforms), [platforms]);
    const isClient = useIsClientRendered();
    // Keyed by storage key so the first client render (and a project switch)
    // already reflects the stored lens instead of the default.
    const [state, setState] = useState<{ key: string; value: PlatformLens } | null>(null);

    const normalizeLens = useCallback((value: string | null): PlatformLens => {
        if (isPlatformLens(value) && availablePlatformLenses.includes(value)) return value;
        return defaultLens;
    }, [availablePlatformLenses, defaultLens]);

    const platformLens: PlatformLens = !isClient
        ? defaultLens
        : normalizeLens(state?.key === storageKey ? state.value : readStoredPlatformLens(storageKey, legacyStorageKey));

    useEffect(() => {
        if (!isClient) return;
        const stored = window.localStorage.getItem(storageKey) ?? window.localStorage.getItem(legacyStorageKey);
        const normalized = normalizeLens(stored);
        setState({ key: storageKey, value: normalized });
        window.localStorage.setItem(storageKey, normalized);
        window.localStorage.removeItem(legacyStorageKey);
    }, [isClient, legacyStorageKey, normalizeLens, storageKey]);

    useEffect(() => {
        if (typeof window === 'undefined') return undefined;

        const onPlatformLensChanged = (event: Event) => {
            const detail = (event as CustomEvent<{ storageKey?: string; value?: string }>).detail;
            if (detail?.storageKey !== storageKey) return;
            setState({ key: storageKey, value: normalizeLens(detail.value ?? null) });
        };

        const onStorage = (event: StorageEvent) => {
            if (event.key !== storageKey) return;
            setState({ key: storageKey, value: normalizeLens(event.newValue) });
        };

        window.addEventListener(PLATFORM_LENS_CHANGED_EVENT, onPlatformLensChanged);
        window.addEventListener('storage', onStorage);
        return () => {
            window.removeEventListener(PLATFORM_LENS_CHANGED_EVENT, onPlatformLensChanged);
            window.removeEventListener('storage', onStorage);
        };
    }, [normalizeLens, storageKey]);

    const setPlatformLens = useCallback((next: PlatformLens) => {
        const normalized = normalizeLens(next);
        setState({ key: storageKey, value: normalized });
        if (typeof window !== 'undefined') {
            window.localStorage.setItem(storageKey, normalized);
            window.dispatchEvent(new CustomEvent(PLATFORM_LENS_CHANGED_EVENT, {
                detail: { storageKey, value: normalized },
            }));
        }
    }, [normalizeLens, storageKey]);

    return { platformLens, setPlatformLens, availablePlatformLenses, ready: isClient };
}
