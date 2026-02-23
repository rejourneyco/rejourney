import React, { useEffect, useMemo, useState } from 'react';
import { Activity, Globe, ShieldAlert } from 'lucide-react';
import { useSessionData } from '../../context/SessionContext';
import { DashboardPageHeader } from '../../components/ui/DashboardPageHeader';
import { TimeFilter, TimeRange, DEFAULT_TIME_RANGE } from '../../components/ui/TimeFilter';
import { useDemoMode } from '../../context/DemoModeContext';
import {
    getApiLatencyByLocation,
    getGeoIssues,
    type ApiLatencyByLocationResponse,
    type GeoIssuesSummary,
} from '../../services/api';
import { config } from '../../config';

// @ts-ignore: mapbox-gl default export typing can vary across versions
import mapboxgl from 'mapbox-gl';
// @ts-ignore: React-map-gl types might not resolve with this TS config
import MapGL, { Marker, NavigationControl, Popup } from 'react-map-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

const MAPBOX_TOKEN = config.mapboxToken;
const DISABLE_MAPBOX_IN_DEMO = true;

type LatencyTier = 'excellent' | 'good' | 'degraded' | 'critical' | 'unknown';

interface MarkerStyle {
    fill: string;
    solid: string;
    ring: string;
}

interface GeoMarker {
    id: string;
    city: string;
    country: string;
    lat: number;
    lng: number;
    sessions: number;
    avgLatencyMs?: number;
    latencyTier: LatencyTier;
    markerSize: number;
    style: MarkerStyle;
}

const EMPTY_ISSUES: GeoIssuesSummary = {
    locations: [],
    countries: [],
    summary: {
        totalIssues: 0,
        byType: {
            crashes: 0,
            anrs: 0,
            errors: 0,
            rageTaps: 0,
            apiErrors: 0,
        },
    },
};

const EMPTY_LATENCY: ApiLatencyByLocationResponse = {
    regions: [],
    summary: {
        avgLatency: 0,
        totalRequests: 0,
    },
};

const LATENCY_STYLE: Record<LatencyTier, MarkerStyle> = {
    excellent: {
        fill: 'rgba(22, 163, 74, 0.8)',
        solid: '#16a34a',
        ring: 'rgba(22, 163, 74, 0.28)',
    },
    good: {
        fill: 'rgba(2, 132, 199, 0.8)',
        solid: '#0284c7',
        ring: 'rgba(2, 132, 199, 0.28)',
    },
    degraded: {
        fill: 'rgba(217, 119, 6, 0.8)',
        solid: '#d97706',
        ring: 'rgba(217, 119, 6, 0.28)',
    },
    critical: {
        fill: 'rgba(220, 38, 38, 0.8)',
        solid: '#dc2626',
        ring: 'rgba(220, 38, 38, 0.28)',
    },
    unknown: {
        fill: 'rgba(100, 116, 139, 0.78)',
        solid: '#64748b',
        ring: 'rgba(100, 116, 139, 0.26)',
    },
};

function normalizeCountry(value?: string): string {
    return (value || '').trim().toLowerCase();
}

function getLatencyTier(latency?: number): LatencyTier {
    if (latency === undefined || Number.isNaN(latency) || latency <= 0) {
        return 'unknown';
    }
    if (latency <= 140) return 'excellent';
    if (latency <= 250) return 'good';
    if (latency <= 400) return 'degraded';
    return 'critical';
}

function getMarkerSize(sessions: number, maxSessions: number): number {
    const safeMax = Math.max(maxSessions, 1);
    const normalized = Math.max(0, sessions) / safeMax;
    // Larger visual spread for high-volume regions while keeping cap reasonable.
    return Math.round(8 + normalized * 30);
}

function formatLatency(value?: number): string {
    if (!value || Number.isNaN(value)) return 'N/A';
    return `${Math.round(value)}ms`;
}

