/**
 * Demo API Mock Data
 * 
 * Comprehensive mock responses for all API endpoints used in demo mode.
 * This enables the demo dashboard to show realistic data without making API calls.
 */

import {
    DashboardStats,
    InsightsTrends,
    GeoSummary,
    GeoRegionalValue,
    GeoIssuesSummary,
    DeviceIssueMatrix,
    DeviceSummary,
    JourneySummary,
    UserSegmentsSummary,
    RegionPerformance,
    ApiLatencyByLocationResponse,
    TeamUsage,
    FrictionHeatmap,
    ObservabilityJourneySummary,
    GrowthObservability,
    ObservabilityDeepMetrics,
    RetentionCohortsResponse,
    UserEngagementTrends,
    ApiErrorSpikesResponse,
} from '~/shared/api/client';

import { Issue, IssueSession } from '~/shared/types';
import { DEMO_FEATURED_SESSION_ID, DEMO_REPLAY_SESSION_IDS, getDemoReplaySessionMetadata } from './demoData';

const DEMO_NOW = new Date().setHours(12, 0, 0, 0);

let demoRandomSeed = 0x5eed1234;
const demoRandom = () => {
    demoRandomSeed = (demoRandomSeed * 1664525 + 1013904223) >>> 0;
    return demoRandomSeed / 0x100000000;
};

// ================================================================================
// Dashboard Stats (for Overview and Growth pages)
// ================================================================================

const demoWatermark = (() => {
    const d = new Date(DEMO_NOW);
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().split('T')[0];
})();

export const demoDashboardStatsApi: DashboardStats = {
    totalSessions: 1842,
    avgDuration: 389, // avgDuration (not avgDurationSeconds)
    errorRate: 1.1, // error rate percentage
    funnelCompletionRate: 63.4,
    avgFunnelStep: 3.4,
    activeUsers: 684,
    activeUsersTrend: 18.7, // % change
    avgDurationTrend: 9.4,
    errorRateTrend: -21.8,
    dau: 186,
    wau: 512,
    mau: 684,
    engagementSegments: {
        bouncers: 78,
        casuals: 197,
        explorers: 287,
        loyalists: 122,
    },
    dataCompleteThrough: demoWatermark,
};

// ================================================================================
// API Endpoint Stats (for API Analytics page)
// ================================================================================

export interface ApiEndpointStats {
    slowestEndpoints: Array<{
        endpoint: string;
        totalCalls: number;
        totalErrors: number;
        avgLatencyMs: number;
        errorRate: number;
        statusCodeBreakdown: Record<string, number>;
        mostCommonErrorCode: string | null;
    }>;
    erroringEndpoints: Array<{
        endpoint: string;
        totalCalls: number;
        totalErrors: number;
        avgLatencyMs: number;
        errorRate: number;
        statusCodeBreakdown: Record<string, number>;
        mostCommonErrorCode: string | null;
    }>;
    allEndpoints: Array<{
        endpoint: string;
        totalCalls: number;
        totalErrors: number;
        avgLatencyMs: number;
        errorRate: number;
        statusCodeBreakdown: Record<string, number>;
        mostCommonErrorCode: string | null;
    }>;
    summary: { totalCalls: number; avgLatency: number; errorRate: number };
}

export const demoApiEndpointStats: ApiEndpointStats = {
    slowestEndpoints: [
        { endpoint: '/api/products/search', totalCalls: 15678, totalErrors: 234, avgLatencyMs: 1245, errorRate: 1.5, statusCodeBreakdown: { '400': 81, '429': 43, '500': 110 }, mostCommonErrorCode: '500' },
        { endpoint: '/api/checkout/process', totalCalls: 8765, totalErrors: 156, avgLatencyMs: 987, errorRate: 1.8, statusCodeBreakdown: { '400': 52, '409': 28, '500': 76 }, mostCommonErrorCode: '500' },
        { endpoint: '/api/recommendations', totalCalls: 23456, totalErrors: 89, avgLatencyMs: 756, errorRate: 0.4, statusCodeBreakdown: { '429': 19, '500': 70 }, mostCommonErrorCode: '500' },
    ],
    erroringEndpoints: [
        { endpoint: '/api/payment/validate', totalCalls: 5678, totalErrors: 456, avgLatencyMs: 234, errorRate: 8.0, statusCodeBreakdown: { '400': 210, '401': 120, '500': 126 }, mostCommonErrorCode: '400' },
        { endpoint: '/api/inventory/check', totalCalls: 12345, totalErrors: 567, avgLatencyMs: 156, errorRate: 4.6, statusCodeBreakdown: { '400': 244, '404': 103, '500': 220 }, mostCommonErrorCode: '400' },
        { endpoint: '/api/shipping/rates', totalCalls: 9876, totalErrors: 234, avgLatencyMs: 345, errorRate: 2.4, statusCodeBreakdown: { '400': 94, '429': 38, '500': 102 }, mostCommonErrorCode: '500' },
    ],
    allEndpoints: [
        { endpoint: '/api/products/list', totalCalls: 45678, totalErrors: 123, avgLatencyMs: 145, errorRate: 0.3, statusCodeBreakdown: { '404': 27, '429': 19, '500': 77 }, mostCommonErrorCode: '500' },
        { endpoint: '/api/products/search', totalCalls: 15678, totalErrors: 234, avgLatencyMs: 1245, errorRate: 1.5, statusCodeBreakdown: { '400': 81, '429': 43, '500': 110 }, mostCommonErrorCode: '500' },
        { endpoint: '/api/cart/add', totalCalls: 23456, totalErrors: 67, avgLatencyMs: 89, errorRate: 0.3, statusCodeBreakdown: { '400': 14, '409': 22, '500': 31 }, mostCommonErrorCode: '500' },
        { endpoint: '/api/cart/update', totalCalls: 12345, totalErrors: 45, avgLatencyMs: 76, errorRate: 0.4, statusCodeBreakdown: { '400': 16, '409': 9, '500': 20 }, mostCommonErrorCode: '500' },
        { endpoint: '/api/checkout/process', totalCalls: 8765, totalErrors: 156, avgLatencyMs: 987, errorRate: 1.8, statusCodeBreakdown: { '400': 52, '409': 28, '500': 76 }, mostCommonErrorCode: '500' },
        { endpoint: '/api/payment/validate', totalCalls: 5678, totalErrors: 456, avgLatencyMs: 234, errorRate: 8.0, statusCodeBreakdown: { '400': 210, '401': 120, '500': 126 }, mostCommonErrorCode: '400' },
        { endpoint: '/api/inventory/check', totalCalls: 12345, totalErrors: 567, avgLatencyMs: 156, errorRate: 4.6, statusCodeBreakdown: { '400': 244, '404': 103, '500': 220 }, mostCommonErrorCode: '400' },
        { endpoint: '/api/shipping/rates', totalCalls: 9876, totalErrors: 234, avgLatencyMs: 345, errorRate: 2.4, statusCodeBreakdown: { '400': 94, '429': 38, '500': 102 }, mostCommonErrorCode: '500' },
        { endpoint: '/api/recommendations', totalCalls: 23456, totalErrors: 89, avgLatencyMs: 756, errorRate: 0.4, statusCodeBreakdown: { '429': 19, '500': 70 }, mostCommonErrorCode: '500' },
        { endpoint: '/api/user/profile', totalCalls: 34567, totalErrors: 12, avgLatencyMs: 67, errorRate: 0.03, statusCodeBreakdown: { '404': 4, '500': 8 }, mostCommonErrorCode: '500' },
    ],
    summary: {
        totalCalls: 191844,
        avgLatency: 312,
        errorRate: 1.8,
    },
};

const demoApiSpikeDetectedAt = new Date(DEMO_NOW - 12 * 60 * 1000);
const demoApiSpikeBucketIso = (minutesAgo: number) => new Date(DEMO_NOW - minutesAgo * 60 * 1000).toISOString();

export const demoApiErrorSpikesResponse: ApiErrorSpikesResponse = {
    ignoredApiEndpoints: [],
    spikes: [
        {
            id: 'demo-api-spike-checkout-payment',
            detectedAt: demoApiSpikeDetectedAt.toISOString(),
            currentRate: 8.4,
            previousRate: 2.1,
            percentIncrease: 300,
            affectedSessions: 412,
            trend: [
                { bucket: demoApiSpikeBucketIso(90), errorCount: 2, totalCount: 93, errorRate: 2.2 },
                { bucket: demoApiSpikeBucketIso(85), errorCount: 1, totalCount: 88, errorRate: 1.1 },
                { bucket: demoApiSpikeBucketIso(80), errorCount: 2, totalCount: 95, errorRate: 2.1 },
                { bucket: demoApiSpikeBucketIso(75), errorCount: 3, totalCount: 112, errorRate: 2.7 },
                { bucket: demoApiSpikeBucketIso(70), errorCount: 2, totalCount: 103, errorRate: 1.9 },
                { bucket: demoApiSpikeBucketIso(65), errorCount: 2, totalCount: 97, errorRate: 2.1 },
                { bucket: demoApiSpikeBucketIso(60), errorCount: 1, totalCount: 91, errorRate: 1.1 },
                { bucket: demoApiSpikeBucketIso(55), errorCount: 3, totalCount: 106, errorRate: 2.8 },
                { bucket: demoApiSpikeBucketIso(50), errorCount: 2, totalCount: 98, errorRate: 2.0 },
                { bucket: demoApiSpikeBucketIso(45), errorCount: 2, totalCount: 101, errorRate: 2.0 },
                { bucket: demoApiSpikeBucketIso(40), errorCount: 4, totalCount: 118, errorRate: 3.4 },
                { bucket: demoApiSpikeBucketIso(35), errorCount: 7, totalCount: 109, errorRate: 6.4 },
                { bucket: demoApiSpikeBucketIso(30), errorCount: 10, totalCount: 116, errorRate: 8.6 },
                { bucket: demoApiSpikeBucketIso(25), errorCount: 11, totalCount: 126, errorRate: 8.7 },
                { bucket: demoApiSpikeBucketIso(20), errorCount: 13, totalCount: 132, errorRate: 9.8 },
                { bucket: demoApiSpikeBucketIso(15), errorCount: 11, totalCount: 124, errorRate: 8.9 },
                { bucket: demoApiSpikeBucketIso(10), errorCount: 9, totalCount: 111, errorRate: 8.1 },
                { bucket: demoApiSpikeBucketIso(5), errorCount: 8, totalCount: 98, errorRate: 8.2 },
            ],
            topEndpoints: [
                { method: 'POST', endpoint: '/api/payment/validate', errorCount: 37 },
                { method: 'GET', endpoint: '/api/inventory/check', errorCount: 22 },
                { method: 'POST', endpoint: '/api/checkout/process', errorCount: 16 },
            ],
        },
    ],
};

type DemoApiLatencyLocation = NonNullable<ApiLatencyByLocationResponse['locations']>[number];

function buildLatencyRegions(locations: DemoApiLatencyLocation[]): ApiLatencyByLocationResponse['regions'] {
    const regions = new Map<string, {
        country: string;
        totalRequests: number;
        weightedLatency: number;
        weightedSuccessRate: number;
        errorCount: number;
    }>();

    for (const location of locations) {
        const current = regions.get(location.country) ?? {
            country: location.country,
            totalRequests: 0,
            weightedLatency: 0,
            weightedSuccessRate: 0,
            errorCount: 0,
        };

        current.totalRequests += location.totalRequests;
        current.weightedLatency += location.avgLatencyMs * location.totalRequests;
        current.weightedSuccessRate += location.successRate * location.totalRequests;
        current.errorCount += location.errorCount;
        regions.set(location.country, current);
    }

    return Array.from(regions.values())
        .map((region) => ({
            country: region.country,
            totalRequests: region.totalRequests,
            avgLatencyMs: Math.round(region.weightedLatency / Math.max(region.totalRequests, 1)),
            successRate: Number((region.weightedSuccessRate / Math.max(region.totalRequests, 1)).toFixed(1)),
            errorCount: region.errorCount,
        }))
        .sort((a, b) => b.totalRequests - a.totalRequests);
}

function buildLatencySummary(locations: DemoApiLatencyLocation[]): ApiLatencyByLocationResponse['summary'] {
    const totalRequests = locations.reduce((sum, location) => sum + location.totalRequests, 0);
    const weightedLatency = locations.reduce(
        (sum, location) => sum + location.avgLatencyMs * location.totalRequests,
        0,
    );

    return {
        avgLatency: Math.round(weightedLatency / Math.max(totalRequests, 1)),
        totalRequests,
    };
}

const demoApiLatencyLocations: DemoApiLatencyLocation[] = [
    { country: 'United States', city: 'New York', lat: 40.7128, lng: -74.006, totalRequests: 64214, avgLatencyMs: 134, successRate: 99, errorCount: 642 },
    { country: 'United States', city: 'San Francisco', lat: 37.7749, lng: -122.4194, totalRequests: 38421, avgLatencyMs: 188, successRate: 98, errorCount: 769 },
    { country: 'United States', city: 'Austin', lat: 30.2672, lng: -97.7431, totalRequests: 27542, avgLatencyMs: 212, successRate: 98.4, errorCount: 441 },
    { country: 'United States', city: 'Chicago', lat: 41.8781, lng: -87.6298, totalRequests: 26318, avgLatencyMs: 244, successRate: 97.9, errorCount: 553 },
    { country: 'United States', city: 'Los Angeles', lat: 34.0522, lng: -118.2437, totalRequests: 24567, avgLatencyMs: 256, successRate: 97.8, errorCount: 540 },
    { country: 'United States', city: 'Seattle', lat: 47.6062, lng: -122.3321, totalRequests: 22108, avgLatencyMs: 148, successRate: 98.9, errorCount: 243 },
    { country: 'United States', city: 'Miami', lat: 25.7617, lng: -80.1918, totalRequests: 18736, avgLatencyMs: 642, successRate: 96.1, errorCount: 731 },
    { country: 'United States', city: 'Dallas', lat: 32.7767, lng: -96.797, totalRequests: 17125, avgLatencyMs: 405, successRate: 97.3, errorCount: 462 },
    { country: 'United States', city: 'Atlanta', lat: 33.749, lng: -84.388, totalRequests: 16204, avgLatencyMs: 338, successRate: 97.7, errorCount: 373 },
    { country: 'United States', city: 'Denver', lat: 39.7392, lng: -104.9903, totalRequests: 14382, avgLatencyMs: 276, successRate: 98.1, errorCount: 273 },
    { country: 'United Kingdom', city: 'London', lat: 51.5074, lng: -0.1278, totalRequests: 45678, avgLatencyMs: 178, successRate: 98.2, errorCount: 822 },
    { country: 'Ireland', city: 'Dublin', lat: 53.3498, lng: -6.2603, totalRequests: 11342, avgLatencyMs: 268, successRate: 98.1, errorCount: 215 },
    { country: 'Germany', city: 'Berlin', lat: 52.52, lng: 13.405, totalRequests: 34567, avgLatencyMs: 156, successRate: 98.6, errorCount: 484 },
    { country: 'France', city: 'Paris', lat: 48.8566, lng: 2.3522, totalRequests: 22841, avgLatencyMs: 232, successRate: 97.9, errorCount: 480 },
    { country: 'Netherlands', city: 'Amsterdam', lat: 52.3676, lng: 4.9041, totalRequests: 19836, avgLatencyMs: 205, successRate: 98.4, errorCount: 317 },
    { country: 'Spain', city: 'Madrid', lat: 40.4168, lng: -3.7038, totalRequests: 17412, avgLatencyMs: 248, successRate: 97.8, errorCount: 383 },
    { country: 'Italy', city: 'Rome', lat: 41.9028, lng: 12.4964, totalRequests: 15329, avgLatencyMs: 284, successRate: 97.2, errorCount: 429 },
    { country: 'Turkey', city: 'Istanbul', lat: 41.0082, lng: 28.9784, totalRequests: 16824, avgLatencyMs: 520, successRate: 96.5, errorCount: 589 },
    { country: 'Sweden', city: 'Stockholm', lat: 59.3293, lng: 18.0686, totalRequests: 12148, avgLatencyMs: 196, successRate: 98.8, errorCount: 146 },
    { country: 'Poland', city: 'Warsaw', lat: 52.2297, lng: 21.0122, totalRequests: 13496, avgLatencyMs: 312, successRate: 97.4, errorCount: 351 },
    { country: 'Switzerland', city: 'Zurich', lat: 47.3769, lng: 8.5417, totalRequests: 10875, avgLatencyMs: 174, successRate: 99, errorCount: 109 },
    { country: 'Portugal', city: 'Lisbon', lat: 38.7223, lng: -9.1393, totalRequests: 11948, avgLatencyMs: 336, successRate: 97, errorCount: 358 },
    { country: 'Japan', city: 'Tokyo', lat: 35.6762, lng: 139.6503, totalRequests: 23456, avgLatencyMs: 89, successRate: 99.2, errorCount: 188 },
    { country: 'South Korea', city: 'Seoul', lat: 37.5665, lng: 126.978, totalRequests: 21974, avgLatencyMs: 142, successRate: 98.9, errorCount: 242 },
    { country: 'Singapore', city: 'Singapore', lat: 1.3521, lng: 103.8198, totalRequests: 20436, avgLatencyMs: 104, successRate: 99.1, errorCount: 184 },
    { country: 'United Arab Emirates', city: 'Dubai', lat: 25.2048, lng: 55.2708, totalRequests: 15792, avgLatencyMs: 428, successRate: 96.8, errorCount: 505 },
    { country: 'Palestine', city: 'Turmus Ayya', lat: 32.0354, lng: 35.2856, totalRequests: 11284, avgLatencyMs: 112, successRate: 99.3, errorCount: 74 },
    { country: 'India', city: 'Mumbai', lat: 19.076, lng: 72.8777, totalRequests: 12345, avgLatencyMs: 980, successRate: 94.1, errorCount: 728 },
    { country: 'India', city: 'Bengaluru', lat: 12.9716, lng: 77.5946, totalRequests: 13216, avgLatencyMs: 640, successRate: 95.8, errorCount: 555 },
    { country: 'India', city: 'Delhi', lat: 28.6139, lng: 77.209, totalRequests: 11892, avgLatencyMs: 1185, successRate: 92.7, errorCount: 868 },
    { country: 'Thailand', city: 'Bangkok', lat: 13.7563, lng: 100.5018, totalRequests: 14208, avgLatencyMs: 610, successRate: 95.6, errorCount: 625 },
    { country: 'Indonesia', city: 'Jakarta', lat: -6.2088, lng: 106.8456, totalRequests: 12975, avgLatencyMs: 860, successRate: 94.9, errorCount: 662 },
    { country: 'Philippines', city: 'Manila', lat: 14.5995, lng: 120.9842, totalRequests: 10483, avgLatencyMs: 1020, successRate: 93.4, errorCount: 692 },
    { country: 'Hong Kong', city: 'Hong Kong', lat: 22.3193, lng: 114.1694, totalRequests: 11672, avgLatencyMs: 146, successRate: 98.6, errorCount: 164 },
    { country: 'Taiwan', city: 'Taipei', lat: 25.033, lng: 121.5654, totalRequests: 10938, avgLatencyMs: 164, successRate: 98.7, errorCount: 142 },
    { country: 'Malaysia', city: 'Kuala Lumpur', lat: 3.139, lng: 101.6869, totalRequests: 9872, avgLatencyMs: 540, successRate: 96.3, errorCount: 365 },
    { country: 'Vietnam', city: 'Ho Chi Minh City', lat: 10.8231, lng: 106.6297, totalRequests: 9124, avgLatencyMs: 740, successRate: 95.1, errorCount: 447 },
    { country: 'Canada', city: 'Toronto', lat: 43.6532, lng: -79.3832, totalRequests: 23456, avgLatencyMs: 189, successRate: 98.1, errorCount: 446 },
    { country: 'Canada', city: 'Vancouver', lat: 49.2827, lng: -123.1207, totalRequests: 12604, avgLatencyMs: 220, successRate: 98.3, errorCount: 214 },
    { country: 'Canada', city: 'Montreal', lat: 45.5017, lng: -73.5673, totalRequests: 11736, avgLatencyMs: 260, successRate: 97.6, errorCount: 282 },
    { country: 'Australia', city: 'Sydney', lat: -33.8688, lng: 151.2093, totalRequests: 18765, avgLatencyMs: 1280, successRate: 92.4, errorCount: 1426 },
    { country: 'Australia', city: 'Melbourne', lat: -37.8136, lng: 144.9631, totalRequests: 13482, avgLatencyMs: 720, successRate: 95.8, errorCount: 566 },
    { country: 'New Zealand', city: 'Auckland', lat: -36.8485, lng: 174.7633, totalRequests: 8456, avgLatencyMs: 380, successRate: 97.4, errorCount: 220 },
    { country: 'Brazil', city: 'São Paulo', lat: -23.5505, lng: -46.6333, totalRequests: 15678, avgLatencyMs: 720, successRate: 95.8, errorCount: 658 },
    { country: 'Mexico', city: 'Mexico City', lat: 19.4326, lng: -99.1332, totalRequests: 14658, avgLatencyMs: 840, successRate: 94.8, errorCount: 762 },
    { country: 'Argentina', city: 'Buenos Aires', lat: -34.6037, lng: -58.3816, totalRequests: 9476, avgLatencyMs: 790, successRate: 95.2, errorCount: 455 },
    { country: 'Colombia', city: 'Bogota', lat: 4.711, lng: -74.0721, totalRequests: 8765, avgLatencyMs: 930, successRate: 93.9, errorCount: 535 },
    { country: 'Chile', city: 'Santiago', lat: -33.4489, lng: -70.6693, totalRequests: 8064, avgLatencyMs: 620, successRate: 96.2, errorCount: 306 },
    { country: 'Peru', city: 'Lima', lat: -12.0464, lng: -77.0428, totalRequests: 7218, avgLatencyMs: 1150, successRate: 92.8, errorCount: 520 },
    { country: 'South Africa', city: 'Cape Town', lat: -33.9249, lng: 18.4241, totalRequests: 6842, avgLatencyMs: 760, successRate: 94.7, errorCount: 363 },
    { country: 'Nigeria', city: 'Lagos', lat: 6.5244, lng: 3.3792, totalRequests: 6157, avgLatencyMs: 1320, successRate: 91.6, errorCount: 517 },
    { country: 'Kenya', city: 'Nairobi', lat: -1.2921, lng: 36.8219, totalRequests: 5864, avgLatencyMs: 880, successRate: 94.1, errorCount: 346 },
    { country: 'Egypt', city: 'Cairo', lat: 30.0444, lng: 31.2357, totalRequests: 5538, avgLatencyMs: 1080, successRate: 92.9, errorCount: 393 },
    { country: 'South Africa', city: 'Johannesburg', lat: -26.2041, lng: 28.0473, totalRequests: 5294, avgLatencyMs: 990, successRate: 93.8, errorCount: 328 },
];

