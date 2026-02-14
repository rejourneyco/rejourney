import React, { useRef, useState, useEffect, useMemo } from 'react';
import { ChevronLeft, ChevronRight, MousePointer2, Navigation } from 'lucide-react';
import { useSessionData } from '../../context/SessionContext';
import { getAlltimeHeatmap, getFrictionHeatmap, AlltimeHeatmapScreen, FrictionHeatmap } from '../../services/api';
import { API_BASE_URL, getCsrfToken } from '../../config';
import { ProfessionalFrame } from '../ui/ProfessionalFrame';
import { NeoCard } from '../ui/neo/NeoCard';
import { TimeRange } from '../ui/TimeFilter';

// Dynamic import for heic2any to avoid SSR window error
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

    const maxHotspotIntensity = Math.max(1, ...touchHotspots.map(h => h.intensity));
    const baseRadius = Math.max(50, Math.min(width, height) * 0.35);

    // Accumulate intensity on a coarse grid for performance
    const scale = 2;
    const w = Math.max(1, Math.floor(width / scale));
    const h = Math.max(1, Math.floor(height / scale));

    const intensityMap: number[][] = Array.from({ length: h }, () => new Array(w).fill(0));

    for (const hotspot of touchHotspots) {
        const centerX = Math.floor(hotspot.x * w);
        const centerY = Math.floor(hotspot.y * h);
        const weight = hotspot.intensity / maxHotspotIntensity;

        const radius = Math.max(20, baseRadius / scale);
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
                    const sigma = radius * 0.35;
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
        if (t < 0.02) return [0, 0, 0, 0];
        if (t < 0.20) {
            const s = (t - 0.02) / 0.18;
            const a = Math.round(90 + s * 90);
            return [Math.round(40 * s), Math.round(175 + s * 50), Math.round(70 + s * 30), a];
        }
        if (t < 0.40) {
            const s = (t - 0.20) / 0.20;
            const a = Math.round(170 + s * 60);
            return [Math.round(50 + s * 160), Math.round(225 - s * 25), Math.round(90 - s * 60), a];
        }
        if (t < 0.60) {
            const s = (t - 0.40) / 0.20;
            const a = Math.round(220 + s * 25);
            return [Math.round(210 + s * 45), Math.round(190 - s * 40), Math.round(40 - s * 40), a];
        }
        if (t < 0.80) {
            const s = (t - 0.60) / 0.20;
            return [255, Math.round(165 - s * 80), 0, 255];
        }
        {
            const s = (t - 0.80) / 0.20;
            return [255, Math.round(90 - s * 70), Math.round(s * 30), 255];
        }
    };

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const t = Math.min(1, intensityMap[y][x] / maxIntensity);
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

type SortMode = 'friction' | 'rage' | 'errors' | 'touches';

interface EnrichedHeatmapScreen extends AlltimeHeatmapScreen {
    rangeVisits: number;
    rangeRageTaps: number;
    rangeErrors: number;
    rangeExitRate: number;
    rangeFrictionScore: number;
    evidenceSessionId: string | null;
}

function getInsightsRangeFromTimeFilter(timeRange: TimeRange): string {
    if (timeRange === 'all') return 'all';
    return timeRange;
}

/**
 * Individual heatmap card for a screen
 */
