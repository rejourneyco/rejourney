import React, { useRef, useState, useEffect, useCallback } from 'react';
import { ChevronLeft, ChevronRight, MousePointer2, Navigation } from 'lucide-react';
import { useSessionData } from '../../context/SessionContext';
import { getAlltimeHeatmap, AlltimeHeatmapScreen } from '../../services/api';
import { API_BASE_URL, getCsrfToken } from '../../config';
import { ProfessionalFrame } from '../ui/ProfessionalFrame';
import { NeoCard } from '../ui/neo/NeoCard';

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

/**
 * Individual heatmap card for a screen
 */
const HeatmapCard: React.FC<{ screen: AlltimeHeatmapScreen }> = ({ screen }) => {
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
                <div className="flex items-center justify-center gap-1.5 mt-1.5">
                    <span className="text-[9px] font-mono font-bold text-slate-500">{screen.visits.toLocaleString()} touches</span>
                    {screen.rageTaps > 0 && (
                        <span className="text-[9px] font-mono font-bold text-red-500 flex items-center gap-0.5">
                            <Navigation className="w-3 h-3 text-red-500" />
                            {screen.rageTaps}
                        </span>
                    )}
                </div>
            </div>
        </div>
    );
};

/**
 * Touch Heatmap Section for the Growth page
 * Displays all-time aggregated touch heatmaps independent of time filter
 */
export const TouchHeatmapSection: React.FC = () => {
    const { selectedProject } = useSessionData();
    const scrollRef = useRef<HTMLDivElement>(null);
    const [screens, setScreens] = useState<AlltimeHeatmapScreen[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [lastUpdated, setLastUpdated] = useState<string>('');

    useEffect(() => {
        if (!selectedProject?.id) return;

        let cancelled = false;
        setIsLoading(true);

        getAlltimeHeatmap(selectedProject.id)
            .then(data => {
                if (cancelled) return;
                setScreens(data.screens || []);
                setLastUpdated(data.lastUpdated);
            })
            .catch(() => {
                if (cancelled) return;
                setScreens([]);
            })
            .finally(() => {
                if (!cancelled) setIsLoading(false);
            });

        return () => { cancelled = true; };
    }, [selectedProject?.id]);

    const scroll = (dir: 'left' | 'right') => {
        scrollRef.current?.scrollBy({ left: dir === 'left' ? -300 : 300, behavior: 'smooth' });
    };

    if (isLoading) {
        return (
            <NeoCard title="Touch Heatmaps (All Time)" variant="flat" className="border-4 border-black bg-white shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]">
                <div className="flex gap-4 overflow-hidden py-2">
                    {[1, 2, 3, 4].map((i) => (
                        <div key={i} className="flex-shrink-0 w-[140px] animate-pulse">
                            <div className="aspect-[9/19.5] bg-slate-200 border-2 border-slate-300 rounded-3xl"></div>
                            <div className="mt-3 space-y-2">
                                <div className="h-3 bg-slate-200 rounded w-20 mx-auto border border-slate-300"></div>
                                <div className="h-2 bg-slate-100 rounded w-16 mx-auto border border-slate-300"></div>
                            </div>
                        </div>
                    ))}
                </div>
            </NeoCard>
        );
    }

    if (screens.length === 0) {
        return (
            <NeoCard title="Touch Heatmaps (All Time)" variant="flat" className="border-4 border-black bg-white shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]">
                <div className="text-center py-12 flex flex-col items-center justify-center min-h-[200px] border-2 border-slate-100 border-dashed rounded-lg bg-slate-50">
                    <MousePointer2 className="w-12 h-12 text-slate-300 mb-4" />
                    <p className="text-sm font-black text-slate-400 uppercase tracking-widest">No touch data available yet</p>
                    <p className="text-xs text-slate-400 mt-2 font-mono">Touch heatmaps will appear as users interact with your app</p>
                </div>
            </NeoCard>
        );
    }

    return (
        <NeoCard variant="flat" className="border-4 border-black bg-white shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] p-6">
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h3 className="text-xl font-black text-black uppercase tracking-tighter flex items-center gap-2">
                        <MousePointer2 className="w-6 h-6" />
                        Touch Heatmaps
                        <span className="px-2 py-0.5 bg-black text-white text-[10px] font-mono font-bold rounded-sm ml-2">ALL TIME</span>
                    </h3>
                    <p className="text-xs font-bold text-slate-500 mt-1 uppercase tracking-wide">Aggregated touch patterns</p>
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

            <div
                ref={scrollRef}
                className="flex gap-6 overflow-x-auto pb-4 hide-scrollbar scroll-smooth px-1"
                style={{ scrollSnapType: 'x mandatory' }}
            >
                {screens.map(screen => (
                    <HeatmapCard key={screen.name} screen={screen} />
                ))}
            </div>
        </NeoCard>
    );

};