export const Geo: React.FC = () => {
    const { selectedProject } = useSessionData();
    const { isDemoMode } = useDemoMode();

    const [timeRange, setTimeRange] = useState<TimeRange>(DEFAULT_TIME_RANGE);
    const [issues, setIssues] = useState<GeoIssuesSummary>(EMPTY_ISSUES);
    const [latencyByLocation, setLatencyByLocation] = useState<ApiLatencyByLocationResponse>(EMPTY_LATENCY);
    const [isLoading, setIsLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [hoveredMarkerId, setHoveredMarkerId] = useState<string | null>(null);

    useEffect(() => {
        const mapbox = mapboxgl as any;
        if (mapbox && typeof mapbox.setTelemetryEnabled === 'function') {
            mapbox.setTelemetryEnabled(false);
        }
    }, []);

    useEffect(() => {
        if (!selectedProject?.id) {
            setIssues(EMPTY_ISSUES);
            setLatencyByLocation(EMPTY_LATENCY);
            setLoadError(null);
            setIsLoading(false);
            return;
        }

        let isCancelled = false;
        setIsLoading(true);
        setLoadError(null);

        const range = timeRange === 'all' ? undefined : timeRange;

        Promise.allSettled([
            getGeoIssues(selectedProject.id, range),
            getApiLatencyByLocation(selectedProject.id, range),
        ])
            .then(([issuesResult, latencyResult]) => {
                if (isCancelled) return;

                if (issuesResult.status === 'fulfilled') {
                    setIssues(issuesResult.value);
                } else {
                    console.error('Failed to load geo issue data:', issuesResult.reason);
                    setIssues(EMPTY_ISSUES);
                }

                if (latencyResult.status === 'fulfilled') {
                    setLatencyByLocation(latencyResult.value);
                } else {
                    console.error('Failed to load geo latency data:', latencyResult.reason);
                    setLatencyByLocation(EMPTY_LATENCY);
                }

                if (issuesResult.status === 'rejected' && latencyResult.status === 'rejected') {
                    setLoadError('Could not load map data.');
                }
            })
            .finally(() => {
                if (!isCancelled) setIsLoading(false);
            });

        return () => {
            isCancelled = true;
        };
    }, [selectedProject?.id, timeRange]);

    const latencyByCountry = useMemo(() => {
        const countryToLatency = new Map<string, number>();
        for (const region of latencyByLocation.regions) {
            countryToLatency.set(normalizeCountry(region.country), region.avgLatencyMs);
        }
        return countryToLatency;
    }, [latencyByLocation.regions]);

    const markers = useMemo<GeoMarker[]>(() => {
        const locations = issues.locations || [];
        const maxSessions = Math.max(...locations.map((loc) => loc.sessions || 0), 1);
        const fallbackLatency = latencyByLocation.summary.avgLatency > 0
            ? latencyByLocation.summary.avgLatency
            : undefined;

        return locations
            .filter((loc) => Number.isFinite(loc.lat) && Number.isFinite(loc.lng))
            .map((loc, index) => {
                const avgLatencyMs = latencyByCountry.get(normalizeCountry(loc.country)) ?? fallbackLatency;
                const latencyTier = getLatencyTier(avgLatencyMs);

                return {
                    id: `${loc.country}:${loc.city}:${index}`,
                    city: loc.city || 'Unknown',
                    country: loc.country,
                    lat: loc.lat,
                    lng: loc.lng,
                    sessions: loc.sessions || 0,
                    avgLatencyMs,
                    latencyTier,
                    markerSize: getMarkerSize(loc.sessions || 0, maxSessions),
                    style: LATENCY_STYLE[latencyTier],
                };
            })
            .sort((a, b) => b.sessions - a.sessions);
    }, [issues.locations, latencyByCountry, latencyByLocation.summary.avgLatency]);

    const hoveredMarker = useMemo(
        () => (hoveredMarkerId ? markers.find((marker) => marker.id === hoveredMarkerId) || null : null),
        [markers, hoveredMarkerId]
    );

    return (
        <div className="min-h-screen font-sans text-slate-900 bg-transparent flex flex-col">
            <div className="sticky top-0 z-30 bg-white border-b border-slate-200">
                <DashboardPageHeader
                    title="Geographic Analysis"
                    icon={<Globe className="w-6 h-6" />}
                    iconColor="bg-sky-600"
                >
                    <TimeFilter value={timeRange} onChange={setTimeRange} />
                </DashboardPageHeader>
            </div>

            <div className="flex-1 w-full bg-white relative">
                {!selectedProject?.id ? (
                    <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-500">Select a project.</div>
                ) : isLoading ? (
                    <div className="absolute inset-0 flex items-center justify-center text-slate-500">
                        <Activity className="h-6 w-6 animate-pulse" />
                    </div>
                ) : !MAPBOX_TOKEN ? (
                    <div className="absolute inset-0 flex items-center justify-center text-center text-sm text-rose-500 px-4">
                        <ShieldAlert className="h-5 w-5 mr-2" />
                        <span>Missing VITE_MAPBOX_TOKEN</span>
                    </div>
                ) : (isDemoMode && DISABLE_MAPBOX_IN_DEMO) ? (
                    <div className="absolute inset-0 flex items-center justify-center text-center p-8">
                        <div className="max-w-md">
                            <Globe className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                            <h3 className="text-lg font-medium text-slate-900 mb-2 font-sans">Mapbox Disabled in Demo</h3>
                            <p className="text-sm text-slate-500 leading-relaxed">
                                Geographic maps are disabled during the live demo to focus on privacy and conserve resources.
                                Full interactive maps are available on the production dashboard.
                            </p>
                        </div>
                    </div>
                ) : (
                    <div className="relative h-[calc(100vh-132px)] min-h-[560px] w-full overflow-hidden bg-white">
                        <MapGL
                            mapboxAccessToken={MAPBOX_TOKEN}
                            reuseMaps
                            initialViewState={{
                                longitude: 8,
                                latitude: 20,
                                zoom: 1.45,
                                pitch: 18,
                                bearing: 0,
                            }}
                            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
                            mapStyle="mapbox://styles/mapbox/light-v11"
                            projection={{ name: 'globe' }}
                            dragPan
                            dragRotate
                            scrollZoom
                            touchZoomRotate
                            doubleClickZoom
                            keyboard
                            cursor="grab"
                            onError={(event: any) => console.error('[Mapbox] error:', event)}
                        >
                            <NavigationControl position="bottom-right" showCompass showZoom />

                            {markers.map((marker) => {
                                const isHovered = marker.id === hoveredMarkerId;
                                return (
                                    <Marker
                                        key={marker.id}
                                        longitude={marker.lng}
                                        latitude={marker.lat}
                                        anchor="center"
                                    >
                                        <button
                                            type="button"
                                            className="relative rounded-full transition-transform duration-150"
                                            style={{
                                                width: `${marker.markerSize}px`,
                                                height: `${marker.markerSize}px`,
                                                transform: isHovered ? 'scale(1.1)' : 'scale(1)',
                                                backgroundColor: marker.style.fill,
                                                border: '1.5px solid rgba(15, 23, 42, 0.38)',
                                                boxShadow: isHovered
                                                    ? `0 0 0 2px ${marker.style.ring}, 0 3px 8px rgba(15,23,42,0.24)`
                                                    : '0 1px 3px rgba(15,23,42,0.24)',
                                            }}
                                            aria-label={`${marker.city}, ${marker.country}: ${marker.sessions.toLocaleString()} active users, ${formatLatency(marker.avgLatencyMs)} avg latency`}
                                            onMouseEnter={() => setHoveredMarkerId(marker.id)}
                                            onMouseLeave={() => setHoveredMarkerId((prev) => (prev === marker.id ? null : prev))}
                                        />
                                    </Marker>
                                );
                            })}

                            {hoveredMarker && (
                                <Popup
                                    longitude={hoveredMarker.lng}
                                    latitude={hoveredMarker.lat}
                                    closeButton={false}
                                    closeOnClick={false}
                                    anchor="bottom"
                                    offset={14}
                                    className="geo-hover-popup"
                                >
                                    <div className="rounded-lg border border-slate-200 bg-white/95 px-2.5 py-2 text-[11px] text-slate-700 shadow-lg backdrop-blur-[2px]">
                                        <div className="mb-0.5 font-semibold text-slate-900">
                                            {hoveredMarker.city}, {hoveredMarker.country}
                                        </div>
                                        <div className="flex items-center gap-2 text-slate-600">
                                            <span>{hoveredMarker.sessions.toLocaleString()} users</span>
                                            <span className="h-1 w-1 rounded-full bg-slate-300" />
                                            <span style={{ color: hoveredMarker.style.solid }}>{formatLatency(hoveredMarker.avgLatencyMs)}</span>
                                        </div>
                                    </div>
                                </Popup>
                            )}
                        </MapGL>

                    </div>
                )}
            </div>

            <style>{`
                .geo-hover-popup .mapboxgl-popup-content {
                    background: transparent !important;
                    box-shadow: none !important;
                    padding: 0 !important;
                    pointer-events: none !important;
                }
                .geo-hover-popup .mapboxgl-popup-tip {
                    border-top-color: rgba(255, 255, 255, 0.92) !important;
                }
            `}</style>
        </div>
    );
};

export default Geo;
