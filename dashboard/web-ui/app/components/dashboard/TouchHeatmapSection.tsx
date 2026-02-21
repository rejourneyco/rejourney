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
import { useSessionData } from '../../context/SessionContext';
import { getAlltimeHeatmap, getFrictionHeatmap, AlltimeHeatmapScreen, FrictionHeatmap } from '../../services/api';
import { API_BASE_URL, getCsrfToken } from '../../config';
import { TimeRange } from '../ui/TimeFilter';
import { usePathPrefix } from '../../hooks/usePathPrefix';

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
    recommendedAction: string;
    hotspotHint: string;
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

function getTopHotspotHint(hotspots: Array<{ x: number; y: number; intensity: number; isRageTap: boolean }>): string {
    if (!hotspots || hotspots.length === 0) return 'No hotspot cluster identified';
    const top = [...hotspots].sort((a, b) => b.intensity - a.intensity)[0];
    const vertical = top.y < 0.33 ? 'top' : top.y > 0.66 ? 'bottom' : 'middle';
    const horizontal = top.x < 0.33 ? 'left' : top.x > 0.66 ? 'right' : 'center';
    return `${vertical}-${horizontal}`;
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

function getRecommendedAction(signal: SignalType, hotspotHint: string): string {
    if (signal === 'rage_taps') {
        return `Check tappable controls near ${hotspotHint}; replay evidence for blocked CTA states.`;
    }
    if (signal === 'errors') {
        return 'Investigate API or validation failures and surface recovery UI before retry loops.';
    }
    if (signal === 'exits') {
        return 'Review screen clarity, response time, and next-step affordance before users abandon.';
    }
    return 'Review replay evidence and prioritize the first blocker visible in the user flow.';
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

const HeatmapPreview: React.FC<{ screen: EnrichedHeatmapScreen }> = ({ screen }) => {
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
        setLoadError(null);
        setImageLoaded(false);
        setDownloadProgress(0);

        if (blobUrlRef.current) {
            URL.revokeObjectURL(blobUrlRef.current);
            blobUrlRef.current = null;
        }
        setBlobUrl(null);

        if (!fullCoverUrl) return () => undefined;

        const csrfToken = getCsrfToken() || '';
        const separator = fullCoverUrl.includes('?') ? '&' : '?';
        const fetchUrl = `${fullCoverUrl}${separator}_cb=${Date.now()}`;

        const fetchWithProgress = async () => {
            const response = await fetch(fetchUrl, {
                credentials: 'include',
                cache: 'no-store',
                headers: { Accept: 'image/*', 'X-CSRF-Token': csrfToken },
            });

            if (!response.ok) {
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

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                if (!value) continue;
                const chunk = new Uint8Array(value.byteLength);
                chunk.set(value);
                chunks.push(chunk.buffer);
                receivedLength += value.length;
                if (contentLength > 0) {
                    setDownloadProgress(Math.round((receivedLength / contentLength) * 100));
                }
            }

            return { blob: new Blob(chunks), contentType };
        };

        fetchWithProgress()
            .then(async (result) => {
                if (!result || cancelled) return;
                const { blob, contentType } = result;

                if (blob.size === 0) {
                    setLoadError('Empty image received');
                    return;
                }

                let displayBlob = blob;
                if (isHeicContentType(contentType)) {
                    try {
                        displayBlob = await convertHeic(blob);
                    } catch {
                        if (!cancelled) setLoadError('HEIC conversion failed');
                        return;
                    }
                }

                if (cancelled) return;
                const objectUrl = URL.createObjectURL(displayBlob);
                blobUrlRef.current = objectUrl;
                setBlobUrl(objectUrl);
            })
            .catch((error: unknown) => {
                if (cancelled) return;
                if (error instanceof Error) {
                    setLoadError(error.message || 'Failed to load screenshot');
                    return;
                }
                setLoadError('Failed to load screenshot');
            });

        return () => {
            cancelled = true;
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
        <div className="mx-auto w-full max-w-[360px]">
            <div className="rounded-[32px] border border-slate-700 bg-slate-900 p-3 shadow-2xl">
                <div ref={containerRef} className="relative aspect-[9/19] overflow-hidden rounded-[24px] bg-slate-800">
                    {blobUrl ? (
                        <img
                            src={blobUrl}
                            alt={screen.name}
                            className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-200 ${imageLoaded ? 'opacity-95' : 'opacity-0'}`}
                            onLoad={() => setImageLoaded(true)}
                            onError={() => setLoadError('Failed to load image')}
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
}

export const TouchHeatmapSection: React.FC<TouchHeatmapSectionProps> = ({ timeRange = '30d' }) => {
    const { selectedProject } = useSessionData();
    const pathPrefix = usePathPrefix();

    const [screens, setScreens] = useState<EnrichedHeatmapScreen[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [lastUpdated, setLastUpdated] = useState('');
    const [sortMode, setSortMode] = useState<SortMode>('impact');
    const [selectedScreenName, setSelectedScreenName] = useState<string | null>(null);

    useEffect(() => {
        if (!selectedProject?.id) {
            setScreens([]);
            setIsLoading(false);
            setLastUpdated('');
            setSelectedScreenName(null);
            return;
        }

        let cancelled = false;
        setIsLoading(true);

        const range = getInsightsRangeFromTimeFilter(timeRange);

        Promise.all([
            getAlltimeHeatmap(selectedProject.id),
            getFrictionHeatmap(selectedProject.id, range),
        ])
            .then(([allTime, friction]) => {
                if (cancelled) return;

                const alltimeMap = new Map<string, AlltimeHeatmapScreen>(
                    (allTime.screens || []).map((screen) => [screen.name, screen]),
                );
                const frictionMap = new Map<string, FrictionHeatmap['screens'][number]>(
                    (friction.screens || []).map((screen) => [screen.name, screen]),
                );

                const mergedNames = new Set<string>([
                    ...Array.from(alltimeMap.keys()),
                    ...Array.from(frictionMap.keys()),
                ]);

                const mergedScreens: EnrichedHeatmapScreen[] = Array.from(mergedNames)
                    .map((name) => {
                        const alltime = alltimeMap.get(name);
                        const rangeData = frictionMap.get(name);
                        const touchHotspots = alltime?.touchHotspots ?? rangeData?.touchHotspots ?? [];
                        const rangeVisits = rangeData?.visits ?? 0;
                        const rangeRageTaps = rangeData?.rageTaps ?? 0;
                        const rangeErrors = rangeData?.errors ?? 0;
                        const rangeExitRate = rangeData?.exitRate ?? 0;
                        const rangeRageTapRatePer100 = rangeData?.rageTapRatePer100 ?? toRatePer100(rangeRageTaps, rangeVisits);
                        const rangeErrorRatePer100 = rangeData?.errorRatePer100 ?? toRatePer100(rangeErrors, rangeVisits);
                        const rangeIncidentRatePer100 = Number((rangeRageTapRatePer100 + rangeErrorRatePer100).toFixed(1));
                        const rangeEstimatedAffectedSessions = rangeData?.estimatedAffectedSessions
                            ?? Math.min(
                                rangeVisits,
                                Math.round(rangeVisits * Math.min(0.95, (rangeIncidentRatePer100 / 100) + ((rangeExitRate / 100) * 0.35))),
                            );
                        const rangeImpactScore = rangeData?.impactScore
                            ?? Number((((rangeIncidentRatePer100 * 0.7) + (rangeExitRate * 0.3)) * Math.log10(rangeVisits + 9)).toFixed(1));
                        const primarySignal = rangeData?.primarySignal ?? getPrimarySignal(rangeRageTapRatePer100, rangeErrorRatePer100, rangeExitRate);
                        const hotspotHint = getTopHotspotHint(touchHotspots);
                        const confidence: ConfidenceType = rangeData?.confidence
                            ?? (rangeVisits >= 150 ? 'high' : rangeVisits >= 50 ? 'medium' : 'low');

                        return {
                            name,
                            visits: alltime?.visits ?? rangeData?.visits ?? 0,
                            rageTaps: alltime?.rageTaps ?? rangeData?.rageTaps ?? 0,
                            errors: alltime?.errors ?? rangeData?.errors ?? 0,
                            exitRate: alltime?.exitRate ?? rangeData?.exitRate ?? 0,
                            frictionScore: alltime?.frictionScore ?? rangeData?.frictionScore ?? 0,
                            screenshotUrl: alltime?.screenshotUrl ?? rangeData?.screenshotUrl ?? null,
                            sessionIds: alltime?.sessionIds ?? rangeData?.sessionIds ?? [],
                            touchHotspots,
                            rangeVisits,
                            rangeRageTaps,
                            rangeErrors,
                            rangeExitRate,
                            rangeFrictionScore: rangeData?.frictionScore ?? rangeImpactScore,
                            rangeImpactScore,
                            rangeRageTapRatePer100,
                            rangeErrorRatePer100,
                            rangeIncidentRatePer100,
                            rangeEstimatedAffectedSessions,
                            primarySignal,
                            confidence,
                            priority: getPriority(rangeImpactScore, rangeEstimatedAffectedSessions),
                            recommendedAction: rangeData?.recommendedAction ?? getRecommendedAction(primarySignal, hotspotHint),
                            hotspotHint,
                            evidenceSessionId: rangeData?.sessionIds?.[0] ?? alltime?.sessionIds?.[0] ?? null,
                        };
                    })
                    .filter((screen) => (
                        screen.rangeVisits > 0
                        || screen.rangeRageTaps > 0
                        || screen.rangeErrors > 0
                        || screen.rangeExitRate > 0
                        || screen.touchHotspots.length > 0
                    ));

                setScreens(mergedScreens);
                setLastUpdated(allTime.lastUpdated || '');
            })
            .catch(() => {
                if (!cancelled) {
                    setScreens([]);
                    setLastUpdated('');
                }
            })
            .finally(() => {
                if (!cancelled) setIsLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [selectedProject?.id, timeRange]);

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
            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <p className="text-sm text-slate-500">Select a project to view touch heatmap intelligence.</p>
            </section>
        );
    }

    if (isLoading) {
        return (
            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="flex items-center gap-3 text-sm text-slate-600">
                    <MousePointer2 className="h-4 w-4 animate-pulse text-blue-600" />
                    Building interaction heatmaps and friction overlays...
                </div>
                <div className="mt-4 h-64 animate-pulse rounded-xl border border-slate-200 bg-slate-50" />
            </section>
        );
    }

    if (!screens.length || !selectedScreen) {
        return (
            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="flex min-h-[220px] flex-col items-center justify-center rounded-xl border border-slate-200 border-dashed bg-slate-50 text-center">
                    <MousePointer2 className="mb-3 h-10 w-10 text-slate-300" />
                    <p className="text-sm font-semibold text-slate-500">No touch heatmap data available yet</p>
                    <p className="mt-1 text-xs text-slate-400">Heatmaps populate after users interact with tracked screens.</p>
                </div>
            </section>
        );
    }

    return (
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 p-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                        <h2 className="text-lg font-semibold text-slate-900">Interaction Heatmaps</h2>
                        <p className="mt-1 text-sm text-slate-500">Visualize where users tap, fail, and abandon, then jump directly to evidence replay.</p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                        {sortOptions.map((option) => (
                            <button
                                key={option.value}
                                onClick={() => setSortMode(option.value)}
                                className={`rounded-lg border px-2.5 py-1 text-xs font-semibold ${sortMode === option.value
                                    ? 'border-slate-900 bg-slate-900 text-white'
                                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                                    }`}
                            >
                                {option.label}
                            </button>
                        ))}
                        {lastUpdated && (
                            <span className="ml-1 text-xs text-slate-500">
                                Updated {new Date(lastUpdated).toLocaleString()}
                            </span>
                        )}
                    </div>
                </div>
            </div>

            <div className="space-y-5 p-5">
                <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <div className="text-[11px] uppercase tracking-wide text-slate-500">Tracked screens</div>
                        <div className="mt-1 text-xl font-semibold text-slate-900">{screens.length}</div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <div className="text-[11px] uppercase tracking-wide text-slate-500">All-time touches</div>
                        <div className="mt-1 text-xl font-semibold text-slate-900">{formatCompact(summary.allTimeTouches)}</div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <div className="text-[11px] uppercase tracking-wide text-slate-500">{timeRange} visits</div>
                        <div className="mt-1 text-xl font-semibold text-slate-900">{formatCompact(summary.rangeVisits)}</div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <div className="text-[11px] uppercase tracking-wide text-slate-500">Affected sessions</div>
                        <div className="mt-1 text-xl font-semibold text-rose-700">{formatCompact(summary.affectedSessions)}</div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <div className="text-[11px] uppercase tracking-wide text-slate-500">Critical screens</div>
                        <div className="mt-1 text-xl font-semibold text-amber-700">{summary.criticalScreens}</div>
                    </div>
                </div>

                <div className="grid grid-cols-1 items-stretch gap-5 xl:grid-cols-[280px_minmax(0,1fr)_320px]">
                    <div className="flex h-full min-h-0 flex-col rounded-2xl border border-slate-200 bg-slate-50 p-3">
                        <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Screen ranking</div>
                        <div className="relative flex-1 overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
                            <div className="h-full space-y-2 overflow-y-auto p-2 pr-1">
                                {sortedScreens.map((screen) => {
                                    const isSelected = selectedScreen.name === screen.name;
                                    return (
                                        <button
                                            key={screen.name}
                                            onClick={() => setSelectedScreenName(screen.name)}
                                            className={`w-full rounded-xl border px-3 py-2 text-left transition ${isSelected
                                                ? 'border-slate-900 bg-slate-900 text-white'
                                                : 'border-slate-200 bg-white text-slate-900 hover:bg-slate-100'
                                                }`}
                                        >
                                            <div className="flex items-center justify-between gap-2">
                                                <span className="truncate text-sm font-semibold">{screen.name}</span>
                                                <span className={`text-xs font-semibold ${isSelected ? 'text-slate-100' : 'text-slate-500'}`}>
                                                    {screen.rangeIncidentRatePer100.toFixed(1)}/100
                                                </span>
                                            </div>
                                            <div className={`mt-2 h-1.5 overflow-hidden rounded-full ${isSelected ? 'bg-white/25' : 'bg-slate-200'}`}>
                                                <div
                                                    className={isSelected ? 'h-full bg-emerald-300' : 'h-full bg-slate-700'}
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

                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                        <div className="mb-3 flex items-center justify-between gap-3">
                            <div>
                                <h3 className="text-base font-semibold text-slate-900">{selectedScreen.name}</h3>
                                <p className="text-xs text-slate-500">Primary signal: {selectedScreen.primarySignal.replace('_', ' ')}</p>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold uppercase ${priorityChipClass}`}>{selectedScreen.priority}</span>
                                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold uppercase ${confidenceChipClass}`}>{selectedScreen.confidence}</span>
                            </div>
                        </div>

                        <div className="mb-4 flex items-center justify-end gap-2">
                            <button
                                onClick={() => moveSelection(-1)}
                                disabled={selectedIndex <= 0}
                                className="rounded-lg border border-slate-300 bg-white p-1.5 text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
                                aria-label="Previous screen"
                            >
                                <ChevronLeft className="h-4 w-4" />
                            </button>
                            <button
                                onClick={() => moveSelection(1)}
                                disabled={selectedIndex < 0 || selectedIndex >= sortedScreens.length - 1}
                                className="rounded-lg border border-slate-300 bg-white p-1.5 text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
                                aria-label="Next screen"
                            >
                                <ChevronRight className="h-4 w-4" />
                            </button>
                        </div>

                        <HeatmapPreview screen={selectedScreen} />
                    </div>

                    <div className="rounded-2xl border border-slate-200 bg-white p-4">
                        <div className="mb-3 grid grid-cols-2 gap-2">
                            <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                                <div className="text-[11px] uppercase tracking-wide text-slate-500">Issue rate</div>
                                <div className="mt-1 text-xl font-semibold text-slate-900">{selectedScreen.rangeIncidentRatePer100.toFixed(1)}/100</div>
                            </div>
                            <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                                <div className="text-[11px] uppercase tracking-wide text-slate-500">Rage taps</div>
                                <div className="mt-1 text-xl font-semibold text-rose-700">{selectedScreen.rangeRageTapRatePer100.toFixed(1)}/100</div>
                            </div>
                            <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                                <div className="text-[11px] uppercase tracking-wide text-slate-500">{timeRange} visits</div>
                                <div className="mt-1 text-xl font-semibold text-slate-900">{formatCompact(selectedScreen.rangeVisits)}</div>
                            </div>
                            <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                                <div className="text-[11px] uppercase tracking-wide text-slate-500">All-time touches</div>
                                <div className="mt-1 text-xl font-semibold text-slate-900">{formatCompact(selectedScreen.visits)}</div>
                            </div>
                        </div>

                        <div className="mb-4 space-y-2">
                            {selectedSignalBars.map((bar) => {
                                const width = (bar.value / maxSignalValue) * 100;
                                const Icon = bar.icon;
                                return (
                                    <div key={bar.key}>
                                        <div className="mb-1 flex items-center justify-between text-xs">
                                            <span className="flex items-center gap-1 text-slate-600"><Icon className="h-3.5 w-3.5" />{bar.label}</span>
                                            <span className={`font-semibold ${bar.textClass}`}>{bar.value.toFixed(1)}{bar.unit}</span>
                                        </div>
                                        <div className="h-1.5 overflow-hidden rounded-full bg-slate-200">
                                            <div className={`h-full ${bar.barClass}`} style={{ width: `${Math.max(4, width)}%` }} />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Top friction zones</div>
                            <div className="mt-2 space-y-2">
                                {hotspotZones.map((zone) => (
                                    <div key={zone.id} className="flex items-center justify-between text-xs">
                                        <span className="text-slate-700">{zone.zone}</span>
                                        <span className={`rounded-full px-2 py-0.5 font-semibold ${zone.isRageTap ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'}`}>
                                            {zone.intensity}% {zone.isRageTap ? 'rage' : 'touch'}
                                        </span>
                                    </div>
                                ))}
                                {hotspotZones.length === 0 && (
                                    <p className="text-xs text-slate-500">No hotspot clusters identified for this screen.</p>
                                )}
                            </div>
                        </div>

                        <p className="mt-3 text-xs text-slate-600">{selectedScreen.recommendedAction}</p>

                        {selectedScreen.evidenceSessionId && (
                            <Link
                                to={`${pathPrefix}/sessions/${selectedScreen.evidenceSessionId}`}
                                className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:text-blue-800"
                            >
                                Open evidence replay <ArrowRight className="h-3.5 w-3.5" />
                            </Link>
                        )}
                    </div>
                </div>
            </div>
        </section>
    );
};
