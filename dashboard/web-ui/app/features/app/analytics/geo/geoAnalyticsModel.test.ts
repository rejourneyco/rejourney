import { describe, expect, it } from 'vitest';
import { buildGeoAnalytics, GEO_LOW_SAMPLE_SESSION_COUNT, sortGeoCountries } from './geoAnalyticsModel';

const issues = {
    locations: [
        { country: 'United States', city: 'Austin', lat: 30, lng: -97, sessions: 60, uniqueUsers: 40, issues: { crashes: 1, anrs: 0, errors: 2, rageTaps: 0, apiErrors: 0, total: 3 } },
        { country: 'United States', city: 'Denver', lat: 40, lng: -105, sessions: 40, uniqueUsers: 30, issues: { crashes: 0, anrs: 0, errors: 1, rageTaps: 0, apiErrors: 0, total: 1 } },
        { country: 'France', city: 'Paris', lat: 49, lng: 2, sessions: 25, uniqueUsers: 18, issues: { crashes: 1, anrs: 0, errors: 4, rageTaps: 0, apiErrors: 0, total: 5 } },
        { country: 'Iceland', city: 'Reykjavik', lat: 64, lng: -22, sessions: GEO_LOW_SAMPLE_SESSION_COUNT - 1, uniqueUsers: 10, issues: { crashes: 4, anrs: 0, errors: 5, rageTaps: 0, apiErrors: 0, total: 9 } },
    ],
    countries: [
        { country: 'United States', sessions: 100, uniqueUsers: 70, crashes: 1, anrs: 0, errors: 3, rageTaps: 0, apiErrors: 0, totalIssues: 4, issueRate: 0.04 },
        { country: 'France', sessions: 25, uniqueUsers: 18, crashes: 1, anrs: 0, errors: 4, rageTaps: 0, apiErrors: 0, totalIssues: 5, issueRate: 0.2 },
        { country: 'Iceland', sessions: 19, uniqueUsers: 10, crashes: 4, anrs: 0, errors: 5, rageTaps: 0, apiErrors: 0, totalIssues: 9, issueRate: 0.47 },
    ],
    summary: { totalIssues: 18, byType: { crashes: 6, anrs: 0, errors: 12, rageTaps: 0, apiErrors: 0 } },
};

const latency = {
    locations: [{ country: 'France', city: 'Paris', lat: 49, lng: 2, totalRequests: 20, avgLatencyMs: 910, successRate: 98, errorCount: 1 }],
    regions: [
        { country: 'United States', totalRequests: 100, avgLatencyMs: 420, successRate: 99, errorCount: 1 },
        { country: 'France', totalRequests: 20, avgLatencyMs: 910, successRate: 98, errorCount: 1 },
    ],
    summary: { avgLatency: 518, totalRequests: 120 },
};

describe('geographic analytics model', () => {
    it('calculates summary totals, traffic share, and weighted country coordinates', () => {
        const result = buildGeoAnalytics(issues, latency);
        const us = result.countries.find((country) => country.country === 'United States');

        expect(result.summary).toEqual({ totalSessions: 144, activeCountries: 3, totalIssues: 18, avgLatencyMs: 518 });
        expect(us?.trafficShare).toBeCloseTo(100 / 144);
        expect(us?.lat).toBeCloseTo(34);
        expect(us?.lng).toBeCloseTo(-100.2);
        expect(result.countries.find((country) => country.country === 'France')?.cities[0].avgLatencyMs).toBe(910);
    });

    it('sorts traffic and latency from highest to lowest', () => {
        const { countries } = buildGeoAnalytics(issues, latency);
        expect(sortGeoCountries(countries, 'sessions').map((country) => country.country)).toEqual(['United States', 'France', 'Iceland']);
        expect(sortGeoCountries(countries, 'latency').map((country) => country.country)).toEqual(['France', 'United States', 'Iceland']);
    });

    it('places low-sample issue rates after statistically useful countries', () => {
        const { countries } = buildGeoAnalytics(issues, latency);
        expect(sortGeoCountries(countries, 'issueRate').map((country) => country.country)).toEqual(['France', 'United States', 'Iceland']);
    });
});
