import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    Activity,
    Eye,
    Layers3,
    ListFilter,
    Loader2,
    Monitor,
    MousePointer2,
    Smartphone,
} from 'lucide-react';
import { useSessionData } from '~/shared/providers/SessionContext';
import { useDemoMode } from '~/shared/providers/DemoModeContext';
import {
    getHeatmapsOverview,
    getHeatmapScreenOverview,
    getWebAttentionHeatmap,
    getSessionReplayManifest,
    type AlltimeHeatmapScreen,
    type ApiSessionReplayManifest,
    type HeatmapHotspot as ApiHeatmapHotspot,
    type HeatmapMode,
    type HeatmapIterationScreen,
    type HeatmapIterationSummary,
    type HeatmapIterationVersion,
    type WebAttentionHeatmapResponse,
} from '~/shared/api/client';
import { API_BASE_URL, getCsrfToken } from '~/shared/config/appConfig';
import { TimeRange } from '~/shared/ui/core/TimeFilter';
import { buildDemoHeatmapOverview } from '~/shared/data/demoHeatmapData';
import WebReplayPlayer from '~/shared/ui/core/WebReplayPlayer';
import { useRrwebReplayEvents } from '~/shared/lib/rrwebReplayLoader';
import { getAvailableHeatmapModes, getDefaultHeatmapMode } from './heatmapMode';

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

function toAbsoluteHeatmapImageUrl(url: string): string {
    if (/^(https?:|blob:|data:)/i.test(url)) return url;
    return `${API_BASE_URL}${url.startsWith('/') ? url : `/${url}`}`;
}

function addUniqueSessionId(target: string[], seen: Set<string>, sessionId: string | null | undefined): void {
    const normalized = sessionId?.trim();
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    target.push(normalized);
}