const HeatmapCard: React.FC<{ screen: EnrichedHeatmapScreen }> = ({ screen }) => {
    const [blobUrl, setBlobUrl] = useState<string | null>(null);
    const [imageLoaded, setImageLoaded] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);

    const fullCoverUrl = screen.screenshotUrl
        ? screen.screenshotUrl.startsWith('http')
            ? screen.screenshotUrl
            : `${API_BASE_URL}${screen.screenshotUrl}`
        : null;

    const [downloadProgress, setDownloadProgress] = useState(0);

    useEffect(() => {
        if (!fullCoverUrl) return;

        let cancelled = false;
        const csrfToken = getCsrfToken() || '';
        const separator = fullCoverUrl.includes('?') ? '&' : '?';
        const fetchUrl = `${fullCoverUrl}${separator}_cb=${Date.now()}`;

        async function fetchWithProgress() {
            try {
                const res = await fetch(fetchUrl, {
                    credentials: 'include',
                    cache: 'no-store',
                    headers: { 'Accept': 'image/*', 'X-CSRF-Token': csrfToken }
                });

                if (!res.ok) {
                    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
                }

                const contentLength = +(res.headers.get('Content-Length') || 0);
                const contentType = res.headers.get('Content-Type') || '';

                if (!res.body) {
                    const blob = await res.blob();
                    return { blob, contentType };
                }

                const reader = res.body.getReader();
                let receivedLength = 0;
                const chunks = [];

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    chunks.push(value);
                    receivedLength += value.length;
                    if (contentLength) {
                        setDownloadProgress(Math.round((receivedLength / contentLength) * 100));
                    }
                }

                if (cancelled) return;

                const blob = new Blob(chunks);
                return { blob, contentType };
            } catch (error: any) {
                throw error;
            }
        }

        fetchWithProgress()
            .then(async (result) => {
                if (!result || cancelled) return;
                const { blob, contentType } = result;

                if (blob.size === 0) {
                    setLoadError('Empty image received');
                    return;
                }

                let displayBlob: Blob = blob;
                if (isHeicContentType(contentType)) {
                    try {
                        displayBlob = await convertHeic(blob);
                    } catch {
                        setLoadError('HEIC conversion failed');
                        return;
                    }
                }

                setImageLoaded(false);
                setLoadError(null);
                const newBlobUrl = URL.createObjectURL(displayBlob);

                setBlobUrl(prev => {
                    if (prev) URL.revokeObjectURL(prev);
                    return newBlobUrl;
                });
            })
            .catch((error) => {
                setLoadError(error?.message || 'Unknown fetch error');
            });

        return () => {
            cancelled = true;
            setBlobUrl(prev => {
                if (prev) URL.revokeObjectURL(prev);
                return prev;
            });
        };
    }, [fullCoverUrl]);

    useEffect(() => {
        const canvas = canvasRef.current;
        const container = containerRef.current;
        const hotspots = screen.touchHotspots || [];

        if (!canvas || !container) return;
        if (hotspots.length === 0) return;

        drawTouchHeatmap(canvas, container, hotspots);
    }, [screen.touchHotspots, imageLoaded, blobUrl]);

    const displayName = screen.name.length > 16 ? screen.name.slice(0, 14) + '...' : screen.name;

    return (
        <div
            className="flex-shrink-0 group"
            style={{ scrollSnapAlign: 'start' }}
        >
            <div className="relative transform-gpu transition-all duration-200 group-hover:-translate-y-1 group-hover:drop-shadow-lg">
                <ProfessionalFrame size="sm">
                    <div ref={containerRef} className="relative w-full h-full bg-slate-900">
                        {blobUrl ? (
                            <img
                                src={blobUrl}
                                alt={screen.name}
                                className={`absolute inset-0 w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity ${imageLoaded ? 'opacity-80' : 'opacity-0'}`}
                                onLoad={() => setImageLoaded(true)}
                                onError={() => setLoadError('Failed to load image')}
                            />
                        ) : (
                            <div className="absolute inset-0 bg-gradient-to-b from-slate-700 to-slate-800 flex flex-col items-center justify-center p-4">
                                <div className="text-center w-full">
                                    <MousePointer2 className="w-6 h-6 text-slate-500 mx-auto mb-2" />
                                    <p className="text-[8px] font-bold text-slate-500 uppercase mb-2">{displayName}</p>

                                    {!loadError && downloadProgress > 0 && downloadProgress < 100 && (
                                        <div className="w-full max-w-[80px] mx-auto">
                                            <div className="h-1.5 w-full bg-slate-900/30 border border-slate-700 rounded-full overflow-hidden">
                                                <div
                                                    className="h-full bg-blue-500 transition-all duration-300"
                                                    style={{ width: `${downloadProgress}%` }}
                                                />
                                            </div>
                                            <p className="text-[6px] font-mono text-slate-400 mt-1 uppercase tracking-tighter">
                                                fetching {downloadProgress}%
                                            </p>
                                        </div>
                                    )}

                                    {loadError && (
                                        <p className="text-[6px] font-mono text-red-400 mt-1">{loadError}</p>
                                    )}
                                </div>
                            </div>
                        )}

                        {(screen.touchHotspots?.length || 0) > 0 && (
                            <canvas
                                ref={canvasRef}
                                className="absolute inset-0 w-full h-full pointer-events-none opacity-90"
                                style={{ mixBlendMode: 'multiply' }}
                            />
                        )}
                    </div>
                </ProfessionalFrame>
            </div>

            <div className="mt-3 px-1 text-center">
                <p className="text-[10px] font-black text-slate-900 uppercase tracking-wider truncate" title={screen.name}>
                    {displayName}
                </p>
                <div className="mt-1.5 grid grid-cols-2 gap-1 text-[9px] font-mono font-bold">
                    <span className="text-slate-500">{screen.visits.toLocaleString()} all-time touches</span>
                    <span className="text-slate-600">{screen.rangeVisits.toLocaleString()} in range</span>
                    <span className="text-red-500 flex items-center justify-center gap-0.5">
                        <Navigation className="w-3 h-3 text-red-500" />
                        {screen.rangeRageTaps} rage
                    </span>
                    <span className="text-amber-600">{screen.rangeErrors} errors</span>
                    <span className="text-blue-600">{screen.rangeExitRate.toFixed(1)}% exits</span>
                    <span className="text-purple-600">friction {screen.rangeFrictionScore.toFixed(1)}</span>
                </div>
            </div>
        </div>
    );
};

