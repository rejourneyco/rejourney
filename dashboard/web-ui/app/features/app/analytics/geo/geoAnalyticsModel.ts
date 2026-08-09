import type { ApiLatencyByLocationResponse, GeoIssuesSummary } from '~/shared/api/client';

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

function locationKey(country?: string | null, city?: string | null): string {
    return `${normalize(country)}:${normalize(city)}`;
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
        const weightedLocations = locations.filter((location) => Number.isFinite(location.lat) && Number.isFinite(location.lng));
        const coordinateWeight = weightedLocations.reduce((sum, location) => sum + Math.max(1, location.sessions || 0), 0);
        const fallback = weightedLocations[0];
        const lat = coordinateWeight > 0
            ? weightedLocations.reduce((sum, location) => sum + location.lat * Math.max(1, location.sessions || 0), 0) / coordinateWeight
            : fallback?.lat ?? 0;
        const lng = coordinateWeight > 0
            ? weightedLocations.reduce((sum, location) => sum + location.lng * Math.max(1, location.sessions || 0), 0) / coordinateWeight
            : fallback?.lng ?? 0;

        const cities = locations
            .map<GeoCityAnalytics>((location) => ({
                id: `${normalize(location.country)}:${normalize(location.city)}`,
                country: location.country,
                city: location.city || 'Unknown',
                lat: location.lat,
                lng: location.lng,
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

