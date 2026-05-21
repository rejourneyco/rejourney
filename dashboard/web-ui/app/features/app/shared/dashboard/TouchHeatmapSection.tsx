import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Monitor, MousePointer2 } from 'lucide-react';
import { useSessionData } from '~/shared/providers/SessionContext';
import { useDemoMode } from '~/shared/providers/DemoModeContext';
import {
    getHeatmapsOverview,
    getHeatmapScreenOverview,
    type AlltimeHeatmapScreen,
    type HeatmapIterationScreen,
    type HeatmapIterationSummary,
    type HeatmapIterationVersion,
} from '~/shared/api/client';
import { API_BASE_URL, getCsrfToken } from '~/shared/config/appConfig';
import { TimeRange } from '~/shared/ui/core/TimeFilter';
import { demoReplayFixture as brewCoffeeReplayFixture } from '~/shared/data/demoReplayDataFrankfurt';

const TOUCH_HEATMAP_DEBUG_PREFIX = '[TouchHeatmapDebug]';
const HEATMAP_DETAIL_FETCH_CONCURRENCY = 4;

function heatmapDebug(message: string, details?: unknown): void {
    let enabled = false;
    try {
        enabled = typeof window !== 'undefined' && window.localStorage.getItem('rejourney:debug:heatmaps') === 'true';
    } catch {
        enabled = false;
    }
    if (!enabled) {
        return;
    }
    if (details !== undefined) {
        console.log(`${TOUCH_HEATMAP_DEBUG_PREFIX} ${message}`, details);
        return;
    }
    console.log(`${TOUCH_HEATMAP_DEBUG_PREFIX} ${message}`);
}

const convertHeic = async (blob: Blob): Promise<Blob> => {
    const heic2any = (await import('heic2any')).default;
    const converted = await heic2any({ blob, toType: 'image/jpeg', quality: 0.8 });
    return (Array.isArray(converted) ? converted[0] : converted) as Blob;
};

function isHeicContentType(contentType: string): boolean {
    const ct = (contentType || '').toLowerCase();
    return ct.includes('heic') || ct.includes('heif');
}

function getScreenshotPreviewErrorMessage(error: unknown): string {
    if (error instanceof Error && /^HTTP\s+\d+/i.test(error.message)) {
        return 'Screenshot unavailable';
    }
    return 'Failed to load screenshot';
}

async function mapWithConcurrency<T, R>(
    items: T[],
    concurrency: number,
    mapper: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
    const results: PromiseSettledResult<R>[] = new Array(items.length);
    let nextIndex = 0;
    const workerCount = Math.max(1, Math.min(concurrency, items.length));

    await Promise.all(Array.from({ length: workerCount }, async () => {
        while (nextIndex < items.length) {
            const index = nextIndex;
            nextIndex += 1;
            try {
                results[index] = { status: 'fulfilled', value: await mapper(items[index]) };
            } catch (reason) {
                results[index] = { status: 'rejected', reason };
            }
        }
    }));

    return results;
}

function drawTouchHeatmap(
    canvas: HTMLCanvasElement,
    container: HTMLElement,
    touchHotspots: HeatmapHotspot[]
): void {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = container.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));

    canvas.width = width;
    canvas.height = height;

    ctx.clearRect(0, 0, width, height);

    if (!touchHotspots || touchHotspots.length === 0) return;

    const maxHotspotIntensity = Math.max(1, ...touchHotspots.map((h) => h.intensity));
    const baseRadius = Math.max(44, Math.min(width, height) * 0.24);

    const scale = 2;
    const w = Math.max(1, Math.floor(width / scale));
    const h = Math.max(1, Math.floor(height / scale));

    const intensityMap: number[][] = Array.from({ length: h }, () => new Array(w).fill(0));

    for (const hotspot of touchHotspots) {
        const centerX = Math.floor(hotspot.x * w);
        const centerY = Math.floor(hotspot.y * h);
        const weight = hotspot.intensity / maxHotspotIntensity;

        const radius = Math.max(16, baseRadius / scale);
        const minX = Math.max(0, Math.floor(centerX - radius));
        const maxX = Math.min(w - 1, Math.ceil(centerX + radius));
        const minY = Math.max(0, Math.floor(centerY - radius));
        const maxY = Math.min(h - 1, Math.ceil(centerY + radius));

        for (let y = minY; y <= maxY; y++) {
            for (let x = minX; x <= maxX; x++) {
                const dx = x - centerX;
                const dy = y - centerY;
                const distSquared = dx * dx + dy * dy;
                const radiusSquared = radius * radius;
                if (distSquared <= radiusSquared) {
                    const sigma = radius * 0.28;
                    const falloff = Math.exp(-distSquared / (2 * sigma * sigma));
                    intensityMap[y][x] += weight * falloff;
                }
            }
        }
    }

    let maxIntensity = 0;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            if (intensityMap[y][x] > maxIntensity) maxIntensity = intensityMap[y][x];
        }
    }
    if (maxIntensity <= 0) return;

    const offscreen = document.createElement('canvas');
    offscreen.width = w;
    offscreen.height = h;
    const offCtx = offscreen.getContext('2d');
    if (!offCtx) return;

    const imageData = offCtx.createImageData(w, h);
    const data = imageData.data;

    const getHeatmapColor = (t: number): [number, number, number, number] => {
        if (t < 0.015) return [0, 0, 0, 0];
        if (t < 0.2) {
            const s = (t - 0.015) / 0.185;
            const a = Math.round(110 + s * 75);
            return [Math.round(34 + s * 69), Math.round(211 + s * 21), Math.round(238 + s * 11), a];
        }
        if (t < 0.45) {
            const s = (t - 0.2) / 0.25;
            const a = Math.round(190 + s * 35);
            return [Math.round(103 + s * 93), Math.round(232 - s * 51), Math.round(249 + s * 4), a];
        }
        if (t < 0.75) {
            const s = (t - 0.45) / 0.3;
            const a = Math.round(225 + s * 20);
            return [Math.round(196 + s * 53), Math.round(181 - s * 13), Math.round(253 - s * 41), a];
        }
        const s = (t - 0.75) / 0.25;
        return [Math.round(249 + s * 2), Math.round(168 - s * 55), Math.round(212 - s * 79), 255];
    };

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const normalized = Math.min(1, intensityMap[y][x] / maxIntensity);
            const t = Math.pow(normalized, 0.62);
            const [r, g, b, a] = getHeatmapColor(t);
            const idx = (y * w + x) * 4;
            data[idx] = r;
            data[idx + 1] = g;
            data[idx + 2] = b;
            data[idx + 3] = a;
        }
    }

    offCtx.putImageData(imageData, 0, 0);

    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(offscreen, 0, 0, width, height);
}

