import React, { useEffect, useMemo, useState } from 'react';
import { Globe, ShieldAlert } from 'lucide-react';
import { useSessionData } from '~/shared/providers/SessionContext';
import { DashboardPageHeader } from '~/shared/ui/core/DashboardPageHeader';
import { TimeFilter, TimeRange, DEFAULT_TIME_RANGE } from '~/shared/ui/core/TimeFilter';
import { useDemoMode } from '~/shared/providers/DemoModeContext';
import {
    getGeoOverview,
    type ApiLatencyByLocationResponse,
    type GeoIssuesSummary,
} from '~/shared/api/client';
import { DashboardGhostLoader } from '~/shared/ui/core/DashboardGhostLoader';
import { disableMapboxTelemetry, isMapboxConfigured } from '~/shared/integrations/mapbox';
import { getMapboxToken } from '~/shared/config/runtimeEnv';
// @ts-ignore: react-map-gl typing can fail under current tsconfig
import MapGL, { Marker, NavigationControl, Popup } from 'react-map-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
const ENABLE_MAPBOX_IN_DEMO = true;
const MAPBOX_TOKEN = getMapboxToken();
const GEO_MAP_STYLE = 'mapbox://styles/mapbox/standard';
const GEO_MAP_CONFIG = {
    basemap: {
        lightPreset: 'day',
        show3dObjects: false,
        showAdminBoundaries: true,
        showPedestrianRoads: false,
        showPointOfInterestLabels: false,
        showTransitLabels: true,
        colorGreenspace: '#8fe39d',
        colorWater: '#58c9f5',
        colorLand: '#c8efbf',
        colorRoads: '#f2a0b6',
        colorMotorways: '#ef8ba4',
        colorTrunks: '#e9a06f',
    },
};

function applyGeoMapConfig(map: any): void {
    if (!map || typeof map.setConfigProperty !== 'function') return;

    Object.entries(GEO_MAP_CONFIG.basemap).forEach(([property, value]) => {
        map.setConfigProperty('basemap', property, value);
    });
}

function getMapInstance(mapRef: React.MutableRefObject<any>) {
    return mapRef.current?.getMap?.() ?? mapRef.current;
}

function getWeightedMapCenter(markers: GeoMarker[]) {
    const validMarkers = markers.filter((marker) => Number.isFinite(marker.lng) && Number.isFinite(marker.lat));
    if (validMarkers.length === 0) {
        return { longitude: -28, latitude: 22 };
    }

    let weightedSin = 0;
    let weightedCos = 0;
    let weightedLat = 0;
    let totalWeight = 0;

    validMarkers.forEach((marker) => {
        const weight = Math.max(marker.sessions, marker.uniqueUsers, 1);
        const radians = (marker.lng * Math.PI) / 180;
        weightedSin += Math.sin(radians) * weight;
        weightedCos += Math.cos(radians) * weight;
        weightedLat += marker.lat * weight;
        totalWeight += weight;
    });

    const longitude = (Math.atan2(weightedSin / totalWeight, weightedCos / totalWeight) * 180) / Math.PI;
    const latitude = Math.max(-38, Math.min(52, weightedLat / totalWeight));
    return { longitude, latitude };
}

type LatencyTier = 'excellent' | 'good' | 'degraded' | 'critical' | 'unknown';

interface MarkerStyle {
    fill: string;
    solid: string;
    ring: string;
    face: 'happy' | 'neutral' | 'angry';
}

interface GeoMarker {
    id: string;
    city: string;
    country: string;
    lat: number;
    lng: number;
    sessions: number;
    uniqueUsers: number;
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
        fill: 'rgba(34, 197, 94, 0.9)',
        solid: 'rgba(21, 128, 61, 1)',
        ring: 'rgba(34, 197, 94, 0.46)',
        face: 'happy',
    },
    good: {
        fill: 'rgba(234, 179, 8, 0.92)',
        solid: 'rgba(202, 138, 4, 1)',
        ring: 'rgba(234, 179, 8, 0.5)',
        face: 'neutral',
    },
    degraded: {
        fill: 'rgba(249, 115, 22, 0.92)',
        solid: 'rgba(194, 65, 12, 1)',
        ring: 'rgba(249, 115, 22, 0.52)',
        face: 'neutral',
    },
    critical: {
        fill: 'rgba(255, 71, 87, 0.94)',
        solid: 'rgba(185, 28, 28, 1)',
        ring: 'rgba(255, 71, 87, 0.54)',
        face: 'angry',
    },
    unknown: {
        fill: 'rgba(107, 114, 128, 0.86)',
        solid: 'rgba(55, 65, 81, 1)',
        ring: 'rgba(100, 116, 139, 0.46)',
        face: 'neutral',
    },
};