export const demoApiLatencyByLocation: ApiLatencyByLocationResponse = {
    locations: demoApiLatencyLocations,
    regions: buildLatencyRegions(demoApiLatencyLocations),
    summary: buildLatencySummary(demoApiLatencyLocations),
};

// ================================================================================
// Insights Trends (for Growth charts)
// ================================================================================

const now = DEMO_NOW;
const day = 24 * 60 * 60 * 1000;

export const demoInsightsTrends: InsightsTrends = {
    daily: Array.from({ length: 30 }, (_, i) => {
        const date = new Date(now - (29 - i) * day);
        const isWeekend = date.getDay() === 0 || date.getDay() === 6;
        const progress = i / 29;
        const weekendFactor = isWeekend ? 0.84 : 1;
        let dau = Math.round((74 + progress * 104) * weekendFactor + demoRandom() * 8);
        let sessions = Math.round(dau * (1.46 + demoRandom() * 0.24));

        if (i === 28) {
            dau = 310;
            sessions = 460;
        } else if (i === 29) {
            dau = 350;
            sessions = 520;
        }

        const mau = Math.round(412 + progress * 252 + demoRandom() * 18);

        const apiErrorRate = Math.max(0.55, 1.85 - progress * 0.95 + (demoRandom() - 0.5) * 0.22);
        const avgDurationSeconds = Math.round(304 + progress * 86 + demoRandom() * 34);
        const productViews = Math.round(62 + progress * 136 + demoRandom() * 16);
        const mobileDau = Math.round(dau * 0.64);
        const webDau = dau - mobileDau;
        const nativeReleaseAge = i - 9;
        const webReleaseAge = i - 16;
        const native260ReleaseAge = i - 27;
        const native260Share = native260ReleaseAge >= 0 ? Math.min(0.68, 0.15 + native260ReleaseAge * 0.28) : 0;
        const native250Share = nativeReleaseAge >= 0 ? Math.max(0, Math.min(0.64, 0.12 + nativeReleaseAge * 0.035) - native260Share) : 0;
        const web2026051Share = webReleaseAge >= 0 ? Math.min(0.72, 0.18 + webReleaseAge * 0.045) : 0;

        let dayCrashes = i % 11 === 0 ? 1 : 0;
        let dayApiErrorRate = apiErrorRate;
        let dayErrorCount = Math.round(2 + (1 - progress) * 5 + demoRandom() * 4);

        if (i === 28) {
            dayCrashes = 15;
            dayApiErrorRate = 8.4;
            dayErrorCount = 42;
        } else if (i === 29) {
            dayCrashes = 9;
            dayApiErrorRate = 6.2;
            dayErrorCount = 28;
        }

        return {
            date: date.toISOString().split('T')[0],
            sessions,
            crashes: dayCrashes,
            rageTaps: Math.round(1 + demoRandom() * 4),
            dau,
            mau,
            avgApiResponseMs: Math.round(188 - progress * 38 + demoRandom() * 24),
            apiErrorRate: Math.round(dayApiErrorRate * 100) / 100,
            avgDurationSeconds,
            errorCount: dayErrorCount,
            appVersionBreakdown: {
                '2.6.0': native260ReleaseAge >= 0 ? Math.round(15 + native260ReleaseAge * 25 + demoRandom() * 5) : 0,
                '2.5.0': nativeReleaseAge >= 0 ? Math.max(0, Math.round(8 + nativeReleaseAge * 5.2 + demoRandom() * 5) - (native260ReleaseAge >= 0 ? 30 : 0)) : 0,
                '2.4.1': Math.max(18, Math.round(82 - i * 1.7 + demoRandom() * 5)),
                '2.4.0': Math.max(8, Math.round(42 - i * 0.9 + demoRandom() * 3)),
                'web-2026.05.1': webReleaseAge >= 0 ? Math.round(10 + webReleaseAge * 3.4 + demoRandom() * 4) : 0,
                'web-2026.05.0': Math.max(6, Math.round(28 - i * 0.4 + demoRandom() * 2)),
            },
            appVersionDauBreakdown: {
                '2.6.0': Math.round(mobileDau * native260Share),
                '2.5.0': Math.round(mobileDau * native250Share),
                '2.4.1': Math.round(mobileDau * Math.max(0.22, 0.62 - progress * 0.28)),
                '2.4.0': Math.round(mobileDau * Math.max(0.05, 0.22 - progress * 0.12)),
                'web-2026.05.1': Math.round(webDau * web2026051Share),
                'web-2026.05.0': Math.round(webDau * Math.max(0.12, 0.52 - Math.max(0, webReleaseAge) * 0.025)),
            },
            countryDauBreakdown: {
                'United States': Math.round(dau * 0.48),
                'United Kingdom': Math.round(dau * 0.13),
                Germany: Math.round(dau * 0.1),
                Canada: Math.round(dau * 0.08),
                Japan: Math.round(dau * 0.07),
            },
            totalApiCalls: Math.round(sessions * (10 + demoRandom() * 4) + productViews),
        };
    }),
    dataCompleteThrough: demoWatermark,
};

// ================================================================================
// Retention Cohorts (for General page)
// ================================================================================

export const demoRetentionCohorts: RetentionCohortsResponse = {
    rows: [
        {
            weekStartKey: '2026-04-12',
            users: 74,
            retention: [100, 67.6, 55.4, 46.0, 38.0, 32.4],
        },
        {
            weekStartKey: '2026-04-19',
            users: 88,
            retention: [100, 65.9, 53.4, 43.2, 36.4, null],
        },
        {
            weekStartKey: '2026-04-26',
            users: 103,
            retention: [100, 63.1, 50.5, 40.8, null, null],
        },
        {
            weekStartKey: '2026-05-03',
            users: 121,
            retention: [100, 61.2, 48.8, null, null, null],
        },
        {
            weekStartKey: '2026-05-10',
            users: 139,
            retention: [100, 58.3, null, null, null, null],
        },
        {
            weekStartKey: '2026-05-17',
            users: 154,
            retention: [100, null, null, null, null, null],
        },
    ],
};

// ================================================================================
// Geographic Summary (for Geo page)
// ================================================================================

export const demoGeoSummary: GeoSummary = {
    countries: [
        {
            country: 'United States',
            count: 842,
            latitude: 37.0902,
            longitude: -95.7129,
            crashCount: 3,
            rageTapCount: 22,
            topCities: [
                { city: 'Austin', count: 164, latitude: 30.2672, longitude: -97.7431 },
                { city: 'San Francisco', count: 142, latitude: 37.7749, longitude: -122.4194 },
                { city: 'New York', count: 128, latitude: 40.7128, longitude: -74.0060 },
                { city: 'Los Angeles', count: 116, latitude: 34.0522, longitude: -118.2437 },
                { city: 'Chicago', count: 84, latitude: 41.8781, longitude: -87.6298 },
            ],
        },
        {
            country: 'United Kingdom',
            count: 214,
            latitude: 55.3781,
            longitude: -3.4360,
            crashCount: 1,
            rageTapCount: 7,
            topCities: [
                { city: 'London', count: 128, latitude: 51.5074, longitude: -0.1278 },
                { city: 'Manchester', count: 34, latitude: 53.4808, longitude: -2.2426 },
            ],
        },
        {
            country: 'Germany',
            count: 176,
            latitude: 51.1657,
            longitude: 10.4515,
            crashCount: 1,
            rageTapCount: 5,
            topCities: [
                { city: 'Berlin', count: 78, latitude: 52.5200, longitude: 13.4050 },
                { city: 'Munich', count: 41, latitude: 48.1351, longitude: 11.5820 },
            ],
        },
        {
            country: 'Japan',
            count: 118,
            latitude: 36.2048,
            longitude: 138.2529,
            crashCount: 0,
            rageTapCount: 4,
            topCities: [
                { city: 'Tokyo', count: 82, latitude: 35.6762, longitude: 139.6503 },
                { city: 'Osaka', count: 19, latitude: 34.6937, longitude: 135.5023 },
            ],
        },
        {
            country: 'Canada',
            count: 132,
            latitude: 56.1304,
            longitude: -106.3468,
            crashCount: 0,
            rageTapCount: 4,
            topCities: [
                { city: 'Toronto', count: 72, latitude: 43.6532, longitude: -79.3832 },
                { city: 'Vancouver', count: 31, latitude: 49.2827, longitude: -123.1207 },
            ],
        },
        {
            country: 'Australia',
            count: 84,
            latitude: -25.2744,
            longitude: 133.7751,
            crashCount: 1,
            rageTapCount: 5,
            topCities: [
                { city: 'Sydney', count: 48, latitude: -33.8688, longitude: 151.2093 },
                { city: 'Melbourne', count: 22, latitude: -37.8136, longitude: 144.9631 },
            ],
        },
        {
            country: 'Brazil',
            count: 63,
            latitude: -14.2350,
            longitude: -51.9253,
            crashCount: 1,
            rageTapCount: 7,
            topCities: [
                { city: 'São Paulo', count: 36, latitude: -23.5505, longitude: -46.6333 },
                { city: 'Rio de Janeiro', count: 14, latitude: -22.9068, longitude: -43.1729 },
            ],
        },
        {
            country: 'India',
            count: 55,
            latitude: 20.5937,
            longitude: 78.9629,
            crashCount: 1,
            rageTapCount: 8,
            topCities: [
                { city: 'Mumbai', count: 24, latitude: 19.0760, longitude: 72.8777 },
                { city: 'Bangalore', count: 18, latitude: 12.9716, longitude: 77.5946 },
            ],
        },
    ],
    totalWithGeo: 1684,
};

export const demoGeoRegionalValue: GeoRegionalValue = {
    regions: [
        {
            country: 'United States',
            sessions: 6234,
            valueSessions: 4012,
            valueShare: 64.36,
            avgDurationSeconds: 338,
            engagementSegments: { bouncers: 512, casuals: 1710, explorers: 2201, loyalists: 1811 },
        },
        {
            country: 'United Kingdom',
            sessions: 1876,
            valueSessions: 1125,
            valueShare: 59.97,
            avgDurationSeconds: 302,
            engagementSegments: { bouncers: 231, casuals: 520, explorers: 680, loyalists: 445 },
        },
        {
            country: 'Germany',
            sessions: 1245,
            valueSessions: 817,
            valueShare: 65.62,
            avgDurationSeconds: 346,
            engagementSegments: { bouncers: 134, casuals: 294, explorers: 482, loyalists: 335 },
        },
        {
            country: 'Japan',
            sessions: 987,
            valueSessions: 721,
            valueShare: 73.05,
            avgDurationSeconds: 371,
            engagementSegments: { bouncers: 74, casuals: 192, explorers: 392, loyalists: 329 },
        },
        {
            country: 'Canada',
            sessions: 756,
            valueSessions: 466,
            valueShare: 61.64,
            avgDurationSeconds: 315,
            engagementSegments: { bouncers: 92, casuals: 198, explorers: 282, loyalists: 184 },
        },
        {
            country: 'Australia',
            sessions: 654,
            valueSessions: 361,
            valueShare: 55.2,
            avgDurationSeconds: 284,
            engagementSegments: { bouncers: 104, casuals: 189, explorers: 229, loyalists: 132 },
        },
        {
            country: 'Brazil',
            sessions: 543,
            valueSessions: 266,
            valueShare: 49.0,
            avgDurationSeconds: 229,
            engagementSegments: { bouncers: 131, casuals: 146, explorers: 176, loyalists: 90 },
        },
        {
            country: 'India',
            sessions: 432,
            valueSessions: 176,
            valueShare: 40.74,
            avgDurationSeconds: 204,
            engagementSegments: { bouncers: 139, casuals: 117, explorers: 122, loyalists: 54 },
        },
        {
            country: 'France',
            sessions: 512,
            valueSessions: 276,
            valueShare: 53.91,
            avgDurationSeconds: 246,
            engagementSegments: { bouncers: 102, casuals: 134, explorers: 184, loyalists: 92 },
        },
        {
            country: 'Singapore',
            sessions: 378,
            valueSessions: 236,
            valueShare: 62.43,
            avgDurationSeconds: 332,
            engagementSegments: { bouncers: 56, casuals: 86, explorers: 142, loyalists: 94 },
        },
    ],
    summary: {
        totalSessions: 13617,
        totalValueSessions: 8456,
        valueShare: 62.1,
        avgDurationSeconds: 320.1,
        regionCount: 10,
    },
};

// ================================================================================
// Geographic Issues (for Geo page issues view)
// ================================================================================

type DemoGeoIssueLocation = GeoIssuesSummary['locations'][number];

function buildGeoIssueCountries(locations: DemoGeoIssueLocation[]): GeoIssuesSummary['countries'] {
    const countries = new Map<string, Omit<GeoIssuesSummary['countries'][number], 'issueRate'>>();

    for (const location of locations) {
        const current = countries.get(location.country) ?? {
            country: location.country,
            sessions: 0,
            uniqueUsers: 0,
            crashes: 0,
            anrs: 0,
            errors: 0,
            rageTaps: 0,
            apiErrors: 0,
            totalIssues: 0,
        };

        current.sessions += location.sessions;
        current.uniqueUsers += location.uniqueUsers;
        current.crashes += location.issues.crashes;
        current.anrs += location.issues.anrs;
        current.errors += location.issues.errors;
        current.rageTaps += location.issues.rageTaps;
        current.apiErrors += location.issues.apiErrors;
        current.totalIssues += location.issues.total;
        countries.set(location.country, current);
    }

    return Array.from(countries.values())
        .map((country) => ({
            ...country,
            issueRate: Number((country.totalIssues / Math.max(country.sessions, 1)).toFixed(2)),
        }))
        .sort((a, b) => b.sessions - a.sessions);
}

function buildGeoIssueSummary(locations: DemoGeoIssueLocation[]): GeoIssuesSummary['summary'] {
    return locations.reduce<GeoIssuesSummary['summary']>(
        (summary, location) => {
            summary.totalIssues += location.issues.total;
            summary.byType.crashes += location.issues.crashes;
            summary.byType.anrs += location.issues.anrs;
            summary.byType.errors += location.issues.errors;
            summary.byType.rageTaps += location.issues.rageTaps;
            summary.byType.apiErrors += location.issues.apiErrors;
            return summary;
        },
        {
            totalIssues: 0,
            byType: {
                crashes: 0,
                anrs: 0,
                errors: 0,
                rageTaps: 0,
                apiErrors: 0,
            },
        },
    );
}