type HeatmapHotspot = { x: number; y: number; intensity: number; isRageTap: boolean };
type SignalType = 'rage_taps' | 'errors' | 'exits' | 'mixed';
type ConfidenceType = 'high' | 'medium' | 'low';
type PriorityType = 'critical' | 'high' | 'watch';
type HeatmapViewerMode = 'auto' | 'web' | 'mobile';
type ResolvedHeatmapViewer = Exclude<HeatmapViewerMode, 'auto'>;

interface PreviewHeatmapScreen {
    name: string;
    screenshotUrl: string | null;
    screenFirstSeenMs?: number | null;
    touchHotspots?: HeatmapHotspot[];
    evidenceSessionId?: string | null;
    platform?: string | null;
    pageWidth?: number | null;
    pageHeight?: number | null;
    viewportWidth?: number | null;
    viewportHeight?: number | null;
}

interface EnrichedHeatmapScreen extends AlltimeHeatmapScreen {
    rangeVisits: number;
    rangeRageTaps: number;
    rangeErrors: number;
    rangeExitRate: number;
    rangeFrictionScore: number;
    rangeImpactScore: number;
    rangeRageTapRatePer100: number;
    rangeErrorRatePer100: number;
    rangeIncidentRatePer100: number;
    rangeEstimatedAffectedSessions: number;
    primarySignal: SignalType;
    confidence: ConfidenceType;
    priority: PriorityType;
    evidenceSessionId: string | null;
    platform?: string | null;
}

type VersionHeatmapScreen = HeatmapIterationScreen & {
    touchHotspots?: HeatmapHotspot[];
};

type VersionHeatmapGroup = Omit<HeatmapIterationVersion, 'screens'> & {
    screens: VersionHeatmapScreen[];
};

const clampUnit = (value: number) => Math.max(0.04, Math.min(0.96, value));

function findBrewCoffeeFrameAt(timestamp: number): { timestamp: number; file: string; index: number } | null {
    const frames = brewCoffeeReplayFixture.screenshotFrames || [];
    if (frames.length === 0) return null;

    let best = frames[0];
    let bestDistance = Math.abs(best.timestamp - timestamp);
    for (const frame of frames) {
        const distance = Math.abs(frame.timestamp - timestamp);
        if (distance < bestDistance) {
            best = frame;
            bestDistance = distance;
        }
    }
    return best;
}

function latestBrewCoffeeScreenAt(timestamp: number, navigationEvents: any[]): string | null {
    let current: string | null = null;
    for (const event of navigationEvents) {
        if (event.timestamp > timestamp) break;
        current = event.screenName || event.screen || event.viewId || current;
    }
    return current;
}

function buildBrewCoffeeHotspots(events: any[], width: number, height: number): HeatmapHotspot[] {
    const buckets = new Map<string, {
        xTotal: number;
        yTotal: number;
        weight: number;
        isRageTap: boolean;
    }>();

    for (const event of events) {
        if (typeof event.x !== 'number' || typeof event.y !== 'number') continue;
        const normalizedX = clampUnit(event.x / width);
        const normalizedY = clampUnit(event.y / height);
        const isRageTap = event.frustrationKind === 'rage_tap' || event.gestureType === 'rage_tap';
        const weight = event.type === 'touch' ? 1.35 : event.gestureType === 'swipe' ? 1.05 : 0.72;
        const bucketX = Math.round(normalizedX / 0.055);
        const bucketY = Math.round(normalizedY / 0.055);
        const key = `${bucketX}:${bucketY}:${isRageTap ? 'rage' : 'touch'}`;
        const current = buckets.get(key) || { xTotal: 0, yTotal: 0, weight: 0, isRageTap };
        current.xTotal += normalizedX * weight;
        current.yTotal += normalizedY * weight;
        current.weight += weight;
        current.isRageTap ||= isRageTap;
        buckets.set(key, current);
    }

    const maxWeight = Math.max(1, ...Array.from(buckets.values()).map((bucket) => bucket.weight));
    return Array.from(buckets.values())
        .map((bucket) => ({
            x: bucket.xTotal / Math.max(bucket.weight, 1),
            y: bucket.yTotal / Math.max(bucket.weight, 1),
            intensity: Number((0.24 + (bucket.weight / maxWeight) * 0.76).toFixed(3)),
            isRageTap: bucket.isRageTap,
        }))
        .sort((a, b) => b.intensity - a.intensity)
        .slice(0, 18);
}

