import { normalizeHeatmapScreenName } from './heatmapScreens.js';

export type HeatmapPreviewEventEntry = {
    event: any;
    artifactStartMs?: number | null;
};

export function hasCompatibleHeatmapVisualArtifact(
    platform: string | null | undefined,
    artifactKinds: Iterable<string>,
): boolean {
    const kinds = new Set(artifactKinds);
    const isWebReplay = platform === 'web' || kinds.has('rrweb');
    return isWebReplay ? kinds.has('rrweb') : kinds.has('screenshots');
}

type FindHeatmapPreviewTimestampParams = {
    events: HeatmapPreviewEventEntry[];
    normalizedScreenName: string;
    sessionStartMs: number;
    sessionEndMs: number | null;
    interactionPrerollMs: number;
    routeSettleMs: number;
};

export function buildHeatmapScreenshotUrl(
    sessionId: string | null | undefined,
    screenFirstSeenMs?: number | null,
    options: { requireTimestamp?: boolean } = {},
): string | null {
    const normalizedSessionId = String(sessionId || '').trim();
    if (!normalizedSessionId) return null;

    const encodedSessionId = encodeURIComponent(normalizedSessionId);
    const timestamp = Number(screenFirstSeenMs);
    if (Number.isFinite(timestamp) && timestamp > 0) {
        return `/api/session/frame/${encodedSessionId}/${Math.round(timestamp)}.jpg`;
    }

    if (options.requireTimestamp) return null;

    return `/api/session/thumbnail/${encodedSessionId}`;
}

function normalizePreviewEventScreen(event: any): string | null {
    const payload = event?.payload && typeof event.payload === 'object' ? event.payload : null;
    const properties = event?.properties && typeof event.properties === 'object' ? event.properties : null;
    const rawScreenName =
        event?.screen ||
        event?.screenName ||
        payload?.screenName ||
        payload?.name ||
        payload?.route ||
        properties?.screen ||
        properties?.screenName ||
        properties?.name ||
        properties?.route;
    if (!rawScreenName) return null;
    return normalizeHeatmapScreenName(String(rawScreenName));
}

function coercePreviewTimestampMs(
    raw: unknown,
    artifactStartMs: number | null,
    sessionStartMs: number,
    sessionEndMs: number | null,
): number | null {
    let timestampMs: number | null = null;

    if (raw instanceof Date) {
        timestampMs = Number.isFinite(raw.getTime()) ? raw.getTime() : null;
    } else if (typeof raw === 'number' || typeof raw === 'string') {
        const numeric = Number(raw);
        if (!Number.isFinite(numeric) || numeric <= 0) {
            timestampMs = null;
        } else if (numeric >= 10_000_000_000) {
            timestampMs = numeric;
        } else if (numeric >= 1_000_000_000) {
            timestampMs = numeric * 1000;
        } else if (artifactStartMs && numeric <= 86_400_000) {
            timestampMs = artifactStartMs + numeric;
        } else if (numeric <= 86_400_000) {
            timestampMs = sessionStartMs + numeric;
        } else {
            const parsedDate = new Date(String(raw));
            timestampMs = Number.isFinite(parsedDate.getTime()) ? parsedDate.getTime() : null;
        }
    } else {
        const parsedDate = new Date(String(raw));
        timestampMs = Number.isFinite(parsedDate.getTime()) ? parsedDate.getTime() : null;
    }

    if (!timestampMs || !Number.isFinite(timestampMs)) return null;
    const lowerBound = sessionStartMs - 60_000;
    const upperBound = (sessionEndMs ?? (sessionStartMs + 24 * 60 * 60 * 1000)) + 120_000;
    if (timestampMs < lowerBound || timestampMs > upperBound) return null;
    return Math.round(timestampMs);
}

function isPreferredScreenTransitionEvent(event: any): boolean {
    const type = String(event?.type || '').toLowerCase();
    return type === 'navigation' || type === 'screen_view' || type === 'screen_change' || type.includes('navigation');
}