function getHeatmapEvidenceSessionIds(screen: PreviewHeatmapScreen): string[] {
    const ids: string[] = [];
    const seen = new Set<string>();

    addUniqueSessionId(ids, seen, screen.evidenceSessionId);
    for (const sessionId of screen.sessionIds || []) {
        addUniqueSessionId(ids, seen, sessionId);
    }

    const screenshotUrl = screen.screenshotUrl || '';
    const match = screenshotUrl.match(/\/api\/session\/(?:frame|thumbnail)\/([^/?#]+)/);
    if (match?.[1]) {
        try {
            addUniqueSessionId(ids, seen, decodeURIComponent(match[1]));
        } catch {
            addUniqueSessionId(ids, seen, match[1]);
        }
    }

    return ids;
}

function getPreferredHeatmapSessionId(screen: PreviewHeatmapScreen): string | null {
    return getHeatmapEvidenceSessionIds(screen)[0] ?? null;
}

function buildHeatmapImageUrlCandidates(screen: PreviewHeatmapScreen, isWebViewer: boolean): string[] {
    const candidates: string[] = [];
    const seen = new Set<string>();
    const addCandidate = (url: string | null | undefined) => {
        if (!url) return;
        const absoluteUrl = toAbsoluteHeatmapImageUrl(url);
        if (seen.has(absoluteUrl)) return;
        seen.add(absoluteUrl);
        candidates.push(absoluteUrl);
    };

    addCandidate(screen.screenshotUrl);

    const evidenceSessionIds = getHeatmapEvidenceSessionIds(screen);
    if (!isWebViewer) {
        const timestamp = Number(screen.screenFirstSeenMs);
        const roundedTimestamp = Number.isFinite(timestamp) && timestamp > 0
            ? Math.round(timestamp)
            : null;
        for (const sessionId of evidenceSessionIds.slice(0, 4)) {
            const encodedSessionId = encodeURIComponent(sessionId);
            if (roundedTimestamp) {
                addCandidate(`/api/session/frame/${encodedSessionId}/${roundedTimestamp}.jpg`);
                addCandidate(`/api/session/thumbnail/${encodedSessionId}?ts=${roundedTimestamp}`);
            }
            addCandidate(`/api/session/thumbnail/${encodedSessionId}`);
        }
    }

    return candidates;
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
    touchHotspots: HeatmapHotspot[],
    mode: HeatmapMode = 'touch',
    options: { fullWidthAttention?: boolean; fullScreenAttention?: boolean } = {},
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
    const isMobileAttention = mode === 'attention'
        && options.fullScreenAttention === true
        && options.fullWidthAttention === false;

    const scale = isMobileAttention ? 3 : 2;
    const w = Math.max(1, Math.floor(width / scale));
    const h = Math.max(1, Math.floor(height / scale));

    const intensityMap: number[][] = Array.from({ length: h }, () => new Array(w).fill(0));

    if (mode === 'attention' && options.fullWidthAttention !== false) {
        // Hotjar-style scroll/attention map: aggregate attention into a vertical profile and
        // wash the full width of each band so whole sections read as "colored in" rather than
        // isolated circular spots.
        const rowIntensity = new Array<number>(h).fill(0);
        const vSigma = Math.max(6, h * 0.045);
        const span = Math.ceil(vSigma * 3);

        for (const hotspot of touchHotspots) {
            const centerY = hotspot.y * h;
            const weight = hotspot.intensity / maxHotspotIntensity;
            const minY = Math.max(0, Math.floor(centerY - span));
            const maxY = Math.min(h - 1, Math.ceil(centerY + span));
            for (let y = minY; y <= maxY; y++) {
                const dy = y - centerY;
                rowIntensity[y] += weight * Math.exp(-(dy * dy) / (2 * vSigma * vSigma));
            }
        }

        for (let y = 0; y < h; y++) {
            const value = rowIntensity[y];
            const row = intensityMap[y];
            for (let x = 0; x < w; x++) {
                row[x] = value;
            }
        }
    } else {
        // Touch/click maps have fewer, broader spots. Mobile attention gets a wider two-pass
        // probability field: a local patch plus a soft parafoveal wash, so it reads like attention
        // over visible content instead of exact tap/fixation dots.
        const baseRadius = isMobileAttention
            ? Math.max(58, Math.min(width, height) * 0.23)
            : Math.max(44, Math.min(width, height) * 0.24);

        for (const hotspot of touchHotspots) {
            const centerX = Math.floor(hotspot.x * w);
            const centerY = Math.floor(hotspot.y * h);
            const weight = hotspot.intensity / maxHotspotIntensity;

            const radius = Math.max(16, baseRadius / scale);
            const broadRadius = isMobileAttention ? radius * 2.35 : radius;
            const minX = Math.max(0, Math.floor(centerX - broadRadius));
            const maxX = Math.min(w - 1, Math.ceil(centerX + broadRadius));
            const minY = Math.max(0, Math.floor(centerY - broadRadius));
            const maxY = Math.min(h - 1, Math.ceil(centerY + broadRadius));

            for (let y = minY; y <= maxY; y++) {
                for (let x = minX; x <= maxX; x++) {
                    const dx = x - centerX;
                    const dy = y - centerY;
                    const distSquared = dx * dx + dy * dy;
                    const radiusSquared = radius * radius;
                    if (distSquared <= broadRadius * broadRadius) {
                        const sigma = radius * (isMobileAttention ? 0.48 : 0.28);
                        const falloff = Math.exp(-distSquared / (2 * sigma * sigma));
                        if (distSquared <= radiusSquared) {
                            intensityMap[y][x] += weight * falloff;
                        }
                        if (isMobileAttention) {
                            const broadSigma = broadRadius * 0.5;
                            const broadFalloff = Math.exp(-distSquared / (2 * broadSigma * broadSigma));
                            intensityMap[y][x] += weight * broadFalloff * 0.34;
                        }
                    }
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

    let normalizationMax = maxIntensity;
    if (isMobileAttention) {
        const positiveValues: number[] = [];
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                if (intensityMap[y][x] > 0) positiveValues.push(intensityMap[y][x]);
            }
        }
        if (positiveValues.length > 0) {
            positiveValues.sort((a, b) => a - b);
            const percentileIndex = Math.min(positiveValues.length - 1, Math.floor(positiveValues.length * 0.985));
            normalizationMax = Math.max(positiveValues[percentileIndex], maxIntensity * 0.42, 0.0001);
        }
    }

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
            const normalized = Math.min(1, intensityMap[y][x] / normalizationMax);
            const visibleNormalized = isMobileAttention
                ? Math.max(0.09, normalized)
                : normalized;
            const t = Math.pow(visibleNormalized, isMobileAttention ? 0.86 : mode === 'attention' ? 0.95 : 0.62);
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

type HeatmapHotspot = ApiHeatmapHotspot;
type SignalType = 'rage_taps' | 'errors' | 'exits' | 'mixed';
type ConfidenceType = 'high' | 'medium' | 'low';
type PriorityType = 'critical' | 'high' | 'watch';
type HeatmapViewerMode = 'auto' | 'web' | 'mobile';
type ResolvedHeatmapViewer = Exclude<HeatmapViewerMode, 'auto'>;
type AttentionHoverState = {
    left: number;
    top: number;
    avgMs: number;
    pct: number | null;
    mode: ResolvedHeatmapViewer;
};

interface PreviewHeatmapScreen {
    name: string;
    screenshotUrl: string | null;
    sessionIds?: string[];
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

const formatDwellDuration = (ms: number): string => {
    const totalSeconds = Math.max(0, Math.round(ms / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};

const formatAttentionHoverDuration = (ms: number, mode: ResolvedHeatmapViewer): string => {
    if (mode === 'web') return formatDwellDuration(ms);
    if (!Number.isFinite(ms) || ms <= 0) return '0.0s';
    if (ms < 10_000) return `${Math.max(0.1, ms / 1000).toFixed(1)}s`;
    if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
    return formatDwellDuration(ms);
};

const formatHeatmapModeLabel = (mode: HeatmapMode, viewer: ResolvedHeatmapViewer): string => {
    if (viewer !== 'web') return mode === 'attention' ? 'Attention map' : 'Touch map';
    return mode === 'attention' ? 'Attention map' : 'Touch map';
};

function getHeatmapRouteMinimumVisits(screens: Array<Pick<EnrichedHeatmapScreen, 'rangeVisits'>>): number {
    const maxVisits = Math.max(0, ...screens.map((screen) => screen.rangeVisits || 0));
    if (maxVisits >= 500) return 5;
    if (maxVisits >= 100) return 3;
    return 1;
}

function isMeaningfulHeatmapScreen(screen: EnrichedHeatmapScreen, minVisits: number): boolean {
    const hotspotCount = screen.touchHotspots?.length ?? 0;
    const hasInteractionSignal = hotspotCount > 0 || screen.rangeRageTaps > 0 || screen.rangeErrors > 0;
    return screen.rangeVisits >= minVisits && (hasInteractionSignal || screen.rangeExitRate > 0);
}

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
            rawPageRatio: viewportHeight / viewportWidth,
            viewportPercent: 100,
            dataViewportFraction: 1,
            hasFullPageMeta: false,
        };
    }

    const viewportWidth = getPositiveMetric(screen.viewportWidth) ?? 1440;
    const viewportHeight = getPositiveMetric(screen.viewportHeight) ?? 900;
    const viewportRatio = viewportHeight / Math.max(viewportWidth, 1);
    const observedPageWidth = getPositiveMetric(screen.pageWidth);
    const observedPageHeight = getPositiveMetric(screen.pageHeight);
    const hasFullPageMeta = Boolean(
        observedPageWidth
        && observedPageHeight
        && observedPageHeight > viewportHeight * 1.08
    );
    const pageWidth = observedPageWidth ?? viewportWidth;
    const rawPageHeight = hasFullPageMeta
        ? observedPageHeight!
        : (observedPageHeight ?? viewportHeight);
    const rawPageRatio = rawPageHeight / Math.max(pageWidth, 1);
    const pageRatio = Math.max(viewportRatio, rawPageRatio);
    const pageHeight = Math.round(pageWidth * pageRatio);
    const dataViewportFraction = hasFullPageMeta
        ? Math.max(0.001, Math.min(1, viewportHeight / Math.max(rawPageHeight, 1)))
        : 1;
    const viewportPercent = hasFullPageMeta
        ? Math.max(12, Math.min(100, (viewportRatio / Math.max(pageRatio, 0.001)) * 100))
        : 100;

    return {
        pageWidth,
        pageHeight,
        viewportWidth,
        viewportHeight,
        pageRatio,
        rawPageRatio,
        viewportPercent,
        dataViewportFraction,
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

type HeatmapFrameDimensions = ReturnType<typeof getHeatmapFrameDimensions>;

const RrwebHeatmapPreview: React.FC<{
    screen: PreviewHeatmapScreen;
    frameDimensions: HeatmapFrameDimensions;
}> = ({ screen, frameDimensions }) => {
    const [rrwebReplay, setRrwebReplay] = useState<ApiSessionReplayManifest['rrwebReplay'] | null>(null);
    const [failed, setFailed] = useState(false);
    const sessionId = getPreferredHeatmapSessionId(screen);

    useEffect(() => {
        if (!sessionId) {
            setRrwebReplay(null);
            setFailed(false);
            return;
        }

        const abort = new AbortController();
        let cancelled = false;
        setRrwebReplay(null);
        setFailed(false);

        getSessionReplayManifest(sessionId, { frameUrlMode: 'signed', signal: abort.signal })
            .then((manifest) => {
                if (cancelled) return;
                const rrweb = manifest.rrwebReplay;
                const hasRrwebEvents = Boolean(
                    rrweb
                    && (
                        (rrweb.eventCount || 0) > 0
                        || (Array.isArray(rrweb.events) && rrweb.events.length > 0)
                        || (Array.isArray(rrweb.segments) && rrweb.segments.length > 0)
                    )
                );
                if (manifest.playbackMode === 'rrweb' && hasRrwebEvents) {
                    setRrwebReplay(manifest.rrwebReplay);
                    return;
                }
                setFailed(true);
            })
            .catch((error: unknown) => {
                if (cancelled || (error as { name?: string } | null)?.name === 'AbortError') return;
                heatmapDebug('Failed to load rrweb heatmap preview', {
                    screenName: screen.name,
                    sessionId,
                    error,
                });
                setFailed(true);
            });

        return () => {
            cancelled = true;
            abort.abort();
        };
    }, [screen.name, sessionId]);

    const { events } = useRrwebReplayEvents(rrwebReplay);
    const replayTiming = useMemo(() => {
        let first = Number.POSITIVE_INFINITY;
        let last = Number.NEGATIVE_INFINITY;
        for (const event of events) {
            const timestamp = Number(event?.timestamp);
            if (!Number.isFinite(timestamp)) continue;
            first = Math.min(first, timestamp);
            last = Math.max(last, timestamp);
        }
        if (!Number.isFinite(first) || !Number.isFinite(last)) return null;
        return {
            first,
            last,
        };
    }, [events]);

    if (failed || !replayTiming || events.length === 0) return null;

    const targetTimestamp = Number(screen.screenFirstSeenMs);
    const currentTime = Number.isFinite(targetTimestamp) && targetTimestamp > 0
        ? Math.max(0, (targetTimestamp - replayTiming.first) / 1000)
        : 0;
    const durationSeconds = Math.max(1, (replayTiming.last - replayTiming.first) / 1000);

    return (
        <div
            className="pointer-events-none absolute inset-0 overflow-hidden bg-white"
        >
            <WebReplayPlayer
                events={events}
                currentTime={currentTime}
                isPlaying={false}
                playbackRate={1}
                durationSeconds={durationSeconds}
                fitMode="document-width"
                documentWidth={frameDimensions.pageWidth}
                documentHeight={frameDimensions.pageHeight}
            />
        </div>
    );
};

const HeatmapPreview: React.FC<{
    screen: PreviewHeatmapScreen;
    compact?: boolean;
    tile?: boolean;
    showLegend?: boolean;
    viewerMode?: HeatmapViewerMode;
    projectPlatforms?: string[];
    heatmapMode?: HeatmapMode;
    attentionData?: WebAttentionHeatmapResponse | null;
}> = ({
    screen,
    compact = false,
    tile = false,
    showLegend = true,
    viewerMode = 'auto',
    projectPlatforms = [],
    heatmapMode = 'touch',
    attentionData = null,
}) => {
    const [blobUrl, setBlobUrl] = useState<string | null>(null);
    const [imageLoaded, setImageLoaded] = useState(false);
    const [imageNaturalSize, setImageNaturalSize] = useState<{ width: number; height: number } | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [downloadProgress, setDownloadProgress] = useState(0);

    const containerRef = useRef<HTMLDivElement>(null);
    const overlayRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const blobUrlRef = useRef<string | null>(null);

    const resolvedViewer = resolveHeatmapViewer(screen, viewerMode, projectPlatforms);
    const isWebViewer = resolvedViewer === 'web';
    const previewScreen = heatmapMode === 'attention' && attentionData
        ? {
            ...screen,
            pageWidth: attentionData.pageWidth ?? screen.pageWidth,
            pageHeight: attentionData.pageHeight ?? screen.pageHeight,
            viewportWidth: attentionData.viewportWidth ?? screen.viewportWidth,
            viewportHeight: attentionData.viewportHeight ?? screen.viewportHeight,
        }
        : screen;
    const frameDimensions = getHeatmapFrameDimensions(previewScreen, isWebViewer);
    const viewportGuideStops = useMemo(
        () => isWebViewer && !tile
            ? buildViewportGuideStops(frameDimensions.pageHeight, frameDimensions.viewportHeight)
            : [],
        [frameDimensions.pageHeight, frameDimensions.viewportHeight, isWebViewer, tile],
    );
    const coverUrlCandidates = useMemo(
        () => buildHeatmapImageUrlCandidates(screen, isWebViewer),
        [screen.screenshotUrl, screen.evidenceSessionId, screen.sessionIds, screen.screenFirstSeenMs, isWebViewer],
    );
    const coverUrlKey = coverUrlCandidates.join('|');
    const shouldRenderRrwebPreview = isWebViewer
        && !tile
        && Boolean(getPreferredHeatmapSessionId(screen));

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
            coverUrlCandidates,
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

        if (coverUrlCandidates.length === 0) {
            heatmapDebug('Skipping screenshot fetch because no screenshot URL is available', {
                screenName: screen.name,
                screenshotUrl: screen.screenshotUrl,
            });
            return () => undefined;
        }

        const csrfToken = getCsrfToken() || '';

        const fetchWithProgress = async (fetchUrl: string) => {
            const sameOrigin = (() => {
                try {
                    return new URL(fetchUrl, window.location.href).origin === window.location.origin;
                } catch {
                    return true;
                }
            })();
            heatmapDebug('Fetching screenshot blob', {
                screenName: screen.name,
                fetchUrl,
                csrfTokenPresent: sameOrigin && Boolean(csrfToken),
                requestedAt: new Date(fetchStartedAt).toISOString(),
            });

            const response = await fetch(fetchUrl, {
                credentials: sameOrigin ? 'include' : 'omit',
                headers: sameOrigin
                    ? { Accept: 'image/*', 'X-CSRF-Token': csrfToken }
                    : { Accept: 'image/*' },
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
                heatmapDebug('Screenshot fetch failed', {
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

        const fetchFirstAvailableScreenshot = async () => {
            let lastError: unknown = null;
            for (const fetchUrl of coverUrlCandidates) {
                if (cancelled) return null;
                setDownloadProgress(0);
                try {
                    const result = await fetchWithProgress(fetchUrl);
                    return { ...result, fetchUrl };
                } catch (error) {
                    lastError = error;
                    heatmapDebug('Screenshot candidate failed, trying next fallback', {
                        screenName: screen.name,
                        fetchUrl,
                        error,
                    });
                }
            }
            throw lastError instanceof Error ? lastError : new Error('No screenshot candidate could be loaded');
        };

        fetchFirstAvailableScreenshot()
            .then(async (result) => {
                if (!result || cancelled) return;
                const { blob, contentType, fetchUrl } = result;

                heatmapDebug('Screenshot blob ready', {
                    screenName: screen.name,
                    fetchUrl,
                    blobSize: blob.size,
                    blobType: blob.type,
                    contentType,
                });

                if (blob.size === 0) {
                    heatmapDebug('Empty image blob received', {
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
                        heatmapDebug('HEIC conversion failed', {
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
                heatmapDebug('Screenshot preview pipeline failed', {
                    screenName: screen.name,
                    coverUrlCandidates,
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
                coverUrlCandidates,
                durationMs: Date.now() - fetchStartedAt,
            });
            if (blobUrlRef.current) {
                URL.revokeObjectURL(blobUrlRef.current);
                blobUrlRef.current = null;
            }
        };
    }, [coverUrlKey]);

    const displayRoute = getDisplayRoute(screen.name);
    const documentAspectStyle = { aspectRatio: `${frameDimensions.pageWidth} / ${frameDimensions.pageHeight}` };
    const tileAspectStyle = { aspectRatio: `${frameDimensions.pageWidth} / ${frameDimensions.pageHeight}` };
    const imageRatio = imageNaturalSize ? imageNaturalSize.height / Math.max(imageNaturalSize.width, 1) : null;
    const useImageAsFullDocument = !isWebViewer || !imageRatio || Math.abs(imageRatio - frameDimensions.rawPageRatio) < 0.5 || !frameDimensions.hasFullPageMeta;
    const firstViewportImageStyle = isWebViewer && !useImageAsFullDocument
        ? { height: `${frameDimensions.viewportPercent}%` }
        : undefined;
    const activeHotspots = heatmapMode === 'attention'
        ? (attentionData?.hotspots || [])
        : (screen.touchHotspots || []);
    const visibleHotspots = useMemo(() => {
        return activeHotspots;
    }, [activeHotspots]);
    const heatmapOverlayClass = 'pointer-events-none absolute inset-0';
    const heatmapOverlayStyle = undefined;

    useEffect(() => {
        const canvas = canvasRef.current;
        const overlay = overlayRef.current;
        if (!canvas || !overlay) return;

        const draw = () => drawTouchHeatmap(canvas, overlay, visibleHotspots, heatmapMode, {
            fullWidthAttention: isWebViewer,
            fullScreenAttention: heatmapMode === 'attention' && !isWebViewer,
        });
        draw();

        window.addEventListener('resize', draw);
        return () => window.removeEventListener('resize', draw);
    }, [visibleHotspots, imageLoaded, blobUrl, frameDimensions.viewportPercent, frameDimensions.dataViewportFraction, heatmapMode, isWebViewer]);

    const topDots = useMemo(
        () => heatmapMode === 'attention'
            ? []
            : [...visibleHotspots].sort((a, b) => b.intensity - a.intensity).slice(0, 10),
        [visibleHotspots, heatmapMode],
    );

    const attentionInteractive = heatmapMode === 'attention'
        && !tile
        && (attentionData?.sampledSessions ?? 0) > 0
        && (
            (attentionData?.dwellByDepth?.some((value) => value > 0) ?? false)
            || visibleHotspots.some((hotspot) => (hotspot.kind ?? 'attention') === 'attention' && (hotspot.dwellMs ?? 0) > 0)
        );
    const [attentionHover, setAttentionHover] = useState<AttentionHoverState | null>(null);

    useEffect(() => {
        setAttentionHover(null);
    }, [attentionInteractive, attentionData]);

    const handleAttentionHover = (event: React.MouseEvent<HTMLDivElement>) => {
        if (!attentionInteractive || !attentionData) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;
        const relX = (event.clientX - rect.left) / rect.width;
        const relY = (event.clientY - rect.top) / rect.height;
        let dwellSum = 0;

        if (isWebViewer) {
            // A web scroll/attention band is one viewport tall: engaged time is spread across the
            // viewport at that scroll depth, so summing over a viewport-sized window recovers it.
            const band = Math.min(1, Math.max(0.06, frameDimensions.dataViewportFraction || 1));
            const lo = relY - band / 2;
            const hi = relY + band / 2;
            const profile = attentionData.dwellByDepth ?? [];
            if (profile.length > 0) {
                const loIdx = Math.max(0, Math.floor(lo * profile.length));
                const hiIdx = Math.min(profile.length - 1, Math.ceil(hi * profile.length) - 1);
                for (let i = loIdx; i <= hiIdx; i += 1) dwellSum += profile[i] ?? 0;
            } else {
                for (const hotspot of attentionData.hotspots) {
                    if ((hotspot.kind ?? 'attention') !== 'attention') continue;
                    if (hotspot.y < lo || hotspot.y > hi) continue;
                    dwellSum += hotspot.dwellMs ?? 0;
                }
            }
        } else {
            const profile = attentionData.dwellByDepth ?? [];
            const profileTotal = profile.reduce((sum, value) => sum + value, 0);
            const hotspotDwellTotal = attentionData.hotspots.reduce((sum, hotspot) => sum + Math.max(0, hotspot.dwellMs ?? 0), 0);
            const sparseCompensation = hotspotDwellTotal > 0 && profileTotal > hotspotDwellTotal
                ? Math.max(1, Math.min(8, profileTotal / hotspotDwellTotal))
                : 1;
            const localSigma = Math.max(72, Math.min(rect.width, rect.height) * 0.32);
            let weightedDwell = 0;
            let weightSum = 0;
            let nearestDwell = 0;
            let nearestDistance = Number.POSITIVE_INFINITY;
            for (const hotspot of attentionData.hotspots) {
                const dwell = hotspot.dwellMs ?? 0;
                if (dwell <= 0) continue;
                const dx = (hotspot.x - relX) * rect.width;
                const dy = (hotspot.y - relY) * rect.height;
                const distSquared = dx * dx + dy * dy;
                const weight = Math.exp(-distSquared / (2 * localSigma * localSigma));
                weightedDwell += dwell * weight;
                weightSum += weight;
                if (distSquared < nearestDistance) {
                    nearestDistance = distSquared;
                    nearestDwell = dwell;
                }
            }
            let depthBandDwell = 0;
            if (profile.length > 0) {
                const band = 0.18;
                const loIdx = Math.max(0, Math.floor((relY - band / 2) * profile.length));
                const hiIdx = Math.min(profile.length - 1, Math.ceil((relY + band / 2) * profile.length) - 1);
                for (let i = loIdx; i <= hiIdx; i += 1) depthBandDwell += profile[i] ?? 0;
                depthBandDwell *= 0.34;
            }
            const screenBaseline = profileTotal > 0 ? profileTotal / Math.max(10, profile.length * 0.12) : 0;
            const neighborhoodDwell = weightedDwell * sparseCompensation;
            dwellSum = weightSum > 0.03
                ? Math.max(neighborhoodDwell, depthBandDwell, screenBaseline * 0.32)
                : Math.max(nearestDwell * sparseCompensation * 0.24, depthBandDwell, screenBaseline * 0.32);
        }

        const avgMs = dwellSum / Math.max(attentionData.sampledSessions, 1);
        const avgSessionDurationMs = attentionData.avgSessionDurationMs ?? 0;
        const pct = avgSessionDurationMs > 0
            ? Math.max(0, Math.min(100, (avgMs / avgSessionDurationMs) * 100))
            : null;
        setAttentionHover({
            left: event.clientX - rect.left,
            top: event.clientY - rect.top,
            avgMs,
            pct,
            mode: isWebViewer ? 'web' : 'mobile',
        });
    };
    const widthClass = tile
        ? isWebViewer
            ? 'w-full'
            : 'w-full'
        : isWebViewer
            ? 'w-full'
            : `mx-auto w-full ${compact ? 'max-w-[310px]' : 'max-w-[360px]'}`;
    const frameClass = isWebViewer
        ? 'heatmap-browser-frame heatmap-web-document-frame overflow-hidden rounded-xl border-2 border-black bg-white shadow-neo'
        : 'heatmap-phone-frame rounded-[28px] border-2 border-black bg-black p-3 shadow-neo';
    const screenClass = isWebViewer
        ? 'heatmap-browser-screen heatmap-web-document-screen relative overflow-hidden bg-white'
        : 'heatmap-phone-screen relative aspect-[9/19] overflow-hidden rounded-[24px] bg-slate-800';
    const tileScreenClass = isWebViewer
        ? 'heatmap-tile-screen heatmap-web-tile-screen heatmap-web-document-tile relative overflow-hidden rounded-lg border-2 border-black bg-white shadow-neo-sm'
        : 'heatmap-tile-screen relative mx-auto aspect-[9/19] max-h-[500px] w-full max-w-[184px] overflow-hidden rounded-2xl border-2 border-black bg-slate-800 shadow-neo-sm';
    const imageFitClass = 'object-fill';
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
                        heatmapDebug('Screenshot image element failed to render', {
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
                    <p className={`text-xs font-black uppercase ${isWebViewer ? 'text-slate-700' : 'text-slate-200'}`}>{screen.name}</p>
                    {!loadError && downloadProgress > 0 && downloadProgress < 100 && (
                        <p className="mt-2 text-[11px] text-slate-400">Loading screenshot {downloadProgress}%</p>
                    )}
                    {loadError && <p className="mt-2 text-[11px] text-rose-300">{loadError}</p>}
                </div>
            )}
            {shouldRenderRrwebPreview && !blobUrl && (
                <RrwebHeatmapPreview
                    screen={screen}
                    frameDimensions={frameDimensions}
                />
            )}
            <div ref={overlayRef} className={heatmapOverlayClass} style={heatmapOverlayStyle}>
                {visibleHotspots.length > 0 && (
                    <canvas
                        ref={canvasRef}
                        className="absolute inset-0 h-full w-full"
                        style={{ mixBlendMode: 'normal', opacity: 0.96 }}
                    />
                )}

                <div className="absolute inset-0">
                    {topDots.map((hotspot, index) => {
                        const size = 10 + (hotspot.intensity * 14);
                        const markerClass = hotspot.kind === 'attention'
                            ? 'bg-amber-300/60'
                            : hotspot.isRageTap || hotspot.kind === 'rage'
                                ? 'bg-rose-500/60'
                                : 'bg-cyan-400/55';
                        return (
                            <span
                                key={`dot-${index}-${hotspot.x}-${hotspot.y}`}
                                className={`absolute rounded-full border border-white/50 ${markerClass}`}
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
            </div>
            {attentionInteractive && (
                <div
                    className="absolute inset-0 z-20 cursor-crosshair"
                    onMouseMove={handleAttentionHover}
                    onMouseLeave={() => setAttentionHover(null)}
                >
                    {attentionHover && (
                        <>
                            {attentionHover.mode === 'web' ? (
                                <span
                                    className="pointer-events-none absolute inset-x-0 border-t-2 border-dashed border-slate-900/40"
                                    style={{ top: `${attentionHover.top}px` }}
                                />
                            ) : (
                                <span
                                    className="pointer-events-none absolute h-12 w-12 rounded-full border-2 border-dashed border-slate-950/45 bg-white/10"
                                    style={{
                                        left: `${attentionHover.left}px`,
                                        top: `${attentionHover.top}px`,
                                        transform: 'translate(-50%, -50%)',
                                    }}
                                />
                            )}
                            <div
                                className="pointer-events-none absolute z-30 w-max max-w-[180px] rounded-lg border-2 border-black bg-white px-3 py-2 shadow-neo-sm"
                                style={{
                                    left: `${attentionHover.left}px`,
                                    top: `${attentionHover.top}px`,
                                    transform: `translate(${attentionHover.left > 180 ? 'calc(-100% - 14px)' : '14px'}, -50%)`,
                                }}
                            >
                                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                                    {attentionHover.mode === 'mobile' ? 'Est Duration' : 'Avg time spent'}
                                </p>
                                <p className="text-lg font-black tabular-nums text-slate-900">
                                    {formatAttentionHoverDuration(attentionHover.avgMs, attentionHover.mode)}
                                </p>
                                <p className="mt-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">% of session length</p>
                                <p className="text-sm font-black tabular-nums text-cyan-600">
                                    {attentionHover.pct === null ? '--' : `${attentionHover.pct.toFixed(2)}%`}
                                </p>
                            </div>
                        </>
                    )}
                </div>
            )}
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
    const [heatmapMode, setHeatmapMode] = useState<HeatmapMode>('touch');
    const [attentionByScreen, setAttentionByScreen] = useState<Record<string, WebAttentionHeatmapResponse>>({});
    const [attentionLoadingFor, setAttentionLoadingFor] = useState<string | null>(null);
    const [attentionErrors, setAttentionErrors] = useState<Record<string, string>>({});
    const attentionByScreenRef = useRef(attentionByScreen);
    attentionByScreenRef.current = attentionByScreen;
    const attentionInFlightRef = useRef<Set<string>>(new Set());

    useEffect(() => {
        setAttentionByScreen({});
        setAttentionErrors({});
        setAttentionLoadingFor(null);
        attentionInFlightRef.current.clear();

        if (isDemoMode) {
            const overview = buildDemoHeatmapOverview();
            setScreens(overview.screens as EnrichedHeatmapScreen[]);
            setScreenIteration(overview.screenIteration || null);
            setLastUpdated(overview.lastUpdated);
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

                const overviewScreens = (overview.screens || []) as EnrichedHeatmapScreen[];
                const minVisits = getHeatmapRouteMinimumVisits(overviewScreens);
                let mergedScreens = overviewScreens.filter((screen) => isMeaningfulHeatmapScreen(screen, minVisits));

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
    const [selectedVersionKey, setSelectedVersionKey] = useState('current');

    useEffect(() => {
        if (!sortedScreens.length) {
            setSelectedScreenName(null);
            setSelectedVersionKey('current');
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
    const selectedVersionOptions = useMemo(() => (
        versionGroups
            .map((version, index) => {
                const screen = version.screens.find((candidate) => candidate.name === selectedScreenName);
                if (!screen) return null;
                return {
                    key: `${index}:${version.appVersion}`,
                    version,
                    screen,
                };
            })
            .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    ), [selectedScreenName, versionGroups]);
    const selectedVersionEntry = useMemo(() => (
        selectedVersionOptions.find((entry) => entry.key === selectedVersionKey) || null
    ), [selectedVersionKey, selectedVersionOptions]);

    useEffect(() => {
        if (selectedVersionKey === 'current') return;
        if (selectedVersionOptions.some((entry) => entry.key === selectedVersionKey)) return;
        setSelectedVersionKey('current');
    }, [selectedVersionKey, selectedVersionOptions]);

    const projectPlatforms = selectedProject?.platforms || [];
    const selectedViewer = selectedScreen ? resolveHeatmapViewer(selectedScreen, 'auto', projectPlatforms) : 'mobile';
    const displayedScreen = selectedScreen && selectedVersionEntry
        ? {
            ...selectedScreen,
            screenshotUrl: selectedVersionEntry.screen.screenshotUrl ?? selectedScreen.screenshotUrl,
            screenFirstSeenMs: selectedVersionEntry.screen.screenFirstSeenMs ?? selectedScreen.screenFirstSeenMs,
            evidenceSessionId: selectedVersionEntry.screen.evidenceSessionId ?? selectedScreen.evidenceSessionId,
            touchHotspots: selectedVersionEntry.screen.touchHotspots?.length
                ? selectedVersionEntry.screen.touchHotspots
                : selectedScreen.touchHotspots,
            pageWidth: selectedVersionEntry.screen.pageWidth ?? selectedScreen.pageWidth,
            pageHeight: selectedVersionEntry.screen.pageHeight ?? selectedScreen.pageHeight,
            viewportWidth: selectedVersionEntry.screen.viewportWidth ?? selectedScreen.viewportWidth,
            viewportHeight: selectedVersionEntry.screen.viewportHeight ?? selectedScreen.viewportHeight,
        }
        : selectedScreen;
    const activeScreen = displayedScreen ?? selectedScreen;
    const isVersionSnapshotSelected = Boolean(selectedVersionEntry);
    const effectiveHeatmapMode: HeatmapMode = heatmapMode;
    const attentionAppVersion = (() => {
        const raw = selectedVersionEntry?.version.appVersion ?? null;
        return raw && raw !== 'All versions' ? raw : null;
    })();
    const attentionKey = selectedScreen ? `${selectedViewer}:${selectedScreen.name}::${attentionAppVersion ?? 'all'}` : null;
    const selectedAttention = attentionKey ? attentionByScreen[attentionKey] ?? null : null;
    const selectedAttentionError = attentionKey ? attentionErrors[attentionKey] ?? null : null;
    const selectedAttentionLoading = Boolean(attentionKey && attentionLoadingFor === attentionKey);
    const selectedModeLabel = isVersionSnapshotSelected
        ? effectiveHeatmapMode === 'attention'
            ? `v${selectedVersionEntry?.version.appVersion} attention map`
            : `v${selectedVersionEntry?.version.appVersion} touch map`
        : formatHeatmapModeLabel(effectiveHeatmapMode, selectedViewer);
    const attentionStatus = effectiveHeatmapMode === 'attention'
        ? selectedAttentionLoading
            ? { state: 'loading' as const, label: 'Building attention' }
            : selectedAttentionError
                ? { state: 'error' as const, label: selectedAttentionError }
                : selectedAttention?.reason
                    ? { state: 'muted' as const, label: selectedAttention.reason }
                    : null
        : null;
    const availableHeatmapModes = getAvailableHeatmapModes(selectedViewer);

    useEffect(() => {
        if (!selectedScreenName) return;
        setHeatmapMode(getDefaultHeatmapMode(selectedViewer));
    }, [selectedScreenName, selectedViewer]);

    const attentionScreenName = selectedScreen?.name ?? null;
    useEffect(() => {
        if (!attentionKey || !attentionScreenName || effectiveHeatmapMode !== 'attention') return;
        if (attentionByScreenRef.current[attentionKey] || attentionInFlightRef.current.has(attentionKey)) return;
        if (!selectedProject?.id && !isDemoMode) return;

        const key = attentionKey;
        const screenNameForFetch = attentionScreenName;
        const versionForFetch = attentionAppVersion;
        attentionInFlightRef.current.add(key);
        setAttentionLoadingFor(key);
        setAttentionErrors((current) => {
            if (!(key in current)) return current;
            const next = { ...current };
            delete next[key];
            return next;
        });

        const projectId = selectedProject?.id || 'demo-project';
        const range = getInsightsRangeFromTimeFilter(timeRange);
        const attentionPlatform = selectedViewer === 'web'
            ? 'web'
            : platform === 'ios' || platform === 'android'
                ? platform
                : 'mobile';
        getWebAttentionHeatmap(projectId, screenNameForFetch, range, attentionPlatform, versionForFetch)
            .then((result) => {
                setAttentionByScreen((current) => ({ ...current, [key]: result }));
            })
            .catch((error: unknown) => {
                heatmapDebug('Failed to build attention heatmap', { screenName: screenNameForFetch, appVersion: versionForFetch, selectedViewer, error });
                setAttentionErrors((current) => ({ ...current, [key]: 'Attention map unavailable' }));
            })
            .finally(() => {
                attentionInFlightRef.current.delete(key);
                setAttentionLoadingFor((current) => (current === key ? null : current));
            });
    }, [
        attentionKey,
        attentionScreenName,
        attentionAppVersion,
        effectiveHeatmapMode,
        isDemoMode,
        platform,
        selectedProject?.id,
        selectedViewer,
        timeRange,
    ]);

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
        <section className={`heatmap-studio ${className}`.trim()}>
            {partialError && (
                <div className="heatmap-alert">
                    <Activity className="h-4 w-4" />
                    <span>{partialError}</span>
                </div>
            )}

            {selectedScreen && activeScreen && (
                <div className="heatmap-canvas-layout">
                    <main className="heatmap-canvas-panel heatmap-primary-canvas" aria-label="Selected heatmap">
                        <div className="heatmap-canvas-toolbar">
                            <div className="min-w-0">
                                <span className="heatmap-eyebrow">
                                    {selectedViewer === 'web' ? <Monitor className="h-3.5 w-3.5" /> : <Smartphone className="h-3.5 w-3.5" />}
                                    {selectedModeLabel}
                                </span>
                                {selectedViewer !== 'web' && <h3 title={activeScreen.name}>{activeScreen.name}</h3>}
                            </div>
                            {attentionStatus && attentionStatus.state !== 'loading' && (
                                <div className={`heatmap-canvas-status heatmap-canvas-status-${attentionStatus.state}`} role={attentionStatus.state === 'error' ? 'status' : undefined}>
                                    <span>{attentionStatus.label}</span>
                                </div>
                            )}
                        </div>
                        <div className={`heatmap-preview-stage heatmap-primary-stage ${selectedViewer === 'web' ? 'heatmap-web-scroll-stage' : ''}`}>
                            <HeatmapPreview
                                screen={activeScreen}
                                compact={compact}
                                showLegend
                                viewerMode="auto"
                                projectPlatforms={projectPlatforms}
                                heatmapMode={effectiveHeatmapMode}
                                attentionData={selectedAttention}
                            />
                            {attentionStatus?.state === 'loading' && (
                                <div className="heatmap-stage-overlay" role="status" aria-live="polite">
                                    <div className="heatmap-stage-overlay-card">
                                        <Loader2 className="h-5 w-5 animate-spin" />
                                        <span>{attentionStatus.label}</span>
                                        <p>Sampling sessions and scoring attention…</p>
                                    </div>
                                </div>
                            )}
                        </div>
                    </main>

                    <aside className="heatmap-side-panel" aria-label="Heatmap controls and context">
                        <section className="heatmap-side-section">
                            <div className="heatmap-side-title">
                                <span className="heatmap-eyebrow">Map type</span>
                            </div>
                            {availableHeatmapModes.length > 1 && (
                                <div className="heatmap-mode-control heatmap-side-mode-control" role="group" aria-label="Heatmap mode">
                                    {availableHeatmapModes.map((mode) => (
                                        <button
                                            key={mode}
                                            type="button"
                                            onClick={() => setHeatmapMode(mode)}
                                            className={effectiveHeatmapMode === mode ? 'is-active' : ''}
                                        >
                                            {mode === 'attention' ? <Eye className="h-4 w-4" /> : <MousePointer2 className="h-4 w-4" />}
                                            {mode === 'attention' ? 'Attention' : 'Touch'}
                                        </button>
                                    ))}
                                </div>
                            )}
                            <p className="heatmap-side-note">
                                {effectiveHeatmapMode === 'attention'
                                    ? selectedViewer === 'web'
                                        ? 'Where visitors looked and lingered, weighted by dwell time and read depth.'
                                        : 'Where users looked and lingered, weighted by dwell, screen structure, scroll behavior, and touch intent.'
                                    : selectedViewer === 'web'
                                        ? 'Where visitors clicked and tapped across the page.'
                                        : 'Where users tapped across this screen.'}
                            </p>
                            {selectedVersionEntry && (
                                <p className="heatmap-side-note">
                                    Scoped to v{selectedVersionEntry.version.appVersion} sessions.
                                </p>
                            )}
                        </section>

                        <section className="heatmap-side-section">
                            <div className="heatmap-side-heading">
                                <span>
                                    <ListFilter className="h-3.5 w-3.5" />
                                    {selectedViewer === 'web' ? 'Routes' : 'Screens'}
                                </span>
                            </div>
                            <div className="heatmap-rail-list heatmap-side-route-list">
                                {sortedScreens.map((screen) => {
                                    const selected = screen.name === selectedScreen.name;
                                    const viewer = resolveHeatmapViewer(screen, 'auto', projectPlatforms);
                                    const Icon = viewer === 'web' ? Monitor : Smartphone;
                                    return (
                                        <button
                                            key={screen.name}
                                            type="button"
                                            aria-pressed={selected}
                                            onClick={() => {
                                                setSelectedScreenName(screen.name);
                                                setSelectedVersionKey('current');
                                            }}
                                            className={`heatmap-route-row ${selected ? 'heatmap-route-row-active' : ''}`}
                                        >
                                            <span className="heatmap-route-icon" aria-hidden="true">
                                                <Icon className="h-3.5 w-3.5" />
                                            </span>
                                            <span className="min-w-0 flex-1 text-left">
                                                <span className="heatmap-route-name">{screen.name}</span>
                                            </span>
                                            {screen.rangeVisits > 0 && (
                                                <span className="heatmap-route-meta" title={`${screen.rangeVisits.toLocaleString()} sessions`}>
                                                    {formatCompactCount(screen.rangeVisits)}
                                                </span>
                                            )}
                                        </button>
                                    );
                                })}
                            </div>
                        </section>

                        <section className="heatmap-side-section">
                            <div className="heatmap-side-heading">
                                <span>
                                    <Layers3 className="h-3.5 w-3.5" />
                                    Versions
                                </span>
                            </div>
                            <div className="heatmap-version-lane">
                                <button
                                    type="button"
                                    aria-pressed={selectedVersionKey === 'current'}
                                    className={`heatmap-version-row ${selectedVersionKey === 'current' ? 'heatmap-version-row-active' : ''}`}
                                    onClick={() => setSelectedVersionKey('current')}
                                >
                                    <span>Current aggregate</span>
                                    <em>{formatHeatmapModeLabel(heatmapMode, selectedViewer)}</em>
                                </button>
                                {selectedVersionOptions.map(({ key, version, screen }) => (
                                    <button
                                        key={`${key}:${screen.name}`}
                                        type="button"
                                        aria-pressed={selectedVersionKey === key}
                                        className={`heatmap-version-row ${selectedVersionKey === key ? 'heatmap-version-row-active' : ''}`}
                                        onClick={() => setSelectedVersionKey(key)}
                                    >
                                        <span>v{version.appVersion}</span>
                                        <em>{formatHeatmapModeLabel(effectiveHeatmapMode, selectedViewer)}</em>
                                    </button>
                                ))}
                            </div>
                        </section>
                    </aside>
                </div>
            )}
        </section>
    );
};
