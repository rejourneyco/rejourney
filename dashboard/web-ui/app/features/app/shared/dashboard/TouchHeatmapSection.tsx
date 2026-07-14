import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    Activity,
    AlertTriangle,
    Check,
    ChevronLeft,
    ChevronRight,
    Eye,
    Flame,
    Image as ImageIcon,
    Loader2,
    Monitor,
    MousePointer2,
    PlayCircle,
    RotateCcw,
    Smartphone,
    X,
} from 'lucide-react';
import { useNavigate } from 'react-router';
import { useDashboardManualRefreshVersion } from '~/shared/providers/DashboardManualRefreshContext';
import { useSessionData } from '~/shared/providers/SessionContext';
import { useDemoMode } from '~/shared/providers/DemoModeContext';
import {
    getHeatmapsOverview,
    getHeatmapScreenOverview,
    getHeatmapBaseFrameCandidates,
    getWebAttentionHeatmap,
    saveHeatmapBaseTemplate,
    deleteHeatmapBaseTemplate,
    getSessionReplayManifest,
    type AlltimeHeatmapScreen,
    type ApiSessionReplayManifest,
    type HeatmapBaseFrameCandidate,
    type HeatmapBaseTemplate,
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
import { usePathPrefix } from '~/shell/routing/usePathPrefix';
import { getAvailableHeatmapModes, getDefaultHeatmapMode } from './heatmapMode';

const TOUCH_HEATMAP_DEBUG_PREFIX = '[TouchHeatmapDebug]';
const HEATMAP_DETAIL_FETCH_CONCURRENCY = 4;
const BASE_FRAME_PAGE_SIZE = 36;
const BASE_FRAME_ALL_SESSIONS = 'all';

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

function parseTimestampedHeatmapImageUrl(url: string): { sessionId: string; timestamp: number } | null {
    const frameMatch = url.match(/\/api\/session\/frame\/([^/?#]+)\/(\d+)(?:\.jpg)?(?:[?#].*)?$/);
    if (frameMatch?.[1] && frameMatch?.[2]) {
        const timestamp = Number(frameMatch[2]);
        if (Number.isFinite(timestamp) && timestamp > 0) {
            return { sessionId: frameMatch[1], timestamp: Math.round(timestamp) };
        }
    }

    const thumbnailMatch = url.match(/\/api\/session\/thumbnail\/([^/?#]+)/);
    if (thumbnailMatch?.[1]) {
        try {
            const parsed = new URL(url, typeof window !== 'undefined' ? window.location.href : 'http://localhost');
            const timestamp = Number(parsed.searchParams.get('ts'));
            if (Number.isFinite(timestamp) && timestamp > 0) {
                return { sessionId: thumbnailMatch[1], timestamp: Math.round(timestamp) };
            }
        } catch {
            return null;
        }
    }

    return null;
}

function isGenericHeatmapThumbnailUrl(url: string): boolean {
    return /\/api\/session\/thumbnail\/[^/?#]+(?:[?#].*)?$/.test(url) && !/[?&]ts=\d+/.test(url);
}

function buildHeatmapImageUrlCandidates(
    screen: PreviewHeatmapScreen,
    options: { allowGenericSessionFallback?: boolean } = {},
): string[] {
    const candidates: string[] = [];
    const seen = new Set<string>();
    const addCandidate = (url: string | null | undefined) => {
        if (!url) return;
        if (isGenericHeatmapThumbnailUrl(url) && !options.allowGenericSessionFallback) return;
        const absoluteUrl = toAbsoluteHeatmapImageUrl(url);
        if (seen.has(absoluteUrl)) return;
        seen.add(absoluteUrl);
        candidates.push(absoluteUrl);
    };

    addCandidate(screen.screenshotUrl);
    const timestamped = screen.screenshotUrl ? parseTimestampedHeatmapImageUrl(screen.screenshotUrl) : null;
    if (timestamped) {
        addCandidate(`/api/session/thumbnail/${timestamped.sessionId}?ts=${timestamped.timestamp}`);
    }

    if (options.allowGenericSessionFallback) {
        for (const sessionId of getHeatmapEvidenceSessionIds(screen).slice(0, 4)) {
            addCandidate(`/api/session/thumbnail/${encodeURIComponent(sessionId)}`);
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
        if (mode === 'attention') {
            const s = Math.min(1, Math.max(0, (t - 0.015) / 0.985));
            return [
                Math.round(52 - s * 30),
                Math.round(86 + s * 78),
                Math.round(205 + s * 28),
                Math.round(28 + s * 132),
            ];
        }
        if (t < 0.18) {
            const s = (t - 0.015) / 0.165;
            const a = Math.round(45 + s * 90);
            return [Math.round(56 + s * 9), Math.round(92 + s * 13), Math.round(214 + s * 11), a];
        }
        if (t < 0.42) {
            const s = (t - 0.18) / 0.24;
            const a = Math.round(135 + s * 55);
            return [Math.round(65 - s * 41), Math.round(105 + s * 81), Math.round(225 - s * 41), a];
        }
        if (t < 0.7) {
            const s = (t - 0.42) / 0.28;
            const a = Math.round(190 + s * 35);
            return [Math.round(24 + s * 221), Math.round(186 + s * 10), Math.round(184 - s * 118), a];
        }
        const s = (t - 0.7) / 0.3;
        return [Math.round(245 - s * 20), Math.round(196 - s * 127), Math.round(66 - s * 11), Math.round(225 + s * 25)];
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
type HeatmapViewMode = HeatmapMode | 'rage';
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
    baseTemplate?: HeatmapBaseTemplate | null;
}

interface EnrichedHeatmapScreen extends AlltimeHeatmapScreen {
    rangeVisits: number;
    rangeUniqueVisitors: number;
    rangeInteractions: number;
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
    baseTemplate?: HeatmapBaseTemplate | null;
}

type VersionHeatmapScreen = HeatmapIterationScreen & {
    touchHotspots?: HeatmapHotspot[];
    baseTemplate?: HeatmapBaseTemplate | null;
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

const formatFrameOffset = (seconds: number | null): string => {
    if (seconds === null || !Number.isFinite(seconds)) return '--:--';
    const rounded = Math.max(0, Math.round(seconds));
    const minutes = Math.floor(rounded / 60);
    const remaining = rounded % 60;
    return `${minutes}:${String(remaining).padStart(2, '0')}`;
};

const formatBaseFrameSessionStartedAt = (value: string): string => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Unknown time';
    return date.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
};

const formatBaseFramePlatform = (value: string | null): string => {
    if (!value) return 'Unknown';
    if (value === 'ios') return 'iOS';
    if (value === 'android') return 'Android';
    if (value === 'web') return 'Web';
    return value.charAt(0).toUpperCase() + value.slice(1);
};

const shortSessionId = (sessionId: string): string => {
    if (sessionId.length <= 18) return sessionId;
    return `${sessionId.slice(0, 10)}...${sessionId.slice(-6)}`;
};

const isWebBaseFrameCandidate = (candidate: HeatmapBaseFrameCandidate | null, fallbackPlatform: string): boolean => (
    candidate?.platform === 'web' || fallbackPlatform === 'web'
);

const formatAttentionHoverDuration = (ms: number, mode: ResolvedHeatmapViewer): string => {
    if (mode === 'web') return formatDwellDuration(ms);
    if (!Number.isFinite(ms) || ms <= 0) return '0.0s';
    if (ms < 10_000) return `${Math.max(0.1, ms / 1000).toFixed(1)}s`;
    if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
    return formatDwellDuration(ms);
};

const formatHeatmapModeLabel = (mode: HeatmapViewMode, viewer: ResolvedHeatmapViewer): string => {
    if (mode === 'rage') return 'Rage map';
    if (viewer !== 'web') return mode === 'attention' ? 'Attention map' : 'Touch map';
    return mode === 'attention' ? 'Attention map' : 'Click map';
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
    const [loadState, setLoadState] = useState<'loading' | 'ready' | 'failed'>('loading');
    const candidateSessionIds = useMemo(() => getHeatmapEvidenceSessionIds(screen).slice(0, 5), [
        screen.evidenceSessionId,
        screen.sessionIds,
        screen.screenshotUrl,
    ]);
    const candidateSessionKey = candidateSessionIds.join('|');

    useEffect(() => {
        if (candidateSessionIds.length === 0) {
            setRrwebReplay(null);
            setLoadState('failed');
            return;
        }

        const abort = new AbortController();
        let cancelled = false;
        setRrwebReplay(null);
        setLoadState('loading');

        (async () => {
            for (const sessionId of candidateSessionIds) {
                try {
                    const manifest = await getSessionReplayManifest(sessionId, { frameUrlMode: 'signed', signal: abort.signal });
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
                        setRrwebReplay(rrweb);
                        setLoadState('ready');
                        return;
                    }
                } catch (error) {
                    if (cancelled || (error as { name?: string } | null)?.name === 'AbortError') return;
                    heatmapDebug('Failed rrweb candidate for heatmap preview', {
                        screenName: screen.name,
                        sessionId,
                        error,
                    });
                }
            }
            if (!cancelled) setLoadState('failed');
        })();

        return () => {
            cancelled = true;
            abort.abort();
        };
    }, [candidateSessionIds, candidateSessionKey, screen.name]);

    const { events, isLoading: eventsLoading, progress } = useRrwebReplayEvents(rrwebReplay);
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

    if (loadState === 'loading' || (loadState === 'ready' && eventsLoading && events.length === 0)) {
        return (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-50/95 p-6 text-center">
                <div>
                    <Loader2 className="mx-auto h-6 w-6 animate-spin text-cyan-600" />
                    <p className="mt-3 text-xs font-black text-slate-800">Reconstructing this page</p>
                    <p className="mt-1 text-[11px] font-semibold text-slate-500">
                        {progress.total > 0 ? `${progress.loaded} of ${progress.total} replay segments` : 'Loading DOM replay evidence'}
                    </p>
                </div>
            </div>
        );
    }

    if (loadState === 'failed' || !replayTiming || events.length === 0) {
        return (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-50 p-6 text-center">
                <div className="max-w-xs">
                    <AlertTriangle className="mx-auto h-7 w-7 text-amber-500" />
                    <p className="mt-3 text-xs font-black text-slate-900">Page replay unavailable</p>
                    <p className="mt-1 text-[11px] font-semibold leading-relaxed text-slate-500">
                        The interaction data is still valid. Choose another route, version, or time range for visual evidence.
                    </p>
                </div>
            </div>
        );
    }

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
    heatmapMode?: HeatmapViewMode;
    attentionData?: WebAttentionHeatmapResponse | null;
    overlayOpacity?: number;
}> = ({
    screen,
    compact = false,
    tile = false,
    showLegend = true,
    viewerMode = 'auto',
    projectPlatforms = [],
    heatmapMode = 'touch',
    attentionData = null,
    overlayOpacity = 0.76,
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
    // Attention dimensions are generated by the web replay pipeline. Applying an
    // empty web response to a mobile screen was replacing its 393×852 capture with
    // the web's 1920×1080 viewport and stretching the image into a tablet.
    const useWebAttentionData = isWebViewer && heatmapMode === 'attention' && attentionData;
    const previewScreen = useWebAttentionData
        ? {
            ...screen,
            pageWidth: attentionData.pageWidth ?? screen.pageWidth,
            pageHeight: attentionData.pageHeight ?? screen.pageHeight,
            viewportWidth: attentionData.viewportWidth ?? screen.viewportWidth,
            viewportHeight: attentionData.viewportHeight ?? screen.viewportHeight,
        }
        : screen;
    const frameDimensions = getHeatmapFrameDimensions(previewScreen, isWebViewer);
    const isTabletViewer = !isWebViewer && frameDimensions.viewportWidth >= 700;
    const viewportGuideStops = useMemo(
        () => isWebViewer && !tile
            ? buildViewportGuideStops(frameDimensions.pageHeight, frameDimensions.viewportHeight)
            : [],
        [frameDimensions.pageHeight, frameDimensions.viewportHeight, isWebViewer, tile],
    );
    const coverUrlCandidates = useMemo(
        () => buildHeatmapImageUrlCandidates(screen, { allowGenericSessionFallback: !isWebViewer }),
        [isWebViewer, screen.evidenceSessionId, screen.screenshotUrl, screen.sessionIds],
    );
    const coverUrlKey = coverUrlCandidates.join('|');
    const shouldRenderRrwebPreview = isWebViewer
        && !tile
        && coverUrlCandidates.length === 0
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
        ? (isWebViewer ? (attentionData?.hotspots || []) : (screen.touchHotspots || []))
        : heatmapMode === 'rage'
            ? (screen.touchHotspots || []).filter((hotspot) => hotspot.isRageTap || hotspot.kind === 'rage')
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

        const renderMode: HeatmapMode = heatmapMode === 'rage' ? 'touch' : heatmapMode;
        const draw = () => drawTouchHeatmap(canvas, overlay, visibleHotspots, renderMode, {
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

    const attentionInteractive = isWebViewer
        && heatmapMode === 'attention'
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
            : isTabletViewer
                ? 'mx-auto w-full max-w-[920px]'
                : `mx-auto w-full ${compact ? 'max-w-[340px]' : 'max-w-[440px]'}`;
    const frameClass = isWebViewer
        ? 'heatmap-browser-frame heatmap-web-document-frame overflow-hidden rounded-xl border-2 border-black bg-white shadow-neo'
        : isTabletViewer
            ? 'heatmap-tablet-frame rounded-[24px] border border-slate-200 bg-white p-1.5 shadow-[0_18px_40px_rgba(15,23,42,0.14)]'
            : 'heatmap-phone-frame rounded-[28px] border border-slate-200 bg-white p-1.5 shadow-[0_18px_40px_rgba(15,23,42,0.14)]';
    const screenClass = isWebViewer
        ? 'heatmap-browser-screen heatmap-web-document-screen relative overflow-hidden bg-white'
        : isTabletViewer
            ? 'heatmap-tablet-screen relative overflow-hidden rounded-[18px] bg-slate-100'
            : 'heatmap-phone-screen relative overflow-hidden rounded-[23px] bg-slate-100';
    const tileScreenClass = isWebViewer
        ? 'heatmap-tile-screen heatmap-web-tile-screen heatmap-web-document-tile relative overflow-hidden rounded-lg border-2 border-black bg-white shadow-neo-sm'
        : 'heatmap-tile-screen relative mx-auto max-h-[500px] w-full max-w-[184px] overflow-hidden rounded-2xl border border-slate-200 bg-slate-100 shadow-[0_8px_20px_rgba(15,23,42,0.1)]';
    const imageFitClass = 'object-cover';
    const placeholderClass = isWebViewer
        ? 'bg-transparent'
        : 'bg-slate-100';
    const previewWrapperStyle = !isWebViewer
        ? ({ '--heatmap-frame-ratio': `${frameDimensions.pageWidth / Math.max(frameDimensions.pageHeight, 1)}` } as React.CSSProperties)
        : undefined;

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
                        style={{ mixBlendMode: 'normal', opacity: overlayOpacity }}
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
        <div className={`${widthClass} shrink-0`} style={previewWrapperStyle}>
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
                    <span>{heatmapMode === 'rage' ? 'Isolated friction' : 'Low intensity'}</span>
                    <div
                        className="mx-2 h-1.5 flex-1 rounded-full"
                        style={{
                            background: heatmapMode === 'rage'
                                ? 'linear-gradient(90deg, #cbd5e1, #f59e0b, #dc2626)'
                                : heatmapMode === 'attention'
                                    ? 'linear-gradient(90deg, rgba(52, 86, 205, 0.35), #1664e8, #16a4e9)'
                                    : 'linear-gradient(90deg, #4169e1, #18bab2 38%, #f5c442 68%, #e14539)',
                        }}
                    />
                    <span>{heatmapMode === 'rage' ? 'Repeated friction' : 'High intensity'}</span>
                </div>
            )}
        </div>
    );
};

const FrameCandidateImage: React.FC<{
    url: string;
    alt: string;
    selected?: boolean;
    fit?: 'cover' | 'contain';
}> = ({ url, alt, selected = false, fit = 'contain' }) => {
    const [blobUrl, setBlobUrl] = useState<string | null>(null);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        let cancelled = false;
        let objectUrl: string | null = null;
        setBlobUrl(null);
        setFailed(false);

        const fetchUrl = toAbsoluteHeatmapImageUrl(url);
        const csrfToken = getCsrfToken() || '';
        const sameOrigin = (() => {
            try {
                return new URL(fetchUrl, window.location.href).origin === window.location.origin;
            } catch {
                return true;
            }
        })();

        fetch(fetchUrl, {
            credentials: sameOrigin ? 'include' : 'omit',
            headers: sameOrigin
                ? { Accept: 'image/*', 'X-CSRF-Token': csrfToken }
                : { Accept: 'image/*' },
        })
            .then((response) => {
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                return response.blob();
            })
            .then((blob) => {
                if (cancelled) return;
                objectUrl = URL.createObjectURL(blob);
                setBlobUrl(objectUrl);
            })
            .catch(() => {
                if (!cancelled) setFailed(true);
            });

        return () => {
            cancelled = true;
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
    }, [url]);

    if (failed) {
        return (
            <div className={`flex h-full w-full items-center justify-center bg-slate-100 text-[11px] font-bold text-slate-500 ${selected ? 'ring-2 ring-cyan-500' : ''}`}>
                Unavailable
            </div>
        );
    }

    if (!blobUrl) {
        return <div className="h-full w-full animate-pulse bg-slate-200" />;
    }

    return (
        <img
            src={blobUrl}
            alt={alt}
            className={`h-full w-full ${fit === 'cover' ? 'object-cover' : 'object-contain'} ${selected ? 'ring-2 ring-cyan-500' : ''}`}
        />
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
    const manualRefreshVersion = useDashboardManualRefreshVersion();
    const { isDemoMode } = useDemoMode();
    const navigate = useNavigate();
    const pathPrefix = usePathPrefix();

    const [screens, setScreens] = useState<EnrichedHeatmapScreen[]>([]);
    const [screenIteration, setScreenIteration] = useState<HeatmapIterationSummary | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [lastUpdated, setLastUpdated] = useState('');
    const [partialError, setPartialError] = useState<string | null>(null);
    const [heatmapMode, setHeatmapMode] = useState<HeatmapViewMode>('attention');
    const [overlayOpacity, setOverlayOpacity] = useState(0.44);
    const [attentionByScreen, setAttentionByScreen] = useState<Record<string, WebAttentionHeatmapResponse>>({});
    const [attentionLoadingFor, setAttentionLoadingFor] = useState<string | null>(null);
    const [attentionErrors, setAttentionErrors] = useState<Record<string, string>>({});
    const [dataRefreshVersion, setDataRefreshVersion] = useState(0);
    const [baseFramePickerOpen, setBaseFramePickerOpen] = useState(false);
    const [baseFrameCandidates, setBaseFrameCandidates] = useState<HeatmapBaseFrameCandidate[]>([]);
    const [baseFrameLoading, setBaseFrameLoading] = useState(false);
    const [baseFrameError, setBaseFrameError] = useState<string | null>(null);
    const [selectedBaseFrameId, setSelectedBaseFrameId] = useState<string | null>(null);
    const [baseFrameSessionFilter, setBaseFrameSessionFilter] = useState(BASE_FRAME_ALL_SESSIONS);
    const [baseFramePage, setBaseFramePage] = useState(0);
    const [baseFrameSaving, setBaseFrameSaving] = useState(false);
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
            const demoScreens = overview.screens as EnrichedHeatmapScreen[];
            const filteredDemoScreens = !platform || platform === 'all'
                ? demoScreens
                : platform === 'mobile'
                    ? demoScreens.filter((screen) => screen.platform === 'ios' || screen.platform === 'android')
                    : demoScreens.filter((screen) => screen.platform === platform);
            setScreens(filteredDemoScreens);
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
                                baseTemplate: detail.baseTemplate ?? screen.baseTemplate ?? null,
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
    }, [selectedProject?.id, timeRange, platform, isDemoMode, manualRefreshVersion, dataRefreshVersion]);

    const sortedScreens = useMemo(() => (
        [...screens].sort((a, b) => {
            if (b.rangeVisits !== a.rangeVisits) return b.rangeVisits - a.rangeVisits;
            return b.rangeInteractions - a.rangeInteractions;
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
                baseTemplate: screen.baseTemplate ?? iterationFallback?.baseTemplate ?? fallback?.baseTemplate ?? null,
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
                baseTemplate: screen.baseTemplate ?? null,
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
            baseTemplate: selectedVersionEntry.screen.baseTemplate ?? selectedScreen.baseTemplate ?? null,
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
    const effectiveHeatmapMode: HeatmapViewMode = heatmapMode;
    const attentionAppVersion = (() => {
        const raw = selectedVersionEntry?.version.appVersion ?? null;
        return raw && raw !== 'All versions' ? raw : null;
    })();
    const baseFramePlatform = selectedViewer === 'web'
        ? 'web'
        : platform === 'ios' || platform === 'android'
            ? platform
            : 'mobile';
    const activeBaseTemplate = activeScreen?.baseTemplate ?? null;
    const attentionKey = selectedScreen ? `${selectedViewer}:${selectedScreen.name}::${attentionAppVersion ?? 'all'}` : null;
    const selectedAttention = attentionKey ? attentionByScreen[attentionKey] ?? null : null;
    const selectedAttentionError = attentionKey ? attentionErrors[attentionKey] ?? null : null;
    const selectedAttentionLoading = Boolean(attentionKey && attentionLoadingFor === attentionKey);
    const selectedModeLabel = isVersionSnapshotSelected
        ? `v${selectedVersionEntry?.version.appVersion} ${formatHeatmapModeLabel(effectiveHeatmapMode, selectedViewer).toLowerCase()}`
        : formatHeatmapModeLabel(effectiveHeatmapMode, selectedViewer);
    const attentionStatus = effectiveHeatmapMode === 'attention'
        ? selectedAttentionLoading
            ? { state: 'loading' as const, label: 'Building attention' }
            : selectedAttentionError
                ? { state: 'error' as const, label: selectedAttentionError }
                : selectedAttention?.reason && !(isDemoMode && selectedViewer === 'mobile')
                    ? { state: 'muted' as const, label: selectedAttention.reason }
                    : null
        : null;
    const availableHeatmapModes: HeatmapViewMode[] = [...getAvailableHeatmapModes(selectedViewer), 'rage'];
    const selectedBaseFrame = useMemo(
        () => baseFrameCandidates.find((candidate) => candidate.id === selectedBaseFrameId) || baseFrameCandidates[0] || null,
        [baseFrameCandidates, selectedBaseFrameId],
    );
    const baseFrameSessionOptions = useMemo(() => {
        const sessions = new Map<string, {
            sessionId: string;
            startedAt: string;
            platform: string | null;
            appVersion: string | null;
            count: number;
        }>();

        baseFrameCandidates.forEach((candidate) => {
            const existing = sessions.get(candidate.sessionId);
            if (existing) {
                existing.count += 1;
                return;
            }
            sessions.set(candidate.sessionId, {
                sessionId: candidate.sessionId,
                startedAt: candidate.sessionStartedAt,
                platform: candidate.platform,
                appVersion: candidate.appVersion,
                count: 1,
            });
        });

        return Array.from(sessions.values());
    }, [baseFrameCandidates]);
    const filteredBaseFrameCandidates = useMemo(() => (
        baseFrameSessionFilter === BASE_FRAME_ALL_SESSIONS
            ? baseFrameCandidates
            : baseFrameCandidates.filter((candidate) => candidate.sessionId === baseFrameSessionFilter)
    ), [baseFrameCandidates, baseFrameSessionFilter]);
    const baseFramePageCount = Math.max(1, Math.ceil(filteredBaseFrameCandidates.length / BASE_FRAME_PAGE_SIZE));
    const safeBaseFramePage = Math.min(baseFramePage, baseFramePageCount - 1);
    const visibleBaseFrameCandidates = filteredBaseFrameCandidates.slice(
        safeBaseFramePage * BASE_FRAME_PAGE_SIZE,
        safeBaseFramePage * BASE_FRAME_PAGE_SIZE + BASE_FRAME_PAGE_SIZE,
    );
    const baseFrameRangeStart = filteredBaseFrameCandidates.length === 0
        ? 0
        : safeBaseFramePage * BASE_FRAME_PAGE_SIZE + 1;
    const baseFrameRangeEnd = Math.min(
        filteredBaseFrameCandidates.length,
        safeBaseFramePage * BASE_FRAME_PAGE_SIZE + visibleBaseFrameCandidates.length,
    );
    const selectedBaseFrameIsWeb = isWebBaseFrameCandidate(selectedBaseFrame, baseFramePlatform);

    useEffect(() => {
        setBaseFramePage(0);
    }, [baseFrameSessionFilter]);

    useEffect(() => {
        if (!baseFramePickerOpen || !selectedBaseFrameId || filteredBaseFrameCandidates.length === 0) return;
        const selectedIndex = filteredBaseFrameCandidates.findIndex((candidate) => candidate.id === selectedBaseFrameId);
        if (selectedIndex < 0) return;
        const selectedPage = Math.floor(selectedIndex / BASE_FRAME_PAGE_SIZE);
        if (selectedPage !== baseFramePage) {
            setBaseFramePage(selectedPage);
        }
    }, [baseFramePage, baseFramePickerOpen, filteredBaseFrameCandidates, selectedBaseFrameId]);

    useEffect(() => {
        if (!baseFramePickerOpen || !activeScreen || !selectedProject?.id || isDemoMode) return;

        let cancelled = false;
        setBaseFrameLoading(true);
        setBaseFrameError(null);
        setBaseFrameCandidates([]);
        setSelectedBaseFrameId(null);
        setBaseFrameSessionFilter(BASE_FRAME_ALL_SESSIONS);
        setBaseFramePage(0);

        const range = getInsightsRangeFromTimeFilter(timeRange);
        getHeatmapBaseFrameCandidates(
            selectedProject.id,
            activeScreen.name,
            range,
            baseFramePlatform,
            attentionAppVersion,
        )
            .then((result) => {
                if (cancelled) return;
                setBaseFrameCandidates(result.candidates);
                const currentTemplate = result.baseTemplate ?? activeBaseTemplate;
                const currentCandidate = currentTemplate
                    ? result.candidates.find((candidate) => (
                        candidate.sessionId === currentTemplate.sourceSessionId
                        && Math.abs(candidate.timestamp - currentTemplate.sourceTimestampMs) < 1000
                    ))
                    : null;
                setSelectedBaseFrameId(currentCandidate?.id ?? result.candidates[0]?.id ?? null);
            })
            .catch((error: unknown) => {
                if (cancelled) return;
                heatmapDebug('Failed to load heatmap base frame candidates', { screenName: activeScreen.name, error });
                setBaseFrameError('No replay frames available for this route');
            })
            .finally(() => {
                if (!cancelled) setBaseFrameLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [
        activeBaseTemplate,
        activeScreen,
        attentionAppVersion,
        baseFramePickerOpen,
        baseFramePlatform,
        isDemoMode,
        selectedProject?.id,
        timeRange,
    ]);

    const handleSaveBaseFrame = async () => {
        if (!selectedProject?.id || !activeScreen || !selectedBaseFrame) return;
        setBaseFrameSaving(true);
        setBaseFrameError(null);
        try {
            await saveHeatmapBaseTemplate({
                projectId: selectedProject.id,
                screenName: activeScreen.name,
                sourceSessionId: selectedBaseFrame.sessionId,
                sourceTimestampMs: selectedBaseFrame.timestamp,
                platform: baseFramePlatform,
                appVersion: attentionAppVersion,
                pageWidth: activeScreen.pageWidth ?? null,
                pageHeight: activeScreen.pageHeight ?? null,
                viewportWidth: activeScreen.viewportWidth ?? null,
                viewportHeight: activeScreen.viewportHeight ?? null,
            });
            setBaseFramePickerOpen(false);
            setDataRefreshVersion((value) => value + 1);
        } catch (error) {
            heatmapDebug('Failed to save heatmap base frame', { screenName: activeScreen.name, error });
            setBaseFrameError('Could not save that frame');
        } finally {
            setBaseFrameSaving(false);
        }
    };

    const handleResetBaseFrame = async () => {
        if (!selectedProject?.id || !activeBaseTemplate) return;
        setBaseFrameSaving(true);
        setBaseFrameError(null);
        try {
            await deleteHeatmapBaseTemplate(selectedProject.id, activeBaseTemplate.id);
            setBaseFramePickerOpen(false);
            setDataRefreshVersion((value) => value + 1);
        } catch (error) {
            heatmapDebug('Failed to reset heatmap base frame', { templateId: activeBaseTemplate.id, error });
            setBaseFrameError('Could not reset the base frame');
        } finally {
            setBaseFrameSaving(false);
        }
    };

    useEffect(() => {
        if (!selectedScreenName) return;
        const nextMode = getDefaultHeatmapMode(selectedViewer);
        setHeatmapMode((currentMode) => currentMode === nextMode ? currentMode : nextMode);
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

    const replayEvidenceSessionId = activeScreen ? getPreferredHeatmapSessionId(activeScreen) : null;
    const selectedRageHotspotCount = activeScreen?.touchHotspots?.filter((hotspot) => hotspot.isRageTap || hotspot.kind === 'rage').length ?? 0;
    const hasVisualBase = Boolean(activeScreen?.screenshotUrl || activeScreen?.baseTemplate || replayEvidenceSessionId);
    const selectedVisitors = selectedScreen?.rangeUniqueVisitors ?? selectedScreen?.rangeVisits ?? 0;
    const selectedSessions = selectedScreen?.rangeVisits ?? 0;
    const selectedInteractions = selectedScreen?.rangeInteractions ?? 0;
    const interactionsPerSession = selectedSessions > 0 ? selectedInteractions / selectedSessions : 0;
    const replaySampleCount = activeScreen ? getHeatmapEvidenceSessionIds(activeScreen).length : 0;

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
                <div className="heatmap-pro-studio">
                    <header className="heatmap-pro-toolbar">
                        <label className="heatmap-pro-route">
                            <span>{selectedViewer === 'web' ? <Monitor className="h-3.5 w-3.5" /> : <Smartphone className="h-3.5 w-3.5" />}</span>
                            <span className="heatmap-pro-route-select">
                                <small>{selectedViewer === 'web' ? 'Page' : 'Screen'}</small>
                                <select
                                    aria-label={selectedViewer === 'web' ? 'Select page' : 'Select screen'}
                                    value={selectedScreen.name}
                                    onChange={(event) => {
                                        setSelectedScreenName(event.target.value);
                                        setSelectedVersionKey('current');
                                    }}
                                >
                                    {sortedScreens.map((screen) => (
                                        <option key={screen.name} value={screen.name}>{getDisplayRoute(screen.name)}</option>
                                    ))}
                                </select>
                            </span>
                        </label>

                        <div className="heatmap-pro-modes" role="group" aria-label="Heatmap mode">
                            {availableHeatmapModes.map((mode) => (
                                <button
                                    key={mode}
                                    type="button"
                                    onClick={() => setHeatmapMode(mode)}
                                    aria-pressed={effectiveHeatmapMode === mode}
                                    className={effectiveHeatmapMode === mode ? 'is-active' : ''}
                                >
                                    {mode === 'attention' ? <Eye className="h-4 w-4" /> : mode === 'rage' ? <Flame className="h-4 w-4" /> : <MousePointer2 className="h-4 w-4" />}
                                    {mode === 'attention' ? 'Attention' : mode === 'rage' ? 'Rage' : selectedViewer === 'web' ? 'Clicks' : 'Touches'}
                                </button>
                            ))}
                        </div>

                        <div className="heatmap-pro-toolbar-actions">
                            <label className="heatmap-pro-intensity">
                                <span>Overlay</span>
                                <input
                                    type="range"
                                    min="0.2"
                                    max="0.9"
                                    step="0.05"
                                    value={overlayOpacity}
                                    onChange={(event) => setOverlayOpacity(Number(event.target.value))}
                                />
                                <strong>{Math.round(overlayOpacity * 100)}%</strong>
                            </label>
                            {replayEvidenceSessionId && (
                                <button
                                    type="button"
                                    className="heatmap-pro-replay-button"
                                    onClick={() => navigate(`${pathPrefix}/sessions/${replayEvidenceSessionId}`)}
                                >
                                    <PlayCircle className="h-4 w-4" />
                                    Replay
                                </button>
                            )}
                        </div>
                    </header>

                    <div className="heatmap-pro-summary" aria-label="Heatmap summary">
                        <div>
                            <span>Visitors</span>
                            <strong>{formatCompactCount(selectedVisitors)}</strong>
                            <small>unique people</small>
                        </div>
                        <div>
                            <span>Sessions</span>
                            <strong>{formatCompactCount(selectedSessions)}</strong>
                            <small>viewed this {selectedViewer === 'web' ? 'page' : 'screen'}</small>
                        </div>
                        <div>
                            <span>{selectedViewer === 'web' ? 'Clicks' : 'Touches'}</span>
                            <strong>{formatCompactCount(selectedInteractions)}</strong>
                            <small>recorded interactions</small>
                        </div>
                        <div>
                            <span>Per session</span>
                            <strong>{interactionsPerSession.toFixed(1)}</strong>
                            <small>interactions on average</small>
                        </div>
                        <div>
                            <span>Rage {selectedViewer === 'web' ? 'clicks' : 'taps'}</span>
                            <strong>{formatCompactCount(selectedScreen.rangeRageTaps)}</strong>
                            <small>{selectedScreen.rangeRageTapRatePer100.toFixed(1)} per 100 sessions</small>
                        </div>
                    </div>

                    <div className="heatmap-pro-body">
                        <main className="heatmap-pro-canvas" aria-label="Selected heatmap">
                            <div className="heatmap-pro-canvas-meta">
                                <span>{selectedModeLabel}</span>
                                <span>{formatCompactCount(effectiveHeatmapMode === 'rage' ? selectedScreen.rangeRageTaps : selectedInteractions)} {effectiveHeatmapMode === 'rage' ? 'rage interactions' : 'interactions'}</span>
                                <span className={hasVisualBase ? 'is-ready' : 'is-warning'}>
                                    {hasVisualBase ? <Check className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
                                    {hasVisualBase ? 'Replay matched' : 'No visual match'}
                                </span>
                            </div>
                            <div className={`heatmap-pro-stage ${selectedViewer === 'web' ? 'heatmap-web-scroll-stage' : ''}`}>
                                <HeatmapPreview
                                    screen={activeScreen}
                                    compact={compact}
                                    showLegend
                                    viewerMode="auto"
                                    projectPlatforms={projectPlatforms}
                                    heatmapMode={effectiveHeatmapMode}
                                    attentionData={selectedAttention}
                                    overlayOpacity={overlayOpacity}
                                />
                                {attentionStatus?.state === 'loading' && (
                                    <div className="heatmap-stage-overlay" role="status" aria-live="polite">
                                        <div className="heatmap-stage-overlay-card">
                                            <Loader2 className="h-5 w-5 animate-spin" />
                                            <span>{attentionStatus.label}</span>
                                        </div>
                                    </div>
                                )}
                                {effectiveHeatmapMode === 'rage' && selectedRageHotspotCount === 0 && (
                                    <div className="heatmap-empty-layer" role="status">
                                        <Flame className="h-4 w-4" />
                                        No rage interactions
                                    </div>
                                )}
                            </div>
                        </main>

                        <aside className="heatmap-pro-inspector" aria-label="Heatmap insights">
                            <div className="heatmap-pro-inspector-heading">
                                <small>Page insights</small>
                                <strong>Behavior signals</strong>
                            </div>
                            <dl className="heatmap-pro-signal-list">
                                <div>
                                    <span><Flame className="h-4 w-4" /></span>
                                    <dt>Rage {selectedViewer === 'web' ? 'clicks' : 'taps'}<small>Repeated interactions</small></dt>
                                    <dd>{formatCompactCount(selectedScreen.rangeRageTaps)}</dd>
                                </div>
                                <div>
                                    <span><AlertTriangle className="h-4 w-4" /></span>
                                    <dt>Errors<small>Sessions reporting errors</small></dt>
                                    <dd>{formatCompactCount(selectedScreen.rangeErrors)}</dd>
                                </div>
                                <div>
                                    <span><RotateCcw className="h-4 w-4" /></span>
                                    <dt>Exit rate<small>Sessions ending here</small></dt>
                                    <dd>{selectedScreen.rangeExitRate.toFixed(1)}%</dd>
                                </div>
                            </dl>
                            <label className="heatmap-pro-version">
                                <span>App / site version</span>
                                <select value={selectedVersionKey} onChange={(event) => setSelectedVersionKey(event.target.value)}>
                                    <option value="current">All versions</option>
                                    {selectedVersionOptions.map(({ key, version }) => (
                                        <option key={key} value={key}>v{version.appVersion}</option>
                                    ))}
                                </select>
                            </label>
                            <section className="heatmap-pro-evidence">
                                <div>
                                    <span className={hasVisualBase ? 'is-ready' : 'is-warning'} />
                                    <p><strong>{hasVisualBase ? 'Replay available' : 'Interaction data only'}</strong><small>{hasVisualBase ? `${Math.max(1, replaySampleCount)} matching recording sample${replaySampleCount === 1 ? '' : 's'}` : 'Try another version or range'}</small></p>
                                </div>
                                {replayEvidenceSessionId && (
                                    <button type="button" onClick={() => navigate(`${pathPrefix}/sessions/${replayEvidenceSessionId}`)}>
                                        Watch matching session
                                    </button>
                                )}
                                {!isDemoMode && selectedViewer !== 'web' && (
                                    <button type="button" onClick={() => setBaseFramePickerOpen(true)}>
                                        {activeBaseTemplate ? 'Change frame' : 'Choose frame'}
                                    </button>
                                )}
                            </section>
                            {attentionStatus && attentionStatus.state !== 'loading' && (
                                <div className={`heatmap-pro-notice is-${attentionStatus.state}`} role="status">{attentionStatus.label}</div>
                            )}
                        </aside>
                    </div>
                </div>
            )}

            {baseFramePickerOpen && activeScreen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Choose heatmap base frame">
                    <button
                        type="button"
                        className="absolute inset-0 bg-slate-950/50"
                        aria-label="Close"
                        onClick={() => {
                            if (!baseFrameSaving) setBaseFramePickerOpen(false);
                        }}
                    />
                    <div className="relative flex h-[92vh] max-h-[920px] w-[min(1480px,calc(100vw-1.25rem))] flex-col overflow-hidden rounded-lg border-2 border-black bg-white shadow-neo">
                        <div className="flex items-center justify-between gap-3 border-b-2 border-black px-4 py-3">
                            <div className="min-w-0">
                                <span className="heatmap-eyebrow">
                                    <ImageIcon className="h-3.5 w-3.5" />
                                    Base frame
                                </span>
                                <h3 className="truncate text-base font-black text-slate-950" title={activeScreen.name}>{activeScreen.name}</h3>
                            </div>
                            <button
                                type="button"
                                aria-label="Close"
                                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 transition hover:border-slate-950 hover:text-slate-950"
                                disabled={baseFrameSaving}
                                onClick={() => setBaseFramePickerOpen(false)}
                            >
                                <X className="h-4 w-4" />
                            </button>
                        </div>

                        <div className="grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-[360px_minmax(0,1fr)]">
                            <aside className="min-h-0 overflow-y-auto border-b-2 border-black bg-slate-50 p-4 xl:border-b-0 xl:border-r-2">
                                <div className="flex items-center justify-between gap-3">
                                    <span className="text-xs font-black uppercase text-slate-700">Selected frame</span>
                                    {selectedBaseFrame && (
                                        <span className="shrink-0 rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-black text-slate-700">
                                            Frame {selectedBaseFrame.frameIndex + 1}
                                        </span>
                                    )}
                                </div>
                                <div
                                    className={`mx-auto mt-3 overflow-hidden rounded-md border-2 border-black bg-white shadow-neo-sm ${selectedBaseFrameIsWeb ? 'aspect-video w-full' : 'aspect-[9/16] max-h-[52vh] w-full max-w-[280px]'}`}
                                >
                                    {selectedBaseFrame ? (
                                        <FrameCandidateImage
                                            url={selectedBaseFrame.url}
                                            alt={`Selected frame ${selectedBaseFrame.frameIndex + 1}`}
                                            fit="contain"
                                        />
                                    ) : (
                                        <div className="flex h-full w-full items-center justify-center text-xs font-bold text-slate-500">
                                            Select a frame
                                        </div>
                                    )}
                                </div>

                                {selectedBaseFrame && (
                                    <dl className="mt-4 space-y-3 text-xs">
                                        <div>
                                            <dt className="font-black uppercase text-slate-500">Time</dt>
                                            <dd className="mt-1 font-black text-slate-900">{formatFrameOffset(selectedBaseFrame.relativeSeconds)}</dd>
                                        </div>
                                        <div>
                                            <dt className="font-black uppercase text-slate-500">Session</dt>
                                            <dd className="mt-1 break-all font-bold text-slate-800">{selectedBaseFrame.sessionId}</dd>
                                        </div>
                                        <div className="grid grid-cols-2 gap-3">
                                            <div>
                                                <dt className="font-black uppercase text-slate-500">Platform</dt>
                                                <dd className="mt-1 font-bold text-slate-800">{formatBaseFramePlatform(selectedBaseFrame.platform)}</dd>
                                            </div>
                                            <div>
                                                <dt className="font-black uppercase text-slate-500">Version</dt>
                                                <dd className="mt-1 font-bold text-slate-800">{selectedBaseFrame.appVersion || 'All'}</dd>
                                            </div>
                                        </div>
                                        <div>
                                            <dt className="font-black uppercase text-slate-500">Started</dt>
                                            <dd className="mt-1 font-bold text-slate-800">{formatBaseFrameSessionStartedAt(selectedBaseFrame.sessionStartedAt)}</dd>
                                        </div>
                                    </dl>
                                )}

                                {baseFrameError && baseFrameCandidates.length > 0 && (
                                    <p className="mt-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">{baseFrameError}</p>
                                )}
                            </aside>

                            <section className="flex min-h-0 flex-col">
                                <div className="border-b border-slate-200 bg-white px-4 py-3">
                                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                                        <div className="min-w-0">
                                            <p className="text-sm font-black text-slate-950">
                                                {baseFrameCandidates.length.toLocaleString()} frame{baseFrameCandidates.length === 1 ? '' : 's'}
                                            </p>
                                            <p className="mt-0.5 text-xs font-semibold text-slate-500">
                                                {filteredBaseFrameCandidates.length > 0
                                                    ? `Showing ${baseFrameRangeStart}-${baseFrameRangeEnd} of ${filteredBaseFrameCandidates.length.toLocaleString()}`
                                                    : 'No frames in this session'}
                                            </p>
                                        </div>
                                        <div className="flex flex-wrap items-center gap-2">
                                            <label className="sr-only" htmlFor="base-frame-session-filter">Session</label>
                                            <select
                                                id="base-frame-session-filter"
                                                value={baseFrameSessionFilter}
                                                onChange={(event) => {
                                                    const nextSessionId = event.target.value;
                                                    setBaseFrameSessionFilter(nextSessionId);
                                                    const nextCandidate = nextSessionId === BASE_FRAME_ALL_SESSIONS
                                                        ? baseFrameCandidates[0]
                                                        : baseFrameCandidates.find((candidate) => candidate.sessionId === nextSessionId);
                                                    if (nextCandidate) setSelectedBaseFrameId(nextCandidate.id);
                                                }}
                                                disabled={baseFrameLoading || baseFrameCandidates.length === 0}
                                                className="h-9 max-w-[260px] rounded-md border border-slate-300 bg-white px-3 text-xs font-bold text-slate-800 outline-none transition hover:border-slate-950 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100"
                                            >
                                                <option value={BASE_FRAME_ALL_SESSIONS}>All sessions ({baseFrameCandidates.length})</option>
                                                {baseFrameSessionOptions.map((session) => (
                                                    <option key={session.sessionId} value={session.sessionId}>
                                                        {shortSessionId(session.sessionId)} · {session.count} · {formatBaseFrameSessionStartedAt(session.startedAt)}
                                                    </option>
                                                ))}
                                            </select>
                                            <div className="inline-flex h-9 overflow-hidden rounded-md border border-slate-300 bg-white">
                                                <button
                                                    type="button"
                                                    aria-label="Previous frame page"
                                                    onClick={() => setBaseFramePage((page) => Math.max(0, page - 1))}
                                                    disabled={safeBaseFramePage === 0 || filteredBaseFrameCandidates.length === 0}
                                                    className="inline-flex w-9 items-center justify-center text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                                                >
                                                    <ChevronLeft className="h-4 w-4" />
                                                </button>
                                                <span className="inline-flex min-w-[76px] items-center justify-center border-x border-slate-300 px-2 text-[11px] font-black text-slate-700">
                                                    {safeBaseFramePage + 1} / {baseFramePageCount}
                                                </span>
                                                <button
                                                    type="button"
                                                    aria-label="Next frame page"
                                                    onClick={() => setBaseFramePage((page) => Math.min(baseFramePageCount - 1, page + 1))}
                                                    disabled={safeBaseFramePage >= baseFramePageCount - 1 || filteredBaseFrameCandidates.length === 0}
                                                    className="inline-flex w-9 items-center justify-center text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                                                >
                                                    <ChevronRight className="h-4 w-4" />
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div className="min-h-0 flex-1 overflow-y-auto p-4">
                                    {baseFrameLoading ? (
                                        <div className="flex min-h-[360px] items-center justify-center gap-3 text-sm font-black text-slate-800">
                                            <Loader2 className="h-5 w-5 animate-spin text-cyan-600" />
                                            Loading replay frames
                                        </div>
                                    ) : baseFrameCandidates.length === 0 ? (
                                        <div className="flex min-h-[360px] flex-col items-center justify-center text-center">
                                            <ImageIcon className="mb-3 h-9 w-9 text-slate-400" />
                                            <p className="text-sm font-black text-slate-900">No replay frames found</p>
                                            <p className="mt-1 text-xs font-semibold text-slate-500">{baseFrameError || 'Try another version or time range.'}</p>
                                        </div>
                                    ) : visibleBaseFrameCandidates.length === 0 ? (
                                        <div className="flex min-h-[360px] flex-col items-center justify-center text-center">
                                            <ImageIcon className="mb-3 h-9 w-9 text-slate-400" />
                                            <p className="text-sm font-black text-slate-900">No frames in this session</p>
                                            <p className="mt-1 text-xs font-semibold text-slate-500">Choose another session from the menu.</p>
                                        </div>
                                    ) : (
                                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 2xl:grid-cols-4">
                                            {visibleBaseFrameCandidates.map((candidate) => {
                                                const selected = selectedBaseFrame?.id === candidate.id;
                                                const candidateIsWeb = isWebBaseFrameCandidate(candidate, baseFramePlatform);
                                                return (
                                                    <button
                                                        key={candidate.id}
                                                        type="button"
                                                        aria-pressed={selected}
                                                        onClick={() => setSelectedBaseFrameId(candidate.id)}
                                                        className={`min-w-0 overflow-hidden rounded-md border-2 bg-white text-left transition ${selected ? 'border-cyan-500 shadow-neo-sm' : 'border-slate-200 hover:border-slate-950'}`}
                                                    >
                                                        <div className={`relative overflow-hidden bg-slate-100 ${candidateIsWeb ? 'aspect-video' : 'aspect-[9/16]'}`}>
                                                            <FrameCandidateImage url={candidate.url} alt={`Frame ${candidate.frameIndex + 1}`} selected={selected} fit="contain" />
                                                            {selected && (
                                                                <span className="absolute right-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded-full border border-white bg-cyan-500 text-white">
                                                                    <Check className="h-3.5 w-3.5" />
                                                                </span>
                                                            )}
                                                        </div>
                                                        <div className="flex items-center justify-between gap-2 px-2 py-2 text-[11px] font-bold text-slate-600">
                                                            <span className="tabular-nums">{formatFrameOffset(candidate.relativeSeconds)}</span>
                                                            <span className="truncate">Frame {candidate.frameIndex + 1}</span>
                                                        </div>
                                                        <div className="border-t border-slate-100 px-2 pb-2 text-[10px] font-semibold text-slate-400">
                                                            {shortSessionId(candidate.sessionId)}
                                                        </div>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            </section>
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-3 border-t-2 border-black px-4 py-3">
                            <div className="min-w-0 max-w-full truncate text-xs font-semibold text-slate-500">
                                {selectedBaseFrame
                                    ? `${selectedBaseFrame.sessionId} at ${formatFrameOffset(selectedBaseFrame.relativeSeconds)}`
                                    : activeBaseTemplate
                                        ? 'Using saved base frame'
                                        : 'No frame selected'}
                            </div>
                            <div className="flex items-center gap-2">
                                {activeBaseTemplate && (
                                    <button
                                        type="button"
                                        onClick={handleResetBaseFrame}
                                        disabled={baseFrameSaving}
                                        className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-xs font-black text-slate-700 transition hover:border-rose-400 hover:text-rose-700 disabled:opacity-60"
                                    >
                                        <RotateCcw className="h-4 w-4" />
                                        Reset
                                    </button>
                                )}
                                <button
                                    type="button"
                                    onClick={handleSaveBaseFrame}
                                    disabled={!selectedBaseFrame || baseFrameSaving || baseFrameLoading}
                                    className="inline-flex h-9 items-center gap-2 rounded-md border-2 border-black bg-cyan-400 px-4 text-xs font-black text-slate-950 shadow-neo-sm transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    {baseFrameSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                                    Save
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </section>
    );
};