function buildBrewCoffeeDemoHeatmaps(): { screens: EnrichedHeatmapScreen[]; screenIteration: HeatmapIterationSummary } {
    const sessionId = brewCoffeeReplayFixture.sessionId;
    const width = brewCoffeeReplayFixture.deviceInfo.screenWidth || 393;
    const height = brewCoffeeReplayFixture.deviceInfo.screenHeight || 852;
    const navigationEvents = brewCoffeeReplayFixture.events
        .filter((event: any) => event.type === 'navigation' && (event.screenName || event.screen || event.viewId))
        .sort((a: any, b: any) => a.timestamp - b.timestamp);

    const eventsByScreen = new Map<string, any[]>();
    for (const event of brewCoffeeReplayFixture.events) {
        if (event.type !== 'touch' && event.type !== 'gesture') continue;
        const screenName = latestBrewCoffeeScreenAt(event.timestamp, navigationEvents);
        if (!screenName) continue;
        const list = eventsByScreen.get(screenName) || [];
        list.push(event);
        eventsByScreen.set(screenName, list);
    }

    const mobileScreens = navigationEvents
        .filter((event: any, index: number, events: any[]) => events.findIndex((candidate: any) => candidate.screenName === event.screenName) === index)
        .map((event: any, index: number): EnrichedHeatmapScreen => {
            const name = event.screenName || event.screen || event.viewId;
            const screenEvents = eventsByScreen.get(name) || [];
            const touchHotspots = buildBrewCoffeeHotspots(screenEvents, width, height);
            const rageTaps = screenEvents.filter((screenEvent) => screenEvent.frustrationKind === 'rage_tap' || screenEvent.gestureType === 'rage_tap').length;
            const touches = Math.max(1, screenEvents.length);
            const rangeVisits = Math.max(180, Math.round(touches * (index === 0 ? 7.2 : 5.8)));
            const totalVisits = Math.round(rangeVisits * 3.4);
            const exitRate = index === 0 ? 14.8 : 9.6;
            const frictionScore = Math.min(100, Math.round(18 + touchHotspots.length * 2.4 + rageTaps * 8 + index * 7));
            const frame = findBrewCoffeeFrameAt(event.timestamp);

            return {
                name,
                visits: totalVisits,
                rageTaps,
                errors: 0,
                exitRate,
                frictionScore,
                screenshotUrl: frame ? `/demo/${sessionId}/frames/${frame.file}` : null,
                sessionIds: [sessionId],
                screenFirstSeenMs: event.timestamp,
                touchHotspots,
                rangeVisits,
                rangeRageTaps: rageTaps,
                rangeErrors: 0,
                rangeExitRate: exitRate,
                rangeFrictionScore: frictionScore,
                rangeImpactScore: Math.min(100, Math.round(frictionScore + touches / 7)),
                rangeRageTapRatePer100: Number(((rageTaps / rangeVisits) * 100).toFixed(1)),
                rangeErrorRatePer100: 0,
                rangeIncidentRatePer100: Number(((rageTaps / rangeVisits) * 100).toFixed(1)),
                rangeEstimatedAffectedSessions: Math.max(1, Math.round(rangeVisits * Math.max(0.04, rageTaps / Math.max(touches, 1)))),
                primarySignal: rageTaps > 0 ? 'rage_taps' : 'mixed',
                confidence: touchHotspots.length >= 8 ? 'high' : 'medium',
                priority: frictionScore >= 42 ? 'high' : 'watch',
                evidenceSessionId: sessionId,
                platform: 'ios',
            };
        })
        .filter((screen) => (screen.touchHotspots?.length || 0) > 0)
        .sort((a, b) => b.rangeImpactScore - a.rangeImpactScore);

    const webScreens: EnrichedHeatmapScreen[] = [{
        name: '/pricing',
        visits: 3240,
        rageTaps: 38,
        errors: 7,
        exitRate: 18.6,
        frictionScore: 142,
        screenshotUrl: null,
        sessionIds: ['demo-web-session-001'],
        screenFirstSeenMs: Number(brewCoffeeReplayFixture.startTime) + 12_000,
        touchHotspots: [
            { x: 0.78, y: 0.08, intensity: 0.72, isRageTap: false },
            { x: 0.36, y: 0.18, intensity: 0.88, isRageTap: false },
            { x: 0.68, y: 0.31, intensity: 0.66, isRageTap: false },
            { x: 0.54, y: 0.48, intensity: 1, isRageTap: true },
            { x: 0.42, y: 0.62, intensity: 0.74, isRageTap: false },
            { x: 0.72, y: 0.79, intensity: 0.82, isRageTap: true },
            { x: 0.5, y: 0.91, intensity: 0.58, isRageTap: false },
        ],
        rangeVisits: 940,
        rangeRageTaps: 38,
        rangeErrors: 7,
        rangeExitRate: 18.6,
        rangeFrictionScore: 142,
        rangeImpactScore: 128,
        rangeRageTapRatePer100: 4,
        rangeErrorRatePer100: 0.7,
        rangeIncidentRatePer100: 23.3,
        rangeEstimatedAffectedSessions: 175,
        primarySignal: 'exits',
        confidence: 'high',
        priority: 'critical',
        evidenceSessionId: null,
        platform: 'web',
        pageWidth: 1440,
        pageHeight: 4200,
        viewportWidth: 1440,
        viewportHeight: 900,
    }];

    const screens = [...mobileScreens, ...webScreens].sort((a, b) => b.rangeImpactScore - a.rangeImpactScore);

    const versionScreens: HeatmapIterationScreen[] = screens.map((screen) => ({
        name: screen.name,
        screenshotUrl: screen.screenshotUrl,
        screenFirstSeenMs: screen.screenFirstSeenMs,
        visits: screen.rangeVisits,
        touches: eventsByScreen.get(screen.name)?.length || screen.rangeVisits,
        rageTaps: screen.rangeRageTaps,
        errors: screen.rangeErrors,
        incidentRatePer100: screen.rangeIncidentRatePer100,
        lastSeenAt: new Date(brewCoffeeReplayFixture.endTime).toISOString(),
        evidenceSessionId: screen.evidenceSessionId,
        touchHotspots: screen.touchHotspots,
    }));

    return {
        screens,
        screenIteration: {
            overall: versionScreens,
            versions: [{
                appVersion: brewCoffeeReplayFixture.deviceInfo.appVersion || '2.1.1',
                firstSeenAt: new Date(brewCoffeeReplayFixture.startTime).toISOString(),
                lastSeenAt: new Date(brewCoffeeReplayFixture.endTime).toISOString(),
                sessions: 1,
                screens: versionScreens,
            }],
        },
    };
}

function getInsightsRangeFromTimeFilter(timeRange: TimeRange): string {
    if (timeRange === 'all') return 'all';
    return timeRange;
}

