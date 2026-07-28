const GEO_MAP_TRACKPAD_ZOOM_RATE = 1 / 35;
const GEO_MAP_WHEEL_ZOOM_RATE = 1 / 100;
const GEO_MAP_ZOOM_PER_STANDARD_WHEEL_STEP = 1;
const GEO_MAP_MAX_WHEEL_ZOOM_DELTA = 1.15;

type ScrollZoomHandlerLike = {
    setZoomRate?: (rate: number) => void;
    setWheelZoomRate?: (rate: number) => void;
};

type MapWithScrollZoom = {
    scrollZoom?: ScrollZoomHandlerLike;
};

export function configureGeoMapZoomSensitivity(map: MapWithScrollZoom | null | undefined): void {
    map?.scrollZoom?.setZoomRate?.(GEO_MAP_TRACKPAD_ZOOM_RATE);
    map?.scrollZoom?.setWheelZoomRate?.(GEO_MAP_WHEEL_ZOOM_RATE);
}

export function getGeoMapWheelZoomDelta(deltaY: number, deltaMode = 0): number {
    if (!Number.isFinite(deltaY) || deltaY === 0) return 0;

    // WheelEvent deltaMode: 0 = pixels, 1 = lines, 2 = pages.
    const deltaModeScale = deltaMode === 1 ? 40 : deltaMode === 2 ? 800 : 1;
    const standardWheelSteps = (deltaY * deltaModeScale) / 100;
    const zoomDelta = -standardWheelSteps * GEO_MAP_ZOOM_PER_STANDARD_WHEEL_STEP;

    return Math.max(-GEO_MAP_MAX_WHEEL_ZOOM_DELTA, Math.min(GEO_MAP_MAX_WHEEL_ZOOM_DELTA, zoomDelta));
}
