import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MousePointer2 } from 'lucide-react';
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

const TOUCH_HEATMAP_DEBUG_PREFIX = '[TouchHeatmapDebug]';

function heatmapDebug(message: string, details?: unknown): void {
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
            const a = Math.round(120 + s * 75);
            return [Math.round(28 + s * 38), Math.round(140 + s * 80), Math.round(210 - s * 95), a];
        }
        if (t < 0.45) {
            const s = (t - 0.2) / 0.25;
            const a = Math.round(200 + s * 40);
            return [Math.round(66 + s * 185), Math.round(220 - s * 20), Math.round(115 - s * 95), a];
        }
        if (t < 0.75) {
            const s = (t - 0.45) / 0.3;
            const a = Math.round(235 + s * 15);
            return [255, Math.round(200 - s * 120), Math.round(20 + s * 10), a];
        }
        const s = (t - 0.75) / 0.25;
        return [255, Math.round(80 - s * 45), Math.round(20 + s * 35), 255];
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

interface PreviewHeatmapScreen {
    name: string;
    screenshotUrl: string | null;
    touchHotspots?: HeatmapHotspot[];
    evidenceSessionId?: string | null;
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

const HeatmapPreview: React.FC<{
    screen: PreviewHeatmapScreen;
    compact?: boolean;
    tile?: boolean;
    showLegend?: boolean;
}> = ({ screen, compact = false, tile = false, showLegend = true }) => {
    const [blobUrl, setBlobUrl] = useState<string | null>(null);
    const [imageLoaded, setImageLoaded] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [downloadProgress, setDownloadProgress] = useState(0);

    const containerRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const blobUrlRef = useRef<string | null>(null);

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
        const separator = fullCoverUrl.includes('?') ? '&' : '?';
        const fetchUrl = `${fullCoverUrl}${separator}_cb=${Date.now()}`;

        const fetchWithProgress = async () => {
            heatmapDebug('Fetching screenshot blob', {
                screenName: screen.name,
                fetchUrl,
                csrfTokenPresent: Boolean(csrfToken),
                requestedAt: new Date(fetchStartedAt).toISOString(),
            });

            const response = await fetch(fetchUrl, {
                credentials: 'include',
                cache: 'no-store',
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
                    setLoadError(error.message || 'Failed to load screenshot');
                    return;
                }
                setLoadError('Failed to load screenshot');
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

    const widthClass = tile ? (compact ? 'w-[148px]' : 'w-[184px]') : `mx-auto w-full ${compact ? 'max-w-[310px]' : 'max-w-[360px]'}`;
    const frameClass = tile
        ? 'rounded-[24px] border border-slate-700 bg-slate-900 p-2 shadow-lg'
        : 'rounded-[32px] border border-slate-700 bg-slate-900 p-3 shadow-2xl';
    const screenClass = tile
        ? 'relative aspect-[9/19] overflow-hidden rounded-[18px] bg-slate-800'
        : 'relative aspect-[9/19] overflow-hidden rounded-[24px] bg-slate-800';

    return (
        <div className={`${widthClass} shrink-0`}>
            <div className={frameClass}>
                <div ref={containerRef} className={screenClass}>
                    {blobUrl ? (
                        <img
                            src={blobUrl}
                            alt={screen.name}
                            className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-200 ${imageLoaded ? 'opacity-95' : 'opacity-0'}`}
                            onLoad={() => {
                                heatmapDebug('Screenshot image element loaded successfully', {
                                    screenName: screen.name,
                                    blobUrl,
                                });
                                setImageLoaded(true);
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
                        <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-b from-slate-700 to-slate-900 p-4 text-center">
                            <MousePointer2 className="mb-2 h-8 w-8 text-slate-400" />
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-300">{screen.name}</p>
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
                                    className={`absolute rounded-full border border-white/50 ${hotspot.isRageTap ? 'bg-rose-500/60' : 'bg-emerald-400/55'}`}
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
            </div>

            {showLegend && (
                <div className="mt-3 flex items-center justify-between text-[11px] font-medium text-slate-500">
                    <span>Low intensity</span>
                    <div className="mx-2 h-1.5 flex-1 rounded-full bg-gradient-to-r from-emerald-400 via-amber-400 to-rose-500" />
                    <span>High intensity</span>
                </div>
            )}
        </div>
    );
};

const HeatmapTile: React.FC<{
    screen: PreviewHeatmapScreen;
    visitsLabel?: string;
    incidentLabel?: string;
    compact?: boolean;
    detailLabel?: string;
}> = ({ screen, visitsLabel, incidentLabel, compact = false, detailLabel }) => (
    <article className={`dashboard-surface shrink-0 border-2 border-black bg-white p-3 shadow-neo-sm ${compact ? 'w-[178px]' : 'w-[220px]'}`}>
        <div className="mb-2 min-h-[46px]">
            <h3 className="truncate text-sm font-black uppercase tracking-wide text-black" title={screen.name}>
                {screen.name}
            </h3>
            {detailLabel ? (
                <p className="mt-1 truncate text-[11px] font-mono text-slate-500" title={detailLabel}>
                    {detailLabel}
                </p>
            ) : null}
        </div>
        <HeatmapPreview screen={screen} compact={compact} tile showLegend={false} />
        {(visitsLabel || incidentLabel) ? (
            <div className="mt-2 flex items-center justify-between gap-2 text-[11px] font-mono">
                {visitsLabel ? <span className="truncate text-slate-500">{visitsLabel}</span> : <span />}
                {incidentLabel ? <span className="shrink-0 font-black text-rose-600">{incidentLabel}</span> : null}
            </div>
        ) : null}
    </article>
);

interface TouchHeatmapSectionProps {
    timeRange?: TimeRange;
    compact?: boolean;
    className?: string;
}

export const TouchHeatmapSection: React.FC<TouchHeatmapSectionProps> = ({
    timeRange = '30d',
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
            const demoScreens: EnrichedHeatmapScreen[] = [
                {
                    name: 'HomeScreen',
                    visits: 4820,
                    rageTaps: 142,
                    errors: 38,
                    exitRate: 12.4,
                    frictionScore: 34,
                    screenshotUrl: null,
                    sessionIds: [],
                    touchHotspots: [
                        { x: 0.5, y: 0.3, intensity: 0.9, isRageTap: false },
                        { x: 0.3, y: 0.6, intensity: 0.7, isRageTap: true },
                        { x: 0.7, y: 0.5, intensity: 0.5, isRageTap: false },
                        { x: 0.5, y: 0.8, intensity: 0.4, isRageTap: false },
                    ],
                    rangeVisits: 1240,
                    rangeRageTaps: 48,
                    rangeErrors: 12,
                    rangeExitRate: 12.4,
                    rangeFrictionScore: 34,
                    rangeImpactScore: 52,
                    rangeRageTapRatePer100: 3.9,
                    rangeErrorRatePer100: 1.0,
                    rangeIncidentRatePer100: 4.9,
                    rangeEstimatedAffectedSessions: 61,
                    primarySignal: 'rage_taps',
                    confidence: 'high',
                    priority: 'critical',
                    evidenceSessionId: null,
                },
                {
                    name: 'CheckoutScreen',
                    visits: 2100,
                    rageTaps: 89,
                    errors: 55,
                    exitRate: 28.1,
                    frictionScore: 58,
                    screenshotUrl: null,
                    sessionIds: [],
                    touchHotspots: [
                        { x: 0.5, y: 0.7, intensity: 0.95, isRageTap: true },
                        { x: 0.5, y: 0.5, intensity: 0.6, isRageTap: false },
                        { x: 0.2, y: 0.4, intensity: 0.3, isRageTap: false },
                    ],
                    rangeVisits: 540,
                    rangeRageTaps: 22,
                    rangeErrors: 14,
                    rangeExitRate: 28.1,
                    rangeFrictionScore: 58,
                    rangeImpactScore: 71,
                    rangeRageTapRatePer100: 4.1,
                    rangeErrorRatePer100: 2.6,
                    rangeIncidentRatePer100: 6.7,
                    rangeEstimatedAffectedSessions: 36,
                    primarySignal: 'exits',
                    confidence: 'high',
                    priority: 'critical',
                    evidenceSessionId: null,
                },
                {
                    name: 'ProfileScreen',
                    visits: 1850,
                    rageTaps: 21,
                    errors: 8,
                    exitRate: 6.2,
                    frictionScore: 12,
                    screenshotUrl: null,
                    sessionIds: [],
                    touchHotspots: [
                        { x: 0.5, y: 0.2, intensity: 0.6, isRageTap: false },
                        { x: 0.5, y: 0.5, intensity: 0.4, isRageTap: false },
                    ],
                    rangeVisits: 480,
                    rangeRageTaps: 5,
                    rangeErrors: 2,
                    rangeExitRate: 6.2,
                    rangeFrictionScore: 12,
                    rangeImpactScore: 18,
                    rangeRageTapRatePer100: 1.0,
                    rangeErrorRatePer100: 0.4,
                    rangeIncidentRatePer100: 1.4,
                    rangeEstimatedAffectedSessions: 7,
                    primarySignal: 'mixed',
                    confidence: 'medium',
                    priority: 'watch',
                    evidenceSessionId: null,
                },
                {
                    name: 'OnboardingScreen',
                    visits: 3200,
                    rageTaps: 64,
                    errors: 29,
                    exitRate: 41.5,
                    frictionScore: 67,
                    screenshotUrl: null,
                    sessionIds: [],
                    touchHotspots: [
                        { x: 0.5, y: 0.85, intensity: 0.88, isRageTap: true },
                        { x: 0.5, y: 0.6, intensity: 0.5, isRageTap: false },
                        { x: 0.8, y: 0.3, intensity: 0.3, isRageTap: false },
                    ],
                    rangeVisits: 820,
                    rangeRageTaps: 16,
                    rangeErrors: 7,
                    rangeExitRate: 41.5,
                    rangeFrictionScore: 67,
                    rangeImpactScore: 63,
                    rangeRageTapRatePer100: 2.0,
                    rangeErrorRatePer100: 0.9,
                    rangeIncidentRatePer100: 2.9,
                    rangeEstimatedAffectedSessions: 24,
                    primarySignal: 'exits',
                    confidence: 'high',
                    priority: 'critical',
                    evidenceSessionId: null,
                },
                {
                    name: 'SearchScreen',
                    visits: 980,
                    rageTaps: 12,
                    errors: 4,
                    exitRate: 8.3,
                    frictionScore: 9,
                    screenshotUrl: null,
                    sessionIds: [],
                    touchHotspots: [
                        { x: 0.5, y: 0.15, intensity: 0.7, isRageTap: false },
                        { x: 0.5, y: 0.4, intensity: 0.3, isRageTap: false },
                    ],
                    rangeVisits: 250,
                    rangeRageTaps: 3,
                    rangeErrors: 1,
                    rangeExitRate: 8.3,
                    rangeFrictionScore: 9,
                    rangeImpactScore: 11,
                    rangeRageTapRatePer100: 1.2,
                    rangeErrorRatePer100: 0.4,
                    rangeIncidentRatePer100: 1.6,
                    rangeEstimatedAffectedSessions: 4,
                    primarySignal: 'mixed',
                    confidence: 'medium',
                    priority: 'watch',
                    evidenceSessionId: null,
                },
            ];

            const demoVersion = (appVersion: string, offset: number): VersionHeatmapGroup => ({
                appVersion,
                firstSeenAt: null,
                lastSeenAt: null,
                sessions: Math.max(12, 48 - offset * 8),
                screens: demoScreens.map((screen) => ({
                    name: screen.name,
                    screenshotUrl: screen.screenshotUrl,
                    visits: Math.max(1, Math.round(screen.rangeVisits * (0.68 + offset * 0.16))),
                    touches: Math.max(1, Math.round(screen.visits * (0.55 + offset * 0.1))),
                    rageTaps: Math.max(0, Math.round(screen.rangeRageTaps * (1.2 - offset * 0.18))),
                    errors: Math.max(0, Math.round(screen.rangeErrors * (1.1 - offset * 0.12))),
                    incidentRatePer100: Math.max(0.4, Number((screen.rangeIncidentRatePer100 * (1.15 - offset * 0.18)).toFixed(1))),
                    lastSeenAt: null,
                    evidenceSessionId: screen.evidenceSessionId,
                    touchHotspots: (screen.touchHotspots || []).map((spot) => ({
                        ...spot,
                        x: Math.max(0.08, Math.min(0.92, spot.x + (offset - 1) * 0.05)),
                        y: Math.max(0.08, Math.min(0.92, spot.y + (offset - 1) * 0.03)),
                        intensity: Math.max(0.2, Math.min(1, spot.intensity * (1.08 - offset * 0.08))),
                    })),
                })),
            });

            setScreens(demoScreens);
            setScreenIteration({
                overall: demoScreens.map((screen) => ({
                    name: screen.name,
                    screenshotUrl: screen.screenshotUrl,
                    visits: screen.rangeVisits,
                    touches: screen.visits,
                    rageTaps: screen.rangeRageTaps,
                    errors: screen.rangeErrors,
                    incidentRatePer100: screen.rangeIncidentRatePer100,
                    lastSeenAt: null,
                    evidenceSessionId: screen.evidenceSessionId,
                    touchHotspots: screen.touchHotspots,
                })),
                versions: [demoVersion('1.2.0', 0), demoVersion('1.3.0', 1), demoVersion('1.4.0', 2)],
            });
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

        getHeatmapsOverview(selectedProject.id, range)
            .then(async (overview) => {
                if (cancelled) return;

                heatmapDebug('Touch heatmap overview fetched', {
                    projectId: selectedProject.id,
                    timeRange,
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
                    const results = await Promise.allSettled(
                        screensNeedingHotspots.map((screen) => (
                            getHeatmapScreenOverview(selectedProject.id, screen.name, range)
                        )),
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
    }, [selectedProject?.id, timeRange, isDemoMode]);

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
                evidenceSessionId: screen.evidenceSessionId ?? iterationFallback?.evidenceSessionId ?? fallback?.evidenceSessionId ?? null,
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
            })),
        }];
    }, [iterationScreenByName, lastUpdated, screenByName, screenIteration?.versions, sortedScreens]);

    if (!selectedProject?.id && !isDemoMode) {
        return (
            <section className={`dashboard-surface p-6 shadow-sm ${className}`.trim()}>
                <p className="text-sm text-slate-500">Select a project to view touch heatmaps.</p>
            </section>
        );
    }

    if (isLoading) {
        return (
            <section className={`dashboard-surface p-6 shadow-sm ${className}`.trim()}>
                <div className="flex items-center gap-3 text-sm text-slate-600">
                    <MousePointer2 className="h-4 w-4 animate-pulse text-blue-600" />
                    Building interaction heatmaps...
                </div>
                <div className="mt-4 h-72 animate-pulse dashboard-inner-surface" />
            </section>
        );
    }

    if (!sortedScreens.length) {
        return (
            <section className={`dashboard-surface p-6 shadow-sm ${className}`.trim()}>
                <div className={`flex flex-col items-center justify-center border-2 border-dashed border-black bg-[#f4f4f5] text-center ${compact ? 'min-h-[180px]' : 'min-h-[220px]'}`}>
                    <MousePointer2 className="mb-3 h-10 w-10 text-slate-300" />
                    <p className="text-sm font-semibold text-slate-500">No touch heatmap data available yet</p>
                    <p className="mt-1 text-xs text-slate-400">Heatmaps populate after users interact with tracked screens.</p>
                    {partialError && (
                        <p className="mt-3 text-xs font-medium text-amber-700">{partialError}</p>
                    )}
                </div>
            </section>
        );
    }

    return (
        <section className={`dashboard-surface shadow-sm ${className}`.trim()}>
            <div className={`overflow-y-auto ${compact ? 'max-h-[70vh] space-y-7 p-4' : 'max-h-[calc(100vh-220px)] space-y-9 p-5'}`}>
                {versionGroups.map((version, versionIndex) => (
                    <div key={`${version.appVersion}-${versionIndex}`} className="space-y-4">
                        <div className="flex items-center gap-3">
                            <div className="border-t-2 border-dashed border-black/70 flex-1" />
                            <div className="shrink-0 border-2 border-black bg-white px-3 py-1 text-xs font-black uppercase tracking-wide text-black">
                                VERSION: {version.appVersion}
                            </div>
                            <div className="border-t-2 border-dashed border-black/70 flex-1" />
                        </div>
                        <div className="overflow-x-auto pb-2">
                            <div className="flex min-w-max gap-4">
                                {version.screens.map((screen) => (
                                    <HeatmapTile
                                        key={`${version.appVersion}-${screen.name}`}
                                        screen={screen}
                                        compact={compact}
                                    />
                                ))}
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </section>
    );
};