const demoGeoIssueLocations: DemoGeoIssueLocation[] = [
    { city: 'New York', country: 'United States', lat: 40.7128, lng: -74.006, sessions: 1245, uniqueUsers: 913, issues: { total: 245, crashes: 8, anrs: 3, errors: 89, rageTaps: 135, apiErrors: 10 }, growthRate: 14.3 },
    { city: 'London', country: 'United Kingdom', lat: 51.5074, lng: -0.1278, sessions: 876, uniqueUsers: 642, issues: { total: 189, crashes: 5, anrs: 2, errors: 67, rageTaps: 105, apiErrors: 10 }, growthRate: 6.2 },
    { city: 'San Francisco', country: 'United States', lat: 37.7749, lng: -122.4194, sessions: 765, uniqueUsers: 561, issues: { total: 156, crashes: 6, anrs: 2, errors: 56, rageTaps: 85, apiErrors: 7 }, growthRate: 11.5 },
    { city: 'Berlin', country: 'Germany', lat: 52.52, lng: 13.405, sessions: 654, uniqueUsers: 488, issues: { total: 123, crashes: 4, anrs: 1, errors: 45, rageTaps: 66, apiErrors: 7 }, growthRate: -1.2 },
    { city: 'Tokyo', country: 'Japan', lat: 35.6762, lng: 139.6503, sessions: 543, uniqueUsers: 401, issues: { total: 89, crashes: 3, anrs: 0, errors: 34, rageTaps: 48, apiErrors: 4 }, growthRate: 3.8 },
    { city: 'Toronto', country: 'Canada', lat: 43.6532, lng: -79.3832, sessions: 432, uniqueUsers: 319, issues: { total: 98, crashes: 4, anrs: 1, errors: 36, rageTaps: 52, apiErrors: 5 }, growthRate: 16.7 },
    { city: 'Turmus Ayya', country: 'Palestine', lat: 32.0354, lng: 35.2856, sessions: 386, uniqueUsers: 291, issues: { total: 24, crashes: 0, anrs: 0, errors: 7, rageTaps: 13, apiErrors: 4 }, growthRate: 24.6 },
    { city: 'Sydney', country: 'Australia', lat: -33.8688, lng: 151.2093, sessions: 321, uniqueUsers: 236, issues: { total: 76, crashes: 2, anrs: 1, errors: 28, rageTaps: 42, apiErrors: 3 }, growthRate: 5.1 },
    { city: 'São Paulo', country: 'Brazil', lat: -23.5505, lng: -46.6333, sessions: 210, uniqueUsers: 161, issues: { total: 112, crashes: 8, anrs: 4, errors: 45, rageTaps: 49, apiErrors: 6 }, growthRate: 18.9 },
    { city: 'Mumbai', country: 'India', lat: 19.076, lng: 72.8777, sessions: 189, uniqueUsers: 148, issues: { total: 98, crashes: 7, anrs: 3, errors: 42, rageTaps: 38, apiErrors: 8 }, growthRate: 42.1 },
    { city: 'Paris', country: 'France', lat: 48.8566, lng: 2.3522, sessions: 412, uniqueUsers: 302, issues: { total: 82, crashes: 2, anrs: 1, errors: 31, rageTaps: 45, apiErrors: 3 }, growthRate: 2.4 },
    { city: 'Singapore', country: 'Singapore', lat: 1.3521, lng: 103.8198, sessions: 378, uniqueUsers: 284, issues: { total: 34, crashes: 1, anrs: 0, errors: 12, rageTaps: 16, apiErrors: 5 }, growthRate: 8.9 },
    { city: 'Dubai', country: 'United Arab Emirates', lat: 25.2048, lng: 55.2708, sessions: 289, uniqueUsers: 213, issues: { total: 56, crashes: 3, anrs: 1, errors: 22, rageTaps: 27, apiErrors: 3 }, growthRate: 21.3 },
    { city: 'Austin', country: 'United States', lat: 30.2672, lng: -97.7431, sessions: 512, uniqueUsers: 375, issues: { total: 89, crashes: 2, anrs: 1, errors: 34, rageTaps: 48, apiErrors: 4 }, growthRate: 9.8 },
    { city: 'Amsterdam', country: 'Netherlands', lat: 52.3676, lng: 4.9041, sessions: 345, uniqueUsers: 255, issues: { total: 67, crashes: 2, anrs: 0, errors: 28, rageTaps: 35, apiErrors: 2 }, growthRate: 4.5 },
    { city: 'Cape Town', country: 'South Africa', lat: -33.9249, lng: 18.4241, sessions: 156, uniqueUsers: 116, issues: { total: 45, crashes: 4, anrs: 2, errors: 18, rageTaps: 19, apiErrors: 2 }, growthRate: 12.4 },
    { city: 'Seoul', country: 'South Korea', lat: 37.5665, lng: 126.9780, sessions: 467, uniqueUsers: 348, issues: { total: 78, crashes: 3, anrs: 1, errors: 29, rageTaps: 41, apiErrors: 4 }, growthRate: 7.6 },
    { city: 'Mexico City', country: 'Mexico', lat: 19.4326, lng: -99.1332, sessions: 398, uniqueUsers: 297, issues: { total: 134, crashes: 9, anrs: 5, errors: 56, rageTaps: 59, apiErrors: 5 }, growthRate: 15.2 },
    { city: 'Buenos Aires', country: 'Argentina', lat: -34.6037, lng: -58.3816, sessions: 245, uniqueUsers: 181, issues: { total: 87, crashes: 5, anrs: 2, errors: 38, rageTaps: 39, apiErrors: 3 }, growthRate: 8.7 },
    { city: 'Lagos', country: 'Nigeria', lat: 6.5244, lng: 3.3792, sessions: 134, uniqueUsers: 101, issues: { total: 56, crashes: 4, anrs: 3, errors: 24, rageTaps: 22, apiErrors: 3 }, growthRate: 34.5 },
    { city: 'Jakarta', country: 'Indonesia', lat: -6.2088, lng: 106.8456, sessions: 287, uniqueUsers: 217, issues: { total: 92, crashes: 6, anrs: 2, errors: 36, rageTaps: 44, apiErrors: 4 }, growthRate: 19.8 },
    { city: 'Chicago', country: 'United States', lat: 41.8781, lng: -87.6298, sessions: 489, uniqueUsers: 357, issues: { total: 95, crashes: 3, anrs: 1, errors: 42, rageTaps: 45, apiErrors: 4 }, growthRate: 3.2 },
    { city: 'Rome', country: 'Italy', lat: 41.9028, lng: 12.4964, sessions: 276, uniqueUsers: 205, issues: { total: 58, crashes: 2, anrs: 1, errors: 23, rageTaps: 29, apiErrors: 3 }, growthRate: 1.4 },
    { city: 'Madrid', country: 'Spain', lat: 40.4168, lng: -3.7038, sessions: 312, uniqueUsers: 231, issues: { total: 64, crashes: 2, anrs: 0, errors: 26, rageTaps: 34, apiErrors: 2 }, growthRate: 5.6 },
    { city: 'Istanbul', country: 'Turkey', lat: 41.0082, lng: 28.9784, sessions: 356, uniqueUsers: 266, issues: { total: 82, crashes: 4, anrs: 2, errors: 35, rageTaps: 38, apiErrors: 3 }, growthRate: 11.2 },
    { city: 'Bangkok', country: 'Thailand', lat: 13.7563, lng: 100.5018, sessions: 324, uniqueUsers: 241, issues: { total: 76, crashes: 3, anrs: 1, errors: 31, rageTaps: 38, apiErrors: 3 }, growthRate: 14.8 },
    { city: 'Seattle', country: 'United States', lat: 47.6062, lng: -122.3321, sessions: 438, uniqueUsers: 322, issues: { total: 62, crashes: 1, anrs: 0, errors: 25, rageTaps: 34, apiErrors: 2 }, growthRate: 6.4 },
    { city: 'Los Angeles', country: 'United States', lat: 34.0522, lng: -118.2437, sessions: 602, uniqueUsers: 444, issues: { total: 118, crashes: 4, anrs: 1, errors: 48, rageTaps: 60, apiErrors: 5 }, growthRate: 10.7 },
    { city: 'Miami', country: 'United States', lat: 25.7617, lng: -80.1918, sessions: 366, uniqueUsers: 271, issues: { total: 104, crashes: 5, anrs: 2, errors: 42, rageTaps: 51, apiErrors: 4 }, growthRate: 13.6 },
    { city: 'Dallas', country: 'United States', lat: 32.7767, lng: -96.7970, sessions: 341, uniqueUsers: 253, issues: { total: 72, crashes: 2, anrs: 1, errors: 29, rageTaps: 37, apiErrors: 3 }, growthRate: 7.1 },
    { city: 'Atlanta', country: 'United States', lat: 33.7490, lng: -84.3880, sessions: 318, uniqueUsers: 238, issues: { total: 69, crashes: 2, anrs: 1, errors: 27, rageTaps: 36, apiErrors: 3 }, growthRate: 5.9 },
    { city: 'Denver', country: 'United States', lat: 39.7392, lng: -104.9903, sessions: 292, uniqueUsers: 216, issues: { total: 48, crashes: 1, anrs: 0, errors: 19, rageTaps: 26, apiErrors: 2 }, growthRate: 4.3 },
    { city: 'Vancouver', country: 'Canada', lat: 49.2827, lng: -123.1207, sessions: 274, uniqueUsers: 204, issues: { total: 43, crashes: 1, anrs: 0, errors: 17, rageTaps: 23, apiErrors: 2 }, growthRate: 5.2 },
    { city: 'Montreal', country: 'Canada', lat: 45.5017, lng: -73.5673, sessions: 258, uniqueUsers: 192, issues: { total: 51, crashes: 2, anrs: 1, errors: 20, rageTaps: 26, apiErrors: 2 }, growthRate: 8.4 },
    { city: 'Dublin', country: 'Ireland', lat: 53.3498, lng: -6.2603, sessions: 236, uniqueUsers: 178, issues: { total: 37, crashes: 1, anrs: 0, errors: 14, rageTaps: 20, apiErrors: 2 }, growthRate: 3.9 },
    { city: 'Stockholm', country: 'Sweden', lat: 59.3293, lng: 18.0686, sessions: 224, uniqueUsers: 169, issues: { total: 31, crashes: 1, anrs: 0, errors: 12, rageTaps: 17, apiErrors: 1 }, growthRate: 2.6 },
    { city: 'Warsaw', country: 'Poland', lat: 52.2297, lng: 21.0122, sessions: 248, uniqueUsers: 185, issues: { total: 55, crashes: 2, anrs: 1, errors: 22, rageTaps: 27, apiErrors: 3 }, growthRate: 7.8 },
    { city: 'Zurich', country: 'Switzerland', lat: 47.3769, lng: 8.5417, sessions: 215, uniqueUsers: 162, issues: { total: 29, crashes: 1, anrs: 0, errors: 11, rageTaps: 16, apiErrors: 1 }, growthRate: 1.8 },
    { city: 'Lisbon', country: 'Portugal', lat: 38.7223, lng: -9.1393, sessions: 231, uniqueUsers: 174, issues: { total: 44, crashes: 1, anrs: 1, errors: 17, rageTaps: 23, apiErrors: 2 }, growthRate: 6.6 },
    { city: 'Bengaluru', country: 'India', lat: 12.9716, lng: 77.5946, sessions: 302, uniqueUsers: 228, issues: { total: 82, crashes: 5, anrs: 2, errors: 34, rageTaps: 37, apiErrors: 4 }, growthRate: 24.5 },
    { city: 'Delhi', country: 'India', lat: 28.6139, lng: 77.2090, sessions: 276, uniqueUsers: 209, issues: { total: 109, crashes: 8, anrs: 4, errors: 47, rageTaps: 44, apiErrors: 6 }, growthRate: 31.2 },
    { city: 'Manila', country: 'Philippines', lat: 14.5995, lng: 120.9842, sessions: 268, uniqueUsers: 203, issues: { total: 96, crashes: 6, anrs: 3, errors: 39, rageTaps: 43, apiErrors: 5 }, growthRate: 20.9 },
    { city: 'Hong Kong', country: 'Hong Kong', lat: 22.3193, lng: 114.1694, sessions: 254, uniqueUsers: 192, issues: { total: 38, crashes: 1, anrs: 0, errors: 14, rageTaps: 21, apiErrors: 2 }, growthRate: 4.7 },
    { city: 'Taipei', country: 'Taiwan', lat: 25.0330, lng: 121.5654, sessions: 241, uniqueUsers: 181, issues: { total: 35, crashes: 1, anrs: 0, errors: 13, rageTaps: 19, apiErrors: 2 }, growthRate: 4.1 },
    { city: 'Kuala Lumpur', country: 'Malaysia', lat: 3.1390, lng: 101.6869, sessions: 226, uniqueUsers: 171, issues: { total: 58, crashes: 3, anrs: 1, errors: 23, rageTaps: 28, apiErrors: 3 }, growthRate: 12.7 },
    { city: 'Ho Chi Minh City', country: 'Vietnam', lat: 10.8231, lng: 106.6297, sessions: 218, uniqueUsers: 164, issues: { total: 74, crashes: 4, anrs: 2, errors: 30, rageTaps: 35, apiErrors: 3 }, growthRate: 17.3 },
    { city: 'Melbourne', country: 'Australia', lat: -37.8136, lng: 144.9631, sessions: 264, uniqueUsers: 197, issues: { total: 57, crashes: 2, anrs: 1, errors: 22, rageTaps: 30, apiErrors: 2 }, growthRate: 6.8 },
    { city: 'Auckland', country: 'New Zealand', lat: -36.8485, lng: 174.7633, sessions: 196, uniqueUsers: 148, issues: { total: 33, crashes: 1, anrs: 0, errors: 12, rageTaps: 18, apiErrors: 2 }, growthRate: 5.4 },
    { city: 'Bogota', country: 'Colombia', lat: 4.7110, lng: -74.0721, sessions: 219, uniqueUsers: 166, issues: { total: 81, crashes: 5, anrs: 2, errors: 34, rageTaps: 36, apiErrors: 4 }, growthRate: 18.1 },
    { city: 'Santiago', country: 'Chile', lat: -33.4489, lng: -70.6693, sessions: 207, uniqueUsers: 157, issues: { total: 63, crashes: 3, anrs: 1, errors: 26, rageTaps: 30, apiErrors: 3 }, growthRate: 10.8 },
    { city: 'Lima', country: 'Peru', lat: -12.0464, lng: -77.0428, sessions: 188, uniqueUsers: 143, issues: { total: 91, crashes: 6, anrs: 3, errors: 39, rageTaps: 39, apiErrors: 4 }, growthRate: 23.6 },
    { city: 'Nairobi', country: 'Kenya', lat: -1.2921, lng: 36.8219, sessions: 177, uniqueUsers: 134, issues: { total: 69, crashes: 4, anrs: 2, errors: 28, rageTaps: 32, apiErrors: 3 }, growthRate: 21.4 },
    { city: 'Cairo', country: 'Egypt', lat: 30.0444, lng: 31.2357, sessions: 169, uniqueUsers: 128, issues: { total: 85, crashes: 6, anrs: 3, errors: 36, rageTaps: 36, apiErrors: 4 }, growthRate: 25.1 },
    { city: 'Johannesburg', country: 'South Africa', lat: -26.2041, lng: 28.0473, sessions: 153, uniqueUsers: 115, issues: { total: 66, crashes: 4, anrs: 2, errors: 26, rageTaps: 31, apiErrors: 3 }, growthRate: 14.2 },
];

export const demoGeoIssues: GeoIssuesSummary = {
    locations: demoGeoIssueLocations,
    countries: buildGeoIssueCountries(demoGeoIssueLocations),
    summary: buildGeoIssueSummary(demoGeoIssueLocations),
};

// ================================================================================
// Device Summary (for Devices page)
// ================================================================================

export const demoDeviceSummary: DeviceSummary = {
    devices: [
        { model: 'iPhone 15 Pro', count: 2341, crashes: 5, anrs: 2, errors: 12, rageTaps: 45, avgDurationSeconds: 386, avgInteractionScore: 78, avgExplorationScore: 73, avgUxScore: 84, engagedSessions: 1884, totalEvents: 84562 },
        { model: 'iPhone 14', count: 1876, crashes: 3, anrs: 1, errors: 8, rageTaps: 32, avgDurationSeconds: 342, avgInteractionScore: 74, avgExplorationScore: 70, avgUxScore: 86, engagedSessions: 1394, totalEvents: 60472 },
        { model: 'Samsung Galaxy S24', count: 1654, crashes: 12, anrs: 8, errors: 23, rageTaps: 56, avgDurationSeconds: 301, avgInteractionScore: 64, avgExplorationScore: 61, avgUxScore: 71, engagedSessions: 1051, totalEvents: 54808 },
        { model: 'Pixel 8 Pro', count: 987, crashes: 4, anrs: 3, errors: 9, rageTaps: 21, avgDurationSeconds: 418, avgInteractionScore: 81, avgExplorationScore: 77, avgUxScore: 82, engagedSessions: 824, totalEvents: 37991 },
        { model: 'iPhone 15', count: 876, crashes: 2, anrs: 0, errors: 5, rageTaps: 12, avgDurationSeconds: 365, avgInteractionScore: 76, avgExplorationScore: 74, avgUxScore: 88, engagedSessions: 684, totalEvents: 29284 },
        { model: 'iPhone 13', count: 765, crashes: 6, anrs: 2, errors: 11, rageTaps: 23, avgDurationSeconds: 238, avgInteractionScore: 56, avgExplorationScore: 53, avgUxScore: 69, engagedSessions: 384, totalEvents: 18112 },
        { model: 'Samsung Galaxy S23', count: 654, crashes: 8, anrs: 5, errors: 15, rageTaps: 34, avgDurationSeconds: 214, avgInteractionScore: 48, avgExplorationScore: 46, avgUxScore: 62, engagedSessions: 283, totalEvents: 14976 },
        { model: 'OnePlus 12', count: 543, crashes: 3, anrs: 2, errors: 7, rageTaps: 15, avgDurationSeconds: 334, avgInteractionScore: 69, avgExplorationScore: 66, avgUxScore: 77, engagedSessions: 374, totalEvents: 17244 },
        { model: 'iPad Pro 12.9"', count: 432, crashes: 1, anrs: 0, errors: 3, rageTaps: 5, avgDurationSeconds: 476, avgInteractionScore: 83, avgExplorationScore: 81, avgUxScore: 90, engagedSessions: 371, totalEvents: 19835 },
        { model: 'Pixel 7', count: 321, crashes: 2, anrs: 1, errors: 4, rageTaps: 8, avgDurationSeconds: 276, avgInteractionScore: 58, avgExplorationScore: 55, avgUxScore: 70, engagedSessions: 172, totalEvents: 8264 },
    ],
    platforms: {
        ios: 7234,
        android: 5613,
    },
    appVersions: [
        { version: '2.3.1', count: 5678, crashes: 8, anrs: 3, errors: 18, rageTaps: 45 },
        { version: '2.3.0', count: 4567, crashes: 15, anrs: 8, errors: 32, rageTaps: 89 },
        { version: '2.2.9', count: 1876, crashes: 12, anrs: 6, errors: 28, rageTaps: 34 },
        { version: '2.2.8', count: 543, crashes: 8, anrs: 4, errors: 15, rageTaps: 12 },
        { version: '2.2.5', count: 183, crashes: 3, anrs: 3, errors: 7, rageTaps: 5 },
    ],
    osVersions: [
        { version: 'iOS 17.2', count: 3456, crashes: 4, anrs: 1, errors: 12, rageTaps: 23 },
        { version: 'iOS 17.1', count: 2345, crashes: 6, anrs: 2, errors: 15, rageTaps: 45 },
        { version: 'Android 14', count: 3987, crashes: 18, anrs: 12, errors: 35, rageTaps: 89 },
        { version: 'iOS 16.7', count: 1234, crashes: 8, anrs: 3, errors: 18, rageTaps: 34 },
        { version: 'Android 13', count: 1456, crashes: 10, anrs: 6, errors: 20, rageTaps: 45 },
        { version: 'iOS 17.0', count: 456, crashes: 2, anrs: 0, errors: 5, rageTaps: 12 },
    ],
    totalSessions: 12847,
};

export const demoDeviceIssueMatrix: DeviceIssueMatrix = {
    devices: [
        'Samsung Galaxy S23',
        'Samsung Galaxy S24',
        'iPhone 13',
        'Pixel 8 Pro',
        'iPhone 15 Pro',
        'iPhone 14',
    ],
    versions: ['2.3.1', '2.3.0', '2.2.9', '2.2.8'],
    matrix: [
        {
            device: 'Samsung Galaxy S23',
            version: '2.3.0',
            sessions: 240,
            issues: { crashes: 5, anrs: 3, errors: 9, rageTaps: 18 },
            issueRate: 0.1458,
        },
        {
            device: 'Samsung Galaxy S24',
            version: '2.3.0',
            sessions: 620,
            issues: { crashes: 7, anrs: 5, errors: 14, rageTaps: 31 },
            issueRate: 0.0919,
        },
        {
            device: 'iPhone 13',
            version: '2.2.9',
            sessions: 360,
            issues: { crashes: 4, anrs: 2, errors: 8, rageTaps: 13 },
            issueRate: 0.075,
        },
        {
            device: 'Pixel 8 Pro',
            version: '2.3.1',
            sessions: 510,
            issues: { crashes: 1, anrs: 1, errors: 5, rageTaps: 9 },
            issueRate: 0.0314,
        },
        {
            device: 'iPhone 15 Pro',
            version: '2.3.1',
            sessions: 1100,
            issues: { crashes: 2, anrs: 0, errors: 5, rageTaps: 12 },
            issueRate: 0.0173,
        },
        {
            device: 'iPhone 14',
            version: '2.3.1',
            sessions: 980,
            issues: { crashes: 1, anrs: 0, errors: 4, rageTaps: 10 },
            issueRate: 0.0153,
        },
    ],
};

// ================================================================================
// Journey Summary (for Journeys page)
// ================================================================================

const demoJourneySessionIds = (prefix: string, count: number) => Array.from(
    { length: count },
    (_, index) => `demo-journey-${prefix}-${String(index + 1).padStart(3, '0')}`,
);

export const demoJourneySummary: JourneySummary = {
    topScreens: [
        { screen: 'Home', visits: 21560 },
        { screen: 'Product Detail', visits: 15840 },
        { screen: 'New Arrivals', visits: 8280 },
        { screen: 'Search', visits: 6180 },
        { screen: 'Cart', visits: 5780 },
        { screen: 'Style Quiz', visits: 3840 },
        { screen: 'Shipping', visits: 3820 },
        { screen: 'Payment', visits: 3260 },
        { screen: 'Reviews', visits: 3320 },
        { screen: 'Order Confirmation', visits: 2870 },
        { screen: 'Size Guide', visits: 2860 },
        { screen: 'Promo Code', visits: 2280 },
    ],
    flows: [
        { from: 'Launch', to: 'Home', count: 21560 },
        { from: 'Home', to: 'New Arrivals', count: 8280 },
        { from: 'New Arrivals', to: 'Product Detail', count: 7320 },
        { from: 'Product Detail', to: 'Cart', count: 5120 },
        { from: 'Cart', to: 'Shipping', count: 3820 },
        { from: 'Shipping', to: 'Payment', count: 3260 },
        { from: 'Payment', to: 'Order Confirmation', count: 2870 },
        { from: 'Home', to: 'Search', count: 6180 },
        { from: 'Search', to: 'Product Detail', count: 4580 },
        { from: 'Home', to: 'Style Quiz', count: 3840 },
        { from: 'Style Quiz', to: 'Quiz Results', count: 3020 },
        { from: 'Quiz Results', to: 'Collections', count: 2560 },
        { from: 'Collections', to: 'Product Detail', count: 2160 },
        { from: 'Product Detail', to: 'Reviews', count: 3320 },
        { from: 'Reviews', to: 'Cart', count: 1880 },
        { from: 'Product Detail', to: 'Size Guide', count: 2860 },
        { from: 'Size Guide', to: 'Cart', count: 1720 },
        { from: 'Cart', to: 'Promo Code', count: 2280 },
        { from: 'Promo Code', to: 'Shipping', count: 1460 },
        { from: 'Payment', to: '3-D Secure', count: 960 },
        { from: '3-D Secure', to: 'Order Confirmation', count: 720 },
        { from: 'Home', to: 'Saved Looks', count: 2420 },
        { from: 'Saved Looks', to: 'Product Detail', count: 1780 },
        { from: 'Product Detail', to: 'Wishlist', count: 1540 },
        { from: 'Wishlist', to: 'Cart', count: 720 },
        { from: 'Shipping', to: 'Support Chat', count: 740 },
        { from: 'Support Chat', to: 'Payment', count: 430 },
    ],
    entryPoints: [
        { screen: 'Launch', count: 21560 },
        { screen: 'Product Detail', count: 1860 },
        { screen: 'Search', count: 920 },
        { screen: 'Cart', count: 540 },
        { screen: 'Style Quiz', count: 410 },
    ],
    exitPoints: [
        { screen: 'Order Confirmation', count: 3590 },
        { screen: 'Search Exit', count: 720 },
        { screen: 'Sizing Exit', count: 620 },
        { screen: 'Promo Exit', count: 580 },
        { screen: 'Payment Exit', count: 600 },
    ],
};

