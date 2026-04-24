import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import {
    ArrowRight,
    Bug,
    ChevronLeft,
    ChevronRight,
    Flame,
    LogOut,
    MousePointer2,
    ShieldAlert,
} from 'lucide-react';
import { useSessionData } from '~/shared/providers/SessionContext';
import { useDemoMode } from '~/shared/providers/DemoModeContext';
import {
    getHeatmapsOverview,
    getHeatmapScreenOverview,
    type AlltimeHeatmapScreen,
} from '~/shared/api/client';
import { API_BASE_URL, getCsrfToken } from '~/shared/config/appConfig';
import { TimeRange } from '~/shared/ui/core/TimeFilter';
import { usePathPrefix } from '~/shell/routing/usePathPrefix';

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
    touchHotspots: Array<{ x: number; y: number; intensity: number; isRageTap: boolean }>
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

type SortMode = 'impact' | 'affected' | 'volume' | 'risk';
type SignalType = 'rage_taps' | 'errors' | 'exits' | 'mixed';
type ConfidenceType = 'high' | 'medium' | 'low';
type PriorityType = 'critical' | 'high' | 'watch';

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

function getInsightsRangeFromTimeFilter(timeRange: TimeRange): string {
    if (timeRange === 'all') return 'all';
    return timeRange;
}

function formatCompact(value: number): string {
    if (!Number.isFinite(value)) return '0';
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
    if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
    return value.toLocaleString();
}

function toRatePer100(value: number, total: number): number {
    if (total <= 0) return 0;
    return Number(((value / total) * 100).toFixed(1));
}

function getPrimarySignal(rageRate: number, errorRate: number, exitRate: number): SignalType {
    const ordered = [
        { key: 'rage_taps' as const, value: rageRate },
        { key: 'errors' as const, value: errorRate },
        { key: 'exits' as const, value: exitRate },
    ].sort((a, b) => b.value - a.value);

    if (!ordered[0] || ordered[0].value <= 0) return 'mixed';
    if ((ordered[0].value - ordered[1].value) < 2) return 'mixed';
    return ordered[0].key;
}

function getPriority(impactScore: number, affectedSessions: number): PriorityType {
    if (impactScore >= 45 || affectedSessions >= 120) return 'critical';
    if (impactScore >= 20 || affectedSessions >= 40) return 'high';
    return 'watch';
}

function getHotspotZoneLabel(x: number, y: number): string {
    const vertical = y < 0.33 ? 'Top' : y > 0.66 ? 'Bottom' : 'Middle';
    const horizontal = x < 0.33 ? 'Left' : x > 0.66 ? 'Right' : 'Center';
    return `${vertical} ${horizontal}`;
}

const sortOptions: Array<{ value: SortMode; label: string }> = [
    { value: 'impact', label: 'Impact' },
    { value: 'affected', label: 'Affected' },
    { value: 'risk', label: 'Risk Rate' },
    { value: 'volume', label: 'Volume' },
];