function isLikelyWebScreenName(screenName: string): boolean {
    const name = screenName.trim();
    if (!name) return false;
    return (
        name === '/'
        || name.startsWith('/')
        || /^https?:\/\//i.test(name)
        || /^[a-z]+:\/\//i.test(name)
        || /[?#]/.test(name)
    );
}

function resolveHeatmapViewer(
    screen: PreviewHeatmapScreen,
    viewerMode: HeatmapViewerMode,
    projectPlatforms: string[] = [],
): ResolvedHeatmapViewer {
    if (viewerMode === 'web' || viewerMode === 'mobile') return viewerMode;

    const screenPlatform = screen.platform?.toLowerCase();
    if (screenPlatform === 'web') return 'web';
    if (screenPlatform === 'ios' || screenPlatform === 'android') return 'mobile';

    const normalizedPlatforms = projectPlatforms.map((platform) => platform.toLowerCase());
    const isWebOnlyProject = normalizedPlatforms.includes('web') && normalizedPlatforms.every((platform) => platform === 'web');
    if (isWebOnlyProject || isLikelyWebScreenName(screen.name)) return 'web';

    return 'mobile';
}

function getDisplayRoute(screenName: string): string {
    const trimmed = screenName.trim();
    if (!trimmed) return '/';
    if (/^https?:\/\//i.test(trimmed)) {
        try {
            const url = new URL(trimmed);
            return `${url.pathname}${url.search}`;
        } catch {
            return trimmed;
        }
    }
    return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

function compareVersionLabels(a: string, b: string): number {
    const normalize = (value: string) => value.trim().toLowerCase();
    const aNormalized = normalize(a);
    const bNormalized = normalize(b);
    if (aNormalized === 'unknown') return bNormalized === 'unknown' ? 0 : 1;
    if (bNormalized === 'unknown') return -1;

    const toParts = (value: string) => (value.match(/\d+|[a-z]+/gi) || [value]).map((part) => {
        const numeric = Number(part);
        return Number.isFinite(numeric) && /^\d+$/.test(part) ? numeric : part.toLowerCase();
    });

    const aParts = toParts(aNormalized);
    const bParts = toParts(bNormalized);
    const length = Math.max(aParts.length, bParts.length);

    for (let index = 0; index < length; index += 1) {
        const left = aParts[index] ?? 0;
        const right = bParts[index] ?? 0;
        if (left === right) continue;
        if (typeof left === 'number' && typeof right === 'number') return left - right;
        return String(left).localeCompare(String(right), undefined, { numeric: true });
    }

    return aNormalized.localeCompare(bNormalized, undefined, { numeric: true });
}

const formatCompactCount = (value: number): string => {
    if (!Number.isFinite(value)) return '0';
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
    if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
    return Math.round(value).toLocaleString();
};

const getPositiveMetric = (value: number | null | undefined): number | null => (
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
);

function getHeatmapFrameDimensions(screen: PreviewHeatmapScreen, isWebViewer: boolean) {
    if (!isWebViewer) {
        const viewportWidth = getPositiveMetric(screen.viewportWidth) ?? 393;
        const viewportHeight = getPositiveMetric(screen.viewportHeight) ?? 852;
        return {
            pageWidth: viewportWidth,
            pageHeight: viewportHeight,
            viewportWidth,
            viewportHeight,
            pageRatio: viewportHeight / viewportWidth,
            viewportPercent: 100,
            hasFullPageMeta: false,
        };
    }

    const viewportWidth = getPositiveMetric(screen.viewportWidth) ?? 1440;
    const viewportHeight = getPositiveMetric(screen.viewportHeight) ?? 900;
    const rawPageWidth = getPositiveMetric(screen.pageWidth) ?? viewportWidth;
    const rawPageHeight = getPositiveMetric(screen.pageHeight) ?? Math.max(viewportHeight, Math.round(viewportHeight * 1.65));
    const hasFullPageMeta = rawPageHeight > viewportHeight * 1.08;
    const pageRatio = Math.max(1.05, Math.min(5.5, rawPageHeight / Math.max(rawPageWidth, 1)));
    const pageWidth = rawPageWidth;
    const pageHeight = Math.round(pageWidth * pageRatio);
    const viewportPercent = Math.max(8, Math.min(100, (viewportHeight / Math.max(pageHeight, 1)) * 100));

    return {
        pageWidth,
        pageHeight,
        viewportWidth,
        viewportHeight,
        pageRatio,
        viewportPercent,
        hasFullPageMeta,
    };
}

function buildViewportGuideStops(pageHeight: number, viewportHeight: number): number[] {
    if (pageHeight <= 0 || viewportHeight <= 0 || pageHeight <= viewportHeight * 1.25) return [];
    const count = Math.min(12, Math.floor(pageHeight / viewportHeight));
    return Array.from({ length: count }, (_, index) => ((index + 1) * viewportHeight / pageHeight) * 100)
        .filter((position) => position > 0 && position < 98);
}

const WEB_DOCUMENT_SECTION_TOPS = [12, 28, 45, 63, 80];

const HeatmapPreview: React.FC<{
    screen: PreviewHeatmapScreen;
    compact?: boolean;
    tile?: boolean;
    showLegend?: boolean;
    viewerMode?: HeatmapViewerMode;
    projectPlatforms?: string[];
}> = ({ screen, compact = false, tile = false, showLegend = true, viewerMode = 'auto', projectPlatforms = [] }) => {
    const [blobUrl, setBlobUrl] = useState<string | null>(null);
    const [imageLoaded, setImageLoaded] = useState(false);
    const [imageNaturalSize, setImageNaturalSize] = useState<{ width: number; height: number } | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [downloadProgress, setDownloadProgress] = useState(0);

    const containerRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const blobUrlRef = useRef<string | null>(null);

    const resolvedViewer = resolveHeatmapViewer(screen, viewerMode, projectPlatforms);
    const isWebViewer = resolvedViewer === 'web';
    const frameDimensions = getHeatmapFrameDimensions(screen, isWebViewer);
    const viewportGuideStops = useMemo(
        () => isWebViewer && !tile
            ? buildViewportGuideStops(frameDimensions.pageHeight, frameDimensions.viewportHeight)
            : [],
        [frameDimensions.pageHeight, frameDimensions.viewportHeight, isWebViewer, tile],
    );
    const fullCoverUrl = screen.screenshotUrl
        ? screen.screenshotUrl.startsWith('http')
            ? screen.screenshotUrl
            : `${API_BASE_URL}${screen.screenshotUrl}`
        : null;

    useEffect(() => {
        let cancelled = false;
        const fetchStartedAt = Date.now();
        setLoadError(null);
        setImageLoaded(false);
        setImageNaturalSize(null);
        setDownloadProgress(0);

        heatmapDebug('HeatmapPreview effect start', {
            screenName: screen.name,
            compact,
            screenshotUrl: screen.screenshotUrl,
            fullCoverUrl,
            hotspotCount: screen.touchHotspots?.length ?? 0,
            evidenceSessionId: screen.evidenceSessionId,
        });

        if (blobUrlRef.current) {
            heatmapDebug('Revoking previous blob URL before loading next screenshot', {
                screenName: screen.name,
                previousBlobUrl: blobUrlRef.current,
            });
            URL.revokeObjectURL(blobUrlRef.current);
            blobUrlRef.current = null;
        }
        setBlobUrl(null);

        if (!fullCoverUrl) {
            heatmapDebug('Skipping screenshot fetch because no screenshot URL is available', {
                screenName: screen.name,
                screenshotUrl: screen.screenshotUrl,
            });
            return () => undefined;
        }

        const csrfToken = getCsrfToken() || '';
        const fetchUrl = fullCoverUrl;

        const fetchWithProgress = async () => {
            heatmapDebug('Fetching screenshot blob', {
                screenName: screen.name,
                fetchUrl,
                csrfTokenPresent: Boolean(csrfToken),
                requestedAt: new Date(fetchStartedAt).toISOString(),
            });

            const response = await fetch(fetchUrl, {
                credentials: 'include',
                headers: { Accept: 'image/*', 'X-CSRF-Token': csrfToken },
            });

            heatmapDebug('Screenshot fetch response received', {
                screenName: screen.name,
                fetchUrl,
                status: response.status,
                statusText: response.statusText,
                ok: response.ok,
                contentType: response.headers.get('Content-Type'),
                contentLength: response.headers.get('Content-Length'),
                cacheControl: response.headers.get('Cache-Control'),
            });

            if (!response.ok) {
                const responseText = await response.text().catch(() => '');
                console.error(`${TOUCH_HEATMAP_DEBUG_PREFIX} Screenshot fetch failed`, {
                    screenName: screen.name,
                    fetchUrl,
                    status: response.status,
                    statusText: response.statusText,
                    responseText,
                });
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const contentLength = +(response.headers.get('Content-Length') || 0);
            const contentType = response.headers.get('Content-Type') || '';

            if (!response.body) {
                const blob = await response.blob();
                return { blob, contentType };
            }

            const reader = response.body.getReader();
            const chunks: ArrayBuffer[] = [];
            let receivedLength = 0;
            let lastLoggedProgress = -1;

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                if (!value) continue;
                const chunk = new Uint8Array(value.byteLength);
                chunk.set(value);
                chunks.push(chunk.buffer);
                receivedLength += value.length;
                if (contentLength > 0) {
                    const progress = Math.round((receivedLength / contentLength) * 100);
                    setDownloadProgress(progress);
                    if (progress >= lastLoggedProgress + 20 || progress === 100) {
                        lastLoggedProgress = progress;
                        heatmapDebug('Screenshot download progress', {
                            screenName: screen.name,
                            fetchUrl,
                            progress,
                            receivedLength,
                            contentLength,
                        });
                    }
                }
            }

            heatmapDebug('Screenshot download complete', {
                screenName: screen.name,
                fetchUrl,
                totalBytes: receivedLength,
                contentType,
                durationMs: Date.now() - fetchStartedAt,
            });

            return { blob: new Blob(chunks), contentType };
        };

        fetchWithProgress()
            .then(async (result) => {
                if (!result || cancelled) return;
                const { blob, contentType } = result;

                heatmapDebug('Screenshot blob ready', {
                    screenName: screen.name,
                    fetchUrl,
                    blobSize: blob.size,
                    blobType: blob.type,
                    contentType,
                });

                if (blob.size === 0) {
                    console.error(`${TOUCH_HEATMAP_DEBUG_PREFIX} Empty image blob received`, {
                        screenName: screen.name,
                        fetchUrl,
                        contentType,
                    });
                    setLoadError('Empty image received');
                    return;
                }

                let displayBlob = blob;
                if (isHeicContentType(contentType)) {
                    try {
                        heatmapDebug('Converting HEIC screenshot to JPEG', {
                            screenName: screen.name,
                            fetchUrl,
                            blobSize: blob.size,
                            contentType,
                        });
                        displayBlob = await convertHeic(blob);
                        heatmapDebug('HEIC conversion complete', {
                            screenName: screen.name,
                            fetchUrl,
                            convertedSize: displayBlob.size,
                            convertedType: displayBlob.type,
                        });
                    } catch {
                        console.error(`${TOUCH_HEATMAP_DEBUG_PREFIX} HEIC conversion failed`, {
                            screenName: screen.name,
                            fetchUrl,
                            contentType,
                        });
                        if (!cancelled) setLoadError('HEIC conversion failed');
                        return;
                    }
                }

                if (cancelled) return;
                const objectUrl = URL.createObjectURL(displayBlob);
                blobUrlRef.current = objectUrl;
                setBlobUrl(objectUrl);
                heatmapDebug('Created object URL for screenshot preview', {
                    screenName: screen.name,
                    fetchUrl,
                    objectUrl,
                    finalBlobSize: displayBlob.size,
                    durationMs: Date.now() - fetchStartedAt,
                });
            })
            .catch((error: unknown) => {
                if (cancelled) return;
                console.error(`${TOUCH_HEATMAP_DEBUG_PREFIX} Screenshot preview pipeline failed`, {
                    screenName: screen.name,
                    fetchUrl,
                    error,
                    durationMs: Date.now() - fetchStartedAt,
                });
                if (error instanceof Error) {
                    setLoadError(getScreenshotPreviewErrorMessage(error));
                    return;
                }
                setLoadError(getScreenshotPreviewErrorMessage(error));
            });

        return () => {
            cancelled = true;
            heatmapDebug('HeatmapPreview cleanup', {
                screenName: screen.name,
                fetchUrl,
                durationMs: Date.now() - fetchStartedAt,
            });
            if (blobUrlRef.current) {
                URL.revokeObjectURL(blobUrlRef.current);
                blobUrlRef.current = null;
            }
        };
    }, [fullCoverUrl]);

    useEffect(() => {
        const canvas = canvasRef.current;
        const container = containerRef.current;
        if (!canvas || !container) return;

        const draw = () => drawTouchHeatmap(canvas, container, screen.touchHotspots || []);
        draw();

        window.addEventListener('resize', draw);
        return () => window.removeEventListener('resize', draw);
    }, [screen.touchHotspots, imageLoaded, blobUrl]);

    const topDots = useMemo(
        () => [...(screen.touchHotspots || [])].sort((a, b) => b.intensity - a.intensity).slice(0, 10),
        [screen.touchHotspots],
    );

    const displayRoute = getDisplayRoute(screen.name);
    const documentAspectStyle = isWebViewer
        ? { aspectRatio: `${frameDimensions.pageWidth} / ${frameDimensions.pageHeight}` }
        : undefined;
    const tileAspectStyle = isWebViewer ? { aspectRatio: '5 / 6' } : undefined;
    const imageRatio = imageNaturalSize ? imageNaturalSize.height / Math.max(imageNaturalSize.width, 1) : null;
    const useImageAsFullDocument = !isWebViewer || !imageRatio || Math.abs(imageRatio - frameDimensions.pageRatio) < 0.5 || !frameDimensions.hasFullPageMeta;
    const firstViewportImageStyle = isWebViewer && !useImageAsFullDocument
        ? { height: `${frameDimensions.viewportPercent}%` }
        : undefined;
    const widthClass = tile
        ? isWebViewer
            ? 'w-full'
            : 'w-full'
        : `mx-auto w-full ${isWebViewer ? 'max-w-[760px]' : compact ? 'max-w-[310px]' : 'max-w-[360px]'}`;
    const frameClass = isWebViewer
        ? 'heatmap-browser-frame heatmap-web-document-frame overflow-hidden rounded-xl border-2 border-black bg-white shadow-neo'
        : 'heatmap-phone-frame rounded-[28px] border-2 border-black bg-black p-3 shadow-neo';
    const screenClass = isWebViewer
        ? 'heatmap-browser-screen heatmap-web-document-screen relative overflow-hidden bg-white'
        : 'heatmap-phone-screen relative aspect-[9/19] overflow-hidden rounded-[24px] bg-slate-800';
    const tileScreenClass = isWebViewer
        ? 'heatmap-tile-screen heatmap-web-tile-screen heatmap-web-document-tile relative overflow-hidden rounded-lg border-2 border-black bg-white shadow-neo-sm'
        : 'heatmap-tile-screen relative mx-auto aspect-[9/19] max-h-[500px] w-full max-w-[184px] overflow-hidden rounded-2xl border-2 border-black bg-slate-800 shadow-neo-sm';
    const imageFitClass = isWebViewer && useImageAsFullDocument ? 'object-cover' : isWebViewer ? 'object-cover' : 'object-cover';
    const placeholderClass = isWebViewer
        ? 'bg-transparent'
        : 'bg-[#111827]';

    const previewInner = (
        <>
            {isWebViewer && (
                <div className="pointer-events-none absolute inset-0 bg-white">
                    <div
                        className="absolute inset-x-0 top-0 border-b border-slate-200 bg-[linear-gradient(90deg,rgba(148,163,184,0.16)_1px,transparent_1px),linear-gradient(rgba(148,163,184,0.16)_1px,transparent_1px)] bg-[length:32px_32px]"
                        style={{ height: `${frameDimensions.viewportPercent}%` }}
                    />
                    {WEB_DOCUMENT_SECTION_TOPS.map((top, index) => (
                        <span
                            key={`section-${top}`}
                            className={`absolute left-[7%] right-[7%] rounded-md ${index % 2 === 0 ? 'bg-slate-100' : 'bg-slate-50'}`}
                            style={{ top: `${top}%`, height: `${index === 0 ? 7 : index === 4 ? 10 : 8}%` }}
                        />
                    ))}
                    {viewportGuideStops.map((top) => (
                        <span
                            key={`viewport-${top.toFixed(2)}`}
                            className="absolute inset-x-0 border-t border-dashed border-slate-300/80"
                            style={{ top: `${top}%` }}
                        />
                    ))}
                </div>
            )}
            {blobUrl ? (
                <img
                    src={blobUrl}
                    alt={screen.name}
                    className={`${isWebViewer && !useImageAsFullDocument ? 'absolute inset-x-0 top-0 w-full' : 'absolute inset-0 h-full w-full'} ${imageFitClass} transition-opacity duration-200 ${imageLoaded ? 'opacity-95' : 'opacity-0'}`}
                    style={firstViewportImageStyle}
                    onLoad={(event) => {
                        heatmapDebug('Screenshot image element loaded successfully', {
                            screenName: screen.name,
                            blobUrl,
                        });
                        setImageLoaded(true);
                        setImageNaturalSize({
                            width: event.currentTarget.naturalWidth,
                            height: event.currentTarget.naturalHeight,
                        });
                    }}
                    onError={(event) => {
                        console.error(`${TOUCH_HEATMAP_DEBUG_PREFIX} Screenshot image element failed to render`, {
                            screenName: screen.name,
                            blobUrl,
                            currentSrc: event.currentTarget.currentSrc,
                        });
                        setLoadError('Failed to load image');
                    }}
                />
            ) : (
                <div className={`absolute ${isWebViewer ? 'inset-x-0 top-0' : 'inset-0'} flex flex-col items-center justify-center p-4 text-center ${placeholderClass}`} style={isWebViewer ? { height: `${frameDimensions.viewportPercent}%` } : undefined}>
                    {isWebViewer ? (
                        <Monitor className="mb-2 h-8 w-8 text-[#67e8f9]" />
                    ) : (
                        <MousePointer2 className="mb-2 h-8 w-8 text-[#67e8f9]" />
                    )}
                    <p className="text-xs font-black uppercase text-slate-200">{screen.name}</p>
                    {!loadError && downloadProgress > 0 && downloadProgress < 100 && (
                        <p className="mt-2 text-[11px] text-slate-400">Loading screenshot {downloadProgress}%</p>
                    )}
                    {loadError && <p className="mt-2 text-[11px] text-rose-300">{loadError}</p>}
                </div>
            )}

            {(screen.touchHotspots?.length || 0) > 0 && (
                <canvas
                    ref={canvasRef}
                    className="pointer-events-none absolute inset-0 h-full w-full"
                    style={{ mixBlendMode: 'normal', opacity: 0.96 }}
                />
            )}

            <div className="pointer-events-none absolute inset-0">
                {topDots.map((hotspot, index) => {
                    const size = 10 + (hotspot.intensity * 14);
                    return (
                        <span
                            key={`dot-${index}-${hotspot.x}-${hotspot.y}`}
                            className={`absolute rounded-full border border-white/50 ${hotspot.isRageTap ? 'bg-rose-500/60' : 'bg-cyan-400/55'}`}
                            style={{
                                left: `${hotspot.x * 100}%`,
                                top: `${hotspot.y * 100}%`,
                                width: `${size}px`,
                                height: `${size}px`,
                                transform: 'translate(-50%, -50%)',
                            }}
                        />
                    );
                })}
            </div>
        </>
    );

    return (
        <div className={`${widthClass} shrink-0`}>
            {tile ? (
                <div ref={containerRef} className={tileScreenClass} style={tileAspectStyle}>
                    {previewInner}
                </div>
            ) : (
                <div className={frameClass}>
                    {isWebViewer && (
                        <div className="heatmap-browser-chrome flex items-center gap-2 border-b border-black bg-[#f8fafd] px-3 py-2">
                            <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
                            <span className="h-2.5 w-2.5 rounded-full bg-[#ffbd2e]" />
                            <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
                            <span className="ml-2 min-w-0 flex-1 truncate rounded-md border border-[#dadce0] bg-white px-3 py-1 text-left text-[11px] font-semibold text-slate-600">
                                {displayRoute}
                            </span>
                        </div>
                    )}
                    <div ref={containerRef} className={screenClass} style={documentAspectStyle}>
                        {previewInner}
                    </div>
                </div>
            )}

            {showLegend && (
                <div className="mt-3 flex items-center justify-between text-[11px] font-bold text-slate-600">
                    <span>Low intensity</span>
                    <div className="mx-2 h-1.5 flex-1 border border-black bg-gradient-to-r from-[#67e8f9] via-[#c4b5fd] to-[#f472b6]" />
                    <span>High intensity</span>
                </div>
            )}
        </div>
    );
};

interface TouchHeatmapSectionProps {
    timeRange?: TimeRange;
    platform?: string;
    compact?: boolean;
    className?: string;
}

export const TouchHeatmapSection: React.FC<TouchHeatmapSectionProps> = ({
    timeRange = '30d',
    platform,
    compact = false,
    className = '',
}) => {
    const { selectedProject } = useSessionData();
    const { isDemoMode } = useDemoMode();

    const [screens, setScreens] = useState<EnrichedHeatmapScreen[]>([]);
    const [screenIteration, setScreenIteration] = useState<HeatmapIterationSummary | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [lastUpdated, setLastUpdated] = useState('');
    const [partialError, setPartialError] = useState<string | null>(null);

    useEffect(() => {
        if (isDemoMode) {
            const { screens: demoScreens, screenIteration: demoScreenIteration } = buildBrewCoffeeDemoHeatmaps();
            setScreens(demoScreens);
            setScreenIteration(demoScreenIteration);
            setLastUpdated(new Date().toISOString());
            setPartialError(null);
            setIsLoading(false);
            return;
        }

        if (!selectedProject?.id) {
            setScreens([]);
            setScreenIteration(null);
            setIsLoading(false);
            setLastUpdated('');
            setPartialError(null);
            return;
        }

        let cancelled = false;
        setIsLoading(true);
        setPartialError(null);

        const range = getInsightsRangeFromTimeFilter(timeRange);

        getHeatmapsOverview(selectedProject.id, range, platform)
            .then(async (overview) => {
                if (cancelled) return;

                heatmapDebug('Touch heatmap overview fetched', {
                    projectId: selectedProject.id,
                    timeRange,
                    platform: platform || 'all',
                    normalizedRange: range,
                    screenCount: overview.screens.length,
                    versionCount: overview.screenIteration?.versions.length ?? 0,
                    failedSections: overview.failedSections,
                });

                let mergedScreens = (overview.screens || [])
                    .filter((screen) => (
                        screen.rangeVisits > 0
                        || screen.rangeRageTaps > 0
                        || screen.rangeErrors > 0
                        || screen.rangeExitRate > 0
                        || (screen.touchHotspots?.length ?? 0) > 0
                    )) as EnrichedHeatmapScreen[];

                const screensNeedingHotspots = mergedScreens.filter((screen) => (screen.touchHotspots?.length ?? 0) === 0);
                if (screensNeedingHotspots.length > 0) {
                    const results = await mapWithConcurrency(
                        screensNeedingHotspots,
                        HEATMAP_DETAIL_FETCH_CONCURRENCY,
                        (screen) => getHeatmapScreenOverview(selectedProject.id, screen.name, range, platform),
                    );
                    if (cancelled) return;

                    const detailByName = new Map<string, EnrichedHeatmapScreen>();
                    for (const result of results) {
                        if (result.status !== 'fulfilled' || !result.value.screen) continue;
                        detailByName.set(result.value.screen.name, result.value.screen as EnrichedHeatmapScreen);
                    }
                    if (detailByName.size > 0) {
                        mergedScreens = mergedScreens.map((screen) => {
                            const detail = detailByName.get(screen.name);
                            if (!detail) return screen;
                            return {
                                ...screen,
                                ...detail,
                                touchHotspots: detail.touchHotspots?.length ? detail.touchHotspots : screen.touchHotspots,
                                screenshotUrl: detail.screenshotUrl ?? screen.screenshotUrl,
                                evidenceSessionId: detail.evidenceSessionId ?? screen.evidenceSessionId,
                            };
                        });
                    }
                }

                setScreens(mergedScreens);
                setScreenIteration(overview.screenIteration || null);
                setLastUpdated(overview.lastUpdated || '');

                if (overview.failedSections.length > 0) {
                    console.warn(`${TOUCH_HEATMAP_DEBUG_PREFIX} Partial touch heatmap data failure`, {
                        projectId: selectedProject.id,
                        failedSections: overview.failedSections,
                    });
                    setPartialError(`Some heatmap sources are unavailable (${overview.failedSections.join(', ')}).`);
                }
            })
            .catch((error) => {
                console.error(`${TOUCH_HEATMAP_DEBUG_PREFIX} Unexpected error while building touch heatmap state`, {
                    projectId: selectedProject.id,
                    timeRange,
                    platform: platform || 'all',
                    error,
                });
                if (!cancelled) setPartialError('Heatmap data unavailable.');
            })
            .finally(() => {
                if (!cancelled) setIsLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [selectedProject?.id, timeRange, platform, isDemoMode]);

    const sortedScreens = useMemo(() => (
        [...screens].sort((a, b) => {
            if (b.rangeImpactScore !== a.rangeImpactScore) return b.rangeImpactScore - a.rangeImpactScore;
            return b.rangeVisits - a.rangeVisits;
        })
    ), [screens]);

    const screenByName = useMemo(() => {
        const map = new Map<string, EnrichedHeatmapScreen>();
        for (const screen of sortedScreens) {
            map.set(screen.name, screen);
        }
        return map;
    }, [sortedScreens]);

    const iterationScreenByName = useMemo(() => {
        const map = new Map<string, VersionHeatmapScreen>();
        for (const screen of screenIteration?.overall || []) {
            map.set(screen.name, screen as VersionHeatmapScreen);
        }
        return map;
    }, [screenIteration?.overall]);

    const versionGroups = useMemo<VersionHeatmapGroup[]>(() => {
        const hydrateScreen = (screen: VersionHeatmapScreen): VersionHeatmapScreen => {
            const fallback = screenByName.get(screen.name);
            const iterationFallback = iterationScreenByName.get(screen.name);
            return {
                ...screen,
                screenshotUrl: screen.screenshotUrl ?? iterationFallback?.screenshotUrl ?? fallback?.screenshotUrl ?? null,
                screenFirstSeenMs: screen.screenFirstSeenMs ?? iterationFallback?.screenFirstSeenMs ?? fallback?.screenFirstSeenMs ?? null,
                evidenceSessionId: screen.evidenceSessionId ?? iterationFallback?.evidenceSessionId ?? fallback?.evidenceSessionId ?? null,
                pageWidth: screen.pageWidth ?? iterationFallback?.pageWidth ?? fallback?.pageWidth ?? null,
                pageHeight: screen.pageHeight ?? iterationFallback?.pageHeight ?? fallback?.pageHeight ?? null,
                viewportWidth: screen.viewportWidth ?? iterationFallback?.viewportWidth ?? fallback?.viewportWidth ?? null,
                viewportHeight: screen.viewportHeight ?? iterationFallback?.viewportHeight ?? fallback?.viewportHeight ?? null,
                touchHotspots: screen.touchHotspots?.length
                    ? screen.touchHotspots
                    : iterationFallback?.touchHotspots?.length
                        ? iterationFallback.touchHotspots
                        : fallback?.touchHotspots ?? [],
            };
        };

        const groups = (screenIteration?.versions || [])
            .filter((version) => version.screens.length > 0)
            .map((version) => ({
                ...version,
                screens: version.screens.map((screen) => hydrateScreen(screen as VersionHeatmapScreen)),
            }))
            .sort((a, b) => compareVersionLabels(a.appVersion, b.appVersion));

        if (groups.length > 0) return groups;

        return [{
            appVersion: 'All versions',
            firstSeenAt: null,
            lastSeenAt: lastUpdated || null,
            sessions: sortedScreens.reduce((sum, screen) => sum + screen.rangeVisits, 0),
            screens: sortedScreens.map((screen) => ({
                name: screen.name,
                screenshotUrl: screen.screenshotUrl,
                visits: screen.rangeVisits,
                touches: screen.visits,
                rageTaps: screen.rangeRageTaps,
                errors: screen.rangeErrors,
                incidentRatePer100: screen.rangeIncidentRatePer100,
                lastSeenAt: lastUpdated || null,
                evidenceSessionId: screen.evidenceSessionId,
                touchHotspots: screen.touchHotspots || [],
                pageWidth: screen.pageWidth ?? null,
                pageHeight: screen.pageHeight ?? null,
                viewportWidth: screen.viewportWidth ?? null,
                viewportHeight: screen.viewportHeight ?? null,
            })),
        }];
    }, [iterationScreenByName, lastUpdated, screenByName, screenIteration?.versions, sortedScreens]);

    const [selectedScreenName, setSelectedScreenName] = useState<string | null>(null);

    useEffect(() => {
        if (!sortedScreens.length) {
            setSelectedScreenName(null);
            return;
        }

        setSelectedScreenName((current) => {
            if (current && sortedScreens.some((screen) => screen.name === current)) return current;
            return sortedScreens[0].name;
        });
    }, [sortedScreens]);

    const selectedScreen = useMemo(
        () => sortedScreens.find((screen) => screen.name === selectedScreenName) || sortedScreens[0] || null,
        [selectedScreenName, sortedScreens],
    );

    const projectPlatforms = selectedProject?.platforms || [];
    const selectedViewer = selectedScreen ? resolveHeatmapViewer(selectedScreen, 'auto', projectPlatforms) : 'mobile';

    if (!selectedProject?.id && !isDemoMode) {
        return (
            <section className={`dashboard-surface p-6 ${className}`.trim()}>
                <p className="text-sm font-semibold text-slate-600">Select a project to view touch heatmaps.</p>
            </section>
        );
    }

    if (isLoading) {
        return (
            <section className={`dashboard-surface p-6 ${className}`.trim()}>
                <div className="flex items-center gap-3 text-sm font-black text-slate-900">
                    <MousePointer2 className="h-4 w-4 animate-pulse text-[#1a73e8]" />
                    Building interaction heatmaps...
                </div>
                <div className="mt-4 h-72 animate-pulse dashboard-inner-surface" />
            </section>
        );
    }

    if (!sortedScreens.length) {
        return (
            <section className={`dashboard-surface p-6 ${className}`.trim()}>
                <div className={`dashboard-inner-surface flex flex-col items-center justify-center border-dashed text-center ${compact ? 'min-h-[180px]' : 'min-h-[220px]'}`}>
                    <MousePointer2 className="mb-3 h-10 w-10 text-[#1a73e8]" />
                    <p className="text-sm font-black text-slate-900">No touch heatmap data available yet</p>
                    <p className="mt-1 text-xs font-semibold text-slate-600">Heatmaps populate after users interact with tracked screens.</p>
                    {partialError && (
                        <p className="mt-3 text-xs font-medium text-rose-700">{partialError}</p>
                    )}
                </div>
            </section>
        );
    }

    return (
        <section className={`heatmap-workspace space-y-5 ${className}`.trim()}>
            {partialError && (
                <div className="dashboard-surface border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800">
                    {partialError}
                </div>
            )}

            {selectedScreen && (
                <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
                    <div className="heatmap-focus-panel dashboard-surface min-w-0 overflow-hidden">
                        <div className="heatmap-panel-header flex flex-col gap-4 border-b border-slate-200 px-5 py-4">
                            <div className="min-w-0 flex-1">
                                <h2 className="truncate text-xl font-black text-slate-950" title={selectedScreen.name}>{selectedScreen.name}</h2>

                            </div>
                        </div>
                        <div className="heatmap-preview-stage px-4 py-5 sm:px-5">
                            <HeatmapPreview
                                screen={selectedScreen}
                                compact={compact}
                                showLegend
                                viewerMode="auto"
                                projectPlatforms={projectPlatforms}
                            />
                        </div>
                    </div>

                    <aside className="heatmap-priority-panel dashboard-surface overflow-hidden">
                        <div className="heatmap-panel-header border-b border-slate-200 px-4 py-3">
                            <h3 className="text-sm font-black text-slate-950">Priority {selectedViewer === 'web' ? 'Routes' : 'Screens'}</h3>
                            <p className="mt-1 text-xs font-medium text-slate-500">Sorted by impact, incident rate, and visit volume.</p>
                        </div>
                        <div className="max-h-[720px] overflow-y-auto p-2">
                            {sortedScreens.map((screen, index) => {
                                const selected = screen.name === selectedScreen.name;
                                return (
                                    <button
                                        key={screen.name}
                                        type="button"
                                        onClick={() => setSelectedScreenName(screen.name)}
                                        className={`heatmap-screen-row ${selected ? 'heatmap-screen-row-selected' : ''}`}
                                    >
                                        <span className="heatmap-screen-rank">{String(index + 1).padStart(2, '0')}</span>
                                        <span className="min-w-0 flex-1 text-left">
                                            <span className="block truncate text-sm font-black text-slate-900">{screen.name}</span>
                                            <span className="mt-0.5 block text-xs font-medium text-slate-500">
                                                {formatCompactCount(screen.rangeVisits)} visits / {screen.rangeIncidentRatePer100.toFixed(1)} incidents per 100
                                            </span>
                                        </span>
                                        <span className="heatmap-impact-score">{screen.rangeImpactScore.toFixed(0)}</span>
                                    </button>
                                );
                            })}
                        </div>
                    </aside>
                </div>
            )}

            <div className="heatmap-version-comparison dashboard-surface overflow-hidden">
                <div className="heatmap-panel-header flex flex-col gap-2 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h3 className="text-sm font-black text-slate-950">Version Trend</h3>
                        <p className="mt-1 text-xs font-medium text-slate-500">
                            {selectedScreen ? `${selectedScreen.name} across app versions.` : 'Compare the selected screen across app versions.'}
                        </p>
                    </div>
                    {lastUpdated && (
                        <span className="text-xs font-medium text-slate-500">
                            Updated {new Date(lastUpdated).toLocaleString()}
                        </span>
                    )}
                </div>
                <div className={`dashboard-mobile-scroll overflow-x-auto ${compact ? 'p-3' : 'p-4'}`}>
                    <div className="heatmap-version-strip flex min-w-max items-stretch gap-3">
                        {versionGroups.map((version, versionIndex) => {
                            const screen = version.screens.find((candidate) => candidate.name === selectedScreenName);
                            if (!screen) return null;
                            const isSelectedScreen = screen.name === selectedScreenName;

                            return (
                                <article
                                    key={`${version.appVersion}-${versionIndex}-${screen.name}`}
                                    className={`heatmap-version-card ${isSelectedScreen ? 'heatmap-version-card-selected' : ''}`}
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => setSelectedScreenName(screen.name)}
                                    onKeyDown={(event) => {
                                        if (event.key === 'Enter' || event.key === ' ') {
                                            event.preventDefault();
                                            setSelectedScreenName(screen.name);
                                        }
                                    }}
                                >
                                    <div className="heatmap-version-card-header">
                                        <strong>v{version.appVersion}</strong>
                                        <span>{formatCompactCount(version.sessions)} sessions</span>
                                    </div>
                                    <HeatmapPreview
                                        screen={screen}
                                        compact
                                        tile
                                        showLegend={false}
                                        viewerMode="auto"
                                        projectPlatforms={projectPlatforms}
                                    />
                                    <div className="heatmap-version-metrics">
                                        <span>{formatCompactCount(screen.visits)} visits</span>
                                        <span>{screen.incidentRatePer100.toFixed(1)} /100</span>
                                    </div>
                                </article>
                            );
                        })}
                    </div>
                </div>
            </div>
        </section>
    );
};