// ================================================================================
// Journey Observability (Observability-centric analysis)
// ================================================================================

export const demoJourneyObservability: ObservabilityJourneySummary = {
    healthSummary: {
        healthy: 18420,
        degraded: 5310,
        problematic: 2460,
    },
    appVersions: [
        { version: '2.6.0', count: 10420 },
        { version: '2.5.1', count: 8210 },
        { version: '2.5.0', count: 5360 },
        { version: '2.4.8', count: 2200 },
    ],
    flows: [
        { from: 'Launch', to: 'Home', count: 21560, apiErrors: 9, apiErrorRate: 0.04, avgApiLatencyMs: 92, rageTapCount: 12, crashCount: 0, anrCount: 0, health: 'healthy', replayCount: 72, sampleSessionIds: demoJourneySessionIds('launch-home', 6) },
        { from: 'Home', to: 'New Arrivals', count: 8280, apiErrors: 18, apiErrorRate: 0.2, avgApiLatencyMs: 138, rageTapCount: 24, crashCount: 0, anrCount: 0, health: 'healthy', replayCount: 58, sampleSessionIds: demoJourneySessionIds('home-arrivals', 6) },
        { from: 'New Arrivals', to: 'Product Detail', count: 7320, apiErrors: 22, apiErrorRate: 0.3, avgApiLatencyMs: 166, rageTapCount: 31, crashCount: 0, anrCount: 0, health: 'healthy', replayCount: 54, sampleSessionIds: demoJourneySessionIds('arrivals-detail', 6) },
        { from: 'Product Detail', to: 'Cart', count: 5120, apiErrors: 74, apiErrorRate: 1.4, avgApiLatencyMs: 286, rageTapCount: 96, crashCount: 2, anrCount: 0, health: 'degraded', replayCount: 49, sampleSessionIds: demoJourneySessionIds('detail-cart', 6) },
        { from: 'Cart', to: 'Shipping', count: 3820, apiErrors: 116, apiErrorRate: 3.0, avgApiLatencyMs: 438, rageTapCount: 154, crashCount: 2, anrCount: 1, health: 'degraded', replayCount: 61, sampleSessionIds: demoJourneySessionIds('cart-shipping', 6) },
        { from: 'Shipping', to: 'Payment', count: 3260, apiErrors: 132, apiErrorRate: 4.0, avgApiLatencyMs: 620, rageTapCount: 188, crashCount: 3, anrCount: 1, health: 'degraded', replayCount: 67, sampleSessionIds: demoJourneySessionIds('shipping-payment', 6) },
        { from: 'Payment', to: 'Order Confirmation', count: 2870, apiErrors: 28, apiErrorRate: 1.0, avgApiLatencyMs: 241, rageTapCount: 34, crashCount: 0, anrCount: 0, health: 'healthy', replayCount: 52, sampleSessionIds: demoJourneySessionIds('payment-confirmed', 6) },
        { from: 'Home', to: 'Search', count: 6180, apiErrors: 14, apiErrorRate: 0.2, avgApiLatencyMs: 118, rageTapCount: 26, crashCount: 0, anrCount: 0, health: 'healthy', replayCount: 38, sampleSessionIds: demoJourneySessionIds('home-search', 5) },
        { from: 'Search', to: 'Product Detail', count: 4580, apiErrors: 92, apiErrorRate: 2.0, avgApiLatencyMs: 366, rageTapCount: 88, crashCount: 1, anrCount: 0, health: 'degraded', replayCount: 46, sampleSessionIds: demoJourneySessionIds('search-detail', 5) },
        { from: 'Search', to: 'Search Exit', count: 720, apiErrors: 86, apiErrorRate: 11.9, avgApiLatencyMs: 1160, rageTapCount: 144, crashCount: 1, anrCount: 0, health: 'problematic', replayCount: 28, sampleSessionIds: demoJourneySessionIds('search-exit', 5) },
        { from: 'Home', to: 'Style Quiz', count: 3840, apiErrors: 16, apiErrorRate: 0.4, avgApiLatencyMs: 154, rageTapCount: 21, crashCount: 0, anrCount: 0, health: 'healthy', replayCount: 34, sampleSessionIds: demoJourneySessionIds('home-quiz', 5) },
        { from: 'Style Quiz', to: 'Quiz Results', count: 3020, apiErrors: 24, apiErrorRate: 0.8, avgApiLatencyMs: 224, rageTapCount: 41, crashCount: 0, anrCount: 0, health: 'healthy', replayCount: 33, sampleSessionIds: demoJourneySessionIds('quiz-results', 5) },
        { from: 'Quiz Results', to: 'Collections', count: 2560, apiErrors: 36, apiErrorRate: 1.4, avgApiLatencyMs: 292, rageTapCount: 54, crashCount: 0, anrCount: 0, health: 'healthy', replayCount: 31, sampleSessionIds: demoJourneySessionIds('quiz-collections', 5) },
        { from: 'Collections', to: 'Product Detail', count: 2160, apiErrors: 31, apiErrorRate: 1.4, avgApiLatencyMs: 305, rageTapCount: 62, crashCount: 0, anrCount: 0, health: 'healthy', replayCount: 27, sampleSessionIds: demoJourneySessionIds('collections-detail', 5) },
        { from: 'Home', to: 'Saved Looks', count: 2420, apiErrors: 8, apiErrorRate: 0.3, avgApiLatencyMs: 142, rageTapCount: 17, crashCount: 0, anrCount: 0, health: 'healthy', replayCount: 24, sampleSessionIds: demoJourneySessionIds('home-saved', 5) },
        { from: 'Saved Looks', to: 'Product Detail', count: 1780, apiErrors: 19, apiErrorRate: 1.1, avgApiLatencyMs: 238, rageTapCount: 42, crashCount: 0, anrCount: 0, health: 'healthy', replayCount: 23, sampleSessionIds: demoJourneySessionIds('saved-detail', 5) },
        { from: 'Product Detail', to: 'Reviews', count: 3320, apiErrors: 27, apiErrorRate: 0.8, avgApiLatencyMs: 210, rageTapCount: 39, crashCount: 0, anrCount: 0, health: 'healthy', replayCount: 35, sampleSessionIds: demoJourneySessionIds('detail-reviews', 5) },
        { from: 'Reviews', to: 'Cart', count: 1880, apiErrors: 21, apiErrorRate: 1.1, avgApiLatencyMs: 196, rageTapCount: 24, crashCount: 0, anrCount: 0, health: 'healthy', replayCount: 24, sampleSessionIds: demoJourneySessionIds('reviews-cart', 5) },
        { from: 'Product Detail', to: 'Size Guide', count: 2860, apiErrors: 104, apiErrorRate: 3.6, avgApiLatencyMs: 670, rageTapCount: 203, crashCount: 1, anrCount: 1, health: 'degraded', replayCount: 44, sampleSessionIds: demoJourneySessionIds('detail-size', 5) },
        { from: 'Size Guide', to: 'Cart', count: 1720, apiErrors: 66, apiErrorRate: 3.8, avgApiLatencyMs: 522, rageTapCount: 126, crashCount: 1, anrCount: 0, health: 'degraded', replayCount: 33, sampleSessionIds: demoJourneySessionIds('size-cart', 5) },
        { from: 'Size Guide', to: 'Sizing Exit', count: 620, apiErrors: 128, apiErrorRate: 20.6, avgApiLatencyMs: 1480, rageTapCount: 286, crashCount: 4, anrCount: 2, health: 'problematic', replayCount: 55, sampleSessionIds: demoJourneySessionIds('sizing-exit', 6) },
        { from: 'Product Detail', to: 'Wishlist', count: 1540, apiErrors: 18, apiErrorRate: 1.2, avgApiLatencyMs: 180, rageTapCount: 19, crashCount: 0, anrCount: 0, health: 'healthy', replayCount: 17, sampleSessionIds: demoJourneySessionIds('detail-wishlist', 4) },
        { from: 'Wishlist', to: 'Cart', count: 720, apiErrors: 9, apiErrorRate: 1.3, avgApiLatencyMs: 188, rageTapCount: 12, crashCount: 0, anrCount: 0, health: 'healthy', replayCount: 13, sampleSessionIds: demoJourneySessionIds('wishlist-cart', 4) },
        { from: 'Cart', to: 'Promo Code', count: 2280, apiErrors: 112, apiErrorRate: 4.9, avgApiLatencyMs: 770, rageTapCount: 246, crashCount: 1, anrCount: 1, health: 'degraded', replayCount: 61, sampleSessionIds: demoJourneySessionIds('cart-promo', 6) },
        { from: 'Promo Code', to: 'Shipping', count: 1460, apiErrors: 88, apiErrorRate: 6.0, avgApiLatencyMs: 812, rageTapCount: 177, crashCount: 2, anrCount: 1, health: 'degraded', replayCount: 48, sampleSessionIds: demoJourneySessionIds('promo-shipping', 5) },
        { from: 'Promo Code', to: 'Promo Exit', count: 580, apiErrors: 154, apiErrorRate: 26.6, avgApiLatencyMs: 1735, rageTapCount: 338, crashCount: 5, anrCount: 3, health: 'problematic', replayCount: 64, sampleSessionIds: demoJourneySessionIds('promo-exit', 6) },
        { from: 'Shipping', to: 'Support Chat', count: 740, apiErrors: 76, apiErrorRate: 10.3, avgApiLatencyMs: 1230, rageTapCount: 149, crashCount: 1, anrCount: 1, health: 'degraded', replayCount: 37, sampleSessionIds: demoJourneySessionIds('shipping-support', 5) },
        { from: 'Support Chat', to: 'Payment', count: 430, apiErrors: 32, apiErrorRate: 7.4, avgApiLatencyMs: 980, rageTapCount: 83, crashCount: 1, anrCount: 0, health: 'degraded', replayCount: 29, sampleSessionIds: demoJourneySessionIds('support-payment', 5) },
        { from: 'Payment', to: '3-D Secure', count: 960, apiErrors: 114, apiErrorRate: 11.9, avgApiLatencyMs: 1290, rageTapCount: 226, crashCount: 2, anrCount: 1, health: 'degraded', replayCount: 58, sampleSessionIds: demoJourneySessionIds('payment-3ds', 6) },
        { from: '3-D Secure', to: 'Order Confirmation', count: 720, apiErrors: 31, apiErrorRate: 4.3, avgApiLatencyMs: 484, rageTapCount: 44, crashCount: 0, anrCount: 0, health: 'healthy', replayCount: 28, sampleSessionIds: demoJourneySessionIds('3ds-confirmed', 5) },
        { from: '3-D Secure', to: 'Payment Exit', count: 210, apiErrors: 82, apiErrorRate: 39.0, avgApiLatencyMs: 2200, rageTapCount: 164, crashCount: 3, anrCount: 2, health: 'problematic', replayCount: 43, sampleSessionIds: demoJourneySessionIds('3ds-exit', 6) },
        { from: 'Payment', to: 'Payment Exit', count: 390, apiErrors: 129, apiErrorRate: 33.1, avgApiLatencyMs: 1960, rageTapCount: 271, crashCount: 5, anrCount: 3, health: 'problematic', replayCount: 69, sampleSessionIds: demoJourneySessionIds('payment-exit', 6) },
        { from: 'Home', to: 'Account', count: 1260, apiErrors: 7, apiErrorRate: 0.6, avgApiLatencyMs: 166, rageTapCount: 14, crashCount: 0, anrCount: 0, health: 'healthy', replayCount: 16, sampleSessionIds: demoJourneySessionIds('home-account', 4) },
        { from: 'Account', to: 'Saved Looks', count: 640, apiErrors: 8, apiErrorRate: 1.3, avgApiLatencyMs: 254, rageTapCount: 18, crashCount: 0, anrCount: 0, health: 'healthy', replayCount: 13, sampleSessionIds: demoJourneySessionIds('account-saved', 4) },
        { from: 'Account', to: 'Support Chat', count: 380, apiErrors: 41, apiErrorRate: 10.8, avgApiLatencyMs: 1090, rageTapCount: 72, crashCount: 1, anrCount: 0, health: 'degraded', replayCount: 21, sampleSessionIds: demoJourneySessionIds('account-support', 4) },
        { from: 'Cart', to: 'Support Chat', count: 520, apiErrors: 83, apiErrorRate: 16.0, avgApiLatencyMs: 1350, rageTapCount: 141, crashCount: 3, anrCount: 1, health: 'problematic', replayCount: 46, sampleSessionIds: demoJourneySessionIds('cart-support', 5) },
    ],
    problematicJourneys: [
        { path: ['Launch', 'Home', 'New Arrivals', 'Product Detail', 'Cart', 'Promo Code', 'Promo Exit'], sessionCount: 580, crashes: 5, anrs: 3, apiErrors: 154, rageTaps: 338, failureScore: 168, sampleSessionIds: demoJourneySessionIds('promo-exit', 4) },
        { path: ['Launch', 'Home', 'Search', 'Search Exit'], sessionCount: 720, crashes: 1, anrs: 0, apiErrors: 86, rageTaps: 144, failureScore: 133, sampleSessionIds: demoJourneySessionIds('search-exit', 4) },
        { path: ['Launch', 'Home', 'New Arrivals', 'Product Detail', 'Size Guide', 'Sizing Exit'], sessionCount: 620, crashes: 4, anrs: 2, apiErrors: 128, rageTaps: 286, failureScore: 154, sampleSessionIds: demoJourneySessionIds('sizing-exit', 4) },
        { path: ['Launch', 'Home', 'New Arrivals', 'Product Detail', 'Cart', 'Shipping', 'Payment', 'Payment Exit'], sessionCount: 390, crashes: 5, anrs: 3, apiErrors: 129, rageTaps: 271, failureScore: 161, sampleSessionIds: demoJourneySessionIds('payment-exit', 4) },
        { path: ['Launch', 'Home', 'New Arrivals', 'Product Detail', 'Cart', 'Shipping', 'Payment', '3-D Secure', 'Payment Exit'], sessionCount: 210, crashes: 3, anrs: 2, apiErrors: 82, rageTaps: 164, failureScore: 119, sampleSessionIds: demoJourneySessionIds('3ds-exit', 4) },
        { path: ['Launch', 'Home', 'Style Quiz', 'Quiz Results', 'Collections', 'Product Detail', 'Size Guide'], sessionCount: 420, crashes: 1, anrs: 1, apiErrors: 82, rageTaps: 156, failureScore: 91, sampleSessionIds: demoJourneySessionIds('quiz-size', 4) },
        { path: ['Launch', 'Home', 'Cart', 'Support Chat'], sessionCount: 520, crashes: 3, anrs: 1, apiErrors: 83, rageTaps: 141, failureScore: 104, sampleSessionIds: demoJourneySessionIds('cart-support', 4) },
    ],
    happyPathJourney: {
        path: ['Launch', 'Home', 'New Arrivals', 'Product Detail', 'Cart', 'Shipping', 'Payment', 'Order Confirmation'],
        sessionCount: 2870,
        crashes: 0,
        anrs: 0,
        apiErrors: 28,
        rageTaps: 34,
        failureScore: 0,
        health: 'healthy',
        sampleSessionIds: demoJourneySessionIds('happy', 6),
    },
    configuredHappyPath: {
        projectId: 'demo-project',
        path: ['Launch', 'Home', 'New Arrivals', 'Product Detail', 'Cart', 'Shipping', 'Payment', 'Order Confirmation'],
        targetScreen: 'Order Confirmation',
        confidence: 0.83,
        sampleSize: 1840,
        updatedAt: new Date(DEMO_NOW - 6 * 60 * 60 * 1000).toISOString(),
    },
    exitAfterError: [
        { screen: 'Promo Code', exitCount: 580, errorTypes: { api: 154, crash: 5, rage: 338 }, sampleSessionIds: demoJourneySessionIds('promo-exit', 4) },
        { screen: 'Size Guide', exitCount: 620, errorTypes: { api: 128, crash: 4, rage: 286 }, sampleSessionIds: demoJourneySessionIds('sizing-exit', 4) },
        { screen: 'Payment', exitCount: 390, errorTypes: { api: 129, crash: 5, rage: 271 }, sampleSessionIds: demoJourneySessionIds('payment-exit', 4) },
        { screen: '3-D Secure', exitCount: 210, errorTypes: { api: 82, crash: 3, rage: 164 }, sampleSessionIds: demoJourneySessionIds('3ds-exit', 4) },
        { screen: 'Search', exitCount: 720, errorTypes: { api: 86, crash: 1, rage: 144 }, sampleSessionIds: demoJourneySessionIds('search-exit', 4) },
        { screen: 'Support Chat', exitCount: 260, errorTypes: { api: 62, crash: 2, rage: 116 }, sampleSessionIds: demoJourneySessionIds('support-exit', 4) },
    ],
    timeToFailure: {
        avgTimeBeforeFirstErrorMs: 78000,
        avgScreensBeforeCrash: 4.6,
        avgInteractionsBeforeRageTap: 16,
    },
    screenHealth: [
        { name: 'Launch', visits: 21560, health: 'healthy', crashes: 0, anrs: 0, apiErrors: 9, rageTaps: 12, replayAvailable: true },
        { name: 'Home', visits: 21560, health: 'healthy', crashes: 0, anrs: 0, apiErrors: 63, rageTaps: 114, replayAvailable: true },
        { name: 'New Arrivals', visits: 8280, health: 'healthy', crashes: 0, anrs: 0, apiErrors: 40, rageTaps: 55, replayAvailable: true },
        { name: 'Product Detail', visits: 15840, health: 'degraded', crashes: 4, anrs: 2, apiErrors: 274, rageTaps: 461, replayAvailable: true },
        { name: 'Search', visits: 6180, health: 'degraded', crashes: 2, anrs: 0, apiErrors: 178, rageTaps: 258, replayAvailable: true },
        { name: 'Size Guide', visits: 2860, health: 'problematic', crashes: 5, anrs: 3, apiErrors: 232, rageTaps: 489, replayAvailable: true },
        { name: 'Cart', visits: 5780, health: 'degraded', crashes: 9, anrs: 3, apiErrors: 394, rageTaps: 541, replayAvailable: true },
        { name: 'Promo Code', visits: 2280, health: 'problematic', crashes: 7, anrs: 4, apiErrors: 354, rageTaps: 515, replayAvailable: true },
        { name: 'Shipping', visits: 3820, health: 'degraded', crashes: 4, anrs: 2, apiErrors: 208, rageTaps: 337, replayAvailable: true },
        { name: 'Payment', visits: 3260, health: 'problematic', crashes: 10, anrs: 6, apiErrors: 403, rageTaps: 531, replayAvailable: true },
        { name: '3-D Secure', visits: 960, health: 'problematic', crashes: 3, anrs: 2, apiErrors: 113, rageTaps: 208, replayAvailable: true },
        { name: 'Order Confirmation', visits: 3590, health: 'healthy', crashes: 0, anrs: 0, apiErrors: 59, rageTaps: 78, replayAvailable: true },
    ],
    topScreens: [
        { screen: 'Home', visits: 21560 },
        { screen: 'Product Detail', visits: 15840 },
        { screen: 'New Arrivals', visits: 8280 },
        { screen: 'Search', visits: 6180 },
        { screen: 'Cart', visits: 5780 },
        { screen: 'Style Quiz', visits: 3840 },
        { screen: 'Shipping', visits: 3820 },
        { screen: 'Payment', visits: 3260 },
        { screen: 'Reviews', visits: 3320 },
        { screen: 'Order Confirmation', visits: 2870 },
        { screen: 'Size Guide', visits: 2860 },
        { screen: 'Promo Code', visits: 2280 },
    ],
    entryPoints: [
        { screen: 'Launch', count: 21560 },
        { screen: 'Product Detail', count: 1860 },
        { screen: 'Search', count: 920 },
        { screen: 'Cart', count: 540 },
        { screen: 'Style Quiz', count: 410 },
    ],
    exitPoints: [
        { screen: 'Order Confirmation', count: 3590 },
        { screen: 'Search Exit', count: 720 },
        { screen: 'Sizing Exit', count: 620 },
        { screen: 'Promo Exit', count: 580 },
        { screen: 'Payment Exit', count: 600 },
    ],
};

// ================================================================================
// Growth Observability (Session health and growth killers)
// ================================================================================