function isHeatmapInteractionEvent(event: any): boolean {
    const type = String(event?.type || '').toLowerCase();
    const gestureType = String(event?.gestureType || event?.payload?.gestureType || event?.properties?.gestureType || '').toLowerCase();
    return (
        type === 'touch' ||
        type === 'tap' ||
        type === 'click' ||
        type === 'rage_tap' ||
        type === 'dead_tap' ||
        type === 'gesture' ||
        gestureType.includes('tap') ||
        gestureType === 'long_press' ||
        gestureType === 'rage_tap' ||
        gestureType === 'dead_tap'
    );
}

export function findHeatmapPreviewTimestampInEvents(params: FindHeatmapPreviewTimestampParams): number | null {
    const normalizedEvents = params.events
        .map((entry, index) => ({
            event: entry.event,
            timestampMs: coercePreviewTimestampMs(
                entry.event?.timestamp,
                entry.artifactStartMs ?? null,
                params.sessionStartMs,
                params.sessionEndMs,
            ),
            index,
        }))
        .filter((entry): entry is { event: any; timestampMs: number; index: number } => entry.timestampMs !== null)
        .sort((a, b) => a.timestampMs - b.timestampMs || a.index - b.index);

    let currentScreen: string | null = null;
    let firstInteractionTimestamp: number | null = null;
    let activeTargetTransitionTimestamp: number | null = null;
    let firstSettledTransitionTimestamp: number | null = null;
    let firstMatchingTimestamp: number | null = null;
    let sawTargetTransition = false;
    const closeTargetWindow = (windowEndMs: number | null) => {
        if (activeTargetTransitionTimestamp === null || firstSettledTransitionTimestamp !== null) {
            activeTargetTransitionTimestamp = null;
            return;
        }

        const settledTimestamp = activeTargetTransitionTimestamp + params.routeSettleMs;
        if (windowEndMs === null || settledTimestamp < windowEndMs) {
            firstSettledTransitionTimestamp = params.sessionEndMs && params.sessionEndMs > activeTargetTransitionTimestamp
                ? Math.min(params.sessionEndMs, settledTimestamp)
                : settledTimestamp;
        }
        activeTargetTransitionTimestamp = null;
    };

    for (const { event, timestampMs } of normalizedEvents) {
        const explicitScreen = normalizePreviewEventScreen(event);
        const isTransition = explicitScreen !== null && isPreferredScreenTransitionEvent(event);
        const isInteraction = isHeatmapInteractionEvent(event);

        if (isTransition && explicitScreen) {
            if (currentScreen === params.normalizedScreenName && explicitScreen !== params.normalizedScreenName) {
                closeTargetWindow(timestampMs);
            }
            currentScreen = explicitScreen;
            if (
                explicitScreen === params.normalizedScreenName &&
                activeTargetTransitionTimestamp === null &&
                firstSettledTransitionTimestamp === null
            ) {
                activeTargetTransitionTimestamp = timestampMs;
                sawTargetTransition = true;
            }
        }

        const eventScreen = explicitScreen ?? currentScreen;
        if (eventScreen !== params.normalizedScreenName) {
            if (explicitScreen && isInteraction && explicitScreen !== currentScreen) {
                if (currentScreen === params.normalizedScreenName) {
                    closeTargetWindow(timestampMs);
                }
                currentScreen = explicitScreen;
            }
            continue;
        }

        if (firstMatchingTimestamp === null || timestampMs < firstMatchingTimestamp) {
            firstMatchingTimestamp = timestampMs;
        }
        if (isInteraction && (firstInteractionTimestamp === null || timestampMs < firstInteractionTimestamp)) {
            firstInteractionTimestamp = timestampMs;
        }

        if (explicitScreen && isInteraction && explicitScreen !== currentScreen) {
            currentScreen = explicitScreen;
        }
    }

    closeTargetWindow(params.sessionEndMs);

    if (firstInteractionTimestamp) {
        return Math.max(params.sessionStartMs, firstInteractionTimestamp - params.interactionPrerollMs);
    }
    if (firstSettledTransitionTimestamp) {
        return firstSettledTransitionTimestamp;
    }
    if (sawTargetTransition) {
        return null;
    }
    return firstMatchingTimestamp;
}
