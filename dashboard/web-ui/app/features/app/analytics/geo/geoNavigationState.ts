export interface GeoMarkerLocationState {
    country: string;
    city: string;
}

export interface GeoViewportState {
    latitude: number;
    longitude: number;
    zoom: number;
}

export interface GeoNavigationState {
    markerLocation: GeoMarkerLocationState | null;
    clusterId: string | null;
    visitorId: string | null;
    activeSessionId: string | null;
    viewport: GeoViewportState | null;
}

const EMPTY_GEO_NAVIGATION_STATE: GeoNavigationState = {
    markerLocation: null,
    clusterId: null,
    visitorId: null,
    activeSessionId: null,
    viewport: null,
};

const GEO_NAVIGATION_STORAGE_PREFIX = 'rejourney:geo-navigation:v1';

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getTrimmedString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function getFiniteNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function normalizeGeoNavigationState(value: unknown): GeoNavigationState {
    if (!isRecord(value)) return { ...EMPTY_GEO_NAVIGATION_STATE };

    const rawMarkerLocation = isRecord(value.markerLocation) ? value.markerLocation : null;
    const country = getTrimmedString(rawMarkerLocation?.country);
    const city = getTrimmedString(rawMarkerLocation?.city);
    const rawViewport = isRecord(value.viewport) ? value.viewport : null;
    const latitude = getFiniteNumber(rawViewport?.latitude);
    const longitude = getFiniteNumber(rawViewport?.longitude);
    const zoom = getFiniteNumber(rawViewport?.zoom);
    const hasValidViewport =
        latitude !== null &&
        longitude !== null &&
        zoom !== null &&
        latitude >= -90 &&
        latitude <= 90 &&
        longitude >= -180 &&
        longitude <= 180 &&
        zoom >= 0 &&
        zoom <= 24;

    return {
        markerLocation: country && city ? { country, city } : null,
        clusterId: getTrimmedString(value.clusterId),
        visitorId: getTrimmedString(value.visitorId),
        activeSessionId: getTrimmedString(value.activeSessionId),
        viewport: hasValidViewport ? { latitude, longitude, zoom } : null,
    };
}

export function getGeoNavigationStorageKey(pathPrefix: string, projectId?: string | null): string {
    const scope = pathPrefix.replace(/^\/+|\/+$/g, '') || 'dashboard';
    return `${GEO_NAVIGATION_STORAGE_PREFIX}:${scope}:${projectId || 'no-project'}`;
}

export function parseStoredGeoNavigationState(rawValue: string | null): GeoNavigationState | null {
    if (!rawValue) return null;

    try {
        const parsed = JSON.parse(rawValue);
        return normalizeGeoNavigationState(parsed);
    } catch {
        return null;
    }
}

export function geoNavigationStatesEqual(left: GeoNavigationState, right: GeoNavigationState): boolean {
    return (
        left.markerLocation?.country === right.markerLocation?.country &&
        left.markerLocation?.city === right.markerLocation?.city &&
        left.clusterId === right.clusterId &&
        left.visitorId === right.visitorId &&
        left.activeSessionId === right.activeSessionId &&
        left.viewport?.latitude === right.viewport?.latitude &&
        left.viewport?.longitude === right.viewport?.longitude &&
        left.viewport?.zoom === right.viewport?.zoom
    );
}