function normalizeCountry(value?: string): string {
    return (value || '').trim().toLowerCase();
}

function normalizeCity(value?: string): string {
    return (value || '').trim().toLowerCase();
}

function getLocationLatencyKey(country?: string, city?: string): string {
    return `${normalizeCountry(country)}:${normalizeCity(city)}`;
}

function getLatencyTier(latency?: number): LatencyTier {
    if (latency === undefined || Number.isNaN(latency) || latency <= 0) {
        return 'unknown';
    }
    if (latency < 600) return 'excellent';
    if (latency < 900) return 'good';
    if (latency < 1200) return 'degraded';
    return 'critical';
}

function getMarkerSize(activeUsers: number, maxActiveUsers: number): number {
    const safeMax = Math.max(maxActiveUsers, 1);
    const normalized = Math.sqrt(Math.max(0, activeUsers) / safeMax);
    return Math.round(5 + normalized * 31);
}

function formatLatency(value?: number): string {
    if (!value || Number.isNaN(value)) return 'N/A';
    return `${Math.round(value)}ms`;
}

function renderLatencyFace(face: MarkerStyle['face']) {
    const mouthStyle: React.CSSProperties =
        face === 'happy'
            ? {
                left: '29%',
                top: '47%',
                width: '42%',
                height: '26%',
                borderBottom: '2px solid rgba(3, 7, 18, 0.86)',
                borderRadius: '0 0 999px 999px',
            }
            : face === 'angry'
                ? {
                    left: '32%',
                    top: '62%',
                    width: '36%',
                    height: '18%',
                    borderTop: '2px solid rgba(3, 7, 18, 0.86)',
                    borderRadius: '999px 999px 0 0',
                }
                : {
                    left: '32%',
                    top: '59%',
                    width: '36%',
                    height: '2px',
                    backgroundColor: 'rgba(3, 7, 18, 0.82)',
                    borderRadius: '999px',
                };

    return (
        <span className="pointer-events-none absolute inset-0 block">
            <span
                className="absolute rounded-full bg-slate-950"
                style={{ left: '29%', top: '33%', width: '10%', height: '10%' }}
            />
            <span
                className="absolute rounded-full bg-slate-950"
                style={{ right: '29%', top: '33%', width: '10%', height: '10%' }}
            />
            {face === 'angry' && (
                <>
                    <span
                        className="absolute bg-slate-950"
                        style={{ left: '24%', top: '25%', width: '19%', height: '2px', transform: 'rotate(24deg)' }}
                    />
                    <span
                        className="absolute bg-slate-950"
                        style={{ right: '24%', top: '25%', width: '19%', height: '2px', transform: 'rotate(-24deg)' }}
                    />
                </>
            )}
            <span className="absolute block" style={mouthStyle} />
        </span>
    );
}