// Generate daily health data for last 30 days
const generateDailyHealth = () => {
    const data = [];
    const now = new Date(DEMO_NOW);
    for (let i = 29; i >= 0; i--) {
        const date = new Date(now);
        date.setDate(date.getDate() - i);
        const dateStr = date.toISOString().split('T')[0];
        const progress = (29 - i) / 29;
        let baseClean = 34 + Math.round(progress * 44 + demoRandom() * 8);
        let baseError = Math.max(1, Math.round(6 - progress * 3 + demoRandom() * 2));
        let baseRage = Math.max(0, Math.round(4 - progress * 2 + demoRandom() * 2));
        let baseSlow = Math.max(0, Math.round(3 - progress * 1.5 + demoRandom() * 2));
        let baseCrash = i % 13 === 0 ? 1 : 0;

        if (i === 1) { // 1 day ago (spike!)
            baseClean = 20;
            baseError = 22;
            baseRage = 15;
            baseCrash = 8;
        } else if (i === 0) { // today
            baseClean = 28;
            baseError = 14;
            baseRage = 8;
            baseCrash = 4;
        }

        data.push({
            date: dateStr,
            clean: baseClean,
            error: baseError,
            rage: baseRage,
            slow: baseSlow,
            crash: baseCrash,
        });
    }
    return data;
};

const generateDailyCustomEvents = () => {
    const eventNames = [
        'product_viewed',
        'search_submitted',
        'add_to_cart',
        'wishlist_added',
        'checkout_started',
        'order_completed',
        'signup_completed',
    ];
    const data: Array<{ date: string; events: Record<string, number> }> = [];
    const now = new Date(DEMO_NOW);
    for (let i = 29; i >= 0; i--) {
        const date = new Date(now);
        date.setDate(date.getDate() - i);
        const dateStr = date.toISOString().split('T')[0];
        const growth = 30 - i;
        data.push({
            date: dateStr,
            events: {
                [eventNames[0]]: 62 + growth * 4 + Math.round(demoRandom() * 14),
                [eventNames[1]]: 28 + Math.round(growth * 2.1) + Math.round(demoRandom() * 8),
                [eventNames[2]]: 24 + Math.round(growth * 1.9) + Math.round(demoRandom() * 7),
                [eventNames[3]]: 14 + Math.round(growth * 1.1) + Math.round(demoRandom() * 5),
                [eventNames[4]]: 13 + Math.round(growth * 1.2) + Math.round(demoRandom() * 5),
                [eventNames[5]]: 8 + Math.round(growth * 0.78) + Math.round(demoRandom() * 4),
                [eventNames[6]]: 5 + Math.round(growth * 0.46) + Math.round(demoRandom() * 3),
            },
        });
    }
    return data;
};

const demoDailyCustomEvents = generateDailyCustomEvents();
const demoCustomEventTotals = demoDailyCustomEvents.reduce<Record<string, number>>((totals, row) => {
    for (const [name, count] of Object.entries(row.events)) {
        totals[name] = (totals[name] || 0) + count;
    }
    return totals;
}, {});

export const demoGrowthObservability: GrowthObservability = {
    sessionHealth: {
        clean: 1647,
        error: 86,
        rage: 52,
        slow: 43,
        crash: 6,
    },
    firstSessionSuccessRate: 84.1,
    firstSessionStats: {
        total: 226,
        clean: 190,
        withCrash: 2,
        withAnr: 1,
        withRageTaps: 11,
        withSlowApi: 19,
    },
    newUserGrowth: {
        acquiredUsers: 226,
        activeUsers: 684,
        acquisitionRate: 33.0,
        returnedUsers: 401,
        returnRate: 58.6,
    },
    growthKillers: [
        {
            reason: 'Checkout payment retries',
            affectedSessions: 34,
            percentOfTotal: 1.8,
            deltaVsPrevious: -18,
            relatedScreen: 'Checkout',
            sampleSessionIds: ['demo-gk-001', 'demo-gk-002', 'demo-gk-003'],
        },
        {
            reason: 'Slow first paint on older Android',
            affectedSessions: 27,
            percentOfTotal: 1.5,
            deltaVsPrevious: -9,
            relatedScreen: 'Home',
            sampleSessionIds: ['demo-gk-004', 'demo-gk-005'],
        },
        {
            reason: 'First-session crash',
            affectedSessions: 2,
            percentOfTotal: 0.1,
            deltaVsPrevious: -4,
            sampleSessionIds: ['demo-gk-006', 'demo-gk-007'],
        },
        {
            reason: 'Promo code rage taps',
            affectedSessions: 18,
            percentOfTotal: 1.0,
            deltaVsPrevious: -6,
            relatedScreen: 'Cart',
            sampleSessionIds: ['demo-gk-008', 'demo-gk-009'],
        },
        {
            reason: 'ANR on first session',
            affectedSessions: 1,
            percentOfTotal: 0.1,
            deltaVsPrevious: -2,
            sampleSessionIds: ['demo-gk-010'],
        },
    ],
    dailyHealth: generateDailyHealth(),
    customEvents: Object.entries(demoCustomEventTotals)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count),
    dailyCustomEvents: demoDailyCustomEvents,
};

// ================================================================================
// Observability Deep Metrics (for Replays/API page)
// ================================================================================

export const demoObservabilityDeepMetrics: ObservabilityDeepMetrics = {
    dataWindow: {
        totalSessions: 1842,
        analyzedSessions: 1842,
        sampled: false,
        visualReplayCoverageRate: 91.6,
        analyticsCoverageRate: 98.7,
    },
    reliability: {
        crashFreeSessionRate: 99.7,
        anrFreeSessionRate: 99.8,
        errorFreeSessionRate: 95.4,
        frustrationFreeSessionRate: 96.9,
        degradedSessionRate: 10.1,
        apiFailureRate: 0.92,
        platformBreakdown: [
            { platform: 'ios', crashFreeSessionRate: 99.8, anrFreeSessionRate: 99.9 },
            { platform: 'android', crashFreeSessionRate: 99.5, anrFreeSessionRate: 99.7 },
            { platform: 'web', crashFreeSessionRate: 100, anrFreeSessionRate: 100 },
        ],
    },
    performance: {
        apiApdex: 0.934,
        p50ApiResponseMs: 142,
        p95ApiResponseMs: 612,
        p99ApiResponseMs: 1040,
        slowApiSessionRate: 3.9,
        p50StartupMs: 780,
        p95StartupMs: 2140,
        slowStartupRate: 5.8,
    },
    impact: {
        uniqueUsers: 684,
        affectedUsers: 87,
        affectedUserRate: 12.72,
        issueReoccurrenceRate: 28.4,
    },
    ingestHealth: {
        sdkUploadSuccessRate: 99.1,
        sessionsWithUploadFailures: 12,
        sessionsWithOfflinePersist: 28,
        sessionsWithMemoryEvictions: 3,
        sessionsWithCircuitBreakerOpen: 0,
        sessionsWithHeavyRetries: 5,
    },
    networkBreakdown: [
        { networkType: 'wifi', sessions: 1036, apiCalls: 12644, apiErrorRate: 0.62, avgLatencyMs: 136 },
        { networkType: 'cellular', sessions: 516, apiCalls: 5921, apiErrorRate: 1.36, avgLatencyMs: 248 },
        { networkType: '5g', sessions: 178, apiCalls: 2194, apiErrorRate: 0.88, avgLatencyMs: 188 },
        { networkType: '4g', sessions: 86, apiCalls: 913, apiErrorRate: 1.74, avgLatencyMs: 312 },
        { networkType: 'unknown', sessions: 26, apiCalls: 244, apiErrorRate: 1.23, avgLatencyMs: 231 },
    ],
    releaseRisk: [
        {
            version: '2.5.0',
            sessions: 612,
            degradedSessions: 49,
            failureRate: 8.01,
            deltaVsOverall: -2.09,
            crashCount: 1,
            anrCount: 0,
            errorCount: 34,
            firstSeen: new Date(DEMO_NOW - 18 * day).toISOString(),
            latestSeen: new Date(DEMO_NOW - 2 * day).toISOString(),
        },
        {
            version: '2.4.1',
            sessions: 734,
            degradedSessions: 82,
            failureRate: 11.17,
            deltaVsOverall: 1.07,
            crashCount: 3,
            anrCount: 2,
            errorCount: 48,
            firstSeen: new Date(DEMO_NOW - 31 * day).toISOString(),
            latestSeen: new Date(DEMO_NOW - 5 * day).toISOString(),
        },
        {
            version: 'web-2026.05.1',
            sessions: 366,
            degradedSessions: 28,
            failureRate: 7.65,
            deltaVsOverall: -2.45,
            crashCount: 0,
            anrCount: 0,
            errorCount: 22,
            firstSeen: new Date(DEMO_NOW - 54 * day).toISOString(),
            latestSeen: new Date(DEMO_NOW - 9 * day).toISOString(),
        },
    ],
    evidenceSessions: [
        {
            title: 'Crash/ANR outliers',
            description: 'Highest fatal stability impact sessions.',
            metric: 'stability',
            value: '6 crash sessions',
            sessionIds: ['demo-obs-001', 'demo-obs-002', 'demo-obs-003'],
        },
        {
            title: 'API degradation outliers',
            description: 'High latency or high API failure sessions.',
            metric: 'api',
            value: '0.92% API failure rate',
            sessionIds: ['demo-obs-004', 'demo-obs-005', 'demo-obs-006'],
        },
        {
            title: 'Frustration hotspots',
            description: 'Sessions with strong rage/dead tap signals.',
            metric: 'ux-friction',
            value: '3.10% friction sessions',
            sessionIds: ['demo-obs-007', 'demo-obs-008', 'demo-obs-009'],
        },
        {
            title: 'Slow startup evidence',
            description: 'Cold starts above 3 seconds.',
            metric: 'startup',
            value: '5.80% slow startup',
            sessionIds: ['demo-obs-010', 'demo-obs-011', 'demo-obs-012'],
        },
        {
            title: 'SDK upload pipeline failures',
            description: 'Sessions where ingestion reliability degraded.',
            metric: 'ingest',
            value: '12 sessions with upload failures',
            sessionIds: ['demo-obs-013', 'demo-obs-014', 'demo-obs-015'],
        },
    ],
};

// ================================================================================
// User Engagement Trends (unique users per segment per day)
// ================================================================================

const generateUserEngagementTrends = (): UserEngagementTrends => {
    const daily = [];
    const now = new Date(DEMO_NOW);
    let totalBouncers = 0, totalCasuals = 0, totalExplorers = 0, totalLoyalists = 0;

    for (let i = 29; i >= 0; i--) {
        const date = new Date(now);
        date.setDate(date.getDate() - i);
        const dateStr = date.toISOString().split('T')[0];
        const progress = (29 - i) / 29;
        const bouncers = Math.round(42 - progress * 15 + demoRandom() * 7);
        const casuals = Math.round(74 + progress * 44 + demoRandom() * 10);
        const explorers = Math.round(86 + progress * 76 + demoRandom() * 13);
        const loyalists = Math.round(32 + progress * 54 + demoRandom() * 9);
        totalBouncers += bouncers;
        totalCasuals += casuals;
        totalExplorers += explorers;
        totalLoyalists += loyalists;
        daily.push({ date: dateStr, bouncers, casuals, explorers, loyalists });
    }
    return {
        daily,
        totals: { bouncers: totalBouncers, casuals: totalCasuals, explorers: totalExplorers, loyalists: totalLoyalists }
    };
};

export const demoUserEngagementTrends: UserEngagementTrends = generateUserEngagementTrends();

// ================================================================================
// User Segments Summary (for UserSegments page)
// ================================================================================

export const demoUserSegmentsSummary: UserSegmentsSummary = {
    segments: [
        {
            name: 'Power Users',
            count: 1876,
            color: '#10b981',
            examples: ['user_power_001', 'user_loyal_007', 'user_premium_001'],
        },
        {
            name: 'Regular Users',
            count: 4567,
            color: '#3b82f6',
            examples: ['user_eu_034', 'user_asia_012', 'user_returning_022'],
        },
        {
            name: 'New Users',
            count: 3456,
            color: '#f59e0b',
            examples: ['user_new_042', 'user_searcher_055', 'user_abandoned_033'],
        },
        {
            name: 'At Risk',
            count: 2948,
            color: '#ef4444',
            examples: ['user_frustrated_088', 'user_crash_099', 'user_weekly_078'],
        },
    ],
    totalSessions: 12847,
};

// ================================================================================
// Region Performance (for API Analytics page)
// ================================================================================

export const demoRegionPerformance: RegionPerformance = {
    fastestRegions: [
        { code: 'JP', name: 'Japan', avgLatencyMs: 89, totalCalls: 23456, sessionCount: 987 },
        { code: 'US', name: 'United States', avgLatencyMs: 134, totalCalls: 156789, sessionCount: 6234 },
        { code: 'DE', name: 'Germany', avgLatencyMs: 156, totalCalls: 34567, sessionCount: 1245 },
        { code: 'GB', name: 'United Kingdom', avgLatencyMs: 178, totalCalls: 45678, sessionCount: 1876 },
        { code: 'CA', name: 'Canada', avgLatencyMs: 189, totalCalls: 23456, sessionCount: 756 },
    ],
    slowestRegions: [
        { code: 'IN', name: 'India', avgLatencyMs: 456, totalCalls: 12345, sessionCount: 432 },
        { code: 'BR', name: 'Brazil', avgLatencyMs: 387, totalCalls: 15678, sessionCount: 543 },
        { code: 'AU', name: 'Australia', avgLatencyMs: 298, totalCalls: 18765, sessionCount: 654 },
    ],
    allRegions: [
        { code: 'JP', name: 'Japan', avgLatencyMs: 89, totalCalls: 23456, sessionCount: 987 },
        { code: 'US', name: 'United States', avgLatencyMs: 134, totalCalls: 156789, sessionCount: 6234 },
        { code: 'DE', name: 'Germany', avgLatencyMs: 156, totalCalls: 34567, sessionCount: 1245 },
        { code: 'GB', name: 'United Kingdom', avgLatencyMs: 178, totalCalls: 45678, sessionCount: 1876 },
        { code: 'CA', name: 'Canada', avgLatencyMs: 189, totalCalls: 23456, sessionCount: 756 },
        { code: 'AU', name: 'Australia', avgLatencyMs: 298, totalCalls: 18765, sessionCount: 654 },
        { code: 'BR', name: 'Brazil', avgLatencyMs: 387, totalCalls: 15678, sessionCount: 543 },
        { code: 'IN', name: 'India', avgLatencyMs: 456, totalCalls: 12345, sessionCount: 432 },
    ],
};

// ================================================================================
// Team Billing Usage (for TopBar)
// ================================================================================

export const demoTeamUsage: TeamUsage = {
    sessionsUsed: 4567,
    sessionsCaptured: 8210,
    sessionReplaysUsed: 4567,
    sessionLimit: 10000,
    sessionReplayLimit: 10000,
    sessionsRemaining: 5433,
    sessionReplaysRemaining: 5433,
    percentUsed: 45.67,
    sessionReplayPercentUsed: 45.67,
    isAtLimit: false,
    isReplayAtLimit: false,
    isNearLimit: false,
    isReplayNearLimit: false,
};

// ================================================================================
// Friction Heatmap (for Overview)
// ================================================================================

export const demoFrictionHeatmap: FrictionHeatmap = {
    screens: [
        {
            name: 'Checkout',
            visits: 2345,
            rageTaps: 234,
            errors: 45,
            exitRate: 32,
            frictionScore: 48,
            sessionIds: ['demo-session-001', 'demo-session-002'],
            screenshotUrl: null,
            touchHotspots: [
                { x: 0.5, y: 0.85, intensity: 1.0, isRageTap: true },  // Submit button - rage taps
                { x: 0.5, y: 0.75, intensity: 0.7, isRageTap: true },  // Payment method area
                { x: 0.3, y: 0.4, intensity: 0.4, isRageTap: false },  // Form field
                { x: 0.7, y: 0.4, intensity: 0.3, isRageTap: false },  // Form field
                { x: 0.5, y: 0.15, intensity: 0.2, isRageTap: false }, // Back navigation
            ]
        },
        {
            name: 'Cart',
            visits: 4567,
            rageTaps: 156,
            errors: 23,
            exitRate: 21,
            frictionScore: 35,
            sessionIds: ['demo-session-003', 'demo-session-004'],
            screenshotUrl: null,
            touchHotspots: [
                { x: 0.5, y: 0.9, intensity: 0.9, isRageTap: true },   // Checkout button
                { x: 0.8, y: 0.35, intensity: 0.6, isRageTap: false },  // Quantity +
                { x: 0.2, y: 0.35, intensity: 0.5, isRageTap: false },  // Quantity -
                { x: 0.5, y: 0.5, intensity: 0.3, isRageTap: false },  // Cart item
                { x: 0.9, y: 0.25, intensity: 0.4, isRageTap: false },  // Remove item
            ]
        },
        {
            name: 'Product Detail',
            visits: 7456,
            rageTaps: 89,
            errors: 12,
            exitRate: 15,
            frictionScore: 22,
            sessionIds: ['demo-session-005', 'demo-session-006'],
            screenshotUrl: null,
            touchHotspots: [
                { x: 0.5, y: 0.9, intensity: 0.8, isRageTap: false },  // Add to cart
                { x: 0.5, y: 0.3, intensity: 0.7, isRageTap: false },  // Image gallery
                { x: 0.2, y: 0.5, intensity: 0.4, isRageTap: false },  // Size selector
                { x: 0.8, y: 0.5, intensity: 0.4, isRageTap: false },  // Color selector
                { x: 0.9, y: 0.15, intensity: 0.5, isRageTap: false }, // Wishlist heart
            ]
        },
        {
            name: 'Search',
            visits: 3456,
            rageTaps: 67,
            errors: 8,
            exitRate: 12,
            frictionScore: 18,
            sessionIds: ['demo-session-007', 'demo-session-008'],
            screenshotUrl: null,
            touchHotspots: [
                { x: 0.5, y: 0.08, intensity: 0.9, isRageTap: false }, // Search bar
                { x: 0.3, y: 0.25, intensity: 0.5, isRageTap: false }, // Filter
                { x: 0.7, y: 0.25, intensity: 0.5, isRageTap: false }, // Sort
                { x: 0.5, y: 0.45, intensity: 0.6, isRageTap: false }, // First result
                { x: 0.5, y: 0.65, intensity: 0.4, isRageTap: false }, // Second result
            ]
        },
        {
            name: 'Home',
            visits: 12847,
            rageTaps: 45,
            errors: 5,
            exitRate: 8,
            frictionScore: 12,
            sessionIds: ['demo-session-009', 'demo-session-010'],
            screenshotUrl: null,
            touchHotspots: [
                { x: 0.5, y: 0.35, intensity: 0.7, isRageTap: false }, // Hero banner
                { x: 0.25, y: 0.6, intensity: 0.5, isRageTap: false }, // Category 1
                { x: 0.75, y: 0.6, intensity: 0.5, isRageTap: false }, // Category 2
                { x: 0.5, y: 0.08, intensity: 0.4, isRageTap: false }, // Search icon
                { x: 0.9, y: 0.08, intensity: 0.3, isRageTap: false }, // Cart icon
            ]
        },
        {
            name: 'Profile',
            visits: 987,
            rageTaps: 34,
            errors: 3,
            exitRate: 6,
            frictionScore: 10,
            sessionIds: ['demo-session-011'],
            screenshotUrl: null,
            touchHotspots: [
                { x: 0.5, y: 0.25, intensity: 0.6, isRageTap: false }, // Profile photo
                { x: 0.5, y: 0.45, intensity: 0.4, isRageTap: false }, // Edit profile
                { x: 0.5, y: 0.6, intensity: 0.3, isRageTap: false },  // Orders link
                { x: 0.5, y: 0.75, intensity: 0.3, isRageTap: false }, // Settings link
            ]
        },
        {
            name: 'Settings',
            visits: 543,
            rageTaps: 23,
            errors: 2,
            exitRate: 5,
            frictionScore: 8,
            sessionIds: ['demo-session-012'],
            screenshotUrl: null,
            touchHotspots: [
                { x: 0.8, y: 0.25, intensity: 0.5, isRageTap: false }, // Toggle switch
                { x: 0.8, y: 0.4, intensity: 0.4, isRageTap: false },  // Toggle switch
                { x: 0.5, y: 0.55, intensity: 0.3, isRageTap: false }, // Privacy link
                { x: 0.5, y: 0.85, intensity: 0.6, isRageTap: true },  // Logout button
            ]
        },
        {
            name: 'Wishlist',
            visits: 1234,
            rageTaps: 18,
            errors: 1,
            exitRate: 4,
            frictionScore: 6,
            sessionIds: ['demo-session-013'],
            screenshotUrl: null,
            touchHotspots: [
                { x: 0.5, y: 0.35, intensity: 0.6, isRageTap: false }, // First item
                { x: 0.5, y: 0.55, intensity: 0.4, isRageTap: false }, // Second item
                { x: 0.85, y: 0.35, intensity: 0.3, isRageTap: false }, // Add to cart
            ]
        },
        {
            name: 'Order History',
            visits: 876,
            rageTaps: 12,
            errors: 1,
            exitRate: 3,
            frictionScore: 5,
            sessionIds: ['demo-session-014'],
            screenshotUrl: null,
            touchHotspots: [
                { x: 0.5, y: 0.3, intensity: 0.5, isRageTap: false },  // Recent order
                { x: 0.5, y: 0.5, intensity: 0.3, isRageTap: false },  // Older order
                { x: 0.8, y: 0.3, intensity: 0.4, isRageTap: false },  // Track order
            ]
        },
        {
            name: 'Notifications',
            visits: 654,
            rageTaps: 8,
            errors: 0,
            exitRate: 2,
            frictionScore: 3,
            sessionIds: ['demo-session-015'],
            screenshotUrl: null,
            touchHotspots: [
                { x: 0.5, y: 0.25, intensity: 0.4, isRageTap: false }, // Notification item
                { x: 0.5, y: 0.45, intensity: 0.3, isRageTap: false }, // Notification item
                { x: 0.9, y: 0.08, intensity: 0.2, isRageTap: false }, // Clear all
            ]
        },
    ],
};

