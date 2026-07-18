import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { ChevronsLeft, ChevronsRight, Globe, GripVertical, Monitor, Play, ShieldAlert, Smartphone, X } from 'lucide-react';
import { useSessionData } from '~/shared/providers/SessionContext';
import { useDashboardManualRefreshVersion } from '~/shared/providers/DashboardManualRefreshContext';
import { DashboardPageHeader } from '~/shared/ui/core/DashboardPageHeader';
import { dashboardPageHeaderProps } from '~/shell/navigation/dashboardPageMeta';
import { DashboardLensControls } from '~/shared/ui/core/DashboardLensControls';
import { CountryFlag } from '~/shared/ui/core/CountryFlag';
import { formatCountryDisplayName } from '~/shared/lib/geoDisplay';
import { useSharedRejourneyTimeRange } from '~/shared/hooks/useSharedRejourneyTimeRange';
import { useDemoMode } from '~/shared/providers/DemoModeContext';
import { getGeoOverview, getSessionsPaginated, type ApiLatencyByLocationResponse, type GeoIssuesSummary } from '~/shared/api/client';
import { useSharedPlatformLens, platformLensToSessionPlatform } from '~/shared/hooks/useSharedPlatformLens';
import { usePathPrefix } from '~/shell/routing/usePathPrefix';
import { DashboardGhostLoader, useInitialDashboardLoad } from '~/shared/ui/core/DashboardGhostLoader';
import { disableMapboxTelemetry, isMapboxConfigured } from '~/shared/integrations/mapbox';
import { getMapboxToken } from '~/shared/config/runtimeEnv';
import {
    getGeoNavigationStorageKey,
    geoNavigationStatesEqual,
    normalizeGeoNavigationState,
    parseStoredGeoNavigationState,
    type GeoMarkerLocationState,
    type GeoNavigationState,
    type GeoViewportState,
} from './geoNavigationState';
// @ts-ignore: react-map-gl typing can fail under current tsconfig
import MapGL, { Marker, NavigationControl, Popup } from 'react-map-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
const ENABLE_MAPBOX_IN_DEMO = true;
const MAPBOX_TOKEN = getMapboxToken();
const GEO_MAP_STYLE = 'mapbox://styles/mapbox/light-v11';
const GEO_MAP_CONFIG = {
    basemap: {
        lightPreset: 'day',
        show3dObjects: false,
        showAdminBoundaries: true,
        showPedestrianRoads: false,
        showPointOfInterestLabels: false,
        showTransitLabels: false,
        colorGreenspace: '#eef4ef',
        colorWater: '#c9d2d6',
        colorLand: '#f7f8f6',
        colorRoads: '#e4e7eb',
        colorMotorways: '#d9dde3',
        colorTrunks: '#d9dde3',
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
        return { longitude: 22, latitude: 28 };
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
    const latitude = Math.max(-54, Math.min(68, weightedLat / totalWeight));
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
    countryCode?: string | null;
    lat: number;
    lng: number;
    sessions: number;
    uniqueUsers: number;
    avgLatencyMs?: number;
    latencyTier: LatencyTier;
    markerSize: number;
    style: MarkerStyle;
}

interface GeoMapCluster {
    id: string;
    kind: 'cluster' | 'location';
    markers: GeoMarker[];
    topMarker: GeoMarker;
    lat: number;
    lng: number;
    sessions: number;
    uniqueUsers: number;
    avgLatencyMs?: number;
    latencyTier: LatencyTier;
    style: MarkerStyle;
}

const MAX_RENDERED_GEO_CLUSTERS = 260;
const GEO_LOCATION_MARKER_LIMIT = 1200;
const GEO_LATENCY_LOCATION_LOOKUP_LIMIT = 1600;
const RECENT_GEO_SESSION_FETCH_LIMIT = 100;
const GEO_SIDEBAR_SESSION_LIMIT = 50;
const GEO_LOCATION_SESSION_LIMIT = 100;
const GEO_SIDEBAR_DEFAULT_WIDTH = 340;
const GEO_SIDEBAR_MIN_WIDTH = 300;
const GEO_SIDEBAR_MAX_WIDTH = 460;
const GEO_SIDEBAR_COLLAPSED_WIDTH = 56;
const GEO_SIDEBAR_WIDTH_STORAGE_KEY = 'rejourney:geo-sidebar-width';
const GEO_SIDEBAR_COLLAPSED_STORAGE_KEY = 'rejourney:geo-sidebar-collapsed';
const GEO_MAP_OVERVIEW_ZOOM = 2.05;
const GEO_MAP_OVERVIEW_MAX_ZOOM = 4.2;
const GEO_MAP_OVERVIEW_FIT_PADDING = 96;
const LIVE_ANALYTICS_WINDOW_MINUTES = 30;
const LIVE_ANALYTICS_BUCKET_COUNT = 15;
const GEO_ICON_BUTTON_CLASS =
    'dashboard-pill inline-flex h-7 w-7 items-center justify-center text-black transition-all hover:-translate-y-0.5 hover:bg-[#ecfeff] disabled:cursor-not-allowed disabled:opacity-40';
const GEO_CLEAR_SELECTION_BUTTON_CLASS = `${GEO_ICON_BUTTON_CLASS} !border-rose-300 !bg-rose-50 !text-rose-700 hover:!border-rose-500 hover:!bg-[#fecaca] hover:!text-rose-950`;
const GEO_SIDEBAR_COLLAPSE_BUTTON_CLASS =
    'flex w-full items-center justify-center gap-2 py-2 text-slate-400 transition-all hover:bg-slate-50 hover:text-slate-700';

const COUNTRY_NAME_TO_CODE: Record<string, string> = {
    argentina: 'AR',
    australia: 'AU',
    brazil: 'BR',
    canada: 'CA',
    chile: 'CL',
    colombia: 'CO',
    egypt: 'EG',
    france: 'FR',
    germany: 'DE',
    'hong kong': 'HK',
    india: 'IN',
    indonesia: 'ID',
    italy: 'IT',
    japan: 'JP',
    kenya: 'KE',
    malaysia: 'MY',
    mexico: 'MX',
    netherlands: 'NL',
    'new zealand': 'NZ',
    nigeria: 'NG',
    palestine: 'PS',
    'palestine / israel': 'PS/IL',
    peru: 'PE',
    philippines: 'PH',
    singapore: 'SG',
    'south africa': 'ZA',
    'south korea': 'KR',
    spain: 'ES',
    taiwan: 'TW',
    thailand: 'TH',
    turkey: 'TR',
    'united arab emirates': 'AE',
    'united kingdom': 'GB',
    'united states': 'US',
    vietnam: 'VN',
};

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
        fill: 'rgba(93, 173, 236, 0.92)',
        solid: 'rgba(37, 99, 235, 1)',
        ring: 'rgba(93, 173, 236, 0.5)',
        face: 'neutral',
    },
    degraded: {
        fill: 'rgba(249, 168, 212, 0.92)',
        solid: 'rgba(190, 24, 93, 1)',
        ring: 'rgba(249, 168, 212, 0.52)',
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

function getCountryCodeForName(country?: string | null): string | null {
    const normalizedCountry = normalizeCountry(country || undefined);
    return normalizedCountry ? COUNTRY_NAME_TO_CODE[normalizedCountry] || null : null;
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
    return Math.round(12 + normalized * 26);
}

function clampGeoSidebarWidth(width: number): number {
    if (!Number.isFinite(width)) return GEO_SIDEBAR_DEFAULT_WIDTH;
    return Math.round(Math.max(GEO_SIDEBAR_MIN_WIDTH, Math.min(GEO_SIDEBAR_MAX_WIDTH, width)));
}

function getInitialGeoSidebarWidth(): number {
    if (typeof window === 'undefined') return GEO_SIDEBAR_DEFAULT_WIDTH;
    const storedWidth = Number(window.localStorage.getItem(GEO_SIDEBAR_WIDTH_STORAGE_KEY));
    return clampGeoSidebarWidth(storedWidth || GEO_SIDEBAR_DEFAULT_WIDTH);
}

function getInitialGeoSidebarCollapsed(): boolean {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(GEO_SIDEBAR_COLLAPSED_STORAGE_KEY) === 'true';
}

function selectTopByScore<T>(items: T[], limit: number, getScore: (item: T) => number): T[] {
    if (items.length <= limit) return items.slice();

    const compactAt = Math.max(limit + 1, limit * 3);
    const candidates: Array<{ item: T; score: number; index: number }> = [];

    items.forEach((item, index) => {
        const rawScore = getScore(item);
        const score = Number.isFinite(rawScore) ? rawScore : 0;
        candidates.push({ item, score, index });

        if (candidates.length >= compactAt) {
            candidates.sort((a, b) => b.score - a.score || a.index - b.index);
            candidates.length = limit;
        }
    });

    return candidates
        .sort((a, b) => b.score - a.score || a.index - b.index)
        .slice(0, limit)
        .map((candidate) => candidate.item);
}

function getGeoLocationScore(location: GeoIssuesSummary['locations'][number]): number {
    const uniqueUsers = Math.max(0, Number(location.uniqueUsers) || 0);
    const sessions = Math.max(0, Number(location.sessions) || 0);
    const issues = Math.max(0, Number(location.issues?.total) || 0);
    const growth = Math.max(0, Number(location.growthRate) || 0);
    return uniqueUsers * 12 + sessions * 3 + issues * 24 + growth;
}

function formatLatency(value?: number): string {
    if (!value || Number.isNaN(value)) return 'N/A';
    return `${Math.round(value)}ms`;
}

function getRelativeGeoMarkerSize(cluster: GeoMapCluster, maxUsers: number, zoom: number): number {
    const safeMax = Math.max(maxUsers, 1);
    const normalized = Math.sqrt(Math.max(1, cluster.uniqueUsers) / safeMax);
    const minSize = cluster.kind === 'cluster' ? 46 : 36;
    const maxSize = cluster.kind === 'cluster' ? 78 : 60;
    const zoomScale = 0.94 + Math.max(0, Math.min(5, zoom - 2)) * 0.07;
    return Math.round((minSize + normalized * (maxSize - minSize)) * zoomScale);
}

function getGeoClusterStep(zoom: number): number {
    const normalizedZoom = Math.max(1, Math.min(9, zoom));
    return Math.max(0.18, 18 / Math.pow(2, normalizedZoom - 1));
}

function getClusterAvatarLimit(cluster: GeoMapCluster, zoom: number): number {
    if (cluster.kind === 'location') {
        if (zoom < 4.4) return 1;
        if (zoom < 5.6) return 2;
        return 3;
    }

    if (zoom < 2.6) return 1;
    if (zoom < 3.6) return 2;
    if (zoom < 4.8) return 3;
    if (zoom < 5.8) return 4;
    return 5;
}

function getVisibleVisitorLimitForZoom(zoom: number): number {
    if (zoom < 3.2) return 0;
    if (zoom < 3.8) return 14;
    if (zoom < 4.7) return 30;
    if (zoom < 5.8) return 56;
    return 88;
}

function getVisibleVisitorPerLocationLimitForZoom(zoom: number): number {
    if (zoom < 3.2) return 0;
    if (zoom < 4.7) return 1;
    if (zoom < 5.8) return 2;
    return 4;
}

function getSessionJitterRadius(zoom: number): number {
    if (zoom < 3.4) return 0.16;
    if (zoom < 4.6) return 0.12;
    if (zoom < 5.8) return 0.085;
    return 0.055;
}

function shouldRenderAggregateCluster(cluster: GeoMapCluster, zoom: number): boolean {
    if (zoom >= 5.15) return false;
    if (zoom >= 3.75) return cluster.kind === 'cluster';
    return true;
}

function buildGeoClusters(markers: GeoMarker[], zoom: number): GeoMapCluster[] {
    if (markers.length === 0) return [];

    const step = getGeoClusterStep(zoom);
    const groups = new Map<string, GeoMarker[]>();
    markers.forEach((marker) => {
        const latBucket = Math.floor((marker.lat + 90) / step);
        const lngBucket = Math.floor((marker.lng + 180) / step);
        const key = `${latBucket}:${lngBucket}`;
        const group = groups.get(key) || [];
        group.push(marker);
        groups.set(key, group);
    });

    return [...groups.entries()]
        .map(([key, group]) => {
            const sortedGroup = [...group].sort((a, b) => b.uniqueUsers - a.uniqueUsers);
            const topMarker = sortedGroup[0];
            const kind: GeoMapCluster['kind'] = group.length === 1 ? 'location' : 'cluster';
            const sessions = group.reduce((sum, marker) => sum + marker.sessions, 0);
            const uniqueUsers = group.reduce((sum, marker) => sum + marker.uniqueUsers, 0);
            const totalWeight = group.reduce((sum, marker) => sum + Math.max(marker.sessions, marker.uniqueUsers, 1), 0);
            const lat = group.reduce((sum, marker) => sum + marker.lat * Math.max(marker.sessions, marker.uniqueUsers, 1), 0) / totalWeight;
            const lng = group.reduce((sum, marker) => sum + marker.lng * Math.max(marker.sessions, marker.uniqueUsers, 1), 0) / totalWeight;
            const latencyWeight = group.reduce((sum, marker) => sum + (marker.avgLatencyMs ? Math.max(marker.sessions, 1) : 0), 0);
            const avgLatencyMs =
                latencyWeight > 0
                    ? group.reduce((sum, marker) => sum + (marker.avgLatencyMs || 0) * Math.max(marker.sessions, 1), 0) / latencyWeight
                    : topMarker.avgLatencyMs;
            const latencyTier = getLatencyTier(avgLatencyMs);

            return {
                id: kind === 'location' ? `location:${topMarker.id}` : `cluster:${key}:${group.length}`,
                kind,
                markers: sortedGroup,
                topMarker,
                lat,
                lng,
                sessions,
                uniqueUsers,
                avgLatencyMs,
                latencyTier,
                style: LATENCY_STYLE[latencyTier],
            };
        })
        .sort((a, b) => b.uniqueUsers - a.uniqueUsers);
}

const ANIMAL_AVATAR_BASE_PATH = '/images/avatars/animals';

const ANONYMOUS_NAME_ANIMALS = [
    'Panda',
    'Otter',
    'Koala',
    'Penguin',
    'Bunny',
    'Dolphin',
    'Owl',
    'Fox',
    'Bear',
    'Deer',
    'Hedgehog',
    'Hamster',
    'Kitten',
    'Puppy',
    'Squirrel',
    'Raccoon',
    'Sloth',
    'Seal',
    'Duckling',
    'Fawn',
    'Lemur',
    'Alpaca',
    'Capybara',
    'Quokka',
    'Meerkat',
    'Chinchilla',
    'Ferret',
    'Beaver',
    'Badger',
    'Wombat',
] as const;

type AnonymousAnimal = (typeof ANONYMOUS_NAME_ANIMALS)[number];

interface ClusterAvatarItem {
    animal: AnonymousAnimal;
    seed: string;
    label: string;
    count: number;
    latestStartedMs: number;
}

const ANIMAL_ICON_SLUGS: Record<AnonymousAnimal, string> = {
    Panda: 'panda',
    Otter: 'otter',
    Koala: 'koala',
    Penguin: 'penguin',
    Bunny: 'bunny',
    Dolphin: 'dolphin',
    Owl: 'owl',
    Fox: 'fox',
    Bear: 'bear',
    Deer: 'deer',
    Hedgehog: 'hedgehog',
    Hamster: 'hamster',
    Kitten: 'kitten',
    Puppy: 'puppy',
    Squirrel: 'squirrel',
    Raccoon: 'raccoon',
    Sloth: 'sloth',
    Seal: 'seal',
    Duckling: 'duckling',
    Fawn: 'fawn',
    Lemur: 'lemur',
    Alpaca: 'alpaca',
    Capybara: 'capybara',
    Quokka: 'quokka',
    Meerkat: 'meerkat',
    Chinchilla: 'chinchilla',
    Ferret: 'ferret',
    Beaver: 'beaver',
    Badger: 'badger',
    Wombat: 'wombat',
};

const AVATAR_TONES = [
    { bg: '#dbeafe', ring: '#60a5fa' },
    { bg: '#dcfce7', ring: '#4ade80' },
    { bg: '#fef3c7', ring: '#fbbf24' },
    { bg: '#fce7f3', ring: '#f472b6' },
    { bg: '#ede9fe', ring: '#a78bfa' },
    { bg: '#cffafe', ring: '#22d3ee' },
    { bg: '#ffedd5', ring: '#fb923c' },
    { bg: '#e0e7ff', ring: '#818cf8' },
];

type GeoSessionRow = {
    id: string;
    userId?: string | null;
    anonymousId?: string | null;
    anonymousDisplayName?: string | null;
    deviceId?: string | null;
    startedAt?: string | number | null;
    platform?: string | null;
    deviceModel?: string | null;
    appVersion?: string | null;
    osVersion?: string | null;
    sdkVersion?: string | null;
    networkType?: string | null;
    cellularGeneration?: string | null;
    metadata?: Record<string, unknown> | null;
    webReferral?: string | null;
    webLandingRoute?: string | null;
    geoLocation?: {
        country?: string | null;
        countryCode?: string | null;
        region?: string | null;
        city?: string | null;
        latitude?: number | null;
        longitude?: number | null;
    } | null;
    durationSeconds?: number;
    isFirstSession?: boolean;
    visitorSessionNumber?: number | null;
    canOpenReplay?: boolean;
    hasSuccessfulRecording?: boolean;
    crashCount?: number;
    anrCount?: number;
    errorCount?: number;
    rageTapCount?: number;
    deadTapCount?: number;
    apiErrorCount?: number;
    apiAvgResponseMs?: number;
    appStartupTimeMs?: number;
};

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function hashString(value: string): number {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

function getAvatarTone(seed: string) {
    return AVATAR_TONES[hashString(seed || 'anonymous') % AVATAR_TONES.length];
}

function getAnimalFromDisplayName(displayName?: string | null): AnonymousAnimal | null {
    const normalized = (displayName || '').replace(/[\s_-]+/g, '').toLowerCase();
    if (!normalized) return null;
    return [...ANONYMOUS_NAME_ANIMALS].sort((a, b) => b.length - a.length).find((animal) => normalized.includes(animal.toLowerCase())) ?? null;
}

function getAnimalForSeed(seed: string): AnonymousAnimal {
    return ANONYMOUS_NAME_ANIMALS[hashString(seed || 'anonymous') % ANONYMOUS_NAME_ANIMALS.length];
}

function getSessionIdentitySeed(session: GeoSessionRow): string {
    return session.anonymousDisplayName?.trim() || session.deviceId?.trim() || session.anonymousId?.trim() || session.userId?.trim() || session.id;
}

function getSessionAnimal(session: GeoSessionRow): AnonymousAnimal {
    return getAnimalFromDisplayName(session.anonymousDisplayName) ?? getAnimalForSeed(getSessionIdentitySeed(session));
}

function getAnimalIconSrc(animal: AnonymousAnimal): string {
    return `${ANIMAL_AVATAR_BASE_PATH}/${ANIMAL_ICON_SLUGS[animal]}.svg`;
}

function rankVisitorAnimalItems(sessions: GeoSessionRow[], limit: number): ClusterAvatarItem[] {
    const visitorMap = new Map<string, ClusterAvatarItem>();

    sessions.forEach((session) => {
        const seed = getSessionIdentitySeed(session);
        const latestStartedMs = getSessionStartedMs(session);
        const existing = visitorMap.get(seed);

        if (!existing) {
            visitorMap.set(seed, {
                animal: getSessionAnimal(session),
                seed,
                label: getVisitorDisplayName(session),
                count: 1,
                latestStartedMs,
            });
            return;
        }

        existing.count += 1;
        if (latestStartedMs >= existing.latestStartedMs) {
            existing.animal = getSessionAnimal(session);
            existing.label = getVisitorDisplayName(session);
            existing.latestStartedMs = latestStartedMs;
        }
    });

    return [...visitorMap.values()]
        .sort((a, b) => b.count - a.count || b.latestStartedMs - a.latestStartedMs || a.label.localeCompare(b.label))
        .slice(0, limit);
}

function rankUniqueVisitorSessions(sessions: GeoSessionRow[]): GeoSessionRow[] {
    const visitorMap = new Map<
        string,
        {
            session: GeoSessionRow;
            count: number;
            latestStartedMs: number;
            label: string;
        }
    >();

    sessions.forEach((session) => {
        const seed = getSessionIdentitySeed(session);
        const latestStartedMs = getSessionStartedMs(session);
        const existing = visitorMap.get(seed);

        if (!existing) {
            visitorMap.set(seed, {
                session,
                count: 1,
                latestStartedMs,
                label: getVisitorDisplayName(session),
            });
            return;
        }

        existing.count += 1;
        if (latestStartedMs >= existing.latestStartedMs) {
            existing.session = session;
            existing.latestStartedMs = latestStartedMs;
            existing.label = getVisitorDisplayName(session);
        }
    });

    return [...visitorMap.values()]
        .sort((a, b) => b.count - a.count || b.latestStartedMs - a.latestStartedMs || a.label.localeCompare(b.label))
        .map((item) => item.session);
}

function sortSessionsByStartedAtDesc(sessions: GeoSessionRow[]): GeoSessionRow[] {
    return [...sessions].sort((a, b) => getSessionStartedMs(b) - getSessionStartedMs(a));
}

function AnimalAvatar({ animal, seed, size = 32, active = false }: { animal: AnonymousAnimal; seed: string; size?: number; active?: boolean }) {
    const tone = getAvatarTone(seed);
    const innerSize = Math.max(18, Math.round(size * 0.68));

    return (
        <span
            className="inline-flex shrink-0 items-center justify-center rounded-full border border-white transition-transform duration-150"
            style={{
                width: size,
                height: size,
                backgroundColor: tone.bg,
                boxShadow: active
                    ? '0 0 0 2px #ffffff, 0 0 0 5px rgba(15,23,42,0.92), 0 8px 18px rgba(15,23,42,0.24)'
                    : `0 0 0 2px #ffffff, 0 0 0 4px ${tone.ring}66, 0 4px 10px rgba(15,23,42,0.16)`,
            }}
            aria-hidden="true"
        >
            <img src={getAnimalIconSrc(animal)} alt="" width={innerSize} height={innerSize} className="block" loading="lazy" />
        </span>
    );
}

function getMarkerLocationKey(marker: GeoMarker): string {
    return getLocationLatencyKey(marker.country, marker.city);
}

function getSessionLocationKey(session: GeoSessionRow): string {
    return getLocationLatencyKey(session.geoLocation?.country || undefined, session.geoLocation?.city || undefined);
}

function getClusterAvatarItems(cluster: GeoMapCluster, sessionsByLocation: Map<string, GeoSessionRow[]>, limit: number): ClusterAvatarItem[] {
    const clusterSessions: GeoSessionRow[] = [];

    for (const marker of cluster.markers) {
        const sessions = sessionsByLocation.get(getMarkerLocationKey(marker)) || [];
        clusterSessions.push(...sessions);
    }

    const rankedSessions = rankVisitorAnimalItems(clusterSessions, limit);
    if (rankedSessions.length >= limit) return rankedSessions;

    const seenSeeds = new Set(rankedSessions.map((item) => item.seed));
    const fallbackItems = cluster.markers.slice(0, limit).flatMap((marker) => {
        const seed = `location:${marker.id}`;
        if (seenSeeds.has(seed)) return [];
        seenSeeds.add(seed);
        return {
            animal: getAnimalForSeed(seed),
            seed,
            label: `${marker.city}, ${formatCountryDisplayName(marker.country, marker.countryCode) || marker.country}`,
            count: Math.max(marker.uniqueUsers, marker.sessions, 1),
            latestStartedMs: 0,
        };
    });

    return [...rankedSessions, ...fallbackItems].slice(0, limit);
}

function GeoClusterAnimalMarker({
    cluster,
    sessionsByLocation,
    size,
    active,
    zoom,
}: {
    cluster: GeoMapCluster;
    sessionsByLocation: Map<string, GeoSessionRow[]>;
    size: number;
    active: boolean;
    zoom: number;
}) {
    const avatarItems = getClusterAvatarItems(cluster, sessionsByLocation, getClusterAvatarLimit(cluster, zoom));
    const isCluster = cluster.kind === 'cluster';
    const avatarSize = isCluster
        ? Math.max(26, Math.min(36, Math.round(size * 0.46)))
        : Math.max(28, Math.min(42, Math.round(size * (avatarItems.length > 1 ? 0.58 : 0.72))));
    const artSize = Math.max(size, avatarSize + 16);
    const offsets =
        avatarItems.length === 1
            ? [{ x: 0, y: 0, z: 5 }]
            : isCluster
              ? [
                    { x: 0, y: -Math.round(size * 0.18), z: 5 },
                    { x: -Math.round(size * 0.22), y: Math.round(size * 0.08), z: 4 },
                    { x: Math.round(size * 0.22), y: Math.round(size * 0.08), z: 3 },
                    { x: -Math.round(size * 0.1), y: Math.round(size * 0.28), z: 2 },
                    { x: Math.round(size * 0.1), y: Math.round(size * 0.28), z: 1 },
                ]
              : [
                    { x: 0, y: -Math.round(size * 0.16), z: 4 },
                    { x: -Math.round(size * 0.18), y: Math.round(size * 0.14), z: 3 },
                    { x: Math.round(size * 0.18), y: Math.round(size * 0.14), z: 2 },
                ];

    return (
        <span className="relative inline-flex flex-col items-center justify-start" style={{ width: artSize + 20, minHeight: artSize + 20 }}>
            <span
                className="relative inline-flex items-center justify-center rounded-full bg-white/90"
                style={{
                    width: artSize,
                    height: artSize,
                    boxShadow: active
                        ? '0 0 0 2px #000000, 0 0 0 5px rgba(15,23,42,0.2), 0 14px 32px rgba(15,23,42,0.24)'
                        : `0 0 0 2px rgba(0,0,0,0.88), 4px 4px 0 0 rgba(15,23,42,0.18), 0 8px 18px rgba(15,23,42,0.16)`,
                }}
            >
                {avatarItems.map((item, index) => {
                    const offset = offsets[index] || offsets[0];
                    return (
                        <span
                            key={`${item.seed}:${index}`}
                            className="absolute"
                            style={{
                                transform: `translate(${offset.x}px, ${offset.y}px)`,
                                zIndex: offset.z,
                            }}
                            title={`${item.label}${item.count > 1 ? ` (${item.count} sessions)` : ''}`}
                        >
                            <AnimalAvatar animal={item.animal} seed={item.seed} size={avatarSize} active={active && index === 0} />
                            {item.count > 1 && (
                                <span className="absolute -bottom-1 -right-1 rounded-full border border-white bg-slate-950 px-1 py-px text-[8px] font-semibold leading-none text-white shadow-sm">
                                    {formatCompactNumber(item.count)}
                                </span>
                            )}
                        </span>
                    );
                })}
                {isCluster && (
                    <span className="absolute -left-1.5 -top-1.5 border-2 border-black bg-white px-1.5 py-0.5 text-[9px] font-black leading-none text-black shadow-neo-sm">
                        {cluster.markers.length}
                    </span>
                )}
            </span>
            <span className="mt-1 whitespace-nowrap border-2 border-black bg-black px-1.5 py-0.5 text-[8px] font-black leading-none text-white shadow-neo-sm">
                {formatCompactNumber(cluster.uniqueUsers)}
            </span>
        </span>
    );
}

function getShortSessionId(id: string): string {
    const compact = id.replace(/-/g, '').trim();
    return (compact || id).slice(0, 4);
}

function formatSessionDuration(seconds?: number): string {
    const safeSeconds = Math.max(0, Math.round(Number(seconds) || 0));
    const minutes = Math.floor(safeSeconds / 60);
    const remainingSeconds = safeSeconds % 60;
    return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
}

function getVisitorLabel(session: GeoSessionRow): string {
    const sessionNumber = session.visitorSessionNumber ?? null;
    if (sessionNumber && sessionNumber > 1) return `Return ${sessionNumber}`;
    return 'New';
}

function getGeoSessionFace(session: GeoSessionRow): MarkerStyle['face'] {
    const severeIssues = (session.crashCount || 0) + (session.anrCount || 0) + (session.rageTapCount || 0);
    if (severeIssues > 0) return 'angry';
    const hasFriction =
        (session.errorCount || 0) > 0 ||
        (session.deadTapCount || 0) > 0 ||
        (session.apiErrorCount || 0) > 0 ||
        (session.apiAvgResponseMs || 0) > 1000 ||
        (session.appStartupTimeMs || 0) > 3000;
    return hasFriction ? 'neutral' : 'happy';
}

function getSessionStatusLabel(session: GeoSessionRow): string {
    const face = getGeoSessionFace(session);
    if (face === 'angry') return 'Issue';
    if (face === 'neutral') return 'Watch';
    return 'Clean';
}

function getVisitorDisplayName(session: GeoSessionRow): string {
    const userId = session.userId?.trim();
    if (userId && userId.toLowerCase() !== 'anonymous') return userId;
    const anonymousDisplayName = session.anonymousDisplayName?.trim();
    if (anonymousDisplayName) return anonymousDisplayName;
    const anonymousId = session.anonymousId?.trim();
    if (anonymousId && anonymousId.toLowerCase() !== 'anonymous') return anonymousId;
    return `Visitor ${getShortSessionId(session.id).toUpperCase()}`;
}

function getVisitorCompactName(session: GeoSessionRow): string {
    const displayName = getVisitorDisplayName(session);
    return displayName.length > 24 ? `${displayName.slice(0, 21)}...` : displayName;
}

function formatLocation(session: GeoSessionRow): string {
    const city = session.geoLocation?.city?.trim();
    const country = session.geoLocation?.country?.trim();
    return [city, country].filter(Boolean).join(', ') || 'Unknown location';
}

function formatRoute(session: GeoSessionRow): string {
    const route = session.webLandingRoute?.trim();
    if (!route) return '/';
    try {
        const url = new URL(route);
        return url.pathname || '/';
    } catch {
        return route.startsWith('/') ? route : `/${route}`;
    }
}

function formatReferrer(session: GeoSessionRow): string {
    const referrer = session.webReferral?.trim();
    if (!referrer) return 'Direct';
    try {
        return new URL(referrer).hostname.replace(/^www\./, '');
    } catch {
        return (
            referrer
                .replace(/^https?:\/\//, '')
                .replace(/^www\./, '')
                .split('/')[0] || 'Direct'
        );
    }
}

function formatSessionStarted(value?: string | number | null): string {
    if (!value) return 'recent';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'recent';
    return new Intl.DateTimeFormat(undefined, {
        hour: '2-digit',
        minute: '2-digit',
    }).format(date);
}

function formatCompactNumber(value: number): string {
    if (value >= 1000000) return `${(value / 1000000).toFixed(1)}m`;
    if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
    return value.toLocaleString();
}

function getJitteredPoint(latitude: number, longitude: number, seed: string, index: number, radiusBase = 0.04) {
    const hash = hashString(`${seed}:${index}`);
    const radius = Math.min(radiusBase * 2.45, radiusBase * (0.42 + Math.sqrt(index + 1) * 0.42 + (hash % 7) * 0.035));
    const angle = (((hash % 360) + index * 137.508) * Math.PI) / 180;
    return {
        latitude: latitude + Math.sin(angle) * radius,
        longitude: longitude + Math.cos(angle) * radius,
    };
}

function getSessionPoint(session: GeoSessionRow, index: number, radiusBase = 0.04) {
    const latitude = session.geoLocation?.latitude;
    const longitude = session.geoLocation?.longitude;
    if (!isFiniteNumber(latitude) || !isFiniteNumber(longitude)) return null;
    return getJitteredPoint(latitude, longitude, getSessionIdentitySeed(session), index, radiusBase);
}

type GeoCountPill = {
    label: string;
    count: number;
    icon?: React.ReactNode;
};

type LiveGeoAnalytics = {
    lastThirtySessions: GeoSessionRow[];
    userCount: number;
    sessionCount: number;
    trendValues: number[];
    peakCount: number;
    peakLabel: string;
    referrers: GeoCountPill[];
    countries: GeoCountPill[];
    devices: GeoCountPill[];
};

function getLastMinutesWindowStart(nowMs: number, minutes = LIVE_ANALYTICS_WINDOW_MINUTES): number {
    return nowMs - minutes * 60 * 1000;
}

function getLastMinutesSessions(sessions: GeoSessionRow[], nowMs: number, minutes = LIVE_ANALYTICS_WINDOW_MINUTES): GeoSessionRow[] {
    const windowStartMs = getLastMinutesWindowStart(nowMs, minutes);
    return sessions.filter((session) => {
        const startedMs = getSessionStartedMs(session);
        return startedMs >= windowStartMs && startedMs <= nowMs;
    });
}

function formatClockTime(valueMs: number): string {
    if (!Number.isFinite(valueMs)) return '--:--';
    return new Intl.DateTimeFormat(undefined, {
        hour: '2-digit',
        minute: '2-digit',
    }).format(new Date(valueMs));
}

function getTrendCoordinates(values: number[], width: number, height: number, paddingX: number, paddingY: number): Array<{ x: number; y: number }> {
    if (values.length === 0) return [];
    const maxValue = Math.max(...values, 1);
    const innerWidth = width - paddingX * 2;
    const innerHeight = height - paddingY * 2;
    const step = values.length > 1 ? innerWidth / (values.length - 1) : innerWidth;

    return values.map((value, index) => ({
        x: paddingX + index * step,
        y: paddingY + innerHeight - (value / maxValue) * innerHeight,
    }));
}

function buildTrendPolyline(values: number[], width = 300, height = 84): string {
    return getTrendCoordinates(values, width, height, 10, 12)
        .map(({ x, y }) => `${x.toFixed(1)},${y.toFixed(1)}`)
        .join(' ');
}

function buildTrendAreaPath(values: number[], width = 300, height = 84): string {
    const coordinates = getTrendCoordinates(values, width, height, 10, 12);
    if (coordinates.length === 0) return '';
    const baseline = height - 12;
    const linePath = coordinates.map(({ x, y }) => `L ${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
    return `M ${coordinates[0].x.toFixed(1)} ${baseline} ${linePath.replace(/^L /, 'L ')} L ${coordinates[coordinates.length - 1].x.toFixed(1)} ${baseline} Z`;
}

function countTopBy(sessions: GeoSessionRow[], getLabel: (session: GeoSessionRow) => string, limit = 4): GeoCountPill[] {
    const counts = new Map<string, number>();
    sessions.forEach((session) => {
        const label = getLabel(session).trim() || 'Unknown';
        counts.set(label, (counts.get(label) || 0) + 1);
    });

    return [...counts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, limit)
        .map(([label, count]) => ({ label, count }));
}

function getCountryPillLabel(session: GeoSessionRow): string {
    return session.geoLocation?.country?.trim() || 'Unknown';
}

function getDeviceCategory(session: GeoSessionRow): 'Desktop' | 'Mobile' | 'Unknown' {
    const platform = (session.platform || '').toLowerCase();
    const metadata = session.metadata || {};
    const deviceType = String(metadata.deviceType || metadata.device_type || metadata.formFactor || '').toLowerCase();
    const userAgent = String(metadata.userAgent || metadata.user_agent || '').toLowerCase();

    if (platform === 'ios' || platform === 'android' || platform === 'mobile' || deviceType.includes('mobile') || userAgent.includes('mobile')) {
        return 'Mobile';
    }
    if (platform === 'web' || platform === 'desktop' || deviceType.includes('desktop')) {
        return 'Desktop';
    }
    return 'Unknown';
}

function getDevicePills(sessions: GeoSessionRow[]): GeoCountPill[] {
    return countTopBy(sessions, getDeviceCategory, 3).map((pill) => ({
        ...pill,
        icon:
            pill.label === 'Desktop' ? (
                <Monitor className="h-3.5 w-3.5 text-slate-500" />
            ) : pill.label === 'Mobile' ? (
                <Smartphone className="h-3.5 w-3.5 text-slate-500" />
            ) : undefined,
    }));
}

function getLiveGeoAnalytics(sessions: GeoSessionRow[], nowMs: number, useLatestSessionFallback = false): LiveGeoAnalytics {
    let analyticsNowMs = nowMs;
    let lastThirtySessions = getLastMinutesSessions(sessions, analyticsNowMs);

    if (useLatestSessionFallback && lastThirtySessions.length === 0 && sessions.length > 0) {
        const latestStartedMs = Math.max(...sessions.map(getSessionStartedMs).filter((value) => value > 0));
        if (Number.isFinite(latestStartedMs) && latestStartedMs > 0) {
            analyticsNowMs = latestStartedMs + 1000;
            lastThirtySessions = getLastMinutesSessions(sessions, analyticsNowMs);
        }
    }

    const windowStartMs = getLastMinutesWindowStart(analyticsNowMs);
    const bucketDurationMs = (LIVE_ANALYTICS_WINDOW_MINUTES * 60 * 1000) / LIVE_ANALYTICS_BUCKET_COUNT;
    const bucketUsers = Array.from({ length: LIVE_ANALYTICS_BUCKET_COUNT }, () => new Set<string>());

    lastThirtySessions.forEach((session) => {
        const startedMs = getSessionStartedMs(session);
        const bucketIndex = Math.max(0, Math.min(LIVE_ANALYTICS_BUCKET_COUNT - 1, Math.floor((startedMs - windowStartMs) / bucketDurationMs)));
        bucketUsers[bucketIndex].add(getSessionIdentitySeed(session));
    });

    const trendValues = bucketUsers.map((bucket) => bucket.size);
    const peakCount = Math.max(...trendValues, 0);
    const peakIndex = Math.max(
        0,
        trendValues.findIndex((value) => value === peakCount),
    );
    const peakLabel = peakCount > 0 ? formatClockTime(windowStartMs + (peakIndex + 1) * bucketDurationMs) : '--:--';
    const uniqueUsers = new Set(lastThirtySessions.map(getSessionIdentitySeed));

    return {
        lastThirtySessions,
        userCount: uniqueUsers.size,
        sessionCount: lastThirtySessions.length,
        trendValues,
        peakCount,
        peakLabel,
        referrers: countTopBy(lastThirtySessions, formatReferrer),
        countries: countTopBy(lastThirtySessions, getCountryPillLabel),
        devices: getDevicePills(lastThirtySessions),
    };
}

function GeoPillList({ label, pills, fallback }: { label: string; pills: GeoCountPill[]; fallback: string }) {
    return (
        <div className="grid grid-cols-1 items-start gap-1.5 sm:grid-cols-[74px_minmax(0,1fr)] sm:gap-2">
            <div className="dashboard-label sm:pt-1">{label}</div>
            <div className="flex min-w-0 flex-wrap gap-1.5">
                {pills.length > 0 ? (
                    pills.map((pill) => (
                        <span
                            key={`${label}:${pill.label}`}
                            className="dashboard-pill inline-flex max-w-full items-center gap-1.5 truncate px-2 py-1 text-[11px] font-semibold text-slate-700"
                        >
                            {pill.icon}
                            <span className="truncate">{pill.label}</span>
                            <span className="font-mono text-[10px] text-slate-500">({pill.count})</span>
                        </span>
                    ))
                ) : (
                    <span className="dashboard-pill px-2 py-1 text-[11px] font-semibold text-slate-500">{fallback}</span>
                )}
            </div>
        </div>
    );
}

function LiveGeoSidebarPanel({
    analytics,
    scopeLabel,
    scopeDetail,
    scopeCountryCode,
    isLoading,
    actions,
}: {
    analytics: LiveGeoAnalytics;
    scopeLabel: string;
    scopeDetail: string;
    scopeCountryCode?: string | null;
    isLoading: boolean;
    actions?: React.ReactNode;
}) {
    const linePoints = buildTrendPolyline(analytics.trendValues);
    const areaPath = buildTrendAreaPath(analytics.trendValues);
    const maxValue = Math.max(...analytics.trendValues, 1);

    return (
        <div className="border-b border-slate-200 bg-white px-3 py-2.5 sm:px-4 sm:py-3">
            <div className="mb-2 flex items-start justify-between gap-2 sm:gap-3">
                <div className="min-w-0">
                    <div className="dashboard-label">Last 30 min</div>
                    <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-sm font-black text-black">
                        {scopeCountryCode ? (
                            <CountryFlag
                                countryCode={scopeCountryCode}
                                countryLabel={scopeLabel}
                                className="h-4"
                                imageClassName="h-4 w-4"
                                decorative
                            />
                        ) : (
                            <Globe className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                        )}
                        <span className="truncate">{scopeLabel}</span>
                    </div>
                    <div className="mt-0.5 truncate text-[11px] font-semibold text-slate-500">{scopeDetail}</div>
                </div>
                <div className="flex shrink-0 items-start gap-2">
                    <div className="text-right text-[11px] font-semibold text-slate-500">
                        <span className="font-mono text-base font-black text-black">{formatCompactNumber(analytics.userCount)}</span> users
                        <div>
                            peak <span className="font-mono font-black text-black">{formatCompactNumber(analytics.peakCount)}</span> @ {analytics.peakLabel}
                        </div>
                    </div>
                    {actions}
                </div>
            </div>

            <div className="relative h-[70px] overflow-hidden rounded-[6px] border border-slate-200 bg-white sm:h-[92px]">
                <svg viewBox="0 0 300 84" className="h-full w-full" role="img" aria-label={`${scopeLabel} users over the last 30 minutes`}>
                    <defs>
                        <linearGradient id="geo-live-trend-fill" x1="0" x2="0" y1="0" y2="1">
                            <stop offset="0%" stopColor="#fb923c" stopOpacity="0.28" />
                            <stop offset="100%" stopColor="#fb923c" stopOpacity="0.02" />
                        </linearGradient>
                    </defs>
                    <line x1="10" x2="290" y1="72" y2="72" stroke="#e2e8f0" strokeWidth="1" />
                    <line x1="10" x2="290" y1="42" y2="42" stroke="#f1f5f9" strokeWidth="1" />
                    <line x1="10" x2="290" y1="12" y2="12" stroke="#f8fafc" strokeWidth="1" />
                    {analytics.trendValues.map((value, index) => {
                        const x = 10 + (index * 280) / Math.max(1, analytics.trendValues.length - 1);
                        const barHeight = Math.max(2, (value / maxValue) * 52);
                        return (
                            <rect key={`trend-bar-${index}`} x={x - 3} y={72 - barHeight} width="6" height={barHeight} rx="2" fill="#fed7aa" opacity="0.7" />
                        );
                    })}
                    {areaPath && <path d={areaPath} fill="url(#geo-live-trend-fill)" />}
                    {linePoints && <polyline points={linePoints} fill="none" stroke="#f97316" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />}
                    <text x="10" y="81" className="fill-slate-400 text-[8px] font-semibold">
                        -30m
                    </text>
                    <text x="290" y="81" textAnchor="end" className="fill-slate-400 text-[8px] font-semibold">
                        now
                    </text>
                </svg>
                {isLoading && <div className="absolute inset-0 grid place-items-center bg-white/70 text-xs font-semibold text-slate-500">Loading...</div>}
            </div>

            <div className="mt-2 space-y-2 sm:mt-3">
                <GeoPillList label="Referrers" pills={analytics.referrers} fallback="No referrers" />
                <GeoPillList label="Countries" pills={analytics.countries} fallback="No countries" />
                <GeoPillList label="Devices" pills={analytics.devices} fallback="No devices" />
            </div>
        </div>
    );
}

function getVisitorSearchTerm(session: GeoSessionRow): string {
    return session.userId?.trim() || session.anonymousDisplayName?.trim() || session.deviceId?.trim() || session.anonymousId?.trim() || session.id;
}

function getSessionStartedMs(session: GeoSessionRow): number {
    if (!session.startedAt) return 0;
    const started = new Date(session.startedAt).getTime();
    return Number.isNaN(started) ? 0 : started;
}

function formatDateTime(value?: string | number | null): string {
    if (!value) return 'Unknown';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Unknown';
    return new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    }).format(date);
}

export const Geo: React.FC = () => {
    const { selectedProject } = useSessionData();
    const manualRefreshVersion = useDashboardManualRefreshVersion();
    const { isDemoMode } = useDemoMode();
    const location = useLocation();
    const navigate = useNavigate();
    const pathPrefix = usePathPrefix();
    const geoNavigationStorageKey = getGeoNavigationStorageKey(pathPrefix, selectedProject?.id);
    const initialGeoNavigationStateRef = React.useRef<GeoNavigationState | null>(null);
    if (initialGeoNavigationStateRef.current === null) {
        const routeState = location.state && typeof location.state === 'object' ? location.state as { geoNavigation?: unknown } : null;
        let storedState: GeoNavigationState | null = null;
        if (typeof window !== 'undefined') {
            try {
                storedState = parseStoredGeoNavigationState(window.sessionStorage.getItem(geoNavigationStorageKey));
            } catch {
                // Session storage may be unavailable in privacy-restricted browser contexts.
            }
        }
        initialGeoNavigationStateRef.current = routeState?.geoNavigation !== undefined
            ? normalizeGeoNavigationState(routeState.geoNavigation)
            : storedState ?? normalizeGeoNavigationState(null);
    }
    const initialGeoNavigationState = initialGeoNavigationStateRef.current;
    const { platformLens } = useSharedPlatformLens(selectedProject?.id, selectedProject?.platforms);
    const platform = platformLensToSessionPlatform(platformLens);
    const mapRef = React.useRef<any>(null);
    const mapWheelHostRef = React.useRef<HTMLElement | null>(null);
    const [mapWheelHostElement, setMapWheelHostElement] = useState<HTMLElement | null>(null);
    const setMapWheelHostRef = React.useCallback((node: HTMLElement | null) => {
        mapWheelHostRef.current = node;
        setMapWheelHostElement(node);
    }, []);

    const { timeRange, setTimeRange } = useSharedRejourneyTimeRange(selectedProject?.id);
    const [issues, setIssues] = useState<GeoIssuesSummary>(EMPTY_ISSUES);
    const [latencyByLocation, setLatencyByLocation] = useState<ApiLatencyByLocationResponse>(EMPTY_LATENCY);
    const [isLoading, setIsLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [hoveredMarkerId, setHoveredMarkerId] = useState<string | null>(null);
    const [selectedMarkerId, setSelectedMarkerId] = useState<string | null>(null);
    const [selectedMarkerLocation, setSelectedMarkerLocation] = useState<GeoMarkerLocationState | null>(
        initialGeoNavigationState.markerLocation,
    );
    const [selectedClusterId, setSelectedClusterId] = useState<string | null>(initialGeoNavigationState.clusterId);
    const [markerSessions, setMarkerSessions] = useState<GeoSessionRow[]>([]);
    const [markerSessionsState, setMarkerSessionsState] = useState<'idle' | 'loading' | 'error'>('idle');
    const [recentSessions, setRecentSessions] = useState<GeoSessionRow[]>([]);
    const [recentSessionsState, setRecentSessionsState] = useState<'idle' | 'loading' | 'error'>('idle');
    const [selectedVisitorId, setSelectedVisitorId] = useState<string | null>(initialGeoNavigationState.visitorId);
    const [visitorSessions, setVisitorSessions] = useState<GeoSessionRow[]>([]);
    const [visitorSessionsState, setVisitorSessionsState] = useState<'idle' | 'loading' | 'error'>('idle');
    const [activeSessionId, setActiveSessionId] = useState<string | null>(initialGeoNavigationState.activeSessionId);
    const [mapZoom, setMapZoom] = useState(initialGeoNavigationState.viewport?.zoom ?? GEO_MAP_OVERVIEW_ZOOM);
    const [mapViewport, setMapViewport] = useState<GeoViewportState | null>(initialGeoNavigationState.viewport);
    const [isMapReady, setIsMapReady] = useState(false);
    const [geoSidebarWidth, setGeoSidebarWidth] = useState(getInitialGeoSidebarWidth);
    const [isGeoSidebarCollapsed, setIsGeoSidebarCollapsed] = useState(getInitialGeoSidebarCollapsed);
    const [isGeoMobileDrawerOpen, setIsGeoMobileDrawerOpen] = useState(false);
    const renderZoom = React.useDeferredValue(mapZoom);
    const mapZoomFrameRef = React.useRef<number | null>(null);
    const pendingMapZoomRef = React.useRef(mapZoom);
    const hoverClearTimeoutRef = React.useRef<number | null>(null);
    const shouldRestoreMarkerFocusRef = React.useRef(
        Boolean(initialGeoNavigationState.markerLocation && !initialGeoNavigationState.viewport),
    );

    const scheduleMapZoom = React.useCallback((zoom: number) => {
        pendingMapZoomRef.current = zoom;
        if (mapZoomFrameRef.current !== null) return;

        mapZoomFrameRef.current = window.requestAnimationFrame(() => {
            mapZoomFrameRef.current = null;
            setMapZoom(pendingMapZoomRef.current);
        });
    }, []);

    const showHoveredMarker = React.useCallback((markerId: string) => {
        if (hoverClearTimeoutRef.current) {
            window.clearTimeout(hoverClearTimeoutRef.current);
            hoverClearTimeoutRef.current = null;
        }
        setHoveredMarkerId(markerId);
    }, []);

    const clearHoveredMarkerSoon = React.useCallback((markerId: string) => {
        if (hoverClearTimeoutRef.current) {
            window.clearTimeout(hoverClearTimeoutRef.current);
        }
        hoverClearTimeoutRef.current = window.setTimeout(() => {
            setHoveredMarkerId((prev) => (prev === markerId ? null : prev));
            hoverClearTimeoutRef.current = null;
        }, 140);
    }, []);

    const startGeoSidebarResize = React.useCallback(
        (event: React.PointerEvent<HTMLButtonElement>) => {
            if (isGeoSidebarCollapsed) return;
            event.preventDefault();

            const startX = event.clientX;
            const startWidth = geoSidebarWidth;
            const previousCursor = document.body.style.cursor;
            const previousUserSelect = document.body.style.userSelect;

            const handlePointerMove = (moveEvent: PointerEvent) => {
                setGeoSidebarWidth(clampGeoSidebarWidth(startWidth + moveEvent.clientX - startX));
            };

            const stopResize = () => {
                document.body.style.cursor = previousCursor;
                document.body.style.userSelect = previousUserSelect;
                window.removeEventListener('pointermove', handlePointerMove);
                window.removeEventListener('pointerup', stopResize);
                window.removeEventListener('pointercancel', stopResize);
            };

            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
            window.addEventListener('pointermove', handlePointerMove);
            window.addEventListener('pointerup', stopResize);
            window.addEventListener('pointercancel', stopResize);
        },
        [geoSidebarWidth, isGeoSidebarCollapsed],
    );

    const focusMapOnMarker = React.useCallback((marker: GeoMarker, zoom = 6.25) => {
        const map = getMapInstance(mapRef);
        if (!map || typeof map.easeTo !== 'function') return;

        const currentZoom = typeof map.getZoom === 'function' ? map.getZoom() : zoom;
        const targetZoom = Math.max(currentZoom, zoom);
        setMapViewport({ latitude: marker.lat, longitude: marker.lng, zoom: targetZoom });
        map.easeTo({
            center: [marker.lng, marker.lat],
            zoom: targetZoom,
            duration: 650,
            essential: true,
        });
    }, []);

    const focusMapOnCluster = React.useCallback(
        (cluster: GeoMapCluster) => {
            if (cluster.kind === 'location' || cluster.markers.length <= 1) {
                focusMapOnMarker(cluster.topMarker);
                return;
            }

            const map = getMapInstance(mapRef);
            if (!map) return;

            const lngs = cluster.markers.map((marker) => marker.lng);
            const lats = cluster.markers.map((marker) => marker.lat);
            const minLng = Math.min(...lngs);
            const maxLng = Math.max(...lngs);
            const minLat = Math.min(...lats);
            const maxLat = Math.max(...lats);
            const currentZoom = typeof map.getZoom === 'function' ? map.getZoom() : mapZoom;
            const targetZoom = Math.max(4.35, Math.min(5.7, currentZoom + 1.35));

            if (typeof map.fitBounds === 'function' && maxLng - minLng > 0.04 && maxLat - minLat > 0.04) {
                map.fitBounds(
                    [
                        [minLng, minLat],
                        [maxLng, maxLat],
                    ],
                    {
                        padding: 96,
                        maxZoom: targetZoom,
                        duration: 650,
                        essential: true,
                    },
                );
                return;
            }

            if (typeof map.easeTo === 'function') {
                map.easeTo({
                    center: [cluster.lng, cluster.lat],
                    zoom: targetZoom,
                    duration: 650,
                    essential: true,
                });
            }
        },
        [focusMapOnMarker, mapZoom],
    );

    useEffect(() => {
        disableMapboxTelemetry();
    }, []);

    useEffect(() => {
        window.localStorage.setItem(GEO_SIDEBAR_WIDTH_STORAGE_KEY, String(geoSidebarWidth));
    }, [geoSidebarWidth]);

    useEffect(() => {
        window.localStorage.setItem(GEO_SIDEBAR_COLLAPSED_STORAGE_KEY, String(isGeoSidebarCollapsed));
    }, [isGeoSidebarCollapsed]);

    const geoNavigationState = useMemo<GeoNavigationState>(
        () => ({
            markerLocation: selectedMarkerLocation,
            clusterId: selectedClusterId,
            visitorId: selectedVisitorId,
            activeSessionId,
            viewport: mapViewport,
        }),
        [activeSessionId, mapViewport, selectedClusterId, selectedMarkerLocation, selectedVisitorId],
    );

    useEffect(() => {
        const routeState = location.state && typeof location.state === 'object' ? location.state as Record<string, unknown> : {};
        const currentNavigationState = normalizeGeoNavigationState(routeState.geoNavigation);
        if (geoNavigationStatesEqual(currentNavigationState, geoNavigationState)) return;

        navigate(`${location.pathname}${location.search}${location.hash}`, {
            replace: true,
            state: { ...routeState, geoNavigation: geoNavigationState },
        });
    }, [geoNavigationState, location.hash, location.pathname, location.search, location.state, navigate]);

    useEffect(() => {
        try {
            window.sessionStorage.setItem(geoNavigationStorageKey, JSON.stringify(geoNavigationState));
        } catch {
            // Session storage may be unavailable in privacy-restricted browser contexts.
        }
    }, [geoNavigationState, geoNavigationStorageKey]);

    useEffect(() => {
        return () => {
            if (mapZoomFrameRef.current !== null) {
                window.cancelAnimationFrame(mapZoomFrameRef.current);
            }
            if (hoverClearTimeoutRef.current) {
                window.clearTimeout(hoverClearTimeoutRef.current);
            }
        };
    }, []);

    useEffect(() => {
        const host = mapWheelHostElement;
        if (!host) return undefined;

        const isInsideMapHost = (event: WheelEvent | (Event & { clientX?: number; clientY?: number })) => {
            const target = event.target;
            if (target instanceof Node && host.contains(target)) return true;

            const clientX = Number(event.clientX);
            const clientY = Number(event.clientY);
            if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return false;

            const rect = host.getBoundingClientRect();
            return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
        };

        const stopBrowserZoom = (event: Event) => {
            if (event.cancelable) event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation?.();
        };

        const getMapHostPoint = (clientX?: number, clientY?: number) => {
            const rect = host.getBoundingClientRect();
            const rawX = Number(clientX);
            const rawY = Number(clientY);
            const x = Number.isFinite(rawX) ? rawX - rect.left : rect.width / 2;
            const y = Number.isFinite(rawY) ? rawY - rect.top : rect.height / 2;
            return [Math.max(0, Math.min(rect.width, x)), Math.max(0, Math.min(rect.height, y))];
        };

        const zoomMapAroundEvent = (event: WheelEvent | (Event & { clientX?: number; clientY?: number }), deltaZoom: number) => {
            const map = getMapInstance(mapRef);
            if (!map || typeof map.getZoom !== 'function' || typeof map.easeTo !== 'function') return;
            const cursorPoint = getMapHostPoint(event.clientX, event.clientY);
            const currentZoom = map.getZoom();
            const nextZoom = Math.max(1.1, Math.min(8.6, currentZoom + deltaZoom));
            const around = typeof map.unproject === 'function' ? map.unproject(cursorPoint) : undefined;

            map.easeTo({
                zoom: nextZoom,
                ...(around ? { around } : {}),
                duration: 90,
                essential: true,
            });
        };

        let lastGestureScale = 1;
        const handleWheel = (event: WheelEvent) => {
            if (!event.ctrlKey && !event.metaKey) return;
            if (!isInsideMapHost(event)) return;

            stopBrowserZoom(event);
            const normalizedDelta = Math.max(-2.4, Math.min(2.4, event.deltaY / 100));
            zoomMapAroundEvent(event, -normalizedDelta * 0.44);
        };
        const handleGestureStart = (event: Event & { scale?: number; clientX?: number; clientY?: number }) => {
            if (!isInsideMapHost(event)) return;
            stopBrowserZoom(event);
            lastGestureScale = Number.isFinite(event.scale) ? Number(event.scale) : 1;
        };
        const handleGestureChange = (event: Event & { scale?: number; clientX?: number; clientY?: number }) => {
            if (!isInsideMapHost(event)) return;
            stopBrowserZoom(event);

            const nextScale = Number.isFinite(event.scale) ? Number(event.scale) : lastGestureScale;
            const scaleDelta = nextScale / Math.max(lastGestureScale, 0.001);
            lastGestureScale = nextScale;

            if (!Number.isFinite(scaleDelta) || scaleDelta <= 0) return;
            const deltaZoom = Math.max(-0.6, Math.min(0.6, Math.log(scaleDelta) * 1.6));
            zoomMapAroundEvent(event, deltaZoom);
        };
        const handleGestureEnd = (event: Event & { clientX?: number; clientY?: number }) => {
            if (!isInsideMapHost(event)) return;
            stopBrowserZoom(event);
            lastGestureScale = 1;
        };

        const listenerOptions: AddEventListenerOptions = {
            passive: false,
            capture: true,
        };

        window.addEventListener('wheel', handleWheel, listenerOptions);
        document.addEventListener('wheel', handleWheel, listenerOptions);
        host.addEventListener('wheel', handleWheel, listenerOptions);
        host.addEventListener('gesturestart', handleGestureStart as EventListener, listenerOptions);
        host.addEventListener('gesturechange', handleGestureChange as EventListener, listenerOptions);
        host.addEventListener('gestureend', handleGestureEnd as EventListener, listenerOptions);
        window.addEventListener('gesturestart', handleGestureStart as EventListener, listenerOptions);
        window.addEventListener('gesturechange', handleGestureChange as EventListener, listenerOptions);
        window.addEventListener('gestureend', handleGestureEnd as EventListener, listenerOptions);
        document.addEventListener('gesturestart', handleGestureStart as EventListener, listenerOptions);
        document.addEventListener('gesturechange', handleGestureChange as EventListener, listenerOptions);
        document.addEventListener('gestureend', handleGestureEnd as EventListener, listenerOptions);

        return () => {
            window.removeEventListener('wheel', handleWheel, listenerOptions);
            document.removeEventListener('wheel', handleWheel, listenerOptions);
            host.removeEventListener('wheel', handleWheel, listenerOptions);
            host.removeEventListener('gesturestart', handleGestureStart as EventListener, listenerOptions);
            host.removeEventListener('gesturechange', handleGestureChange as EventListener, listenerOptions);
            host.removeEventListener('gestureend', handleGestureEnd as EventListener, listenerOptions);
            window.removeEventListener('gesturestart', handleGestureStart as EventListener, listenerOptions);
            window.removeEventListener('gesturechange', handleGestureChange as EventListener, listenerOptions);
            window.removeEventListener('gestureend', handleGestureEnd as EventListener, listenerOptions);
            document.removeEventListener('gesturestart', handleGestureStart as EventListener, listenerOptions);
            document.removeEventListener('gesturechange', handleGestureChange as EventListener, listenerOptions);
            document.removeEventListener('gestureend', handleGestureEnd as EventListener, listenerOptions);
        };
    }, [mapWheelHostElement]);

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

        void getGeoOverview(selectedProject.id, timeRange, platform)
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
    }, [manualRefreshVersion, selectedProject?.id, timeRange, platform]);

    useEffect(() => {
        if (!selectedProject?.id) {
            setRecentSessions([]);
            setRecentSessionsState('idle');
            return;
        }

        let isCancelled = false;
        setRecentSessionsState('loading');

        void getSessionsPaginated({
            projectId: selectedProject.id,
            timeRange,
            platform,
            hasRecording: true,
            includeTotal: false,
            limit: RECENT_GEO_SESSION_FETCH_LIMIT,
            sort: 'date',
            sortDir: 'desc',
        })
            .then((result) => {
                if (isCancelled) return;
                setRecentSessions((result.sessions || []).filter((session) => session.canOpenReplay ?? session.hasSuccessfulRecording ?? true));
                setRecentSessionsState('idle');
            })
            .catch((err) => {
                console.error('Failed to load geo visitor feed:', err);
                if (isCancelled) return;
                setRecentSessions([]);
                setRecentSessionsState('error');
            });

        return () => {
            isCancelled = true;
        };
    }, [manualRefreshVersion, platform, selectedProject?.id, timeRange]);

    const latencyByCountry = useMemo(() => {
        const countryToLatency = new Map<string, number>();
        for (const region of latencyByLocation.regions) {
            countryToLatency.set(normalizeCountry(region.country), region.avgLatencyMs);
        }
        return countryToLatency;
    }, [latencyByLocation.regions]);

    const latencyByLocationKey = useMemo(() => {
        const locationToLatency = new Map<string, number>();
        const latencyLocations = selectTopByScore(latencyByLocation.locations || [], GEO_LATENCY_LOCATION_LOOKUP_LIMIT, (location) =>
            Math.max(0, Number(location.totalRequests) || 0),
        );
        for (const location of latencyLocations) {
            locationToLatency.set(getLocationLatencyKey(location.country, location.city), location.avgLatencyMs);
        }
        return locationToLatency;
    }, [latencyByLocation.locations]);

    const markers = useMemo<GeoMarker[]>(() => {
        const locations = selectTopByScore(
            (issues.locations || []).filter((loc) => Number.isFinite(loc.lat) && Number.isFinite(loc.lng)),
            GEO_LOCATION_MARKER_LIMIT,
            getGeoLocationScore,
        );
        const maxActiveUsers = Math.max(
            locations.reduce((max, loc) => Math.max(max, loc.uniqueUsers || 0), 0),
            1,
        );
        const fallbackLatency = latencyByLocation.summary.avgLatency > 0 ? latencyByLocation.summary.avgLatency : undefined;

        return locations
            .map((loc, index) => {
                const avgLatencyMs =
                    latencyByLocationKey.get(getLocationLatencyKey(loc.country, loc.city)) ??
                    latencyByCountry.get(normalizeCountry(loc.country)) ??
                    fallbackLatency;
                const latencyTier = getLatencyTier(avgLatencyMs);

                return {
                    id: `${loc.country}:${loc.city}:${index}`,
                    city: loc.city || 'Unknown',
                    country: loc.country,
                    countryCode: (loc as { countryCode?: string | null }).countryCode || getCountryCodeForName(loc.country),
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
            .sort((a, b) => b.uniqueUsers - a.uniqueUsers || b.sessions - a.sessions);
    }, [issues.locations, latencyByCountry, latencyByLocation.summary.avgLatency, latencyByLocationKey]);

    const hoveredMarker = useMemo(() => (hoveredMarkerId ? markers.find((marker) => marker.id === hoveredMarkerId) || null : null), [hoveredMarkerId, markers]);

    const selectedMarker = useMemo(
        () => (selectedMarkerId ? markers.find((marker) => marker.id === selectedMarkerId) || null : null),
        [selectedMarkerId, markers],
    );

    const selectedVisitor = useMemo(() => {
        if (!selectedVisitorId) return null;
        return (
            markerSessions.find((session) => session.id === selectedVisitorId) ||
            recentSessions.find((session) => session.id === selectedVisitorId) ||
            null
        );
    }, [markerSessions, recentSessions, selectedVisitorId]);

	    const initialViewState = useMemo(() => {
	        if (initialGeoNavigationState.viewport) {
	            return {
	                longitude: initialGeoNavigationState.viewport.longitude,
	                latitude: initialGeoNavigationState.viewport.latitude,
	                zoom: initialGeoNavigationState.viewport.zoom,
	                pitch: 0,
	                bearing: 0,
	            };
	        }
	        const center = getWeightedMapCenter(markers);
	        return {
	            longitude: center.longitude,
	            latitude: center.latitude,
	            zoom: GEO_MAP_OVERVIEW_ZOOM,
	            pitch: 0,
	            bearing: 0,
	        };
	    }, [initialGeoNavigationState.viewport, markers]);

	    const focusMapOnOverview = React.useCallback(() => {
	        const map = getMapInstance(mapRef);
	        if (!map) return;

	        const validMarkers = markers.filter((marker) => Number.isFinite(marker.lng) && Number.isFinite(marker.lat));
	        if (validMarkers.length > 1 && typeof map.fitBounds === 'function') {
	            const lngs = validMarkers.map((marker) => marker.lng);
	            const lats = validMarkers.map((marker) => marker.lat);
	            const minLng = Math.min(...lngs);
	            const maxLng = Math.max(...lngs);
	            const minLat = Math.min(...lats);
	            const maxLat = Math.max(...lats);

	            if (maxLng - minLng > 0.08 || maxLat - minLat > 0.08) {
	                map.fitBounds(
	                    [
	                        [minLng, minLat],
	                        [maxLng, maxLat],
	                    ],
	                    {
	                        padding: GEO_MAP_OVERVIEW_FIT_PADDING,
	                        maxZoom: GEO_MAP_OVERVIEW_MAX_ZOOM,
	                        duration: 650,
	                        essential: true,
	                    },
	                );
	                return;
	            }
	        }

	        if (typeof map.easeTo === 'function') {
	            map.easeTo({
	                center: [initialViewState.longitude, initialViewState.latitude],
	                zoom: initialViewState.zoom,
	                pitch: initialViewState.pitch,
	                bearing: initialViewState.bearing,
	                duration: 650,
	                essential: true,
	            });
	        }
	    }, [initialViewState, markers]);

    useEffect(() => {
        if (isLoading) return;
        if (selectedMarker) {
            const nextLocation = { country: selectedMarker.country, city: selectedMarker.city };
            if (
                normalizeCountry(selectedMarkerLocation?.country) !== normalizeCountry(nextLocation.country) ||
                normalizeCity(selectedMarkerLocation?.city) !== normalizeCity(nextLocation.city)
            ) {
                setSelectedMarkerLocation(nextLocation);
            }
            return;
        }

        if (selectedMarkerLocation) {
            const restoredMarker = markers.find(
                (marker) =>
                    normalizeCountry(marker.country) === normalizeCountry(selectedMarkerLocation.country) &&
                    normalizeCity(marker.city) === normalizeCity(selectedMarkerLocation.city),
            );
            if (restoredMarker) {
                setSelectedMarkerId(restoredMarker.id);
                return;
            }
            setSelectedMarkerLocation(null);
        }

        if (selectedMarkerId) setSelectedMarkerId(null);
    }, [isLoading, markers, selectedMarker, selectedMarkerId, selectedMarkerLocation]);

    useEffect(() => {
        if (!isMapReady || !selectedMarker || !shouldRestoreMarkerFocusRef.current) return;
        shouldRestoreMarkerFocusRef.current = false;
        focusMapOnMarker(selectedMarker);
    }, [focusMapOnMarker, isMapReady, selectedMarker]);

    useEffect(() => {
        if (!selectedProject?.id || !selectedMarker) {
            setMarkerSessions([]);
            setMarkerSessionsState('idle');
            return;
        }

        let isCancelled = false;
        setMarkerSessions([]);
        setMarkerSessionsState('loading');

        void getSessionsPaginated({
            projectId: selectedProject.id,
            timeRange,
            platform,
            hasRecording: true,
            includeTotal: false,
            limit: GEO_LOCATION_SESSION_LIMIT,
            sort: 'date',
            sortDir: 'desc',
            geoCountry: selectedMarker.country,
            geoCity: selectedMarker.city === 'Unknown' ? undefined : selectedMarker.city,
        })
            .then((result) => {
                if (isCancelled) return;
                setMarkerSessions((result.sessions || []).filter((session) => session.canOpenReplay ?? session.hasSuccessfulRecording ?? true));
                setMarkerSessionsState('idle');
            })
            .catch((err) => {
                console.error('Failed to load geo marker sessions:', err);
                if (isCancelled) return;
                setMarkerSessions([]);
                setMarkerSessionsState('error');
            });

        return () => {
            isCancelled = true;
        };
    }, [manualRefreshVersion, platform, selectedMarker, selectedProject?.id, timeRange]);

    useEffect(() => {
        if (!selectedProject?.id || !selectedVisitor) {
            setVisitorSessions([]);
            setVisitorSessionsState('idle');
            return;
        }

        let isCancelled = false;
        const visitorSearch = getVisitorSearchTerm(selectedVisitor);
        setVisitorSessions([]);
        setVisitorSessionsState('loading');

        void getSessionsPaginated({
            projectId: selectedProject.id,
            hasRecording: true,
            includeTotal: false,
            limit: 60,
            sort: 'date',
            sortDir: 'desc',
            q: visitorSearch,
        })
            .then((result) => {
                if (isCancelled) return;
                const selectedSeed = getSessionIdentitySeed(selectedVisitor);
                const selectedName = getVisitorDisplayName(selectedVisitor);
                const matchingSessions = (result.sessions || []).filter(
                    (session) =>
                        getSessionIdentitySeed(session) === selectedSeed ||
                        getVisitorDisplayName(session) === selectedName ||
                        session.id === selectedVisitor.id,
                );
                setVisitorSessions(matchingSessions.length > 0 ? matchingSessions : result.sessions || []);
                setVisitorSessionsState('idle');
            })
            .catch((err) => {
                console.error('Failed to load geo visitor profile:', err);
                if (isCancelled) return;
                setVisitorSessions([]);
                setVisitorSessionsState('error');
            });

        return () => {
            isCancelled = true;
        };
    }, [manualRefreshVersion, selectedProject?.id, selectedVisitor]);

    const markerByLocation = useMemo(() => {
        const locationMap = new Map<string, GeoMarker>();
        markers.forEach((marker) => {
            locationMap.set(getMarkerLocationKey(marker), marker);
        });
        return locationMap;
    }, [markers]);

    const sessionsByLocation = useMemo(() => {
        const sessionMap = new Map<string, GeoSessionRow[]>();
        recentSessions.forEach((session) => {
            const key = getSessionLocationKey(session);
            if (!markerByLocation.has(key)) return;

            const existing = sessionMap.get(key) || [];
            existing.push(session);
            sessionMap.set(key, existing);
        });
        return sessionMap;
    }, [markerByLocation, recentSessions]);

    const geoClusters = useMemo(() => buildGeoClusters(markers, renderZoom), [markers, renderZoom]);
    const renderedGeoClusters = useMemo(
        () =>
            geoClusters
                .filter((cluster) => {
                    if (shouldRenderAggregateCluster(cluster, renderZoom)) return true;
                    if (cluster.kind !== 'location') return false;

                    const recentLocationSessions = sessionsByLocation.get(getMarkerLocationKey(cluster.topMarker)) || [];
                    const selectedLocationHasLoadedSessions = selectedMarkerId === cluster.topMarker.id && markerSessions.length > 0;
                    return recentLocationSessions.length === 0 && !selectedLocationHasLoadedSessions;
                })
                .slice(0, MAX_RENDERED_GEO_CLUSTERS),
        [geoClusters, markerSessions.length, renderZoom, selectedMarkerId, sessionsByLocation],
    );
    const maxRenderedClusterUsers = useMemo(() => Math.max(...renderedGeoClusters.map((cluster) => cluster.uniqueUsers), 1), [renderedGeoClusters]);
    const selectedCluster = useMemo(
        () => (selectedClusterId ? geoClusters.find((cluster) => cluster.id === selectedClusterId) || null : null),
        [geoClusters, selectedClusterId],
    );

    useEffect(() => {
        if (!isLoading && selectedClusterId && !selectedCluster) {
            setSelectedClusterId(null);
        }
    }, [isLoading, selectedCluster, selectedClusterId]);

    const totalSessions = useMemo(() => markers.reduce((sum, marker) => sum + marker.sessions, 0), [markers]);
    const selectedClusterSessions = useMemo(() => {
        if (!selectedCluster || selectedCluster.kind !== 'cluster') return [];

        const sessionById = new Map<string, GeoSessionRow>();
        selectedCluster.markers.forEach((marker) => {
            const markerKey = getMarkerLocationKey(marker);
            (sessionsByLocation.get(markerKey) || []).forEach((session) => {
                sessionById.set(session.id, session);
            });
        });

        return [...sessionById.values()].sort((a, b) => getSessionStartedMs(b) - getSessionStartedMs(a));
    }, [selectedCluster, sessionsByLocation]);

    const selectedMapFocusSessions = useMemo(() => {
        if (selectedMarker) {
            return markerSessions.length > 0 ? markerSessions : sessionsByLocation.get(getMarkerLocationKey(selectedMarker)) || [];
        }

        if (selectedCluster) return selectedClusterSessions;
        return [];
    }, [markerSessions, selectedCluster, selectedClusterSessions, selectedMarker, sessionsByLocation]);

    const recentSessionPoints = useMemo(() => {
        const baseVisitorLimit = getVisibleVisitorLimitForZoom(renderZoom);
        const pinnedSessions =
            selectedMapFocusSessions.length > 0 ? rankUniqueVisitorSessions(selectedMapFocusSessions).slice(0, GEO_LOCATION_SESSION_LIMIT) : [];
        const visitorLimit = pinnedSessions.length > 0 ? Math.max(baseVisitorLimit, pinnedSessions.length) : baseVisitorLimit;
        if (visitorLimit <= 0) return [];

        const rankedRecentSessions = rankUniqueVisitorSessions(recentSessions);
        const perLocationLimit = getVisibleVisitorPerLocationLimitForZoom(renderZoom);
        const mapSessions: GeoSessionRow[] = [];
        const seenVisitors = new Set<string>();
        const addMapSession = (session: GeoSessionRow) => {
            const seed = getSessionIdentitySeed(session);
            if (seenVisitors.has(seed)) return false;
            seenVisitors.add(seed);
            mapSessions.push(session);
            return true;
        };

        pinnedSessions.forEach(addMapSession);

        if (perLocationLimit > 0) {
            const perLocationCounts = new Map<string, number>();
            rankedRecentSessions.forEach((session) => {
                const locationKey = getSessionLocationKey(session);
                if (!markerByLocation.has(locationKey)) return;

                const locationCount = perLocationCounts.get(locationKey) || 0;
                if (locationCount >= perLocationLimit) return;
                if (addMapSession(session)) {
                    perLocationCounts.set(locationKey, locationCount + 1);
                }
            });
        }

        rankedRecentSessions.forEach(addMapSession);

        const jitterRadius = getSessionJitterRadius(renderZoom);
        const locationOrdinals = new Map<string, number>();
        return mapSessions
            .slice(0, visitorLimit)
            .map((session, index) => {
                const locationKey = getSessionLocationKey(session);
                const locationIndex = locationOrdinals.get(locationKey) || 0;
                locationOrdinals.set(locationKey, locationIndex + 1);

                const precisePoint = getSessionPoint(session, locationIndex, jitterRadius);
                if (precisePoint) return { session, point: precisePoint };

                const fallbackMarker = markerByLocation.get(locationKey);
                const fallbackPoint = fallbackMarker
                    ? getJitteredPoint(fallbackMarker.lat, fallbackMarker.lng, getSessionIdentitySeed(session), locationIndex, jitterRadius)
                    : null;
                return { session, point: fallbackPoint };
            })
            .filter(
                (
                    item,
                ): item is {
                    session: GeoSessionRow;
                    point: { latitude: number; longitude: number };
                } => Boolean(item.point),
            );
    }, [markerByLocation, recentSessions, renderZoom, selectedMapFocusSessions]);

    const scopedSessions = selectedMarker ? markerSessions : selectedCluster ? selectedClusterSessions : recentSessions;
    const scopedSessionsState = selectedMarker ? markerSessionsState : recentSessionsState;
    const scopedSessionRows = useMemo(
        () => sortSessionsByStartedAtDesc(scopedSessions).slice(0, GEO_SIDEBAR_SESSION_LIMIT),
        [scopedSessions],
    );
    const selectedVisitorSessionRows = useMemo(() => {
        const rows = visitorSessions.length > 0 ? visitorSessions : selectedVisitor ? [selectedVisitor] : [];
        return [...rows].sort((a, b) => getSessionStartedMs(b) - getSessionStartedMs(a));
    }, [selectedVisitor, visitorSessions]);
    const activeSidebarSessions = selectedVisitor ? selectedVisitorSessionRows : scopedSessions;
    const activeSidebarState = selectedVisitor ? visitorSessionsState : scopedSessionsState;
    const activeSidebarLoading = activeSidebarState === 'loading' && activeSidebarSessions.length === 0;
    const liveAnalytics = useMemo(() => getLiveGeoAnalytics(activeSidebarSessions, Date.now(), isDemoMode), [activeSidebarSessions, isDemoMode]);
    const scopeLabel = selectedMarker
        ? `${selectedMarker.city}, ${formatCountryDisplayName(selectedMarker.country, selectedMarker.countryCode) || selectedMarker.country}`
        : selectedCluster && selectedCluster.kind === 'cluster'
          ? `${selectedCluster.markers.length} nearby locations`
          : 'All locations';
    const scopeCountryCode = selectedMarker?.countryCode || null;
    const activeScopeLabel = selectedVisitor ? getVisitorDisplayName(selectedVisitor) : scopeLabel;
	    const scopeDetail = selectedVisitor
	        ? `${selectedVisitorSessionRows.length.toLocaleString()} sessions · ${formatLocation(selectedVisitor)}`
	        : selectedMarker
	          ? `${formatCompactNumber(selectedMarker.uniqueUsers)} users on the map · ${formatCompactNumber(selectedMarker.sessions)} sessions`
	          : selectedCluster && selectedCluster.kind === 'cluster'
	            ? `${formatCompactNumber(selectedCluster.uniqueUsers)} users · ${formatCompactNumber(selectedCluster.sessions)} sessions · ${formatCountryDisplayName(selectedCluster.topMarker.country, selectedCluster.topMarker.countryCode) || selectedCluster.topMarker.country}`
	            : `${markers.length.toLocaleString()} cities · ${formatCompactNumber(totalSessions)} sessions`;
	    const clearGeographicSelection = () => {
	        setSelectedMarkerId(null);
	        setSelectedMarkerLocation(null);
	        setSelectedClusterId(null);
	        setSelectedVisitorId(null);
	        setActiveSessionId(null);
	        setHoveredMarkerId(null);
	        setIsGeoMobileDrawerOpen(false);
	        focusMapOnOverview();
	    };
	    const selectVisitor = (session: GeoSessionRow) => {
	        setSelectedVisitorId(session.id);
	        setActiveSessionId(session.id);
	        setIsGeoMobileDrawerOpen(true);
        setSelectedClusterId(null);
        const marker = markerByLocation.get(getSessionLocationKey(session));
        if (marker) {
            setSelectedMarkerId(marker.id);
            setSelectedMarkerLocation({ country: marker.country, city: marker.city });
        }
    };

    const selectLocation = (marker: GeoMarker) => {
        setSelectedMarkerId(marker.id);
        setSelectedMarkerLocation({ country: marker.country, city: marker.city });
        setSelectedClusterId(null);
        setSelectedVisitorId(null);
        setActiveSessionId(null);
        setIsGeoMobileDrawerOpen(true);
        focusMapOnMarker(marker);
    };

    const selectCluster = (cluster: GeoMapCluster) => {
        if (cluster.kind === 'location') {
            selectLocation(cluster.topMarker);
            return;
        }

        setSelectedClusterId(cluster.id);
        setSelectedMarkerLocation(null);
        setSelectedVisitorId(null);
        setActiveSessionId(null);
        setSelectedMarkerId(null);
        setIsGeoMobileDrawerOpen(true);
        focusMapOnCluster(cluster);
    };

    const geoReturnTo = `${location.pathname}${location.search}${location.hash}`;
    const buildGeoReturnState = (sessionId: string) => ({
        geoNavigation: {
            ...geoNavigationState,
            activeSessionId: sessionId,
        },
    });

    const shouldShowInitialGhost = useInitialDashboardLoad(isLoading);

    if (shouldShowInitialGhost && selectedProject?.id) {
        return <DashboardGhostLoader variant="map" />;
    }

    return (
        <div className="flex h-full min-h-0 flex-col bg-transparent font-sans text-slate-900">
            <div className="shrink-0">
                <DashboardPageHeader title="Geographic Analysis" {...dashboardPageHeaderProps('geo')}>
                    <DashboardLensControls timeRange={timeRange} onTimeRangeChange={setTimeRange} />
                </DashboardPageHeader>
            </div>

            <div className="relative min-h-0 w-full flex-1 bg-white">
                {!selectedProject?.id ? (
                    <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-500">Select a project.</div>
                ) : !isMapboxConfigured() ? (
                    <div className="absolute inset-0 flex items-center justify-center px-4 text-center text-sm text-rose-500">
                        <ShieldAlert className="mr-2 h-5 w-5" />
                        <span>404 - New World Not Discovered Yet</span>
                    </div>
                ) : isDemoMode && !ENABLE_MAPBOX_IN_DEMO ? (
                    <div className="absolute inset-0 flex items-center justify-center p-8 text-center">
                        <div className="max-w-md">
                            <Globe className="mx-auto mb-4 h-12 w-12 text-slate-300" />
                            <h3 className="mb-2 font-sans text-lg font-medium text-slate-900">Mapbox Disabled in Demo</h3>
                            <p className="text-sm leading-relaxed text-slate-500">
                                Geographic maps are disabled during the live demo to focus on privacy and conserve resources. Full interactive maps are
                                available on the production dashboard.
                            </p>
                        </div>
                    </div>
                ) : (
                    <div className="relative flex h-full min-h-0 w-full flex-col overflow-hidden border-t border-slate-200 bg-[#f8fafc] lg:flex-row">
                        {isGeoMobileDrawerOpen && (
                            <button
                                type="button"
                                className="fixed inset-0 z-[34] bg-slate-950/20 backdrop-blur-[1px] lg:hidden"
                                onClick={() => setIsGeoMobileDrawerOpen(false)}
                                aria-label="Close geographic sessions panel"
                            />
                        )}
                        <aside
                            id="geo-mobile-sessions-panel"
                            className={`geo-side-panel fixed inset-x-3 bottom-3 z-[35] flex max-h-[78dvh] shrink-0 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xl transition-transform duration-200 ease-out lg:relative lg:inset-auto lg:z-20 lg:h-full lg:max-h-none lg:w-[var(--geo-sidebar-width)] lg:rounded-none lg:border-b-0 lg:border-l-0 lg:border-r lg:border-t-0 lg:shadow-none ${isGeoMobileDrawerOpen ? 'translate-y-0' : 'translate-y-[calc(100%+1rem)] lg:translate-y-0'}`}
                            style={
                                {
                                    '--geo-sidebar-width': `${isGeoSidebarCollapsed ? GEO_SIDEBAR_COLLAPSED_WIDTH : geoSidebarWidth}px`,
                                } as React.CSSProperties
                            }
                        >
                            <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-3 py-2 lg:hidden">
                                <div className="min-w-0">
                                    <div className="dashboard-label">Geographic Sessions</div>
                                    <div className="mt-0.5 truncate text-xs font-semibold text-slate-500">{scopeDetail}</div>
                                </div>
                                <button
                                    type="button"
                                    className={`${GEO_ICON_BUTTON_CLASS} h-8 w-8`}
                                    onClick={() => setIsGeoMobileDrawerOpen(false)}
                                    aria-label="Close geographic sessions panel"
                                    title="Close panel"
                                >
                                    <X className="h-4 w-4" />
                                </button>
                            </div>
                            {isGeoSidebarCollapsed && (
                                <div className="hidden h-full min-h-0 flex-col bg-white lg:flex">
                                    <div className="flex flex-1 flex-col items-center px-2 py-3">
                                        <div className="grid h-9 w-9 place-items-center border border-black/20 bg-[#f8fafd]">
                                            <Globe className="h-4 w-4 text-slate-500" />
                                        </div>
                                    </div>
                                    <div className="mt-auto border-t border-[#e8eaed] bg-white p-2">
                                        <button
                                            type="button"
                                            className={GEO_SIDEBAR_COLLAPSE_BUTTON_CLASS}
                                            onClick={() => setIsGeoSidebarCollapsed(false)}
                                            aria-label="Expand geographic sidebar"
                                            title="Expand sidebar"
                                            aria-expanded={!isGeoSidebarCollapsed}
                                        >
                                            <ChevronsRight className="h-4 w-4 shrink-0" />
                                        </button>
                                    </div>
                                </div>
                            )}

                            <div className={`flex min-h-0 flex-1 flex-col ${isGeoSidebarCollapsed ? 'lg:hidden' : ''}`}>
                                <LiveGeoSidebarPanel
                                    analytics={liveAnalytics}
                                    scopeLabel={activeScopeLabel}
                                    scopeDetail={scopeDetail}
                                    scopeCountryCode={selectedVisitor ? null : scopeCountryCode}
                                    isLoading={activeSidebarLoading}
                                />

                                <div className="min-h-0 flex-1 overflow-y-auto">
                                    <div>
                                        <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-3 py-2.5 sm:px-4">
                                            <div className="min-w-0">
                                                <div className="dashboard-label">Sessions</div>
                                                <div className="mt-0.5 truncate text-xs font-semibold text-slate-500">
                                                    {selectedVisitor
                                                        ? `${selectedVisitorSessionRows.length.toLocaleString()} for ${getVisitorDisplayName(selectedVisitor)}`
                                                        : `${scopedSessionRows.length.toLocaleString()} latest replay sessions for ${scopeLabel}`}
                                                </div>
                                            </div>
	                                            {(selectedMarker || selectedCluster || selectedVisitor) && (
	                                                <button
	                                                    type="button"
	                                                    className={`${GEO_CLEAR_SELECTION_BUTTON_CLASS} h-8 w-8`}
	                                                    onClick={clearGeographicSelection}
	                                                    aria-label="Clear geographic selection"
	                                                    title="Clear selection"
	                                                >
	                                                    <X className="h-4 w-4" />
	                                                </button>
                                            )}
                                        </div>

                                        {selectedVisitor && (
                                            <div className="flex items-start gap-3 border-b border-slate-200 bg-[#f8fafc] px-3 py-2.5 sm:px-4 sm:py-3">
                                                <AnimalAvatar
                                                    animal={getSessionAnimal(selectedVisitor)}
                                                    seed={getSessionIdentitySeed(selectedVisitor)}
                                                    size={42}
                                                    active
                                                />
                                                <div className="min-w-0 flex-1">
                                                    <div className="truncate text-sm font-black text-black">{getVisitorDisplayName(selectedVisitor)}</div>
                                                    <div className="mt-0.5 truncate text-[11px] font-semibold text-slate-500">
                                                        {formatLocation(selectedVisitor)} · via {formatReferrer(selectedVisitor)}
                                                    </div>
                                                </div>
                                            </div>
                                        )}

                                        {!selectedVisitor && scopedSessionsState === 'loading' && (
                                            <div className="px-4 py-8 text-center text-xs font-semibold text-slate-500">Loading sessions...</div>
                                        )}
                                        {!selectedVisitor && scopedSessionsState === 'error' && (
                                            <div className="px-4 py-8 text-center text-xs font-semibold text-rose-700">Could not load sessions.</div>
                                        )}
                                        {selectedVisitor && visitorSessionsState === 'loading' && (
                                            <div className="border-b border-slate-100 px-4 py-2 text-xs font-semibold text-slate-500">
                                                Loading session history...
                                            </div>
                                        )}
                                        {selectedVisitor && visitorSessionsState === 'error' && (
                                            <div className="border-b border-slate-100 px-4 py-2 text-xs font-semibold text-rose-700">
                                                Could not load full history.
                                            </div>
                                        )}
                                        {!selectedVisitor && scopedSessionsState === 'idle' && scopedSessionRows.length === 0 && (
                                            <div className="px-4 py-8 text-center text-xs font-semibold text-slate-500">
                                                No replay-ready sessions for this scope.
                                            </div>
                                        )}
                                        {selectedVisitor && visitorSessionsState === 'idle' && selectedVisitorSessionRows.length === 0 && (
                                            <div className="px-4 py-8 text-center text-xs font-semibold text-slate-500">No sessions found for this user.</div>
                                        )}
                                        {!selectedVisitor &&
                                            scopedSessionsState === 'idle' &&
                                            scopedSessionRows.map((session) => {
                                                const animal = getSessionAnimal(session);
                                                const seed = getSessionIdentitySeed(session);
                                                const isActive = activeSessionId === session.id;
                                                const canOpenReplay = session.canOpenReplay ?? session.hasSuccessfulRecording ?? true;

                                                return (
                                                    <div
                                                        key={session.id}
                                                        role="button"
                                                        tabIndex={0}
                                                        className={`grid w-full grid-cols-[38px_minmax(0,1fr)_32px] items-center gap-2 border-b border-slate-100 px-3 py-2.5 text-left transition-colors last:border-b-0 sm:grid-cols-[42px_minmax(0,1fr)_34px] sm:px-4 sm:py-3 ${isActive ? 'bg-[#f8fafc] shadow-[inset_3px_0_0_#111827]' : 'hover:bg-[#f8fafc]'} ${canOpenReplay ? '' : 'opacity-60'}`}
                                                        onClick={() => selectVisitor(session)}
                                                        onKeyDown={(event) => {
                                                            if (event.key === 'Enter' || event.key === ' ') selectVisitor(session);
                                                        }}
                                                        title={getVisitorDisplayName(session)}
                                                    >
                                                        <AnimalAvatar animal={animal} seed={seed} size={34} active={isActive} />
                                                        <span className="min-w-0">
                                                            <span className="flex min-w-0 items-center gap-2">
                                                                <span className="truncate font-mono text-[13px] font-black text-black">
                                                                    {formatRoute(session)}
                                                                </span>
                                                                <span className="dashboard-pill shrink-0 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">
                                                                    {formatSessionStarted(session.startedAt)}
                                                                </span>
                                                            </span>
                                                            <span className="mt-1 block truncate text-[11px] font-semibold text-slate-500">
                                                                {formatLocation(session)} · {getDeviceCategory(session).toLowerCase()} · via{' '}
                                                                {formatReferrer(session)}
                                                            </span>
                                                        </span>
                                                        {canOpenReplay ? (
                                                            <Link
                                                                to={`${pathPrefix}/sessions/${session.id}`}
                                                                state={{ returnTo: geoReturnTo, returnState: buildGeoReturnState(session.id) }}
                                                                className={GEO_ICON_BUTTON_CLASS}
                                                                onClick={(event) => event.stopPropagation()}
                                                                aria-label={`Open replay for ${getVisitorDisplayName(session)}`}
                                                                title="Open replay"
                                                            >
                                                                <Play className="h-3.5 w-3.5" />
                                                            </Link>
                                                        ) : (
                                                            <span
                                                                className={GEO_ICON_BUTTON_CLASS}
                                                                aria-label={`Replay unavailable for ${getVisitorDisplayName(session)}`}
                                                                aria-disabled="true"
                                                            >
                                                                <Play className="h-3.5 w-3.5" />
                                                            </span>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        {selectedVisitor &&
                                            selectedVisitorSessionRows.map((session) => {
                                                const isActive = activeSessionId === session.id;
                                                const canOpenReplay = session.canOpenReplay ?? session.hasSuccessfulRecording ?? true;

                                                return (
                                                    <Link
                                                        key={session.id}
                                                        to={`${pathPrefix}/sessions/${session.id}`}
                                                        state={{ returnTo: geoReturnTo, returnState: buildGeoReturnState(session.id) }}
                                                        className={`grid w-full grid-cols-[minmax(0,1fr)_52px] items-center gap-2 border-b border-slate-100 px-3 py-2.5 text-left transition-colors last:border-b-0 sm:grid-cols-[minmax(0,1fr)_58px] sm:gap-3 sm:px-4 sm:py-3 ${isActive ? 'bg-[#f8fafc] shadow-[inset_3px_0_0_#111827]' : 'hover:bg-[#f8fafc]'} ${canOpenReplay ? '' : 'opacity-60'}`}
                                                        onClick={(event) => {
                                                            if (!canOpenReplay) event.preventDefault();
                                                        }}
                                                        aria-disabled={!canOpenReplay}
                                                        tabIndex={canOpenReplay ? 0 : -1}
                                                    >
                                                        <span className="min-w-0">
                                                            <span className="flex min-w-0 items-center gap-2">
                                                                <span className="truncate font-mono text-[13px] font-black text-black">
                                                                    {formatRoute(session)}
                                                                </span>
                                                                <span className="dashboard-pill shrink-0 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">
                                                                    {formatSessionStarted(session.startedAt)}
                                                                </span>
                                                            </span>
                                                            <span className="mt-1 block truncate text-[11px] font-semibold text-slate-500">
                                                                {formatLocation(session)} · {formatSessionDuration(session.durationSeconds)} ·{' '}
                                                                {getSessionStatusLabel(session)}
                                                            </span>
                                                        </span>
                                                        <span className="dashboard-pill inline-flex items-center justify-center gap-1.5 px-2 py-1 text-[10px] font-black text-black">
                                                            <Play className="h-3 w-3" />
                                                            Play
                                                        </span>
                                                    </Link>
                                                );
                                            })}
                                    </div>
                                </div>
                                {!isGeoSidebarCollapsed && (
                                    <div className="hidden border-t border-[#e8eaed] bg-white p-2 lg:block">
                                        <button
                                            type="button"
                                            className={GEO_SIDEBAR_COLLAPSE_BUTTON_CLASS}
                                            onClick={() => setIsGeoSidebarCollapsed(true)}
                                            aria-label="Collapse geographic sidebar"
                                            title="Collapse sidebar"
                                            aria-expanded={!isGeoSidebarCollapsed}
                                        >
                                            <ChevronsLeft className="h-4 w-4 shrink-0" />
                                            <span className="text-xs font-medium">Collapse</span>
                                        </button>
                                    </div>
                                )}
                            </div>
                            {!isGeoSidebarCollapsed && (
                                <button
                                    type="button"
                                    className="group absolute -right-1 top-0 z-30 hidden h-full w-2 cursor-col-resize items-center justify-center bg-transparent transition-colors hover:bg-slate-200/70 lg:flex"
                                    onPointerDown={startGeoSidebarResize}
                                    onDoubleClick={() => setGeoSidebarWidth(GEO_SIDEBAR_DEFAULT_WIDTH)}
                                    aria-label="Resize geographic sidebar"
                                    title="Resize sidebar"
                                >
                                    <GripVertical className="pointer-events-none h-5 w-5 text-slate-400 opacity-0 transition-opacity group-hover:opacity-100" />
                                </button>
                            )}
                        </aside>

                        <section
                            ref={setMapWheelHostRef}
                            className="relative min-h-[340px] flex-1 overflow-hidden bg-[#d5dde1] sm:min-h-[380px] lg:min-h-0"
                            style={{ touchAction: 'none', overscrollBehavior: 'contain' }}
                        >
                            <MapGL
                                ref={mapRef}
                                mapboxAccessToken={MAPBOX_TOKEN}
                                reuseMaps
                                initialViewState={initialViewState}
                                style={{
                                    position: 'absolute',
                                    inset: 0,
                                    width: '100%',
                                    height: '100%',
                                }}
                                mapStyle={GEO_MAP_STYLE}
                                projection={{ name: 'mercator' }}
                                dragPan
                                dragRotate={false}
                                scrollZoom
                                touchZoomRotate={false}
                                doubleClickZoom
                                keyboard
                                cursor="grab"
                                onMove={(event: any) => scheduleMapZoom(event.viewState.zoom)}
                                onMoveEnd={(event: any) => {
                                    const { latitude, longitude, zoom } = event.viewState || {};
                                    if (Number.isFinite(latitude) && Number.isFinite(longitude) && Number.isFinite(zoom)) {
                                        setMapViewport({ latitude, longitude, zoom });
                                    }
                                }}
                                onLoad={(event: any) => {
                                    mapRef.current = event.target;
                                    applyGeoMapConfig(event.target);
                                    setIsMapReady(true);
                                }}
                            >
                                <NavigationControl position="bottom-right" showCompass={false} showZoom />

                                {renderedGeoClusters.map((cluster) => {
                                    const isSelected = selectedClusterId === cluster.id || selectedMarkerId === cluster.topMarker.id;
                                    const size = getRelativeGeoMarkerSize(cluster, maxRenderedClusterUsers, renderZoom);
                                    const hitWidth = size + 30;
                                    const hitHeight = size + 32;

                                    return (
                                        <Marker
                                            key={cluster.id}
                                            longitude={cluster.lng}
                                            latitude={cluster.lat}
                                            anchor="center"
                                            style={{ pointerEvents: 'none' }}
                                        >
                                            <button
                                                type="button"
                                                className="grid place-items-center text-center transition-transform duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-950"
                                                style={{
                                                    width: hitWidth,
                                                    height: hitHeight,
                                                    pointerEvents: 'auto',
                                                    transform: isSelected ? 'scale(1.16)' : 'scale(1)',
                                                }}
                                                aria-label={`${cluster.kind === 'cluster' ? `${cluster.markers.length} locations` : `${cluster.topMarker.city}, ${formatCountryDisplayName(cluster.topMarker.country, cluster.topMarker.countryCode) || cluster.topMarker.country}`}: ${cluster.uniqueUsers.toLocaleString()} users, ${cluster.sessions.toLocaleString()} sessions`}
                                                onPointerDown={(event) => event.stopPropagation()}
                                                onClick={(event) => {
                                                    event.stopPropagation();
                                                    selectCluster(cluster);
                                                }}
                                                onMouseEnter={() => showHoveredMarker(cluster.topMarker.id)}
                                                onMouseLeave={() => clearHoveredMarkerSoon(cluster.topMarker.id)}
                                            >
                                                <GeoClusterAnimalMarker
                                                    cluster={cluster}
                                                    sessionsByLocation={sessionsByLocation}
                                                    size={size}
                                                    active={isSelected}
                                                    zoom={renderZoom}
                                                />
                                            </button>
                                        </Marker>
                                    );
                                })}

                                {recentSessionPoints.map(({ session, point }, index) => {
                                    const animal = getSessionAnimal(session);
                                    const seed = getSessionIdentitySeed(session);
                                    const isActive = activeSessionId === session.id;
                                    const marker = markerByLocation.get(getSessionLocationKey(session));

                                    return (
                                        <Marker
                                            key={`visitor-${session.id}`}
                                            longitude={point.longitude}
                                            latitude={point.latitude}
                                            anchor="center"
                                            style={{ pointerEvents: 'none' }}
                                        >
                                            <button
                                                type="button"
                                                className="rounded-full transition-transform duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-950"
                                                style={{
                                                    pointerEvents: 'auto',
                                                    transform: isActive ? 'scale(1.16)' : 'scale(1)',
                                                }}
                                                aria-label={`${getVisitorDisplayName(session)} in ${formatLocation(session)}`}
                                                onPointerDown={(event) => event.stopPropagation()}
                                                onClick={(event) => {
                                                    event.stopPropagation();
                                                    selectVisitor(session);
                                                }}
                                                onMouseEnter={() => marker && showHoveredMarker(marker.id)}
                                                onMouseLeave={() => marker && clearHoveredMarkerSoon(marker.id)}
                                            >
                                                <AnimalAvatar animal={animal} seed={`${seed}:${index}`} size={isActive ? 46 : 40} active={isActive} />
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
                                        style={{ pointerEvents: 'none' }}
                                    >
                                        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] text-slate-700 shadow-lg">
                                            <div className="mb-0.5 font-semibold text-slate-900">
                                                {hoveredMarker.city}, {formatCountryDisplayName(hoveredMarker.country, hoveredMarker.countryCode) || hoveredMarker.country}
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
                                <div className="absolute left-4 top-4 z-20 rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-900 shadow-sm">
                                    {loadError}
                                </div>
                            )}
                            <button
                                type="button"
                                className="dashboard-pill absolute bottom-4 left-4 z-20 inline-flex max-w-[calc(100%-2rem)] items-center gap-2 bg-white/95 px-3 py-2 text-xs font-bold text-slate-900 shadow-lg backdrop-blur transition-all hover:-translate-y-0.5 hover:bg-white lg:hidden"
                                onClick={() => setIsGeoMobileDrawerOpen(true)}
                                aria-controls="geo-mobile-sessions-panel"
                                aria-expanded={isGeoMobileDrawerOpen}
                            >
                                <Globe className="h-4 w-4 shrink-0 text-slate-600" />
                                <span className="min-w-0 truncate">{activeScopeLabel}</span>
                                <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600">
                                    {formatCompactNumber(activeSidebarSessions.length)}
                                </span>
                            </button>
                        </section>
                    </div>
                )}
            </div>
        </div>
    );
};

export default Geo;
