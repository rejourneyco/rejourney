import type { ApiLatencyByLocationResponse, GeoIssuesSummary } from '~/shared/api/client';
import { COUNTRY_CENTROIDS } from './countryCentroids';

export type GeoMetric = 'sessions' | 'issueRate' | 'latency';

export interface GeoCityAnalytics {
    id: string;
    country: string;
    city: string;
    lat: number;
    lng: number;
    sessions: number;
    uniqueUsers: number;
    totalIssues: number;
    issueRate: number;
    avgLatencyMs?: number;
}

export interface GeoCountryAnalytics {
    id: string;
    country: string;
    lat: number;
    lng: number;
    sessions: number;
    uniqueUsers: number;
    totalIssues: number;
    issueRate: number;
    avgLatencyMs?: number;
    trafficShare: number;
    cities: GeoCityAnalytics[];
}

export interface GeoAnalyticsSummary {
    totalSessions: number;
    activeCountries: number;
    totalIssues: number;
    avgLatencyMs: number;
}

export const GEO_LOW_SAMPLE_SESSION_COUNT = 20;

function normalize(value?: string | null): string {
    return (value || '').trim().toLowerCase();
}

const COUNTRY_MARKER_CENTROIDS = new Map<string, { lat: number; lng: number }>();

for (const country of COUNTRY_CENTROIDS) {
    const centroid = { lat: country.lat, lng: country.lng };
    COUNTRY_MARKER_CENTROIDS.set(normalize(country.code), centroid);
    COUNTRY_MARKER_CENTROIDS.set(normalize(country.name), centroid);
}

COUNTRY_MARKER_CENTROIDS.set('uk', COUNTRY_MARKER_CENTROIDS.get('gb')!);
COUNTRY_MARKER_CENTROIDS.set('palestine / israel', COUNTRY_MARKER_CENTROIDS.get('ps')!);

function locationKey(country?: string | null, city?: string | null): string {
    return `${normalize(country)}:${normalize(city)}`;
}