// ================================================================================
// Detailed Session Data (for RecordingDetail page)
// ================================================================================

import { demoReplayFixture as existingDemoReplayFixture } from './demoReplayData';
import { demoReplayFixture as frankfurtDemoReplayFixture } from './demoReplayDataFrankfurt';
import { demoReplayFixture as webDemoReplayFixture } from './demoReplayDataWeb';
import { demoReplayFixture as videoDemoReplayFixture } from './demoReplayDataVideo';

const demoReplayFixtures: any[] = [videoDemoReplayFixture, webDemoReplayFixture, frankfurtDemoReplayFixture, existingDemoReplayFixture];
const defaultDemoReplayFixture =
    demoReplayFixtures.find((fixture) => fixture.sessionId === DEMO_FEATURED_SESSION_ID) ||
    videoDemoReplayFixture;

const buildDemoFullSession = (demoReplayFixture: any) => {
    const networkRequests = demoReplayFixture.networkRequests || [];
    const sessionEvents = demoReplayFixture.events || [];
    const replayMetadata = getDemoReplaySessionMetadata(demoReplayFixture.sessionId);
    const startupEvent = sessionEvents.find((event: any) => event.type === 'app_startup') as { durationMs?: number } | undefined;
    const appStartupTimeMs = Math.round(startupEvent?.durationMs ?? replayMetadata?.appStartupTimeMs ?? 0);
    const rawOs = String(demoReplayFixture.deviceInfo.os || '').toLowerCase();
    const platform = rawOs === 'android' ? 'android' : rawOs === 'ios' ? 'ios' : 'web';
    const playbackMode = demoReplayFixture.playbackMode === 'rrweb' ? 'rrweb' as const : 'screenshots' as const;
    const screenshotFrames = (demoReplayFixture.screenshotFrames || []).map((frame: any) => ({
        timestamp: frame.timestamp,
        url: `/demo/${demoReplayFixture.sessionId}/frames/${frame.file}`,
        index: frame.index,
    }));
    const identifiedUserId =
        demoReplayFixture.events.find((event: any) => event.type === 'user_identity_changed' && event.userId)?.userId ||
        replayMetadata?.userId ||
        'demo-user';
    const deadTapCount =
        demoReplayFixture.metrics.deadTapCount ??
        demoReplayFixture.events.filter((event: any) => event.frustrationKind === 'dead_tap').length;
    const explorationScore = demoReplayFixture.metrics.explorationScore ?? Math.min(100, 40 + demoReplayFixture.screensVisited.length * 5);
    const interactionScore = demoReplayFixture.metrics.interactionScore ?? Math.min(
        100,
        45 + Math.round((demoReplayFixture.metrics.touchCount + demoReplayFixture.metrics.gestureCount) / 5)
    );

    return {
        id: demoReplayFixture.sessionId,
        projectId: 'demo-project-001',
        userId: identifiedUserId,
        anonymousDisplayName: replayMetadata?.anonymousDisplayName,
        deviceId: replayMetadata?.deviceId,
        hasRecording: true,
        hasSuccessfulRecording: true,
        canOpenReplay: true,
        status: 'ready',
        effectiveStatus: 'ready',
        playbackMode,
        platform,
        appVersion: demoReplayFixture.deviceInfo.appVersion || '1.0.0',
        sdkVersion: demoReplayFixture.deviceInfo.sdkVersion || replayMetadata?.sdkVersion,
        deviceInfo: demoReplayFixture.deviceInfo,
        geoLocation: demoReplayFixture.geoLocation,
        webReferral: (replayMetadata?.metadata?.webReferral as string) || demoReplayFixture.webReferral || null,
        webLandingRoute: demoReplayFixture.webLandingRoute ?? (platform === 'web' ? '/' : null),
        metadata: replayMetadata?.metadata,
        startTime: demoReplayFixture.startTime,
        endTime: demoReplayFixture.endTime,
        duration: demoReplayFixture.durationSeconds,
        durationSeconds: demoReplayFixture.durationSeconds,
        appStartupTimeMs,
        networkType: demoReplayFixture.metrics.networkType || replayMetadata?.networkType || 'wifi',
        cellularGeneration: replayMetadata?.cellularGeneration,
        recordingDeleted: false,
        recordingDeletedAt: null,
        retentionDays: replayMetadata?.retentionDays,
        retentionTier: replayMetadata?.retentionTier,
        isFirstSession: replayMetadata?.isFirstSession,
        userFirstSeenAt: replayMetadata?.userFirstSeenAt,
        visitorSessionNumber: replayMetadata?.visitorSessionNumber,
        visitorFinalSessionNumber: replayMetadata?.visitorFinalSessionNumber,
        checkoutStatus: replayMetadata?.checkoutStatus,
        hierarchySnapshots: demoReplayFixture.hierarchySnapshots || [],
        screenshotFrames,
        screenshotFramesStatus: demoReplayFixture.screenshotFramesStatus || (playbackMode === 'rrweb' ? 'none' as const : 'ready' as const),
        screenshotFrameCount: demoReplayFixture.screenshotFrameCount || screenshotFrames.length,
        screenshotFramesProcessedSegments: demoReplayFixture.screenshotFramesProcessedSegments || 0,
        screenshotFramesTotalSegments: demoReplayFixture.screenshotFramesTotalSegments || 0,
        rrwebReplay: demoReplayFixture.rrwebReplay || { events: [], eventCount: 0, segments: [], page: null, viewport: null, loadMode: 'inline' as const },
        events: sessionEvents,
        networkRequests,
        batches: [],
        stats: demoReplayFixture.stats,
        metrics: {
            ...demoReplayFixture.metrics,
            rageTapCount: demoReplayFixture.metrics.rageTapCount ?? 0,
            deadTapCount,
            apiSuccessCount: networkRequests.filter((request: any) => request.success).length,
            apiErrorCount: networkRequests.filter((request: any) => !request.success).length,
            apiTotalCount: networkRequests.length,
            screensVisited: demoReplayFixture.screensVisited,
            uniqueScreensCount: demoReplayFixture.screensVisited.length,
            interactionScore,
            explorationScore,
            appStartupTimeMs,
        },
    };
};

export const demoFullSessionsById = Object.fromEntries(
    demoReplayFixtures.map((fixture) => [fixture.sessionId, buildDemoFullSession(fixture)])
) as Record<string, ReturnType<typeof buildDemoFullSession>>;

export const demoFullSession =
    demoFullSessionsById[DEMO_FEATURED_SESSION_ID] ||
    buildDemoFullSession(defaultDemoReplayFixture);

export const getDemoFullSession = (sessionId?: string) => (
    (sessionId ? demoFullSessionsById[sessionId] : null) ||
    demoFullSession
);

// ================================================================================
// Issues Data (for Issues Feed)
// ================================================================================

const demoUserIds = (prefix: string, count: number) =>
    Array.from({ length: count }, (_, index) => `${prefix}-user-${String(index + 1).padStart(3, '0')}`);

const demoStabilityLogs = (baseTime: string, area: string, issue: string, terminalEntry: string) => {
    const levels = ['INFO', 'DEBUG', 'TRACE', 'DEBUG', 'INFO', 'WARN'];
    const states = ['hydrating', 'normalizing', 'diffing', 'rendering', 'committing', 'observing'];
    const entries = Array.from({ length: 44 }, (_, index) => {
        const seconds = String((index * 3) % 60).padStart(2, '0');
        const millis = String(100 + ((index * 37) % 899)).padStart(3, '0');
        const level = levels[index % levels.length];
        const state = states[index % states.length];
        return `[${baseTime}:${seconds}.${millis}] ${level} ${area} issue=${issue} checkpoint=${String(index + 1).padStart(2, '0')} state=${state} requestId=req_demo_${String(index + 91).padStart(4, '0')} queueDepth=${(index % 9) + 1} payloadBytes=${1432 + index * 211} route="/checkout/summary?coupon=SPRING25&source=demo-fixture" viewState="cartSnapshot pendingPromotion normalizedTotals staleComponentBoundary retryBudget=${3 - (index % 3)}"`;
    });
    return [...entries, terminalEntry];
};

const demoLongStackFrames = (namespace: string, fileName: string, count: number = 38) =>
    Array.from(
        { length: count },
        (_, index) => `    at ${namespace}.diagnosticFrame${String(index + 1).padStart(2, '0')} (${fileName}:${120 + index}:${17 + (index % 9)})`
    ).join('\n');

const demoIssueItems: Issue[] = [
    {
        id: 'issue-crash-1',
        projectId: 'demo-project',
        fingerprint: 'crash-nsinvalidargument-checkout-total',
        issueType: 'crash',
        title: 'NSInvalidArgumentException',
        subtitle: 'CartTotalView recomputed a removed price node',
        culprit: 'CartTotalView.swift:88',
        status: 'unresolved',
        firstSeen: new Date(DEMO_NOW - 10 * day).toISOString(),
        lastSeen: new Date(DEMO_NOW - 18 * 60 * 1000).toISOString(),
        eventCount: 24,
        userCount: 18,
        events24h: 3,
        events90d: 71,
        sampleSessionId: 'demo-crash-session-001',
        sampleAppVersion: '2.5.0',
        affectedDevices: { 'iPhone 15 Pro': 10, 'iPhone 14': 7, 'iPhone 13': 4, 'iPad Pro 12.9"': 3 },
        affectedVersions: { '2.5.0': 13, '2.4.1': 8, '2.4.0': 3 },
    },
    {
        id: 'issue-crash-2',
        projectId: 'demo-project',
        fingerprint: 'crash-android-null-product-card',
        issueType: 'crash',
        title: 'NullPointerException',
        subtitle: 'ProductCardFragment.bindPrice(ProductCardFragment.kt:214)',
        culprit: 'ProductCardFragment.kt:214',
        status: 'unresolved',
        firstSeen: new Date(DEMO_NOW - 8 * day).toISOString(),
        lastSeen: new Date(DEMO_NOW - 41 * 60 * 1000).toISOString(),
        eventCount: 18,
        userCount: 14,
        events24h: 2,
        events90d: 48,
        sampleSessionId: 'demo-crash-session-002',
        sampleAppVersion: '2.5.0',
        affectedDevices: { 'Samsung Galaxy S24': 7, 'Pixel 8 Pro': 5, 'Samsung Galaxy S23': 4, 'OnePlus 12': 2 },
        affectedVersions: { '2.5.0': 10, '2.4.1': 6, '2.4.0': 2 },
    },
    {
        id: 'issue-crash-3',
        projectId: 'demo-project',
        fingerprint: 'crash-exc-bad-access-image-cache',
        issueType: 'crash',
        title: 'EXC_BAD_ACCESS KERN_INVALID_ADDRESS',
        subtitle: 'ImageCache.releaseSurface while replay thumbnail unloads',
        culprit: 'ImageCache.mm:143',
        status: 'ongoing',
        firstSeen: new Date(DEMO_NOW - 6 * day).toISOString(),
        lastSeen: new Date(DEMO_NOW - 64 * 60 * 1000).toISOString(),
        eventCount: 11,
        userCount: 9,
        events24h: 1,
        events90d: 33,
        sampleSessionId: 'demo-crash-session-003',
        sampleAppVersion: '2.4.1',
        affectedDevices: { 'iPhone 15 Pro': 5, 'iPhone 15': 3, 'iPhone 14': 2, 'iPad Pro 12.9"': 1 },
        affectedVersions: { '2.4.1': 7, '2.4.0': 4 },
    },
    {
        id: 'issue-anr-1',
        projectId: 'demo-project',
        fingerprint: 'anr-main-thread-checkout-shipping-rates',
        issueType: 'anr',
        title: 'Main thread blocked fetching shipping rates',
        subtitle: 'CheckoutActivity waits on /api/shipping/rates',
        culprit: 'CheckoutActivity.kt:332',
        status: 'ongoing',
        firstSeen: new Date(DEMO_NOW - 5 * day).toISOString(),
        lastSeen: new Date(DEMO_NOW - 22 * 60 * 1000).toISOString(),
        eventCount: 15,
        userCount: 12,
        events24h: 2,
        events90d: 39,
        sampleSessionId: 'demo-anr-session-001',
        sampleAppVersion: '2.5.0',
        affectedDevices: { 'Samsung Galaxy S24': 6, 'Pixel 8 Pro': 4, 'Samsung Galaxy S23': 3, 'Pixel 7': 2 },
        affectedVersions: { '2.5.0': 9, '2.4.1': 6 },
    },
    {
        id: 'issue-anr-2',
        projectId: 'demo-project',
        fingerprint: 'anr-ios-main-thread-image-decode',
        issueType: 'anr',
        title: 'Main thread blocked decoding collection images',
        subtitle: 'HomeFeedViewController renders 24 oversized tiles',
        culprit: 'HomeFeedViewController.swift:411',
        status: 'unresolved',
        firstSeen: new Date(DEMO_NOW - 4 * day).toISOString(),
        lastSeen: new Date(DEMO_NOW - 57 * 60 * 1000).toISOString(),
        eventCount: 9,
        userCount: 7,
        events24h: 1,
        events90d: 24,
        sampleSessionId: 'demo-anr-session-002',
        sampleAppVersion: '2.4.1',
        affectedDevices: { 'iPhone 14': 4, 'iPhone 13': 2, 'iPhone 15 Pro': 2, 'iPad Pro 12.9"': 1 },
        affectedVersions: { '2.4.1': 6, '2.4.0': 3 },
    },
    {
        id: 'issue-error-1',
        projectId: 'demo-project',
        fingerprint: 'error-checkout-lineitems-undefined',
        issueType: 'error',
        title: 'TypeError',
        subtitle: 'Cannot read properties of undefined (reading "lineItems")',
        culprit: 'CheckoutSummary.tsx:74',
        status: 'unresolved',
        firstSeen: new Date(DEMO_NOW - 7 * day).toISOString(),
        lastSeen: new Date(DEMO_NOW - 12 * 60 * 1000).toISOString(),
        eventCount: 68,
        userCount: 42,
        events24h: 8,
        events90d: 196,
        sampleSessionId: 'demo-error-session-001',
        sampleAppVersion: 'web-2026.05.1',
        affectedDevices: { 'Chrome on Windows': 25, 'Safari on iPhone': 17, 'Chrome on macOS': 15, 'Firefox on Linux': 11 },
        affectedVersions: { 'web-2026.05.1': 41, 'web-2026.05.0': 27 },
    },
    {
        id: 'issue-error-2',
        projectId: 'demo-project',
        fingerprint: 'error-payment-intent-rejected',
        issueType: 'error',
        title: 'PaymentIntentError',
        subtitle: 'Payment validation rejected stale cart token',
        culprit: 'PaymentSheet.tsx:188',
        status: 'ongoing',
        firstSeen: new Date(DEMO_NOW - 5 * day).toISOString(),
        lastSeen: new Date(DEMO_NOW - 31 * 60 * 1000).toISOString(),
        eventCount: 41,
        userCount: 29,
        events24h: 5,
        events90d: 128,
        sampleSessionId: 'demo-error-session-002',
        sampleAppVersion: 'web-2026.05.1',
        affectedDevices: { 'Chrome on Android': 15, 'Safari on iPhone': 12, 'Chrome on Windows': 8, 'Chrome on macOS': 6 },
        affectedVersions: { 'web-2026.05.1': 28, 'web-2026.05.0': 13 },
    },
    {
        id: 'issue-error-3',
        projectId: 'demo-project',
        fingerprint: 'error-inventory-promise-rejection',
        issueType: 'error',
        title: 'Unhandled Promise Rejection',
        subtitle: 'Inventory refresh timed out after product variant change',
        culprit: 'InventoryClient.ts:129',
        status: 'unresolved',
        firstSeen: new Date(DEMO_NOW - 3 * day).toISOString(),
        lastSeen: new Date(DEMO_NOW - 45 * 60 * 1000).toISOString(),
        eventCount: 37,
        userCount: 25,
        events24h: 4,
        events90d: 104,
        sampleSessionId: 'demo-error-session-003',
        sampleAppVersion: 'web-2026.05.0',
        affectedDevices: { 'Chrome on Windows': 14, 'Edge on Windows': 9, 'Chrome on Android': 8, 'Safari on iPhone': 6 },
        affectedVersions: { 'web-2026.05.0': 23, 'web-2026.04.2': 14 },
    },
    {
        id: 'issue-rage-1',
        projectId: 'demo-project',
        fingerprint: 'rage-tap-checkout-button',
        issueType: 'rage_tap',
        title: 'Rage Taps on "Checkout" button',
        subtitle: 'CartScreen',
        status: 'ongoing',
        firstSeen: new Date(DEMO_NOW - 1 * day).toISOString(),
        lastSeen: new Date(DEMO_NOW).toISOString(),
        eventCount: 22,
        userCount: 17,
        events24h: 3,
        events90d: 64,
        sampleSessionId: 'demo-err-001',
    },
];

export const demoIssuesResponse: { issues: Issue[], stats: any, total: number } = {
    issues: demoIssueItems,
    stats: {
        totalIssues: demoIssueItems.length,
        unresolvedCount: demoIssueItems.filter((issue) => issue.status === 'unresolved').length,
        ongoingCount: demoIssueItems.filter((issue) => issue.status === 'ongoing').length,
        resolvedCount: demoIssueItems.filter((issue) => issue.status === 'resolved').length,
    },
    total: demoIssueItems.length,
};

export const demoIssueSessions: IssueSession[] = [
    {
        id: 'session-1',
        deviceModel: 'iPhone 14 Pro',
        platform: 'ios',
        durationSeconds: 145,
        createdAt: new Date(DEMO_NOW - 10 * 60 * 1000).toISOString(),
        coverPhotoUrl: null,
    },
    {
        id: 'session-2',
        deviceModel: 'Pixel 7',
        platform: 'android',
        durationSeconds: 234,
        createdAt: new Date(DEMO_NOW - 25 * 60 * 1000).toISOString(),
        coverPhotoUrl: null,
    },
];

// ================================================================================
// Issue Detection / Leaks Demo Data
// ================================================================================

export const demoLeakContextMarkdown = `# Checkout coupon validation leak

## Why it matters
Users can reach checkout with an invalid coupon state. The replay shows repeated failed validation calls followed by checkout abandonment.

## Evidence
- 14 affected sessions in the last 24 hours
- 9 users hit a visible validation loop
- Top replay includes rage taps on the checkout CTA and repeated 409 responses

## Likely cause
The checkout form keeps stale coupon state after the cart total recalculates.

## IDE handoff
Use this markdown as the full investigation packet. Paste it into the selected IDE agent so it can inspect the local repository and decide which files need changes.

## Suggested fix
Clear coupon validation state whenever cart line items or total change, then rerun validation once before payment submission.`;