const HeatmapPreview: React.FC<{ screen: EnrichedHeatmapScreen; compact?: boolean }> = ({ screen, compact = false }) => {
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

    return (
        <div className={`mx-auto w-full ${compact ? 'max-w-[310px]' : 'max-w-[360px]'}`}>
            <div className="rounded-[32px] border border-slate-700 bg-slate-900 p-3 shadow-2xl">
                <div ref={containerRef} className="relative aspect-[9/19] overflow-hidden rounded-[24px] bg-slate-800">
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

            <div className="mt-3 flex items-center justify-between text-[11px] font-medium text-slate-500">
                <span>Low intensity</span>
                <div className="mx-2 h-1.5 flex-1 rounded-full bg-gradient-to-r from-emerald-400 via-amber-400 to-rose-500" />
                <span>High intensity</span>
            </div>
        </div>
    );
};

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
    const pathPrefix = usePathPrefix();

    const [screens, setScreens] = useState<EnrichedHeatmapScreen[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [lastUpdated, setLastUpdated] = useState('');
    const [partialError, setPartialError] = useState<string | null>(null);
    const [sortMode, setSortMode] = useState<SortMode>('impact');
    const [selectedScreenName, setSelectedScreenName] = useState<string | null>(null);
    const [isScreenDetailLoading, setIsScreenDetailLoading] = useState(false);

    useEffect(() => {
        if (isDemoMode) {
            const demoScreens: EnrichedHeatmapScreen[] = [
                {
                    name: 'HomeScreen',
                    visits: 4820, rageTaps: 142, errors: 38, exitRate: 12.4, frictionScore: 34,
                    screenshotUrl: null, sessionIds: [], touchHotspots: [
                        { x: 0.5, y: 0.3, intensity: 0.9, isRageTap: false },
                        { x: 0.3, y: 0.6, intensity: 0.7, isRageTap: true },
                        { x: 0.7, y: 0.5, intensity: 0.5, isRageTap: false },
                        { x: 0.5, y: 0.8, intensity: 0.4, isRageTap: false },
                    ],
                    rangeVisits: 1240, rangeRageTaps: 48, rangeErrors: 12, rangeExitRate: 12.4,
                    rangeFrictionScore: 34, rangeImpactScore: 52, rangeRageTapRatePer100: 3.9,
                    rangeErrorRatePer100: 1.0, rangeIncidentRatePer100: 4.9,
                    rangeEstimatedAffectedSessions: 61, primarySignal: 'rage_taps',
                    confidence: 'high', priority: 'critical', evidenceSessionId: null,
                },
                {
                    name: 'CheckoutScreen',
                    visits: 2100, rageTaps: 89, errors: 55, exitRate: 28.1, frictionScore: 58,
                    screenshotUrl: null, sessionIds: [], touchHotspots: [
                        { x: 0.5, y: 0.7, intensity: 0.95, isRageTap: true },
                        { x: 0.5, y: 0.5, intensity: 0.6, isRageTap: false },
                        { x: 0.2, y: 0.4, intensity: 0.3, isRageTap: false },
                    ],
                    rangeVisits: 540, rangeRageTaps: 22, rangeErrors: 14, rangeExitRate: 28.1,
                    rangeFrictionScore: 58, rangeImpactScore: 71, rangeRageTapRatePer100: 4.1,
                    rangeErrorRatePer100: 2.6, rangeIncidentRatePer100: 6.7,
                    rangeEstimatedAffectedSessions: 36, primarySignal: 'exits',
                    confidence: 'high', priority: 'critical', evidenceSessionId: null,
                },
                {
                    name: 'ProfileScreen',
                    visits: 1850, rageTaps: 21, errors: 8, exitRate: 6.2, frictionScore: 12,
                    screenshotUrl: null, sessionIds: [], touchHotspots: [
                        { x: 0.5, y: 0.2, intensity: 0.6, isRageTap: false },
                        { x: 0.5, y: 0.5, intensity: 0.4, isRageTap: false },
                    ],
                    rangeVisits: 480, rangeRageTaps: 5, rangeErrors: 2, rangeExitRate: 6.2,
                    rangeFrictionScore: 12, rangeImpactScore: 18, rangeRageTapRatePer100: 1.0,
                    rangeErrorRatePer100: 0.4, rangeIncidentRatePer100: 1.4,
                    rangeEstimatedAffectedSessions: 7, primarySignal: 'mixed',
                    confidence: 'medium', priority: 'watch', evidenceSessionId: null,
                },
                {
                    name: 'OnboardingScreen',
                    visits: 3200, rageTaps: 64, errors: 29, exitRate: 41.5, frictionScore: 67,
                    screenshotUrl: null, sessionIds: [], touchHotspots: [
                        { x: 0.5, y: 0.85, intensity: 0.88, isRageTap: true },
                        { x: 0.5, y: 0.6, intensity: 0.5, isRageTap: false },
                        { x: 0.8, y: 0.3, intensity: 0.3, isRageTap: false },
                    ],
                    rangeVisits: 820, rangeRageTaps: 16, rangeErrors: 7, rangeExitRate: 41.5,
                    rangeFrictionScore: 67, rangeImpactScore: 63, rangeRageTapRatePer100: 2.0,
                    rangeErrorRatePer100: 0.9, rangeIncidentRatePer100: 2.9,
                    rangeEstimatedAffectedSessions: 24, primarySignal: 'exits',
                    confidence: 'high', priority: 'critical', evidenceSessionId: null,
                },
                {
                    name: 'SearchScreen',
                    visits: 980, rageTaps: 12, errors: 4, exitRate: 8.3, frictionScore: 9,
                    screenshotUrl: null, sessionIds: [], touchHotspots: [
                        { x: 0.5, y: 0.15, intensity: 0.7, isRageTap: false },
                        { x: 0.5, y: 0.4, intensity: 0.3, isRageTap: false },
                    ],
                    rangeVisits: 250, rangeRageTaps: 3, rangeErrors: 1, rangeExitRate: 8.3,
                    rangeFrictionScore: 9, rangeImpactScore: 11, rangeRageTapRatePer100: 1.2,
                    rangeErrorRatePer100: 0.4, rangeIncidentRatePer100: 1.6,
                    rangeEstimatedAffectedSessions: 4, primarySignal: 'mixed',
                    confidence: 'medium', priority: 'watch', evidenceSessionId: null,
                },
            ];
            setScreens(demoScreens);
            setIsLoading(false);
            return;
        }

        if (!selectedProject?.id) {
            setScreens([]);
            setIsLoading(false);
            setLastUpdated('');
            setPartialError(null);
            setSelectedScreenName(null);
            return;
        }

        let cancelled = false;
        setIsLoading(true);
        setPartialError(null);

        const range = getInsightsRangeFromTimeFilter(timeRange);

        getHeatmapsOverview(selectedProject.id, range)
            .then((overview) => {
                if (cancelled) return;

                heatmapDebug('Touch heatmap summary fetched', {
                    projectId: selectedProject.id,
                    timeRange,
                    normalizedRange: range,
                    screenCount: overview.screens.length,
                    failedSections: overview.failedSections,
                });

                const mergedScreens = (overview.screens || [])
                    .filter((screen) => (
                        screen.rangeVisits > 0
                        || screen.rangeRageTaps > 0
                        || screen.rangeErrors > 0
                        || screen.rangeExitRate > 0
                    )) as EnrichedHeatmapScreen[];

                heatmapDebug('Touch heatmap screens prepared', {
                    projectId: selectedProject.id,
                    mergedScreenCount: mergedScreens.length,
                    sampleScreens: mergedScreens.slice(0, 10).map((screen) => ({
                        name: screen.name,
                        screenshotUrl: screen.screenshotUrl,
                        evidenceSessionId: screen.evidenceSessionId,
                        hotspotCount: screen.touchHotspots.length,
                        rangeVisits: screen.rangeVisits,
                    })),
                });

                setScreens(mergedScreens);
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
            })
            .finally(() => {
                if (!cancelled) setIsLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [selectedProject?.id, timeRange, isDemoMode]);

    const sortedScreens = useMemo(() => {
        const copied = [...screens];
        switch (sortMode) {
            case 'affected':
                return copied.sort((a, b) => b.rangeEstimatedAffectedSessions - a.rangeEstimatedAffectedSessions);
            case 'volume':
                return copied.sort((a, b) => b.rangeVisits - a.rangeVisits);
            case 'risk':
                return copied.sort((a, b) => (b.rangeIncidentRatePer100 + b.rangeExitRate * 0.6) - (a.rangeIncidentRatePer100 + a.rangeExitRate * 0.6));
            case 'impact':
            default:
                return copied.sort((a, b) => b.rangeImpactScore - a.rangeImpactScore);
        }
    }, [screens, sortMode]);

    useEffect(() => {
        if (!sortedScreens.length) {
            setSelectedScreenName(null);
            return;
        }
        if (!selectedScreenName || !sortedScreens.some((screen) => screen.name === selectedScreenName)) {
            setSelectedScreenName(sortedScreens[0].name);
        }
    }, [sortedScreens, selectedScreenName]);

    const selectedScreen = useMemo(
        () => sortedScreens.find((screen) => screen.name === selectedScreenName) || sortedScreens[0] || null,
        [sortedScreens, selectedScreenName],
    );

    useEffect(() => {
        if (isDemoMode || !selectedProject?.id || !selectedScreenName) return;

        let cancelled = false;
        setIsScreenDetailLoading(true);

        void getHeatmapScreenOverview(selectedProject.id, selectedScreenName, getInsightsRangeFromTimeFilter(timeRange))
            .then((response) => {
                if (cancelled || !response.screen) return;
                setScreens((prev) => prev.map((screen) => (
                    screen.name === selectedScreenName
                        ? { ...screen, ...response.screen } as EnrichedHeatmapScreen
                        : screen
                )));
                if (response.failedSections.length > 0) {
                    setPartialError(`Some heatmap sources are unavailable (${response.failedSections.join(', ')}).`);
                }
            })
            .catch((error) => {
                if (!cancelled) {
                    console.error(`${TOUCH_HEATMAP_DEBUG_PREFIX} Failed to load selected screen detail`, {
                        projectId: selectedProject.id,
                        selectedScreenName,
                        error,
                    });
                    setPartialError((prev) => prev || 'Selected heatmap detail unavailable.');
                }
            })
            .finally(() => {
                if (!cancelled) setIsScreenDetailLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [selectedProject?.id, selectedScreenName, timeRange, isDemoMode]);

    const selectedIndex = useMemo(
        () => selectedScreen ? sortedScreens.findIndex((screen) => screen.name === selectedScreen.name) : -1,
        [sortedScreens, selectedScreen],
    );

    const summary = useMemo(() => {
        const totals = screens.reduce((acc, screen) => {
            acc.allTimeTouches += screen.visits;
            acc.rangeVisits += screen.rangeVisits;
            acc.affectedSessions += screen.rangeEstimatedAffectedSessions;
            acc.incidentRate += screen.rangeIncidentRatePer100;
            acc.impact += screen.rangeImpactScore;
            if (screen.priority === 'critical') acc.criticalScreens += 1;
            return acc;
        }, {
            allTimeTouches: 0,
            rangeVisits: 0,
            affectedSessions: 0,
            incidentRate: 0,
            impact: 0,
            criticalScreens: 0,
        });

        return {
            ...totals,
            avgIncidentRate: screens.length > 0 ? totals.incidentRate / screens.length : 0,
            avgImpact: screens.length > 0 ? totals.impact / screens.length : 0,
        };
    }, [screens]);

    const selectedSignalBars = useMemo(() => {
        if (!selectedScreen) return [];
        return [
            {
                key: 'rage',
                label: 'Rage tap rate',
                value: selectedScreen.rangeRageTapRatePer100,
                unit: '/100',
                barClass: 'bg-rose-500',
                textClass: 'text-rose-700',
                icon: Flame,
            },
            {
                key: 'errors',
                label: 'Error rate',
                value: selectedScreen.rangeErrorRatePer100,
                unit: '/100',
                barClass: 'bg-amber-500',
                textClass: 'text-amber-700',
                icon: Bug,
            },
            {
                key: 'exit',
                label: 'Exit rate',
                value: selectedScreen.rangeExitRate,
                unit: '%',
                barClass: 'bg-blue-500',
                textClass: 'text-blue-700',
                icon: LogOut,
            },
            {
                key: 'incident',
                label: 'Combined incident',
                value: selectedScreen.rangeIncidentRatePer100,
                unit: '/100',
                barClass: 'bg-violet-500',
                textClass: 'text-violet-700',
                icon: ShieldAlert,
            },
        ];
    }, [selectedScreen]);

    const maxSignalValue = useMemo(() => {
        if (!selectedSignalBars.length) return 1;
        return Math.max(1, ...selectedSignalBars.map((bar) => bar.value));
    }, [selectedSignalBars]);

    const hotspotZones = useMemo(() => {
        if (!selectedScreen) return [];
        return [...(selectedScreen.touchHotspots || [])]
            .sort((a, b) => b.intensity - a.intensity)
            .slice(0, 5)
            .map((spot, index) => ({
                id: `${spot.x}-${spot.y}-${index}`,
                zone: getHotspotZoneLabel(spot.x, spot.y),
                intensity: Math.round(spot.intensity * 100),
                isRageTap: spot.isRageTap,
            }));
    }, [selectedScreen]);

    const selectedSignalMix = useMemo(() => {
        if (!selectedScreen) return [];
        const base = [
            { key: 'rage', label: 'Rage', value: selectedScreen.rangeRageTapRatePer100 },
            { key: 'errors', label: 'Errors', value: selectedScreen.rangeErrorRatePer100 },
            { key: 'exits', label: 'Exits', value: selectedScreen.rangeExitRate },
        ];
        const total = base.reduce((sum, item) => sum + item.value, 0);
        return base.map((item) => ({
            ...item,
            share: total > 0 ? Number(((item.value / total) * 100).toFixed(1)) : 0,
        }));
    }, [selectedScreen]);

    const priorityChipClass = selectedScreen?.priority === 'critical'
        ? 'bg-rose-100 text-rose-700'
        : selectedScreen?.priority === 'high'
            ? 'bg-amber-100 text-amber-700'
            : 'bg-slate-200 text-slate-700';

    const confidenceChipClass = selectedScreen?.confidence === 'high'
        ? 'bg-emerald-100 text-emerald-700'
        : selectedScreen?.confidence === 'medium'
            ? 'bg-amber-100 text-amber-700'
            : 'bg-slate-200 text-slate-700';

    const moveSelection = (direction: -1 | 1) => {
        if (selectedIndex < 0) return;
        const nextIndex = selectedIndex + direction;
        if (nextIndex < 0 || nextIndex >= sortedScreens.length) return;
        setSelectedScreenName(sortedScreens[nextIndex].name);
    };

    if (!selectedProject?.id) {
        return (
            <section className={`dashboard-surface p-6 shadow-sm ${className}`.trim()}>
                <p className="text-sm text-slate-500">Select a project to view touch heatmap intelligence.</p>
            </section>
        );
    }

    if (isLoading) {
        return (
            <section className={`dashboard-surface p-6 shadow-sm ${className}`.trim()}>
                <div className="flex items-center gap-3 text-sm text-slate-600">
                    <MousePointer2 className="h-4 w-4 animate-pulse text-blue-600" />
                    Building interaction heatmaps and friction overlays...
                </div>
                <div className="mt-4 h-64 animate-pulse dashboard-inner-surface" />
            </section>
        );
    }

    if (!screens.length || !selectedScreen) {
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
            <div className={`${compact ? 'space-y-4 p-4' : 'space-y-5 p-5'}`}>
                <div className="flex flex-col gap-3 border-b border-slate-200 pb-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                    {compact ? (
                        <div className="min-w-0">
                            <h2 className="text-base font-semibold uppercase tracking-wide text-black">Interaction Heatmaps</h2>
                            <p className="mt-1 text-sm text-slate-500">Prioritize high-friction screens with replay evidence.</p>
                        </div>
                    ) : null}
                    <div className={`flex flex-wrap items-center gap-2 ${compact ? '' : 'sm:justify-end'}`}>
                        {sortOptions.map((option) => (
                            <button
                                key={option.value}
                                onClick={() => setSortMode(option.value)}
                                className={`rounded-xl border px-3 py-1.5 text-xs font-semibold transition-all ${sortMode === option.value
                                    ? 'border-2 border-black bg-black text-white'
                                    : 'border-2 border-transparent text-gray-500 hover:border-black hover:text-black'
                                    }`}
                            >
                                {option.label}
                            </button>
                        ))}
                        {lastUpdated ? (
                            <span className="text-xs text-slate-500 sm:ml-1">
                                Updated {new Date(lastUpdated).toLocaleString()}
                            </span>
                        ) : null}
                    </div>
                </div>
                {partialError ? (
                    <div className="border-2 border-black bg-amber-50 px-3 py-2 text-xs text-amber-900">
                        {partialError}
                    </div>
                ) : null}
                <div
                    className={`grid grid-cols-1 gap-4 ${compact ? 'sm:grid-cols-2 xl:grid-cols-4' : 'sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5'}`}
                >
                    <div className="dashboard-surface min-w-0 bg-white px-4 py-3 border-2 border-black shadow-neo-sm transition-all hover:-translate-y-1 hover:shadow-neo rounded-none">
                        <div className="break-words text-[10px] font-black uppercase tracking-widest text-slate-600">Tracked screens</div>
                        <div className="mt-2 break-words text-2xl font-black tracking-tight text-black sm:text-3xl">{screens.length}</div>
                    </div>
                    {!compact && (
                        <div className="dashboard-surface min-w-0 bg-white px-4 py-3 border-2 border-black shadow-neo-sm transition-all hover:-translate-y-1 hover:shadow-neo rounded-none">
                            <div className="break-words text-[10px] font-black uppercase tracking-widest text-slate-600">All-time touches</div>
                            <div className="mt-2 break-words text-2xl font-black tracking-tight text-black sm:text-3xl">{formatCompact(summary.allTimeTouches)}</div>
                        </div>
                    )}
                    <div className="dashboard-surface min-w-0 bg-white px-4 py-3 border-2 border-black shadow-neo-sm transition-all hover:-translate-y-1 hover:shadow-neo rounded-none">
                        <div className="break-words text-[10px] font-black uppercase tracking-widest text-slate-600">{timeRange} visits</div>
                        <div className="mt-2 break-words text-2xl font-black tracking-tight text-black sm:text-3xl">{formatCompact(summary.rangeVisits)}</div>
                    </div>
                    <div className="dashboard-surface min-w-0 bg-white px-4 py-3 border-2 border-black shadow-neo-sm transition-all hover:-translate-y-1 hover:shadow-neo rounded-none">
                        <div className="break-words text-[10px] font-black uppercase tracking-widest text-slate-600">Affected sessions</div>
                        <div className="mt-2 break-words text-2xl font-black tracking-tight text-rose-600 sm:text-3xl">{formatCompact(summary.affectedSessions)}</div>
                    </div>
                    <div className="dashboard-surface min-w-0 bg-white px-4 py-3 border-2 border-black shadow-neo-sm transition-all hover:-translate-y-1 hover:shadow-neo rounded-none">
                        <div className="break-words text-[10px] font-black uppercase tracking-widest text-slate-600">Critical screens</div>
                        <div className="mt-2 break-words text-2xl font-black tracking-tight text-amber-700 sm:text-3xl">{summary.criticalScreens}</div>
                    </div>
                </div>

                <div className={`grid grid-cols-1 items-stretch ${compact ? 'gap-5 xl:grid-cols-[230px_minmax(0,1fr)]' : 'gap-6 xl:grid-cols-[280px_minmax(0,1fr)_320px]'}`}>
                    <div className={`flex h-full min-h-0 flex-col dashboard-inner-surface ${compact ? 'p-3' : 'p-4'}`}>
                        <div className={`mb-3 flex items-center justify-between ${compact ? 'px-1' : 'px-2'} text-xs font-mono font-semibold uppercase tracking-wide text-gray-500`}>Screen ranking</div>
                        <div className="relative flex-1 overflow-hidden dashboard-inner-surface">
                            <div className="h-full space-y-2 overflow-y-auto p-2 pr-1">
                                {sortedScreens.map((screen) => {
                                    const isSelected = selectedScreen.name === screen.name;
                                    return (
                                        <button
                                            key={screen.name}
                                            onClick={() => setSelectedScreenName(screen.name)}
                                            className={`w-full rounded-xl border px-3 py-2 text-left transition ${isSelected
                                                ? 'border-2 border-black bg-black text-white'
                                                : 'dashboard-surface text-black hover:bg-[#f4f4f5]'
                                                }`}
                                        >
                                            <div className="flex items-center justify-between gap-2">
                                                <span className="truncate text-sm font-semibold">{screen.name}</span>
                                                <span className={`text-xs font-semibold ${isSelected ? 'text-slate-100' : 'text-slate-500'}`}>
                                                    {screen.rangeIncidentRatePer100.toFixed(1)}/100
                                                </span>
                                            </div>
                                            <div className={`mt-2 h-1.5 overflow-hidden rounded-full ${isSelected ? 'bg-white/30' : 'bg-gray-200'}`}>
                                                <div
                                                    className={isSelected ? 'h-full bg-[#34d399]' : 'h-full bg-black'}
                                                    style={{ width: `${Math.min(100, Math.max(6, screen.rangeIncidentRatePer100 * 8))}%` }}
                                                />
                                            </div>
                                            <div className={`mt-2 flex items-center justify-between text-[11px] ${isSelected ? 'text-slate-200' : 'text-slate-500'}`}>
                                                <span>{formatCompact(screen.rangeVisits)} visits</span>
                                                <span>{screen.rangeIncidentRatePer100.toFixed(1)}/100</span>
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    </div>

                    <div className={`dashboard-inner-surface ${compact ? 'p-3.5' : 'p-4'}`}>
                        <div className="mb-3 flex items-center justify-between gap-3">
                            <div>
                                <h3 className={`${compact ? 'text-sm' : 'text-base'} font-semibold uppercase tracking-wide text-black`}>{selectedScreen.name}</h3>
                                <p className="text-xs font-mono text-gray-500">Primary signal: {selectedScreen.primarySignal.replace('_', ' ')}</p>
                            </div>
                            <div className="flex items-center gap-2">
                                {isScreenDetailLoading && (
                                    <span className="dashboard-surface px-2 py-0.5 text-[11px] font-mono font-semibold uppercase text-gray-500">
                                        Refreshing
                                    </span>
                                )}
                                <span className={`border-2 border-black px-2 py-0.5 text-xs font-mono font-semibold uppercase ${priorityChipClass}`}>{selectedScreen.priority}</span>
                                <span className={`border-2 border-black px-2 py-0.5 text-xs font-mono font-semibold uppercase ${confidenceChipClass}`}>{selectedScreen.confidence}</span>
                            </div>
                        </div>

                        <div className="mb-4 flex items-center justify-end gap-2">
                            <button
                                onClick={() => moveSelection(-1)}
                                disabled={selectedIndex <= 0}
                                className="dashboard-surface p-1.5 text-black hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-40 transition-all"
                                aria-label="Previous screen"
                            >
                                <ChevronLeft className="h-4 w-4" />
                            </button>
                            <button
                                onClick={() => moveSelection(1)}
                                disabled={selectedIndex < 0 || selectedIndex >= sortedScreens.length - 1}
                                className="dashboard-surface p-1.5 text-black hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-40 transition-all"
                                aria-label="Next screen"
                            >
                                <ChevronRight className="h-4 w-4" />
                            </button>
                        </div>

                        <HeatmapPreview screen={selectedScreen} compact={compact} />

                        {compact && (
                            <>
                                <div className="mt-3 grid grid-cols-2 gap-2">
                                    <div className="dashboard-surface px-2.5 py-2">
                                        <div className="text-[10px] font-mono uppercase tracking-wide text-gray-500">Issue rate</div>
                                        <div className="mt-0.5 text-sm font-black font-mono text-black">{selectedScreen.rangeIncidentRatePer100.toFixed(1)}/100</div>
                                    </div>
                                    <div className="dashboard-surface px-2.5 py-2">
                                        <div className="text-[10px] font-mono uppercase tracking-wide text-gray-500">Rage taps</div>
                                        <div className="mt-0.5 text-sm font-black font-mono text-[#ef4444]">{selectedScreen.rangeRageTapRatePer100.toFixed(1)}/100</div>
                                    </div>
                                    <div className="dashboard-surface px-2.5 py-2">
                                        <div className="text-[10px] font-mono uppercase tracking-wide text-gray-500">{timeRange} visits</div>
                                        <div className="mt-0.5 text-sm font-black font-mono text-black">{formatCompact(selectedScreen.rangeVisits)}</div>
                                    </div>
                                    <div className="dashboard-surface px-2.5 py-2">
                                        <div className="text-[10px] font-mono uppercase tracking-wide text-gray-500">All-time touches</div>
                                        <div className="mt-0.5 text-sm font-black font-mono text-black">{formatCompact(selectedScreen.visits)}</div>
                                    </div>
                                </div>

                                {selectedScreen.evidenceSessionId && (
                                    <Link
                                        to={`${pathPrefix}/sessions/${selectedScreen.evidenceSessionId}`}
                                        className="mt-3 inline-flex items-center gap-1 text-xs font-mono font-semibold text-[#5dadec] hover:text-black"
                                    >
                                        Open evidence replay <ArrowRight className="h-3.5 w-3.5" />
                                    </Link>
                                )}
                            </>
                        )}
                    </div>

                    {!compact && (
                        <div className="dashboard-surface p-4">
                            <div className="mb-3 grid grid-cols-2 gap-2">
                                <div className="dashboard-inner-surface p-2.5">
                                    <div className="text-[11px] font-mono uppercase tracking-wide text-gray-500">Issue rate</div>
                                    <div className="mt-1 text-xl font-black font-mono text-black">{selectedScreen.rangeIncidentRatePer100.toFixed(1)}/100</div>
                                </div>
                                <div className="dashboard-inner-surface p-2.5">
                                    <div className="text-[11px] font-mono uppercase tracking-wide text-gray-500">Rage taps</div>
                                    <div className="mt-1 text-xl font-black font-mono text-[#ef4444]">{selectedScreen.rangeRageTapRatePer100.toFixed(1)}/100</div>
                                </div>
                                <div className="dashboard-inner-surface p-2.5">
                                    <div className="text-[11px] font-mono uppercase tracking-wide text-gray-500">{timeRange} visits</div>
                                    <div className="mt-1 text-xl font-black font-mono text-black">{formatCompact(selectedScreen.rangeVisits)}</div>
                                </div>
                                <div className="dashboard-inner-surface p-2.5">
                                    <div className="text-[11px] font-mono uppercase tracking-wide text-gray-500">All-time touches</div>
                                    <div className="mt-1 text-xl font-black font-mono text-black">{formatCompact(selectedScreen.visits)}</div>
                                </div>
                            </div>

                            <div className="mb-4 space-y-2">
                                {selectedSignalBars.map((bar) => {
                                    const width = (bar.value / maxSignalValue) * 100;
                                    const Icon = bar.icon;
                                    return (
                                        <div key={bar.key}>
                                            <div className="mb-1 flex items-center justify-between text-xs">
                                                <span className="flex items-center gap-1 text-black"><Icon className="h-3.5 w-3.5" />{bar.label}</span>
                                                <span className={`font-semibold ${bar.textClass}`}>{bar.value.toFixed(1)}{bar.unit}</span>
                                            </div>
                                            <div className="h-1.5 overflow-hidden rounded-full bg-gray-200">
                                                <div className={`h-full ${bar.barClass}`} style={{ width: `${Math.max(4, width)}%` }} />
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>

                            <div className="dashboard-inner-surface p-3">
                                <div className="text-xs font-mono font-semibold uppercase tracking-wide text-gray-500">Top friction zones</div>
                                <div className="mt-2 space-y-2">
                                    {hotspotZones.map((zone) => (
                                        <div key={zone.id} className="flex items-center justify-between text-xs">
                                            <span className="text-black">{zone.zone}</span>
                                            <span className={`px-2 py-0.5 font-mono font-semibold ${zone.isRageTap ? 'border-2 border-[#ef4444] bg-white text-[#ef4444]' : 'border-2 border-[#34d399] bg-white text-[#34d399]'}`}>
                                                {zone.intensity}% {zone.isRageTap ? 'rage' : 'touch'}
                                            </span>
                                        </div>
                                    ))}
                                    {hotspotZones.length === 0 && (
                                        <p className="text-xs text-gray-500">No hotspot clusters identified for this screen.</p>
                                    )}
                                </div>
                            </div>
                            <div className="mt-3 dashboard-inner-surface p-3">
                                <div className="text-xs font-mono font-semibold uppercase tracking-wide text-gray-500">Signal distribution</div>
                                <div className="mt-2 grid grid-cols-3 gap-2">
                                    {selectedSignalMix.map((item) => (
                                        <div key={item.key} className="dashboard-surface px-2 py-1.5 text-center">
                                            <div className="text-[10px] font-mono uppercase tracking-wide text-gray-500">{item.label}</div>
                                            <div className="mt-0.5 text-sm font-black font-mono text-black">{item.share.toFixed(1)}%</div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {selectedScreen.evidenceSessionId && (
                                <Link
                                    to={`${pathPrefix}/sessions/${selectedScreen.evidenceSessionId}`}
                                    className="mt-3 inline-flex items-center gap-1 text-xs font-mono font-semibold text-[#5dadec] hover:text-black"
                                >
                                    Open evidence replay <ArrowRight className="h-3.5 w-3.5" />
                                </Link>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </section>
    );
};