function distanceInKm(left: { lat: number; lng: number }, right: { lat: number; lng: number }): number {
    const toRadians = (value: number) => (value * Math.PI) / 180;
    const latitudeDelta = toRadians(right.lat - left.lat);
    const longitudeDelta = toRadians(right.lng - left.lng);
    const leftLatitude = toRadians(left.lat);
    const rightLatitude = toRadians(right.lat);
    const haversine = Math.sin(latitudeDelta / 2) ** 2
        + Math.cos(leftLatitude) * Math.cos(rightLatitude) * Math.sin(longitudeDelta / 2) ** 2;
    return 6371 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function getSafeLocationCoordinates(country: string, lat: number, lng: number): { lat: number; lng: number } {
    const fallback = COUNTRY_MARKER_CENTROIDS.get(normalize(country));
    if (!fallback) return { lat, lng };
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return fallback;
    if (Math.abs(lat) < 0.5 && Math.abs(lng) < 0.5) return fallback;
    if (normalize(country) === 'taiwan' || normalize(country) === 'tw') {
        return distanceInKm(fallback, { lat, lng }) <= 650 ? { lat, lng } : fallback;
    }
    return { lat, lng };
}

export function buildGeoAnalytics(
    issues: GeoIssuesSummary,
    latency: ApiLatencyByLocationResponse,
): { countries: GeoCountryAnalytics[]; summary: GeoAnalyticsSummary } {
    const latencyByCountry = new Map(latency.regions.map((region) => [normalize(region.country), region.avgLatencyMs]));
    const latencyByLocation = new Map(
        (latency.locations || []).map((location) => [locationKey(location.country, location.city), location.avgLatencyMs]),
    );
    const locationsByCountry = new Map<string, GeoIssuesSummary['locations']>();

    for (const location of issues.locations) {
        const key = normalize(location.country);
        const current = locationsByCountry.get(key) || [];
        current.push(location);
        locationsByCountry.set(key, current);
    }

    const totalSessions = issues.countries.reduce((sum, country) => sum + Math.max(0, country.sessions || 0), 0);
    const countries = issues.countries.map((country) => {
        const locations = locationsByCountry.get(normalize(country.country)) || [];
        const positionedLocations = locations.map((location) => ({
            location,
            ...getSafeLocationCoordinates(location.country, location.lat, location.lng),
        }));
        const weightedLocations = positionedLocations.filter(({ lat, lng }) => Number.isFinite(lat) && Number.isFinite(lng));
        const coordinateWeight = weightedLocations.reduce((sum, { location }) => sum + Math.max(1, location.sessions || 0), 0);
        const countryCentroid = COUNTRY_MARKER_CENTROIDS.get(normalize(country.country));
        const lat = coordinateWeight > 0
            ? weightedLocations.reduce((sum, positioned) => sum + positioned.lat * Math.max(1, positioned.location.sessions || 0), 0) / coordinateWeight
            : countryCentroid?.lat ?? Number.NaN;
        const lng = coordinateWeight > 0
            ? weightedLocations.reduce((sum, positioned) => sum + positioned.lng * Math.max(1, positioned.location.sessions || 0), 0) / coordinateWeight
            : countryCentroid?.lng ?? Number.NaN;

        const cities = positionedLocations
            .map<GeoCityAnalytics>(({ location, lat: cityLat, lng: cityLng }) => ({
                id: `${normalize(location.country)}:${normalize(location.city)}`,
                country: location.country,
                city: location.city || 'Unknown',
                lat: cityLat,
                lng: cityLng,
                sessions: location.sessions || 0,
                uniqueUsers: location.uniqueUsers || 0,
                totalIssues: location.issues.total || 0,
                issueRate: location.sessions > 0 ? (location.issues.total || 0) / location.sessions : 0,
                avgLatencyMs: latencyByLocation.get(locationKey(location.country, location.city)),
            }))
            .sort((left, right) => right.sessions - left.sessions || left.city.localeCompare(right.city));

        return {
            id: normalize(country.country),
            country: country.country,
            lat,
            lng,
            sessions: country.sessions || 0,
            uniqueUsers: country.uniqueUsers || 0,
            totalIssues: country.totalIssues || 0,
            issueRate: country.issueRate || 0,
            avgLatencyMs: latencyByCountry.get(normalize(country.country)),
            trafficShare: totalSessions > 0 ? (country.sessions || 0) / totalSessions : 0,
            cities,
        };
    });

    return {
        countries,
        summary: {
            totalSessions,
            activeCountries: countries.length,
            totalIssues: issues.summary.totalIssues,
            avgLatencyMs: latency.summary.avgLatency || 0,
        },
    };
}

export function sortGeoCountries(countries: GeoCountryAnalytics[], metric: GeoMetric): GeoCountryAnalytics[] {
    return [...countries].sort((left, right) => {
        if (metric === 'issueRate') {
            const leftLowSample = left.sessions < GEO_LOW_SAMPLE_SESSION_COUNT;
            const rightLowSample = right.sessions < GEO_LOW_SAMPLE_SESSION_COUNT;
            if (leftLowSample !== rightLowSample) return leftLowSample ? 1 : -1;
            return right.issueRate - left.issueRate || right.sessions - left.sessions;
        }
        if (metric === 'latency') {
            const leftLatency = left.avgLatencyMs ?? -1;
            const rightLatency = right.avgLatencyMs ?? -1;
            return rightLatency - leftLatency || right.sessions - left.sessions;
        }
        return right.sessions - left.sessions || left.country.localeCompare(right.country);
    });
}

export function getGeoMetricValue(country: Pick<GeoCountryAnalytics, 'sessions' | 'issueRate' | 'avgLatencyMs'>, metric: GeoMetric): number {
    if (metric === 'issueRate') return country.issueRate;
    if (metric === 'latency') return country.avgLatencyMs || 0;
    return country.sessions;
}