export const demoLeaksResponse = {
    leaks: [
        {
            id: 'demo-leak-ready-checkout-coupon',
            shortId: 'LEAK-101',
            projectId: 'demo-project-001',
            title: 'Users are giving up zooming into the product image',
            status: 'ready',
            severity: 'high',
            issueType: 'ux_friction',
            whyItMatters: 'Leak Detected: Opportunity +$179. Affecting 15 users across all platforms.',
            affectedSessionsCount: 22,
            affectedUsersCount: 15,
            firstSeenAt: new Date(DEMO_NOW - 26 * 60 * 60 * 1000).toISOString(),
            lastSeenAt: new Date(DEMO_NOW - 42 * 60 * 1000).toISOString(),
            estimatedCostUsd: 179.0,
            estimatedAffectedUsersPercent: 92.5,
            contextStatus: 'ready',
            topSignals: ['session_replay', 'dead_tap', 'abandonment'],
        },
        {
            id: 'demo-leak-researching-tour-selector',
            shortId: 'LEAK-102',
            projectId: 'demo-project-001',
            title: 'Product tour selector misses target on settings page',
            status: 'researching',
            severity: 'medium',
            issueType: 'session_problem_cluster',
            whyItMatters: 'New users get stuck in onboarding because the tour waits for an element that is not rendered.',
            affectedSessionsCount: 7,
            affectedUsersCount: 6,
            firstSeenAt: new Date(DEMO_NOW - 12 * 60 * 60 * 1000).toISOString(),
            lastSeenAt: new Date(DEMO_NOW - 18 * 60 * 1000).toISOString(),
            estimatedCostUsd: 0.21,
            estimatedAffectedUsersPercent: 62.1,
            contextStatus: 'running',
            topSignals: ['session_segment_cluster', 'dead_tap', 'abandonment'],
        },
        {
            id: 'demo-leak-queued-inventory',
            shortId: 'LEAK-103',
            projectId: 'demo-project-001',
            title: 'Inventory badge flickers between in-stock and unavailable',
            status: 'queued',
            severity: 'medium',
            issueType: 'stuck_loop',
            whyItMatters: 'Product detail sessions show repeated visual churn around inventory state before users leave.',
            affectedSessionsCount: 5,
            affectedUsersCount: 4,
            firstSeenAt: new Date(DEMO_NOW - 8 * 60 * 60 * 1000).toISOString(),
            lastSeenAt: new Date(DEMO_NOW - 25 * 60 * 1000).toISOString(),
            estimatedCostUsd: 0.15,
            estimatedAffectedUsersPercent: 45.3,
            contextStatus: 'queued',
            topSignals: ['visual_loop', 'api_latency', 'session_replay'],
        },
        {
            id: 'demo-leak-budget-search',
            shortId: 'LEAK-104',
            projectId: 'demo-project-001',
            title: 'Search results blank screen needs next budget window',
            status: 'budget_exhausted',
            severity: 'low',
            issueType: 'budget_guard',
            whyItMatters: 'The candidate ranked high, but the project reached the daily analysis cap before this session could be analyzed.',
            affectedSessionsCount: 3,
            affectedUsersCount: 3,
            firstSeenAt: new Date(DEMO_NOW - 5 * 60 * 60 * 1000).toISOString(),
            lastSeenAt: new Date(DEMO_NOW - 66 * 60 * 1000).toISOString(),
            estimatedCostUsd: 0.0,
            estimatedAffectedUsersPercent: 30.0,
            contextStatus: 'budget_exhausted',
            topSignals: ['blank_screen', 'api_error', 'budget_cap'],
        },
        {
            id: 'demo-leak-resolved-profile',
            shortId: 'LEAK-088',
            projectId: 'demo-project-001',
            title: 'Profile save spinner did not clear after timeout',
            status: 'resolved',
            severity: 'medium',
            issueType: 'non_blocking_failure',
            whyItMatters: 'Resolved example: affected sessions stopped after clearing the save mutation timeout state.',
            affectedSessionsCount: 11,
            affectedUsersCount: 8,
            firstSeenAt: new Date(DEMO_NOW - 7 * 24 * 60 * 60 * 1000).toISOString(),
            lastSeenAt: new Date(DEMO_NOW - 3 * 24 * 60 * 60 * 1000).toISOString(),
            estimatedCostUsd: 0.0,
            estimatedAffectedUsersPercent: 15.0,
            contextStatus: 'ready',
            topSignals: ['session_replay', 'timeout', 'resolved'],
        },
    ],
    stats: {
        total: 5,
        ready: 1,
        queued: 1,
        researching: 1,
        budgetExhausted: 1,
        resolved: 1,
    },
    nextCursor: null,
};

export const demoLeakDetails = demoLeaksResponse.leaks.map((leak) => ({
    ...leak,
    evidenceGroups: [
        {
            label: 'Session signals',
            signals: leak.topSignals.map((signal, index) => ({
                id: `${leak.id}-signal-${index}`,
                label: signal,
                weight: index === 0 ? 1 : 0.6,
                summary: `${signal.replace(/_/g, ' ')} contributed to the leak ranking.`,
            })),
        },
    ],
    sessions: leak.id === 'demo-leak-ready-checkout-coupon'
        ? [{
            id: 'session_1779280282320_047794570aa44c92896290d6677ce0d1',
            startedAt: new Date(DEMO_NOW - 45 * 60 * 1000).toISOString(),
            replayUrl: `/demo/sessions/session_1779280282320_047794570aa44c92896290d6677ce0d1`,
            signalScore: 12,
        }]
        : DEMO_REPLAY_SESSION_IDS.slice(0, Math.max(1, Math.min(3, leak.affectedSessionsCount))).map((sessionId, index) => ({
            id: sessionId,
            startedAt: new Date(DEMO_NOW - (index + 1) * 45 * 60 * 1000).toISOString(),
            replayUrl: `/demo/sessions/${sessionId}`,
            signalScore: 12 - index * 2,
        })),
    codePointers: [],
    contextMarkdown: leak.contextStatus === 'ready' ? demoLeakContextMarkdown : null,
    contextMarkdownUrl: `/api/automations/leaks/${leak.id}/context/raw.md`,
}));

// ================================================================================
// Crashes, Errors & ANRs (for Stability pages)
// ================================================================================

const demoCrashOverviewGroups = [
    {
        id: 'crash-group-nsinvalidargument-checkout-total',
        name: 'NSInvalidArgumentException',
        sampleCrashId: 'crash-nsinvalidargument-checkout-total',
        sampleSessionId: 'demo-crash-session-001',
        count: 312,
        users: demoUserIds('crash-checkout-total', 184),
        firstSeen: new Date(DEMO_NOW - 10 * day).toISOString(),
        lastOccurred: new Date(DEMO_NOW - 18 * 60 * 1000).toISOString(),
        affectedDevices: { 'iPhone 15 Pro': 132, 'iPhone 14': 92, 'iPhone 13': 50, 'iPad Pro 12.9"': 38 },
        affectedVersions: { '2.5.0': 171, '2.4.1': 96, '2.4.0': 45 },
        platform: 'ios',
        logs: demoStabilityLogs(
            '19:41',
            'CheckoutCoordinator',
            'promotion-total-null-line-items',
            '[19:41:52.226] ERROR NSInvalidArgumentException selector=lineItems screen=Checkout cartId=cart_8f21'
        ),
    },
    {
        id: 'crash-group-android-null-product-card',
        name: 'NullPointerException',
        sampleCrashId: 'crash-android-null-product-card',
        sampleSessionId: 'demo-crash-session-002',
        count: 228,
        users: demoUserIds('crash-null-card', 137),
        firstSeen: new Date(DEMO_NOW - 8 * day).toISOString(),
        lastOccurred: new Date(DEMO_NOW - 41 * 60 * 1000).toISOString(),
        affectedDevices: { 'Samsung Galaxy S24': 88, 'Pixel 8 Pro': 61, 'Samsung Galaxy S23': 49, 'OnePlus 12': 30 },
        affectedVersions: { '2.5.0': 119, '2.4.1': 79, '2.4.0': 30 },
        platform: 'android',
        logs: demoStabilityLogs(
            '19:18',
            'ProductCardFragment',
            'null-price-display-string',
            '[19:18:09.470] ERROR NullPointerException ProductCardFragment.kt:214 sku=JK-481 variant=midnight'
        ),
    },
    {
        id: 'crash-group-exc-bad-access-image-cache',
        name: 'EXC_BAD_ACCESS KERN_INVALID_ADDRESS',
        sampleCrashId: 'crash-exc-bad-access-image-cache',
        sampleSessionId: 'demo-crash-session-003',
        count: 176,
        users: demoUserIds('crash-image-cache', 112),
        firstSeen: new Date(DEMO_NOW - 6 * day).toISOString(),
        lastOccurred: new Date(DEMO_NOW - 64 * 60 * 1000).toISOString(),
        affectedDevices: { 'iPhone 15 Pro': 72, 'iPhone 15': 44, 'iPhone 14': 39, 'iPad Pro 12.9"': 21 },
        affectedVersions: { '2.4.1': 101, '2.4.0': 75 },
        platform: 'ios',
        logs: demoStabilityLogs(
            '18:55',
            'ReplayThumbnailCell',
            'released-surface-during-draw',
            '[18:55:31.019] ERROR EXC_BAD_ACCESS address=0x0000000000000018 key=hero_tile_12 refCount=0'
        ),
    },
    {
        id: 'crash-group-sigabrt-collection-mutated',
        name: 'SIGABRT Collection was mutated while being enumerated',
        sampleCrashId: 'crash-sigabrt-collection-mutated',
        sampleSessionId: 'demo-crash-session-004',
        count: 143,
        users: demoUserIds('crash-collection-mutated', 88),
        firstSeen: new Date(DEMO_NOW - 5 * day).toISOString(),
        lastOccurred: new Date(DEMO_NOW - 2 * 60 * 60 * 1000).toISOString(),
        affectedDevices: { 'iPhone 14': 57, 'iPhone 13': 36, 'iPhone 15': 29, 'iPhone 12': 21 },
        affectedVersions: { '2.4.1': 84, '2.4.0': 59 },
        platform: 'ios',
    },
    {
        id: 'crash-group-kotlin-lateinit-session',
        name: 'UninitializedPropertyAccessException',
        sampleCrashId: 'crash-kotlin-lateinit-session',
        sampleSessionId: 'demo-crash-session-005',
        count: 118,
        users: demoUserIds('crash-lateinit-session', 76),
        firstSeen: new Date(DEMO_NOW - 4 * day).toISOString(),
        lastOccurred: new Date(DEMO_NOW - 3 * 60 * 60 * 1000).toISOString(),
        affectedDevices: { 'Samsung Galaxy S23': 42, 'Samsung Galaxy S24': 31, 'Pixel 8 Pro': 27, 'Pixel 7': 18 },
        affectedVersions: { '2.5.0': 67, '2.4.1': 51 },
        platform: 'android',
    },
    {
        id: 'crash-group-index-out-of-bounds-carousel',
        name: 'IndexOutOfBoundsException',
        sampleCrashId: 'crash-index-out-of-bounds-carousel',
        sampleSessionId: 'demo-crash-session-006',
        count: 96,
        users: demoUserIds('crash-carousel-index', 61),
        firstSeen: new Date(DEMO_NOW - 3 * day).toISOString(),
        lastOccurred: new Date(DEMO_NOW - 4 * 60 * 60 * 1000).toISOString(),
        affectedDevices: { 'Pixel 8 Pro': 34, 'Samsung Galaxy S24': 28, 'OnePlus 12': 21, 'Samsung Galaxy S23': 13 },
        affectedVersions: { '2.5.0': 62, '2.4.1': 34 },
        platform: 'android',
    },
    {
        id: 'crash-group-swift-decoding-corrupted',
        name: 'DecodingError.dataCorrupted',
        sampleCrashId: 'crash-swift-decoding-corrupted',
        sampleSessionId: 'demo-crash-session-007',
        count: 74,
        users: demoUserIds('crash-decoding-corrupted', 49),
        firstSeen: new Date(DEMO_NOW - 2 * day).toISOString(),
        lastOccurred: new Date(DEMO_NOW - 5 * 60 * 60 * 1000).toISOString(),
        affectedDevices: { 'iPhone 15 Pro': 29, 'iPhone 14': 25, 'iPhone 13': 20 },
        affectedVersions: { '2.5.0': 43, '2.4.1': 31 },
        platform: 'ios',
    },
    {
        id: 'crash-group-react-native-fatal-bridge',
        name: 'ReactNativeFatalException',
        sampleCrashId: 'crash-react-native-fatal-bridge',
        sampleSessionId: 'demo-crash-session-008',
        count: 58,
        users: demoUserIds('crash-rn-bridge', 37),
        firstSeen: new Date(DEMO_NOW - day).toISOString(),
        lastOccurred: new Date(DEMO_NOW - 7 * 60 * 60 * 1000).toISOString(),
        affectedDevices: { 'iPhone 15 Pro': 21, 'Pixel 8 Pro': 18, 'Samsung Galaxy S24': 12, 'iPhone 14': 7 },
        affectedVersions: { '2.5.0': 39, '2.4.1': 19 },
        platform: 'mobile',
    },
];

export const demoCrashReports: any[] = [
    {
        id: 'crash-nsinvalidargument-checkout-total',
        sessionId: 'demo-crash-session-001',
        projectId: 'demo-project',
        timestamp: new Date(DEMO_NOW - 18 * 60 * 1000).toISOString(),
        exceptionName: 'NSInvalidArgumentException',
        reason: '-[__NSCFNumber lineItems]: unrecognized selector sent to instance while recalculating checkout totals',
        status: 'new',
        occurrenceCount: 312,
        deviceMetadata: { model: 'iPhone 15 Pro', systemName: 'iOS', systemVersion: '18.1', appVersion: '2.5.0', freeMemory: 178257920, orientation: 'portrait', platform: 'ios' },
        stackTrace: `Fatal Exception: NSInvalidArgumentException
0   CoreFoundation                 0x0000000184a2e12c __exceptionPreprocess
1   libobjc.A.dylib                0x0000000181d3fabc objc_exception_throw
2   CoreFoundation                 0x0000000184b281dc -[NSObject(NSObject) doesNotRecognizeSelector:]
3   RejourneyDemo                  0x0000000102f84a18 CartTotalView.recalculateTotals() + 88
4   RejourneyDemo                  0x0000000102f83ef0 CheckoutViewController.refreshSummary() + 214
5   RejourneyDemo                  0x0000000102f80d74 CheckoutCoordinator.applyPromotion(_:) + 119
6   UIKitCore                      0x0000000188cf6c90 -[UIApplication sendAction:to:from:forEvent:]
${demoLongStackFrames('CheckoutRecoveryPipeline', 'CheckoutRecoveryPipeline.swift', 42)}`,
    },
    {
        id: 'crash-android-null-product-card',
        sessionId: 'demo-crash-session-002',
        projectId: 'demo-project',
        timestamp: new Date(DEMO_NOW - 41 * 60 * 1000).toISOString(),
        exceptionName: 'NullPointerException',
        reason: 'Attempt to invoke virtual method Money.toDisplayString() on a null price',
        status: 'new',
        occurrenceCount: 228,
        deviceMetadata: { model: 'Samsung Galaxy S24', systemName: 'Android', systemVersion: '14', osVersion: 'Android 14', appVersion: '2.5.0', freeMemory: 251658240, orientation: 'portrait', platform: 'android' },
        stackTrace: `Fatal Exception: java.lang.NullPointerException
    at com.rejourney.demo.product.ProductCardFragment.bindPrice(ProductCardFragment.kt:214)
    at com.rejourney.demo.product.ProductCardFragment.bind(ProductCardFragment.kt:166)
    at com.rejourney.demo.collections.CollectionAdapter.onBindViewHolder(CollectionAdapter.kt:87)
    at androidx.recyclerview.widget.RecyclerView$Adapter.bindViewHolder(RecyclerView.java:7847)
    at androidx.recyclerview.widget.RecyclerView$Recycler.tryBindViewHolderByDeadline(RecyclerView.java:6646)
    at android.os.Looper.loopOnce(Looper.java:226)
    at android.app.ActivityThread.main(ActivityThread.java:8910)`,
    },
    {
        id: 'crash-exc-bad-access-image-cache',
        sessionId: 'demo-crash-session-003',
        projectId: 'demo-project',
        timestamp: new Date(DEMO_NOW - 64 * 60 * 1000).toISOString(),
        exceptionName: 'EXC_BAD_ACCESS KERN_INVALID_ADDRESS',
        reason: 'ImageCache released a thumbnail surface while the replay preview was still drawing',
        status: 'investigating',
        occurrenceCount: 176,
        deviceMetadata: { model: 'iPhone 15 Pro', systemName: 'iOS', systemVersion: '18.0', appVersion: '2.4.1', freeMemory: 96468992, orientation: 'landscape', platform: 'ios' },
        stackTrace: `Exception Type: EXC_BAD_ACCESS (SIGSEGV)
Exception Subtype: KERN_INVALID_ADDRESS at 0x0000000000000018
0   RejourneyDemo                  0x00000001031112a4 ImageCache.releaseSurface(_:) + 143
1   RejourneyDemo                  0x0000000103110ef8 ReplayThumbnailCell.prepareForReuse() + 52
2   UIKitCore                      0x00000001892c41c8 -[UICollectionView _createPreparedCellForItemAtIndexPath:]
3   UIKitCore                      0x00000001892c6cd0 -[UICollectionView _updateVisibleCellsNow:]
4   QuartzCore                     0x000000018831571c CA::Transaction::commit()`,
    },
    {
        id: 'crash-sigabrt-collection-mutated',
        sessionId: 'demo-crash-session-004',
        projectId: 'demo-project',
        timestamp: new Date(DEMO_NOW - 2 * 60 * 60 * 1000).toISOString(),
        exceptionName: 'SIGABRT',
        reason: 'Collection was mutated while being enumerated during saved-items sync',
        status: 'investigating',
        occurrenceCount: 143,
        deviceMetadata: { model: 'iPhone 14', systemName: 'iOS', systemVersion: '17.6', appVersion: '2.4.1', freeMemory: 132120576, orientation: 'portrait', platform: 'ios' },
        stackTrace: `Fatal Exception: NSGenericException
0   CoreFoundation                 0x0000000184a2e12c __exceptionPreprocess
1   libobjc.A.dylib                0x0000000181d3fabc objc_exception_throw
2   CoreFoundation                 0x0000000184a50b8c __NSFastEnumerationMutationHandler
3   RejourneyDemo                  0x0000000102f549b0 SavedItemsStore.mergeRemoteChanges(_:) + 201
4   RejourneyDemo                  0x0000000102f52a08 WishlistSyncOperation.main() + 77`,
    },
    {
        id: 'crash-kotlin-lateinit-session',
        sessionId: 'demo-crash-session-005',
        projectId: 'demo-project',
        timestamp: new Date(DEMO_NOW - 3 * 60 * 60 * 1000).toISOString(),
        exceptionName: 'UninitializedPropertyAccessException',
        reason: 'lateinit property sessionRecorder has not been initialized',
        status: 'new',
        occurrenceCount: 118,
        deviceMetadata: { model: 'Samsung Galaxy S23', systemName: 'Android', systemVersion: '14', osVersion: 'Android 14', appVersion: '2.5.0', freeMemory: 188743680, orientation: 'portrait', platform: 'android' },
        stackTrace: `Fatal Exception: kotlin.UninitializedPropertyAccessException
    lateinit property sessionRecorder has not been initialized
    at com.rejourney.demo.SessionBridge.getSessionRecorder(SessionBridge.kt:39)
    at com.rejourney.demo.checkout.CheckoutActivity.onCreate(CheckoutActivity.kt:121)
    at android.app.Activity.performCreate(Activity.java:8595)
    at android.app.ActivityThread.performLaunchActivity(ActivityThread.java:4091)
    at android.app.ActivityThread.handleLaunchActivity(ActivityThread.java:4258)`,
    },
    {
        id: 'crash-index-out-of-bounds-carousel',
        sessionId: 'demo-crash-session-006',
        projectId: 'demo-project',
        timestamp: new Date(DEMO_NOW - 4 * 60 * 60 * 1000).toISOString(),
        exceptionName: 'IndexOutOfBoundsException',
        reason: 'Index 6 out of bounds for length 6 after carousel diff update',
        status: 'new',
        occurrenceCount: 96,
        deviceMetadata: { model: 'Pixel 8 Pro', systemName: 'Android', systemVersion: '15', osVersion: 'Android 15', appVersion: '2.5.0', freeMemory: 222298112, orientation: 'portrait', platform: 'android' },
        stackTrace: `Fatal Exception: java.lang.IndexOutOfBoundsException
    Index 6 out of bounds for length 6
    at java.util.ArrayList.get(ArrayList.java:437)
    at com.rejourney.demo.home.HeroCarouselAdapter.onBindViewHolder(HeroCarouselAdapter.kt:72)
    at androidx.recyclerview.widget.RecyclerView$Adapter.bindViewHolder(RecyclerView.java:7847)
    at androidx.recyclerview.widget.GapWorker.prefetchPositionWithDeadline(GapWorker.java:288)`,
    },
    {
        id: 'crash-swift-decoding-corrupted',
        sessionId: 'demo-crash-session-007',
        projectId: 'demo-project',
        timestamp: new Date(DEMO_NOW - 5 * 60 * 60 * 1000).toISOString(),
        exceptionName: 'DecodingError.dataCorrupted',
        reason: 'Product recommendations payload contained an invalid ISO-8601 timestamp',
        status: 'new',
        occurrenceCount: 74,
        deviceMetadata: { model: 'iPhone 15 Pro', systemName: 'iOS', systemVersion: '18.1', appVersion: '2.5.0', freeMemory: 151519232, orientation: 'portrait', platform: 'ios' },
        stackTrace: `Fatal error: DecodingError.dataCorrupted
0   RejourneyDemo                  0x0000000102f7369c RecommendationsClient.decodeResponse(_:) + 99
1   RejourneyDemo                  0x0000000102f71a4c RecommendationsClient.fetchNextBatch() + 152
2   RejourneyDemo                  0x0000000102f24d10 ProductDetailViewModel.loadRecommendations() + 67
3   libswift_Concurrency.dylib     0x00000001a0bb1f44 completeTaskWithClosure(swift::AsyncContext*)`,
    },
    {
        id: 'crash-react-native-fatal-bridge',
        sessionId: 'demo-crash-session-008',
        projectId: 'demo-project',
        timestamp: new Date(DEMO_NOW - 7 * 60 * 60 * 1000).toISOString(),
        exceptionName: 'ReactNativeFatalException',
        reason: 'Malformed native payload passed through CheckoutBridge.applyDiscount',
        status: 'investigating',
        occurrenceCount: 58,
        deviceMetadata: { model: 'Pixel 8 Pro', systemName: 'Android', systemVersion: '15', osVersion: 'Android 15', appVersion: '2.5.0', freeMemory: 201326592, orientation: 'portrait', platform: 'android' },
        stackTrace: `Fatal Exception: com.facebook.react.common.JavascriptException
    TypeError: Cannot convert undefined value to object
    at applyDiscount (CheckoutBridge.ts:44:21)
    at onPress (PromoCodeSheet.tsx:109:18)
    at _performTransitionSideEffects (Pressability.js:757:18)
    at com.facebook.react.modules.core.ExceptionsManagerModule.reportFatalException(ExceptionsManagerModule.java:88)`,
    },
];