interface TouchHeatmapSectionProps {
    timeRange?: TimeRange;
}

/**
 * Touch Heatmap Section for the Growth page
 * Combines all-time touch maps with selected time-range friction analytics.
 */
export const TouchHeatmapSection: React.FC<TouchHeatmapSectionProps> = ({ timeRange = '30d' }) => {
    const { selectedProject } = useSessionData();
    const scrollRef = useRef<HTMLDivElement>(null);
    const [screens, setScreens] = useState<EnrichedHeatmapScreen[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [lastUpdated, setLastUpdated] = useState<string>('');
    const [sortMode, setSortMode] = useState<SortMode>('friction');

    useEffect(() => {
        if (!selectedProject?.id) return;

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

                const mergedScreens: EnrichedHeatmapScreen[] = Array.from(mergedNames).map((name) => {
                    const alltime = alltimeMap.get(name);
                    const rangeData = frictionMap.get(name);

                    return {
                        name,
                        visits: alltime?.visits ?? rangeData?.visits ?? 0,
                        rageTaps: alltime?.rageTaps ?? rangeData?.rageTaps ?? 0,
                        errors: alltime?.errors ?? rangeData?.errors ?? 0,
                        exitRate: alltime?.exitRate ?? rangeData?.exitRate ?? 0,
                        frictionScore: alltime?.frictionScore ?? rangeData?.frictionScore ?? 0,
                        screenshotUrl: alltime?.screenshotUrl ?? rangeData?.screenshotUrl ?? null,
                        sessionIds: alltime?.sessionIds ?? rangeData?.sessionIds ?? [],
                        touchHotspots: alltime?.touchHotspots ?? rangeData?.touchHotspots ?? [],
                        rangeVisits: rangeData?.visits ?? 0,
                        rangeRageTaps: rangeData?.rageTaps ?? 0,
                        rangeErrors: rangeData?.errors ?? 0,
                        rangeExitRate: rangeData?.exitRate ?? 0,
                        rangeFrictionScore: rangeData?.frictionScore ?? 0,
                        evidenceSessionId: rangeData?.sessionIds?.[0] ?? alltime?.sessionIds?.[0] ?? null,
                    };
                });

                setScreens(mergedScreens);
                setLastUpdated(allTime.lastUpdated);
            })
            .catch(() => {
                if (!cancelled) setScreens([]);
            })
            .finally(() => {
                if (!cancelled) setIsLoading(false);
            });

        return () => { cancelled = true; };
    }, [selectedProject?.id, timeRange]);

    const sortedScreens = useMemo(() => {
        const copied = [...screens];
        switch (sortMode) {
            case 'rage':
                return copied.sort((a, b) => b.rangeRageTaps - a.rangeRageTaps);
            case 'errors':
                return copied.sort((a, b) => b.rangeErrors - a.rangeErrors);
            case 'touches':
                return copied.sort((a, b) => b.visits - a.visits);
            case 'friction':
            default:
                return copied.sort((a, b) => b.rangeFrictionScore - a.rangeFrictionScore);
        }
    }, [screens, sortMode]);

    const summary = useMemo(() => {
        const totals = sortedScreens.reduce((acc, screen) => {
            acc.allTimeTouches += screen.visits;
            acc.rangeTouches += screen.rangeVisits;
            acc.rangeRage += screen.rangeRageTaps;
            acc.rangeErrors += screen.rangeErrors;
            acc.friction += screen.rangeFrictionScore;
            return acc;
        }, {
            allTimeTouches: 0,
            rangeTouches: 0,
            rangeRage: 0,
            rangeErrors: 0,
            friction: 0,
        });

        return {
            ...totals,
            avgFriction: sortedScreens.length > 0 ? totals.friction / sortedScreens.length : 0,
        };
    }, [sortedScreens]);

    const scroll = (dir: 'left' | 'right') => {
        scrollRef.current?.scrollBy({ left: dir === 'left' ? -320 : 320, behavior: 'smooth' });
    };

    if (isLoading) {
        return (
            <NeoCard variant="flat" className="border-4 border-black bg-white shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] p-6">
                <div className="flex items-center justify-between mb-6">
                    <div>
                        <h3 className="text-xl font-black text-black uppercase tracking-tighter flex items-center gap-2">
                            <MousePointer2 className="w-6 h-6" />
                            Heatmaps + Friction Overlay
                            <span className="px-2 py-0.5 bg-black text-white text-[10px] font-mono font-bold rounded-sm ml-2">{timeRange}</span>
                        </h3>
                        <p className="text-xs font-bold text-slate-500 mt-1 uppercase tracking-wide">Merging all-time touch maps with selected-range friction signals</p>
                    </div>
                </div>
                <div className="h-40 rounded-xl border-2 border-slate-200 bg-slate-50 animate-pulse" />
            </NeoCard>
        );
    }

    if (screens.length === 0) {
        return (
            <NeoCard title="Heatmaps + Friction Overlay" variant="flat" className="border-4 border-black bg-white shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]">
                <div className="text-center py-12 flex flex-col items-center justify-center min-h-[200px] border-2 border-slate-100 border-dashed rounded-lg bg-slate-50">
                    <MousePointer2 className="w-12 h-12 text-slate-300 mb-4" />
                    <p className="text-sm font-black text-slate-400 uppercase tracking-widest">No touch heatmap data available yet</p>
                    <p className="text-xs text-slate-400 mt-2 font-mono">Heatmaps will populate after users interact with screens</p>
                </div>
            </NeoCard>
        );
    }

    return (
        <NeoCard variant="flat" className="border-4 border-black bg-white shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] p-6">
            <div className="flex flex-col gap-4 mb-6">
                <div className="flex items-center justify-between gap-4">
                    <div>
                        <h3 className="text-xl font-black text-black uppercase tracking-tighter flex items-center gap-2">
                            <MousePointer2 className="w-6 h-6" />
                            Heatmaps + Friction Overlay
                            <span className="px-2 py-0.5 bg-black text-white text-[10px] font-mono font-bold rounded-sm ml-2">{timeRange}</span>
                        </h3>
                        <p className="text-xs font-bold text-slate-500 mt-1 uppercase tracking-wide">
                            All-time touch density with range-specific rage, error, exit, and friction context
                        </p>
                    </div>
                    <div className="flex gap-2">
                        <button
                            onClick={() => scroll('left')}
                            className="p-2 border-2 border-black bg-white text-black hover:bg-black hover:text-white transition-all shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none"
                        >
                            <ChevronLeft size={20} />
                        </button>
                        <button
                            onClick={() => scroll('right')}
                            className="p-2 border-2 border-black bg-white text-black hover:bg-black hover:text-white transition-all shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none"
                        >
                            <ChevronRight size={20} />
                        </button>
                    </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-[10px] font-mono font-bold uppercase">
                    <div className="border-2 border-black bg-slate-50 px-2 py-1.5">All-time touches: {summary.allTimeTouches.toLocaleString()}</div>
                    <div className="border-2 border-black bg-slate-50 px-2 py-1.5">{timeRange} touches: {summary.rangeTouches.toLocaleString()}</div>
                    <div className="border-2 border-black bg-red-50 px-2 py-1.5 text-red-700">Rage taps: {summary.rangeRage.toLocaleString()}</div>
                    <div className="border-2 border-black bg-amber-50 px-2 py-1.5 text-amber-700">Errors: {summary.rangeErrors.toLocaleString()}</div>
                    <div className="border-2 border-black bg-purple-50 px-2 py-1.5 text-purple-700">Avg friction: {summary.avgFriction.toFixed(1)}</div>
                </div>

                <div className="flex items-center gap-2">
                    {([
                        { value: 'friction', label: 'Sort by Friction' },
                        { value: 'rage', label: 'Sort by Rage' },
                        { value: 'errors', label: 'Sort by Errors' },
                        { value: 'touches', label: 'Sort by Touches' },
                    ] as Array<{ value: SortMode; label: string }>).map((option) => (
                        <button
                            key={option.value}
                            onClick={() => setSortMode(option.value)}
                            className={`px-2 py-1 text-[10px] font-black uppercase border-2 border-black ${sortMode === option.value ? 'bg-black text-white' : 'bg-white text-black'}`}
                        >
                            {option.label}
                        </button>
                    ))}
                    {lastUpdated && (
                        <span className="ml-auto text-[10px] font-mono text-slate-400 uppercase">
                            updated {new Date(lastUpdated).toLocaleString()}
                        </span>
                    )}
                </div>
            </div>

            <div
                ref={scrollRef}
                className="flex gap-6 overflow-x-auto pb-4 hide-scrollbar scroll-smooth px-1"
                style={{ scrollSnapType: 'x mandatory' }}
            >
                {sortedScreens.map(screen => (
                    <HeatmapCard key={screen.name} screen={screen} />
                ))}
            </div>
        </NeoCard>
    );
};