export const Geo: React.FC = () => {
    const { selectedProject } = useSessionData();
    const { isDemoMode } = useDemoMode();
    const mapRef = React.useRef<any>(null);
    const isHoverPausedRef = React.useRef(false);
    const isInteractionPausedRef = React.useRef(false);
    const resumeRotationTimerRef = React.useRef<number | null>(null);

    const [timeRange, setTimeRange] = useState<TimeRange>(DEFAULT_TIME_RANGE);
    const [issues, setIssues] = useState<GeoIssuesSummary>(EMPTY_ISSUES);
    const [latencyByLocation, setLatencyByLocation] = useState<ApiLatencyByLocationResponse>(EMPTY_LATENCY);
    const [isLoading, setIsLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [hoveredMarkerId, setHoveredMarkerId] = useState<string | null>(null);

    useEffect(() => {
        disableMapboxTelemetry();
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

        void getGeoOverview(selectedProject.id, timeRange)
            .then((overview) => {
                if (isCancelled) return;
                setIssues(overview.issues);
                setLatencyByLocation(overview.latencyByLocation);
                setLoadError(overview.failedSections.length > 0 ? 'Some geographic sections are unavailable.' : null);
            })
            .catch((err) => {
                console.error('Failed to load geographic overview:', err);
                if (isCancelled) return;
                setIssues(EMPTY_ISSUES);
                setLatencyByLocation(EMPTY_LATENCY);
                setLoadError('Could not load map data.');
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

    const latencyByLocationKey = useMemo(() => {
        const locationToLatency = new Map<string, number>();
        for (const location of latencyByLocation.locations || []) {
            locationToLatency.set(getLocationLatencyKey(location.country, location.city), location.avgLatencyMs);
        }
        return locationToLatency;
    }, [latencyByLocation.locations]);

    const markers = useMemo<GeoMarker[]>(() => {
        const locations = issues.locations || [];
        const maxActiveUsers = Math.max(...locations.map((loc) => loc.uniqueUsers || 0), 1);
        const fallbackLatency = latencyByLocation.summary.avgLatency > 0
            ? latencyByLocation.summary.avgLatency
            : undefined;

        return locations
            .filter((loc) => Number.isFinite(loc.lat) && Number.isFinite(loc.lng))
            .map((loc, index) => {
                const avgLatencyMs =
                    latencyByLocationKey.get(getLocationLatencyKey(loc.country, loc.city))
                    ?? latencyByCountry.get(normalizeCountry(loc.country))
                    ?? fallbackLatency;
                const latencyTier = getLatencyTier(avgLatencyMs);

                return {
                    id: `${loc.country}:${loc.city}:${index}`,
                    city: loc.city || 'Unknown',
                    country: loc.country,
                    lat: loc.lat,
                    lng: loc.lng,
                    sessions: loc.sessions || 0,
                    uniqueUsers: loc.uniqueUsers || 0,
                    avgLatencyMs,
                    latencyTier,
                    markerSize: getMarkerSize(loc.uniqueUsers || 0, maxActiveUsers),
                    style: LATENCY_STYLE[latencyTier],
                };
            })
            .sort((a, b) => b.uniqueUsers - a.uniqueUsers);
    }, [issues.locations, latencyByCountry, latencyByLocation.summary.avgLatency, latencyByLocationKey]);

    const hoveredMarker = useMemo(
        () => (hoveredMarkerId ? markers.find((marker) => marker.id === hoveredMarkerId) || null : null),
        [hoveredMarkerId, markers],
    );

    const initialViewState = useMemo(() => {
        const center = getWeightedMapCenter(markers);
        return {
            longitude: center.longitude,
            latitude: center.latitude,
            zoom: 1.34,
            pitch: 14,
            bearing: 0,
        };
    }, [markers]);

    useEffect(() => {
        let animationFrame = 0;
        let previousTime = performance.now();

        const rotateGlobe = (time: number) => {
            const map = getMapInstance(mapRef);
            if (!map || isHoverPausedRef.current || isInteractionPausedRef.current) return;

            const center = map.getCenter();
            const deltaSeconds = Math.min((time - previousTime) / 1000, 0.05);
            previousTime = time;
            map.setCenter([center.lng + deltaSeconds * 1.8, center.lat]);
        };

        const tick = (time: number) => {
            rotateGlobe(time);
            animationFrame = window.requestAnimationFrame(tick);
        };

        animationFrame = window.requestAnimationFrame(tick);

        return () => {
            window.cancelAnimationFrame(animationFrame);
            if (resumeRotationTimerRef.current) {
                window.clearTimeout(resumeRotationTimerRef.current);
            }
        };
    }, []);

    const pauseRotationBriefly = () => {
        isInteractionPausedRef.current = true;
        if (resumeRotationTimerRef.current) {
            window.clearTimeout(resumeRotationTimerRef.current);
        }
        resumeRotationTimerRef.current = window.setTimeout(() => {
            isInteractionPausedRef.current = false;
            resumeRotationTimerRef.current = null;
        }, 2400);
    };

    const setHoverPaused = (isPaused: boolean) => {
        isHoverPausedRef.current = isPaused;
    };

    if (isLoading && selectedProject?.id) {
        return <DashboardGhostLoader variant="map" />;
    }

    return (
        <div className="flex min-h-screen flex-col bg-transparent font-sans text-slate-900">
            <div className="shrink-0">
                <DashboardPageHeader
                    title="Geographic Analysis"
                    icon={<Globe className="w-6 h-6" />}
                    iconColor="bg-sky-600"
                >
                    <TimeFilter value={timeRange} onChange={setTimeRange} />
                </DashboardPageHeader>
            </div>

            <div className="relative min-h-0 w-full flex-1 bg-white">
                {!selectedProject?.id ? (
                    <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-500">Select a project.</div>
                ) : !isMapboxConfigured() ? (
                    <div className="absolute inset-0 flex items-center justify-center text-center text-sm text-rose-500 px-4">
                        <ShieldAlert className="h-5 w-5 mr-2" />
                        <span>Missing VITE_MAPBOX_TOKEN</span>
                    </div>
                ) : (isDemoMode && !ENABLE_MAPBOX_IN_DEMO) ? (
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
                    <div
                        className="relative h-[calc(100vh-132px)] min-h-[560px] w-full overflow-hidden bg-[#05070d]"
                        onMouseEnter={() => setHoverPaused(true)}
                        onMouseLeave={() => setHoverPaused(false)}
                        onFocus={() => setHoverPaused(true)}
                        onBlur={() => setHoverPaused(false)}
                    >
                        <MapGL
                            ref={mapRef}
                            mapboxAccessToken={MAPBOX_TOKEN}
                            reuseMaps
                            initialViewState={initialViewState}
                            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
                            mapStyle={GEO_MAP_STYLE}
                            projection={{ name: 'globe' }}
                            dragPan
                            dragRotate
                            scrollZoom
                            touchZoomRotate
                            doubleClickZoom
                            keyboard
                            cursor="grab"
                            onDragStart={pauseRotationBriefly}
                            onZoomStart={pauseRotationBriefly}
                            onRotateStart={pauseRotationBriefly}
                            onLoad={(event: any) => {
                                mapRef.current = event.target;
                                applyGeoMapConfig(event.target);
                            }}
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
                                                transform: isHovered ? 'scale(1.18)' : 'scale(1)',
                                                background: `radial-gradient(circle at 32% 28%, rgba(255,255,255,0.82) 0, ${marker.style.fill} 27%, ${marker.style.solid} 100%)`,
                                                border: '1.5px solid rgba(8, 13, 23, 0.62)',
                                                opacity: isHovered ? 1 : 0.9,
                                                boxShadow: isHovered
                                                    ? `0 0 0 3px rgba(255,255,255,0.86), 0 0 0 6px ${marker.style.ring}, 0 0 20px ${marker.style.ring}, 0 5px 14px rgba(2,6,23,0.32)`
                                                    : `0 0 0 2px rgba(255,255,255,0.78), 0 0 0 4px ${marker.style.ring}, 0 3px 10px rgba(2,6,23,0.22)`,
                                            }}
                                            aria-label={`${marker.city}, ${marker.country}: ${marker.uniqueUsers.toLocaleString()} unique users, ${marker.sessions.toLocaleString()} sessions, ${formatLatency(marker.avgLatencyMs)} avg latency`}
                                            onMouseEnter={() => setHoveredMarkerId(marker.id)}
                                            onMouseLeave={() => setHoveredMarkerId((prev) => (prev === marker.id ? null : prev))}
                                        >
                                            {renderLatencyFace(marker.style.face)}
                                        </button>
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
                                    <div className="dashboard-surface px-3 py-2 text-[11px] text-slate-700">
                                        <div className="mb-0.5 font-semibold text-slate-900">
                                            {hoveredMarker.city}, {hoveredMarker.country}
                                        </div>
                                        <div className="flex items-center gap-2 text-slate-600">
                                            <span>{hoveredMarker.uniqueUsers.toLocaleString()} users</span>
                                            <span className="h-1 w-1 rounded-full bg-slate-300" />
                                            <span>{hoveredMarker.sessions.toLocaleString()} sessions</span>
                                            <span className="h-1 w-1 rounded-full bg-slate-300" />
                                            <span style={{ color: hoveredMarker.style.solid }}>{formatLatency(hoveredMarker.avgLatencyMs)}</span>
                                        </div>
                                    </div>
                                </Popup>
                            )}
                        </MapGL>
                        {loadError && (
                            <div className="absolute left-4 top-4 z-20 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900 shadow-sm">
                                {loadError}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default Geo;