export const demoCrashesOverview: any = {
    groups: demoCrashOverviewGroups,
    summary: {
        issues: demoCrashOverviewGroups.length,
        events: demoCrashOverviewGroups.reduce((sum, group) => sum + group.count, 0),
        users: demoCrashOverviewGroups.reduce((sum, group) => sum + group.users.length, 0),
    },
    truncated: false,
};

const demoErrorRecords = [
    {
        id: 'err-checkout-lineitems',
        sessionId: 'demo-error-session-001',
        projectId: 'demo-project',
        timestamp: new Date(DEMO_NOW - 12 * 60 * 1000).toISOString(),
        firstSeen: new Date(DEMO_NOW - 7 * day).toISOString(),
        lastSeen: new Date(DEMO_NOW - 12 * 60 * 1000).toISOString(),
        errorType: 'js_error',
        errorName: 'TypeError',
        message: 'Cannot read properties of undefined (reading "lineItems")',
        stack: `TypeError: Cannot read properties of undefined (reading 'lineItems')
    at CheckoutSummary (CheckoutSummary.tsx:74:31)
    at renderWithHooks (react-dom.development.js:16305:18)
    at updateFunctionComponent (react-dom.development.js:19588:20)
    at beginWork (react-dom.development.js:21601:16)
    at performUnitOfWork (react-dom.development.js:26557:12)
    at workLoopSync (react-dom.development.js:26466:5)
${demoLongStackFrames('CheckoutRenderGuard', 'CheckoutRenderGuard.tsx', 40)}`,
        screenName: 'Checkout',
        deviceModel: 'Chrome on Windows',
        osVersion: 'Windows 11',
        appVersion: 'web-2026.05.1',
        fingerprint: 'error-checkout-lineitems-undefined',
        status: 'open',
        createdAt: new Date(DEMO_NOW - 7 * day).toISOString(),
        platform: 'web',
        occurrenceCount: 684,
        userCount: 321,
        affectedDevices: { 'Chrome on Windows': 253, 'Safari on iPhone': 176, 'Chrome on macOS': 152, 'Firefox on Linux': 103 },
        affectedVersions: { 'web-2026.05.1': 411, 'web-2026.05.0': 273 },
        logs: demoStabilityLogs(
            '20:05',
            'CheckoutSummary',
            'undefined-line-items',
            '[20:05:11.096] ERROR TypeError Cannot read properties of undefined (reading "lineItems") cartId=web_cart_442'
        ),
    },
    {
        id: 'err-payment-intent',
        sessionId: 'demo-error-session-002',
        projectId: 'demo-project',
        timestamp: new Date(DEMO_NOW - 31 * 60 * 1000).toISOString(),
        firstSeen: new Date(DEMO_NOW - 5 * day).toISOString(),
        lastSeen: new Date(DEMO_NOW - 31 * 60 * 1000).toISOString(),
        errorType: 'unhandled_exception',
        errorName: 'PaymentIntentError',
        message: 'Payment validation rejected stale cart token',
        stack: `PaymentIntentError: Payment validation rejected stale cart token
    at confirmPaymentIntent (PaymentSheet.tsx:188:17)
    at async submitCheckout (CheckoutForm.tsx:241:9)
    at async onSubmit (CheckoutForm.tsx:318:5)
    at async HTMLFormElement.dispatchSubmit (forms.ts:42:13)`,
        screenName: 'Payment',
        deviceModel: 'Safari on iPhone',
        osVersion: 'iOS 18',
        appVersion: 'web-2026.05.1',
        fingerprint: 'error-payment-intent-rejected',
        status: 'investigating',
        createdAt: new Date(DEMO_NOW - 5 * day).toISOString(),
        platform: 'web',
        occurrenceCount: 472,
        userCount: 258,
        affectedDevices: { 'Chrome on Android': 171, 'Safari on iPhone': 132, 'Chrome on Windows': 96, 'Chrome on macOS': 73 },
        affectedVersions: { 'web-2026.05.1': 318, 'web-2026.05.0': 154 },
        logs: demoStabilityLogs(
            '19:46',
            'PaymentSheet',
            'stale-cart-token',
            '[19:46:03.904] ERROR PaymentIntentError Payment validation rejected stale cart token token=cart_tok_stale_91'
        ),
    },
    {
        id: 'err-inventory-timeout',
        sessionId: 'demo-error-session-003',
        projectId: 'demo-project',
        timestamp: new Date(DEMO_NOW - 45 * 60 * 1000).toISOString(),
        firstSeen: new Date(DEMO_NOW - 3 * day).toISOString(),
        lastSeen: new Date(DEMO_NOW - 45 * 60 * 1000).toISOString(),
        errorType: 'promise_rejection',
        errorName: 'Unhandled Promise Rejection',
        message: 'Inventory refresh timed out after product variant change',
        stack: `UnhandledPromiseRejection: Inventory refresh timed out after product variant change
    at InventoryClient.refreshVariant (InventoryClient.ts:129:13)
    at async ProductDetailPage.onVariantChange (ProductDetailPage.tsx:211:7)
    at async VariantSelector.handleSelect (VariantSelector.tsx:58:5)`,
        screenName: 'Product Detail',
        deviceModel: 'Chrome on Windows',
        osVersion: 'Windows 11',
        appVersion: 'web-2026.05.0',
        fingerprint: 'error-inventory-promise-rejection',
        status: 'open',
        createdAt: new Date(DEMO_NOW - 3 * day).toISOString(),
        platform: 'web',
        occurrenceCount: 356,
        userCount: 204,
        affectedDevices: { 'Chrome on Windows': 142, 'Edge on Windows': 88, 'Chrome on Android': 74, 'Safari on iPhone': 52 },
        affectedVersions: { 'web-2026.05.0': 229, 'web-2026.04.2': 127 },
        logs: demoStabilityLogs(
            '19:32',
            'InventoryClient',
            'variant-refresh-timeout',
            '[19:32:25.384] ERROR UnhandledPromiseRejection Inventory refresh timed out after product variant change sku=SHOE-92 color=bone'
        ),
    },
    {
        id: 'err-search-abort',
        sessionId: 'demo-error-session-004',
        projectId: 'demo-project',
        timestamp: new Date(DEMO_NOW - 58 * 60 * 1000).toISOString(),
        firstSeen: new Date(DEMO_NOW - 4 * day).toISOString(),
        lastSeen: new Date(DEMO_NOW - 58 * 60 * 1000).toISOString(),
        errorType: 'js_error',
        errorName: 'AbortError',
        message: 'Search request was aborted after filter reset',
        stack: `AbortError: Search request was aborted after filter reset
    at SearchClient.fetchResults (SearchClient.ts:88:11)
    at async SearchResults.useEffect.load (SearchResults.tsx:132:19)
    at async flushPassiveEffectsImpl (react-dom.development.js:27039:9)`,
        screenName: 'Search',
        deviceModel: 'Firefox on Linux',
        osVersion: 'Ubuntu 24.04',
        appVersion: 'web-2026.05.1',
        fingerprint: 'error-search-abort-filter-reset',
        status: 'open',
        createdAt: new Date(DEMO_NOW - 4 * day).toISOString(),
        platform: 'web',
        occurrenceCount: 244,
        userCount: 139,
        affectedDevices: { 'Firefox on Linux': 91, 'Chrome on macOS': 74, 'Chrome on Windows': 48, 'Safari on iPhone': 31 },
        affectedVersions: { 'web-2026.05.1': 162, 'web-2026.05.0': 82 },
    },
    {
        id: 'err-profile-json',
        sessionId: 'demo-error-session-005',
        projectId: 'demo-project',
        timestamp: new Date(DEMO_NOW - 76 * 60 * 1000).toISOString(),
        firstSeen: new Date(DEMO_NOW - 2 * day).toISOString(),
        lastSeen: new Date(DEMO_NOW - 76 * 60 * 1000).toISOString(),
        errorType: 'js_error',
        errorName: 'SyntaxError',
        message: 'Unexpected end of JSON input while loading saved addresses',
        stack: `SyntaxError: Unexpected end of JSON input
    at JSON.parse (<anonymous>)
    at parseSavedAddresses (ProfileAddresses.ts:42:15)
    at async AccountPage.loadProfile (AccountPage.tsx:119:21)
    at async AccountPage.tsx:151:7`,
        screenName: 'Account',
        deviceModel: 'Chrome on Android',
        osVersion: 'Android 14',
        appVersion: 'web-2026.05.1',
        fingerprint: 'error-profile-address-json',
        status: 'open',
        createdAt: new Date(DEMO_NOW - 2 * day).toISOString(),
        platform: 'web',
        occurrenceCount: 193,
        userCount: 121,
        affectedDevices: { 'Chrome on Android': 83, 'Safari on iPhone': 61, 'Chrome on Windows': 49 },
        affectedVersions: { 'web-2026.05.1': 118, 'web-2026.05.0': 75 },
    },
    {
        id: 'err-carousel-range',
        sessionId: 'demo-error-session-006',
        projectId: 'demo-project',
        timestamp: new Date(DEMO_NOW - 2 * 60 * 60 * 1000).toISOString(),
        firstSeen: new Date(DEMO_NOW - day).toISOString(),
        lastSeen: new Date(DEMO_NOW - 2 * 60 * 60 * 1000).toISOString(),
        errorType: 'js_error',
        errorName: 'RangeError',
        message: 'Invalid array length while hydrating recommendation carousel',
        stack: `RangeError: Invalid array length
    at buildCarouselPages (RecommendationCarousel.tsx:57:23)
    at RecommendationCarousel (RecommendationCarousel.tsx:92:17)
    at renderWithHooks (react-dom.development.js:16305:18)
    at mountIndeterminateComponent (react-dom.development.js:20074:13)`,
        screenName: 'Home',
        deviceModel: 'Safari on iPhone',
        osVersion: 'iOS 18',
        appVersion: 'web-2026.05.1',
        fingerprint: 'error-carousel-range',
        status: 'open',
        createdAt: new Date(DEMO_NOW - day).toISOString(),
        platform: 'web',
        occurrenceCount: 126,
        userCount: 83,
        affectedDevices: { 'Safari on iPhone': 52, 'Chrome on macOS': 39, 'Chrome on Windows': 35 },
        affectedVersions: { 'web-2026.05.1': 126 },
    },
];

const demoErrorGroups = demoErrorRecords.map((error) => ({
    errorName: error.errorName,
    message: error.message,
    count: error.occurrenceCount,
    firstSeen: error.firstSeen,
    lastSeen: error.lastSeen,
    sampleSessionId: error.sessionId,
    platform: error.platform,
    users: demoUserIds(error.id, error.userCount),
    affectedDevices: error.affectedDevices,
    affectedVersions: error.affectedVersions,
    screens: [error.screenName],
    sampleError: {
        id: error.id,
        sessionId: error.sessionId,
        timestamp: error.timestamp,
        deviceModel: error.deviceModel,
        appVersion: error.appVersion,
        stack: error.stack,
        screenName: error.screenName,
        platform: error.platform,
        logs: error.logs || [],
    },
}));

export const demoErrorsResponse: any = {
    errors: demoErrorRecords,
    grouped: demoErrorGroups,
    summary: {
        total: demoErrorRecords.reduce((sum, error) => sum + error.occurrenceCount, 0),
        jsErrors: demoErrorRecords
            .filter((error) => error.errorType === 'js_error')
            .reduce((sum, error) => sum + error.occurrenceCount, 0),
        promiseRejections: demoErrorRecords
            .filter((error) => error.errorType === 'promise_rejection')
            .reduce((sum, error) => sum + error.occurrenceCount, 0),
        unhandledExceptions: demoErrorRecords
            .filter((error) => error.errorType === 'unhandled_exception')
            .reduce((sum, error) => sum + error.occurrenceCount, 0),
    },
    pagination: {
        offset: 0,
        limit: 100,
        total: demoErrorRecords.length,
    },
};

const demoAnrRecords = [
    {
        id: 'anr-checkout-shipping-rates',
        sessionId: 'demo-anr-session-001',
        projectId: 'demo-project',
        timestamp: new Date(DEMO_NOW - 22 * 60 * 1000).toISOString(),
        durationMs: 9400,
        threadState: `Thread[main,5,main]
    at java.lang.Object.wait(Native Method)
    at okhttp3.internal.connection.RealCall.getResponseWithInterceptorChain(RealCall.kt:201)
    at com.rejourney.demo.checkout.ShippingRepository.fetchRatesBlocking(ShippingRepository.kt:64)
    at com.rejourney.demo.checkout.CheckoutActivity.renderShippingOptions(CheckoutActivity.kt:332)
    at android.view.ViewRootImpl.performTraversals(ViewRootImpl.java:3123)
    at android.os.Looper.loopOnce(Looper.java:226)
    at android.app.ActivityThread.main(ActivityThread.java:8910)
${demoLongStackFrames('ShippingMainThreadProbe', 'ShippingMainThreadProbe.kt', 39)}`,
        deviceMetadata: {
            deviceModel: 'Samsung Galaxy S24',
            model: 'Samsung Galaxy S24',
            osVersion: 'Android 14',
            appVersion: '2.5.0',
            platform: 'android',
            os: 'android',
        },
        platform: 'android',
        status: 'open',
        occurrenceCount: 164,
        userCount: 97,
        groupKey: 'checkout-shipping-rates',
        logs: demoStabilityLogs(
            '19:58',
            'CheckoutActivity',
            'blocking-shipping-rates',
            '[19:58:53.520] ERROR ANR detected main_thread_blocked durationMs=9400 addressId=addr_102'
        ),
    },
    {
        id: 'anr-home-image-decode',
        sessionId: 'demo-anr-session-002',
        projectId: 'demo-project',
        timestamp: new Date(DEMO_NOW - 57 * 60 * 1000).toISOString(),
        durationMs: 7200,
        threadState: `Thread[main,5,main]
    at ImageIO_PNG_Data::decodeImage(void*, unsigned long)
    at UIKitCore UIImage._initWithData(_:scale:)
    at RejourneyDemo HomeFeedViewController.renderHeroTiles(HomeFeedViewController.swift:411)
    at RejourneyDemo HomeFeedViewController.collectionView(_:cellForItemAt:)
    at UIKitCore -[UICollectionView _createPreparedCellForItemAtIndexPath:]
    at CoreFoundation __CFRUNLOOP_IS_CALLING_OUT_TO_A_SOURCE0_PERFORM_FUNCTION__`,
        deviceMetadata: {
            deviceModel: 'iPhone 14',
            model: 'iPhone 14',
            osVersion: 'iOS 17.6',
            appVersion: '2.4.1',
            platform: 'ios',
            os: 'ios',
        },
        platform: 'ios',
        status: 'open',
        occurrenceCount: 118,
        userCount: 73,
        groupKey: 'home-image-decode',
        logs: demoStabilityLogs(
            '19:23',
            'HomeFeedViewController',
            'image-decode-main-thread',
            '[19:23:25.974] ERROR ANR detected image_decode_main_thread durationMs=7200 image=hero_04.png frameDrops=196'
        ),
    },
    {
        id: 'anr-cart-diffable-snapshot',
        sessionId: 'demo-anr-session-003',
        projectId: 'demo-project',
        timestamp: new Date(DEMO_NOW - 81 * 60 * 1000).toISOString(),
        durationMs: 6100,
        threadState: `Thread[main,5,main]
    at RejourneyDemo CartDiffableDataSource.applySnapshot(_:animatingDifferences:)
    at RejourneyDemo CartViewController.rebuildSnapshot(CartViewController.swift:266)
    at RejourneyDemo CartViewModel.reconcilePromotions(CartViewModel.swift:183)
    at libdispatch.dylib _dispatch_main_queue_callback_4CF
    at CoreFoundation __CFRUNLOOP_IS_SERVICING_THE_MAIN_DISPATCH_QUEUE__`,
        deviceMetadata: {
            deviceModel: 'iPhone 15 Pro',
            model: 'iPhone 15 Pro',
            osVersion: 'iOS 18.1',
            appVersion: '2.5.0',
            platform: 'ios',
            os: 'ios',
        },
        platform: 'ios',
        status: 'investigating',
        occurrenceCount: 92,
        userCount: 61,
        groupKey: 'cart-diffable-snapshot',
    },
    {
        id: 'anr-search-room-migration',
        sessionId: 'demo-anr-session-004',
        projectId: 'demo-project',
        timestamp: new Date(DEMO_NOW - 2 * 60 * 60 * 1000).toISOString(),
        durationMs: 12800,
        threadState: `Thread[main,5,main]
    at androidx.room.RoomOpenHelper.onUpgrade(RoomOpenHelper.kt:96)
    at android.database.sqlite.SQLiteOpenHelper.getDatabaseLocked(SQLiteOpenHelper.java:416)
    at com.rejourney.demo.search.SearchHistoryStore.readRecentQueries(SearchHistoryStore.kt:58)
    at com.rejourney.demo.search.SearchActivity.onCreate(SearchActivity.kt:102)
    at android.app.Activity.performCreate(Activity.java:8595)`,
        deviceMetadata: {
            deviceModel: 'Pixel 8 Pro',
            model: 'Pixel 8 Pro',
            osVersion: 'Android 15',
            appVersion: '2.5.0',
            platform: 'android',
            os: 'android',
        },
        platform: 'android',
        status: 'open',
        occurrenceCount: 86,
        userCount: 54,
        groupKey: 'search-room-migration',
    },
    {
        id: 'anr-product-main-thread-sort',
        sessionId: 'demo-anr-session-005',
        projectId: 'demo-project',
        timestamp: new Date(DEMO_NOW - 3 * 60 * 60 * 1000).toISOString(),
        durationMs: 5600,
        threadState: `Thread[main,5,main]
    at java.util.TimSort.sort(TimSort.java:245)
    at java.util.Arrays.sort(Arrays.java:1344)
    at kotlin.collections.CollectionsKt___CollectionsKt.sortedWith(_Collections.kt:1075)
    at com.rejourney.demo.product.ProductGridPresenter.sortVisibleProducts(ProductGridPresenter.kt:149)
    at com.rejourney.demo.product.ProductGridFragment.onFilterChanged(ProductGridFragment.kt:221)`,
        deviceMetadata: {
            deviceModel: 'Samsung Galaxy S23',
            model: 'Samsung Galaxy S23',
            osVersion: 'Android 14',
            appVersion: '2.4.1',
            platform: 'android',
            os: 'android',
        },
        platform: 'android',
        status: 'open',
        occurrenceCount: 73,
        userCount: 49,
        groupKey: 'product-main-thread-sort',
    },
    {
        id: 'anr-profile-keychain-read',
        sessionId: 'demo-anr-session-006',
        projectId: 'demo-project',
        timestamp: new Date(DEMO_NOW - 5 * 60 * 60 * 1000).toISOString(),
        durationMs: 6800,
        threadState: `Thread[main,5,main]
    at Security SecItemCopyMatching
    at RejourneyDemo SecureTokenStore.readToken(SecureTokenStore.swift:47)
    at RejourneyDemo AccountCoordinator.restoreSession(AccountCoordinator.swift:88)
    at RejourneyDemo ProfileViewController.viewDidAppear(ProfileViewController.swift:133)
    at UIKitCore -[UIViewController _setViewAppearState:isAnimating:]`,
        deviceMetadata: {
            deviceModel: 'iPhone 13',
            model: 'iPhone 13',
            osVersion: 'iOS 17.5',
            appVersion: '2.4.0',
            platform: 'ios',
            os: 'ios',
        },
        platform: 'ios',
        status: 'investigating',
        occurrenceCount: 61,
        userCount: 42,
        groupKey: 'profile-keychain-read',
    },
];

export const demoANRsResponse: any = {
    anrs: demoAnrRecords,
    totalGroups: demoAnrRecords.length,
    totalEvents: demoAnrRecords.reduce((sum, anr) => sum + anr.occurrenceCount, 0),
};
