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
    GeoIssuesSummary,
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
    UserEngagementTrends,
} from '../services/api';

import { Issue, IssueSession } from '../types';
import { DEMO_FEATURED_SESSION_ID } from './demoData';

// ================================================================================
// Dashboard Stats (for Overview and Growth pages)
// ================================================================================

export const demoDashboardStatsApi: DashboardStats = {
    totalSessions: 28456, // Sessions > MAU since users have multiple sessions
    avgDuration: 342, // avgDuration (not avgDurationSeconds)
    avgUxScore: 78,
    errorRate: 2.3, // error rate percentage
    funnelCompletionRate: 45.6,
    avgFunnelStep: 2.8,
    activeUsers: 1234,
    activeUsersTrend: 8.5, // % change
    avgDurationTrend: -2.3,
    avgUxScoreTrend: 5.1,
    errorRateTrend: -12.4,
    dau: 823,
    wau: 4567,
    mau: 12847,
    engagementSegments: {
        bouncers: 2856,
        casuals: 9823,
        explorers: 10456,
        loyalists: 5321,
    },
};

// ================================================================================
// API Endpoint Stats (for API Analytics page)
// ================================================================================

export interface ApiEndpointStats {
    slowestEndpoints: Array<{ endpoint: string; totalCalls: number; totalErrors: number; avgLatencyMs: number; errorRate: number }>;
    erroringEndpoints: Array<{ endpoint: string; totalCalls: number; totalErrors: number; avgLatencyMs: number; errorRate: number }>;
    allEndpoints: Array<{ endpoint: string; totalCalls: number; totalErrors: number; avgLatencyMs: number; errorRate: number }>;
    summary: { totalCalls: number; avgLatency: number; errorRate: number };
}

export const demoApiEndpointStats: ApiEndpointStats = {
    slowestEndpoints: [
        { endpoint: '/api/products/search', totalCalls: 15678, totalErrors: 234, avgLatencyMs: 1245, errorRate: 1.5 },
        { endpoint: '/api/checkout/process', totalCalls: 8765, totalErrors: 156, avgLatencyMs: 987, errorRate: 1.8 },
        { endpoint: '/api/recommendations', totalCalls: 23456, totalErrors: 89, avgLatencyMs: 756, errorRate: 0.4 },
    ],
    erroringEndpoints: [
        { endpoint: '/api/payment/validate', totalCalls: 5678, totalErrors: 456, avgLatencyMs: 234, errorRate: 8.0 },
        { endpoint: '/api/inventory/check', totalCalls: 12345, totalErrors: 567, avgLatencyMs: 156, errorRate: 4.6 },
        { endpoint: '/api/shipping/rates', totalCalls: 9876, totalErrors: 234, avgLatencyMs: 345, errorRate: 2.4 },
    ],
    allEndpoints: [
        { endpoint: '/api/products/list', totalCalls: 45678, totalErrors: 123, avgLatencyMs: 145, errorRate: 0.3 },
        { endpoint: '/api/products/search', totalCalls: 15678, totalErrors: 234, avgLatencyMs: 1245, errorRate: 1.5 },
        { endpoint: '/api/cart/add', totalCalls: 23456, totalErrors: 67, avgLatencyMs: 89, errorRate: 0.3 },
        { endpoint: '/api/cart/update', totalCalls: 12345, totalErrors: 45, avgLatencyMs: 76, errorRate: 0.4 },
        { endpoint: '/api/checkout/process', totalCalls: 8765, totalErrors: 156, avgLatencyMs: 987, errorRate: 1.8 },
        { endpoint: '/api/payment/validate', totalCalls: 5678, totalErrors: 456, avgLatencyMs: 234, errorRate: 8.0 },
        { endpoint: '/api/inventory/check', totalCalls: 12345, totalErrors: 567, avgLatencyMs: 156, errorRate: 4.6 },
        { endpoint: '/api/shipping/rates', totalCalls: 9876, totalErrors: 234, avgLatencyMs: 345, errorRate: 2.4 },
        { endpoint: '/api/recommendations', totalCalls: 23456, totalErrors: 89, avgLatencyMs: 756, errorRate: 0.4 },
        { endpoint: '/api/user/profile', totalCalls: 34567, totalErrors: 12, avgLatencyMs: 67, errorRate: 0.03 },
    ],
    summary: {
        totalCalls: 191844,
        avgLatency: 312,
        errorRate: 1.8,
    },
};

export const demoApiLatencyByLocation: ApiLatencyByLocationResponse = {
    regions: [
        { country: 'United States', totalRequests: 156789, avgLatencyMs: 134, successRate: 98.8, errorCount: 1881 },
        { country: 'United Kingdom', totalRequests: 45678, avgLatencyMs: 178, successRate: 98.2, errorCount: 822 },
        { country: 'Germany', totalRequests: 34567, avgLatencyMs: 156, successRate: 98.6, errorCount: 484 },
        { country: 'Japan', totalRequests: 23456, avgLatencyMs: 89, successRate: 99.2, errorCount: 188 },
        { country: 'Canada', totalRequests: 23456, avgLatencyMs: 189, successRate: 98.1, errorCount: 446 },
        { country: 'Australia', totalRequests: 18765, avgLatencyMs: 298, successRate: 97.4, errorCount: 488 },
        { country: 'Brazil', totalRequests: 15678, avgLatencyMs: 387, successRate: 96.8, errorCount: 502 },
        { country: 'India', totalRequests: 12345, avgLatencyMs: 456, successRate: 95.9, errorCount: 506 },
    ],
    summary: {
        avgLatency: 221,
        totalRequests: 330734,
    },
};

// ================================================================================
// Insights Trends (for Growth charts)
// ================================================================================

const now = Date.now();
const day = 24 * 60 * 60 * 1000;

export const demoInsightsTrends: InsightsTrends = {
    daily: Array.from({ length: 30 }, (_, i) => {
        const date = new Date(now - (29 - i) * day);
        const isWeekend = date.getDay() === 0 || date.getDay() === 6;
        const baseSessions = isWeekend ? 800 : 1200; // More sessions per day
        const variance = Math.random() * 0.2 + 0.9;

        return {
            date: date.toISOString().split('T')[0],
            sessions: Math.round(baseSessions * variance), // Sessions per day (800-1200)
            crashes: Math.round(1 + Math.random() * 3),
            rageTaps: Math.round(5 + Math.random() * 10),
            avgUxScore: Math.round(75 + Math.random() * 8),
            dau: Math.round(200 + Math.random() * 100), // DAU (200-300) < sessions
            mau: Math.round(850 + (Math.random() - 0.5) * 50), // MAU varies slightly (825-875)
            // NEW: Additional metrics for overview graphs
            avgApiResponseMs: Math.round(150 + Math.random() * 100), // 150-250ms
            apiErrorRate: Math.round((1 + Math.random() * 4) * 100) / 100, // 1-5%
            avgDurationSeconds: Math.round(180 + Math.random() * 120), // 180-300 seconds
            errorCount: Math.round(5 + Math.random() * 15), // 5-20 errors per day
            // App version breakdown - simulating gradual adoption of newer versions
            appVersionBreakdown: {
                '2.3.1': Math.round(40 + i * 3 + Math.random() * 10), // Newest, growing
                '2.3.0': Math.round(60 - i * 1.5 + Math.random() * 10), // Previous, declining
                '2.2.9': Math.round(30 - i * 0.8 + Math.random() * 5), // Older, declining
                '2.2.8': Math.round(15 - i * 0.4 + Math.random() * 3), // Even older
                '2.2.5': Math.round(5 + Math.random() * 2), // Long-tail users
            },
        };
    }),
};

// ================================================================================
// Geographic Summary (for Geo page)
// ================================================================================

export const demoGeoSummary: GeoSummary = {
    countries: [
        {
            country: 'United States',
            count: 6234,
            latitude: 37.0902,
            longitude: -95.7129,
            avgUxScore: 79,
            crashCount: 23,
            rageTapCount: 156,
            topCities: [
                { city: 'Austin', count: 987, latitude: 30.2672, longitude: -97.7431, avgUxScore: 82 },
                { city: 'San Francisco', count: 876, latitude: 37.7749, longitude: -122.4194, avgUxScore: 81 },
                { city: 'New York', count: 765, latitude: 40.7128, longitude: -74.0060, avgUxScore: 78 },
                { city: 'Los Angeles', count: 654, latitude: 34.0522, longitude: -118.2437, avgUxScore: 77 },
                { city: 'Chicago', count: 543, latitude: 41.8781, longitude: -87.6298, avgUxScore: 76 },
            ],
        },
        {
            country: 'United Kingdom',
            count: 1876,
            latitude: 55.3781,
            longitude: -3.4360,
            avgUxScore: 77,
            crashCount: 8,
            rageTapCount: 67,
            topCities: [
                { city: 'London', count: 876, latitude: 51.5074, longitude: -0.1278, avgUxScore: 78 },
                { city: 'Manchester', count: 234, latitude: 53.4808, longitude: -2.2426, avgUxScore: 76 },
            ],
        },
        {
            country: 'Germany',
            count: 1245,
            latitude: 51.1657,
            longitude: 10.4515,
            avgUxScore: 81,
            crashCount: 5,
            rageTapCount: 45,
            topCities: [
                { city: 'Berlin', count: 456, latitude: 52.5200, longitude: 13.4050, avgUxScore: 82 },
                { city: 'Munich', count: 234, latitude: 48.1351, longitude: 11.5820, avgUxScore: 80 },
            ],
        },
        {
            country: 'Japan',
            count: 987,
            latitude: 36.2048,
            longitude: 138.2529,
            avgUxScore: 84,
            crashCount: 2,
            rageTapCount: 23,
            topCities: [
                { city: 'Tokyo', count: 654, latitude: 35.6762, longitude: 139.6503, avgUxScore: 85 },
                { city: 'Osaka', count: 198, latitude: 34.6937, longitude: 135.5023, avgUxScore: 83 },
            ],
        },
        {
            country: 'Canada',
            count: 756,
            latitude: 56.1304,
            longitude: -106.3468,
            avgUxScore: 78,
            crashCount: 3,
            rageTapCount: 34,
            topCities: [
                { city: 'Toronto', count: 345, latitude: 43.6532, longitude: -79.3832, avgUxScore: 79 },
                { city: 'Vancouver', count: 198, latitude: 49.2827, longitude: -123.1207, avgUxScore: 80 },
            ],
        },
        {
            country: 'Australia',
            count: 654,
            latitude: -25.2744,
            longitude: 133.7751,
            avgUxScore: 76,
            crashCount: 4,
            rageTapCount: 45,
            topCities: [
                { city: 'Sydney', count: 345, latitude: -33.8688, longitude: 151.2093, avgUxScore: 77 },
                { city: 'Melbourne', count: 198, latitude: -37.8136, longitude: 144.9631, avgUxScore: 75 },
            ],
        },
        {
            country: 'Brazil',
            count: 543,
            latitude: -14.2350,
            longitude: -51.9253,
            avgUxScore: 72,
            crashCount: 6,
            rageTapCount: 78,
            topCities: [
                { city: 'São Paulo', count: 287, latitude: -23.5505, longitude: -46.6333, avgUxScore: 71 },
                { city: 'Rio de Janeiro', count: 156, latitude: -22.9068, longitude: -43.1729, avgUxScore: 73 },
            ],
        },
        {
            country: 'India',
            count: 432,
            latitude: 20.5937,
            longitude: 78.9629,
            avgUxScore: 68,
            crashCount: 8,
            rageTapCount: 89,
            topCities: [
                { city: 'Mumbai', count: 198, latitude: 19.0760, longitude: 72.8777, avgUxScore: 67 },
                { city: 'Bangalore', count: 145, latitude: 12.9716, longitude: 77.5946, avgUxScore: 70 },
            ],
        },
    ],
    totalWithGeo: 11837,
};

// ================================================================================
// Geographic Issues (for Geo page issues view)
// ================================================================================

export const demoGeoIssues: GeoIssuesSummary = {
    locations: [
        { country: 'United States', city: 'Austin', lat: 30.2672, lng: -97.7431, sessions: 987, issues: { crashes: 8, anrs: 3, errors: 45, rageTaps: 67, apiErrors: 23, total: 146 } },
        { country: 'United States', city: 'San Francisco', lat: 37.7749, lng: -122.4194, sessions: 876, issues: { crashes: 5, anrs: 2, errors: 32, rageTaps: 45, apiErrors: 18, total: 102 } },
        { country: 'United States', city: 'New York', lat: 40.7128, lng: -74.0060, sessions: 765, issues: { crashes: 6, anrs: 4, errors: 38, rageTaps: 52, apiErrors: 21, total: 121 } },
        { country: 'United Kingdom', city: 'London', lat: 51.5074, lng: -0.1278, sessions: 876, issues: { crashes: 3, anrs: 1, errors: 28, rageTaps: 34, apiErrors: 12, total: 78 } },
        { country: 'Germany', city: 'Berlin', lat: 52.5200, lng: 13.4050, sessions: 456, issues: { crashes: 2, anrs: 1, errors: 18, rageTaps: 23, apiErrors: 8, total: 52 } },
        { country: 'Japan', city: 'Tokyo', lat: 35.6762, lng: 139.6503, sessions: 654, issues: { crashes: 1, anrs: 0, errors: 12, rageTaps: 15, apiErrors: 5, total: 33 } },
        { country: 'Canada', city: 'Toronto', lat: 43.6532, lng: -79.3832, sessions: 345, issues: { crashes: 2, anrs: 1, errors: 15, rageTaps: 19, apiErrors: 7, total: 44 } },
        { country: 'Australia', city: 'Sydney', lat: -33.8688, lng: 151.2093, sessions: 345, issues: { crashes: 3, anrs: 2, errors: 22, rageTaps: 28, apiErrors: 11, total: 66 } },
        { country: 'Brazil', city: 'São Paulo', lat: -23.5505, lng: -46.6333, sessions: 287, issues: { crashes: 5, anrs: 3, errors: 35, rageTaps: 48, apiErrors: 19, total: 110 } },
        { country: 'India', city: 'Mumbai', lat: 19.0760, lng: 72.8777, sessions: 198, issues: { crashes: 6, anrs: 4, errors: 42, rageTaps: 56, apiErrors: 24, total: 132 } },
        { country: 'India', city: 'Bangalore', lat: 12.9716, lng: 77.5946, sessions: 145, issues: { crashes: 4, anrs: 3, errors: 28, rageTaps: 38, apiErrors: 16, total: 89 } },
        { country: 'Germany', city: 'Munich', lat: 48.1351, lng: 11.5820, sessions: 234, issues: { crashes: 1, anrs: 0, errors: 10, rageTaps: 14, apiErrors: 4, total: 29 } },
        { country: 'France', city: 'Paris', lat: 48.8566, lng: 2.3522, sessions: 312, issues: { crashes: 2, anrs: 1, errors: 19, rageTaps: 25, apiErrors: 9, total: 56 } },
        { country: 'Singapore', city: 'Singapore', lat: 1.3521, lng: 103.8198, sessions: 267, issues: { crashes: 1, anrs: 0, errors: 8, rageTaps: 11, apiErrors: 3, total: 23 } },
    ],
    countries: [
        { country: 'United States', sessions: 6234, crashes: 23, anrs: 12, errors: 156, rageTaps: 234, apiErrors: 89, totalIssues: 514, issueRate: 0.08 },
        { country: 'India', sessions: 432, crashes: 10, anrs: 7, errors: 70, rageTaps: 94, apiErrors: 40, totalIssues: 221, issueRate: 0.51 },
        { country: 'Brazil', sessions: 543, crashes: 6, anrs: 4, errors: 45, rageTaps: 62, apiErrors: 25, totalIssues: 142, issueRate: 0.26 },
        { country: 'United Kingdom', sessions: 1876, crashes: 8, anrs: 4, errors: 67, rageTaps: 89, apiErrors: 34, totalIssues: 202, issueRate: 0.11 },
        { country: 'Australia', sessions: 654, crashes: 4, anrs: 3, errors: 32, rageTaps: 45, apiErrors: 18, totalIssues: 102, issueRate: 0.16 },
        { country: 'Germany', sessions: 1245, crashes: 5, anrs: 2, errors: 45, rageTaps: 56, apiErrors: 19, totalIssues: 127, issueRate: 0.10 },
        { country: 'Japan', sessions: 987, crashes: 2, anrs: 1, errors: 23, rageTaps: 28, apiErrors: 9, totalIssues: 63, issueRate: 0.06 },
        { country: 'Canada', sessions: 756, crashes: 3, anrs: 2, errors: 28, rageTaps: 34, apiErrors: 12, totalIssues: 79, issueRate: 0.10 },
        { country: 'France', sessions: 512, crashes: 3, anrs: 2, errors: 25, rageTaps: 33, apiErrors: 12, totalIssues: 75, issueRate: 0.15 },
        { country: 'Singapore', sessions: 378, crashes: 1, anrs: 0, errors: 12, rageTaps: 16, apiErrors: 5, totalIssues: 34, issueRate: 0.09 },
    ],
    summary: {
        totalIssues: 1559,
        byType: {
            crashes: 65,
            anrs: 37,
            errors: 503,
            rageTaps: 691,
            apiErrors: 263,
        },
    },
};

// ================================================================================
// Device Summary (for Devices page)
// ================================================================================

export const demoDeviceSummary: DeviceSummary = {
    devices: [
        { model: 'iPhone 15 Pro', count: 2341, crashes: 5, anrs: 2, errors: 12 },
        { model: 'iPhone 14', count: 1876, crashes: 3, anrs: 1, errors: 8 },
        { model: 'Samsung Galaxy S24', count: 1654, crashes: 12, anrs: 8, errors: 23 },
        { model: 'Pixel 8 Pro', count: 987, crashes: 4, anrs: 3, errors: 9 },
        { model: 'iPhone 15', count: 876, crashes: 2, anrs: 0, errors: 5 },
        { model: 'iPhone 13', count: 765, crashes: 6, anrs: 2, errors: 11 },
        { model: 'Samsung Galaxy S23', count: 654, crashes: 8, anrs: 5, errors: 15 },
        { model: 'OnePlus 12', count: 543, crashes: 3, anrs: 2, errors: 7 },
        { model: 'iPad Pro 12.9"', count: 432, crashes: 1, anrs: 0, errors: 3 },
        { model: 'Pixel 7', count: 321, crashes: 2, anrs: 1, errors: 4 },
    ],
    platforms: {
        ios: 7234,
        android: 5613,
    },
    appVersions: [
        { version: '2.3.1', count: 5678, crashes: 8, anrs: 3, errors: 18 },
        { version: '2.3.0', count: 4567, crashes: 15, anrs: 8, errors: 32 },
        { version: '2.2.9', count: 1876, crashes: 12, anrs: 6, errors: 28 },
        { version: '2.2.8', count: 543, crashes: 8, anrs: 4, errors: 15 },
        { version: '2.2.5', count: 183, crashes: 3, anrs: 3, errors: 7 },
    ],
    osVersions: [
        { version: 'iOS 17.2', count: 3456, crashes: 4, anrs: 1, errors: 12 },
        { version: 'iOS 17.1', count: 2345, crashes: 6, anrs: 2, errors: 15 },
        { version: 'Android 14', count: 3987, crashes: 18, anrs: 12, errors: 35 },
        { version: 'iOS 16.7', count: 1234, crashes: 8, anrs: 3, errors: 18 },
        { version: 'Android 13', count: 1456, crashes: 10, anrs: 6, errors: 20 },
        { version: 'iOS 17.0', count: 456, crashes: 2, anrs: 0, errors: 5 },
    ],
    totalSessions: 12847,
};

// ================================================================================
// Journey Summary (for Journeys page)
// ================================================================================

export const demoJourneySummary: JourneySummary = {
    topScreens: [
        { screen: 'Home', visits: 12847 },
        { screen: 'Products', visits: 9823 },
        { screen: 'Product Detail', visits: 7456 },
        { screen: 'Cart', visits: 4567 },
        { screen: 'Search', visits: 3456 },
        { screen: 'Checkout', visits: 2345 },
        { screen: 'Order Confirmation', visits: 1876 },
        { screen: 'Wishlist', visits: 1234 },
        { screen: 'Profile', visits: 987 },
        { screen: 'Settings', visits: 543 },
    ],
    flows: [
        { from: 'Home', to: 'Products', count: 6234 },
        { from: 'Products', to: 'Product Detail', count: 5678 },
        { from: 'Product Detail', to: 'Cart', count: 3456 },
        { from: 'Cart', to: 'Checkout', count: 2345 },
        { from: 'Checkout', to: 'Order Confirmation', count: 1876 },
        { from: 'Home', to: 'Search', count: 2345 },
        { from: 'Search', to: 'Products', count: 1987 },
        { from: 'Product Detail', to: 'Wishlist', count: 876 },
        { from: 'Products', to: 'Home', count: 1234 },
        { from: 'Cart', to: 'Products', count: 987 },
    ],
    entryPoints: [
        { screen: 'Home', count: 9876 },
        { screen: 'Product Detail', count: 1876 },
        { screen: 'Products', count: 654 },
        { screen: 'Cart', count: 234 },
        { screen: 'Search', count: 207 },
    ],
    exitPoints: [
        { screen: 'Order Confirmation', count: 1876 },
        { screen: 'Home', count: 2345 },
        { screen: 'Product Detail', count: 1234 },
        { screen: 'Cart', count: 987 },
        { screen: 'Checkout', count: 456 },
    ],
};

// ================================================================================
// Journey Observability (Observability-centric analysis)
// ================================================================================

export const demoJourneyObservability: ObservabilityJourneySummary = {
    healthSummary: {
        healthy: 9234,
        degraded: 2156,
        problematic: 1457,
    },
    flows: [
        { from: 'Home', to: 'Products', count: 6234, apiErrors: 12, apiErrorRate: 0.2, avgApiLatencyMs: 145, rageTapCount: 23, crashCount: 0, anrCount: 0, health: 'healthy', replayCount: 45 },
        { from: 'Products', to: 'Product Detail', count: 5678, apiErrors: 8, apiErrorRate: 0.1, avgApiLatencyMs: 189, rageTapCount: 18, crashCount: 0, anrCount: 0, health: 'healthy', replayCount: 38 },
        { from: 'Product Detail', to: 'Cart', count: 3456, apiErrors: 45, apiErrorRate: 1.3, avgApiLatencyMs: 234, rageTapCount: 67, crashCount: 2, anrCount: 0, health: 'degraded', replayCount: 28 },
        { from: 'Cart', to: 'Checkout', count: 2345, apiErrors: 156, apiErrorRate: 6.7, avgApiLatencyMs: 876, rageTapCount: 234, crashCount: 5, anrCount: 2, health: 'problematic', replayCount: 67 },
        { from: 'Checkout', to: 'Order Confirmation', count: 1876, apiErrors: 89, apiErrorRate: 4.7, avgApiLatencyMs: 1234, rageTapCount: 123, crashCount: 3, anrCount: 1, health: 'problematic', replayCount: 45 },
        { from: 'Home', to: 'Search', count: 2345, apiErrors: 5, apiErrorRate: 0.2, avgApiLatencyMs: 98, rageTapCount: 12, crashCount: 0, anrCount: 0, health: 'healthy', replayCount: 12 },
        { from: 'Search', to: 'Products', count: 1987, apiErrors: 23, apiErrorRate: 1.2, avgApiLatencyMs: 345, rageTapCount: 45, crashCount: 0, anrCount: 0, health: 'degraded', replayCount: 18 },
        { from: 'Product Detail', to: 'Wishlist', count: 876, apiErrors: 3, apiErrorRate: 0.3, avgApiLatencyMs: 112, rageTapCount: 8, crashCount: 0, anrCount: 0, health: 'healthy', replayCount: 5 },
        { from: 'Products', to: 'Home', count: 1234, apiErrors: 2, apiErrorRate: 0.2, avgApiLatencyMs: 78, rageTapCount: 5, crashCount: 0, anrCount: 0, health: 'healthy', replayCount: 8 },
        { from: 'Cart', to: 'Products', count: 987, apiErrors: 15, apiErrorRate: 1.5, avgApiLatencyMs: 167, rageTapCount: 34, crashCount: 0, anrCount: 0, health: 'degraded', replayCount: 12 },
    ],
    problematicJourneys: [
        { path: ['Home', 'Products', 'Cart', 'Checkout'], sessionCount: 456, crashes: 8, anrs: 3, apiErrors: 189, rageTaps: 312, failureScore: 94, sampleSessionIds: ['demo-001', 'demo-002', 'demo-003'] },
        { path: ['Home', 'Search', 'Products', 'Cart', 'Checkout'], sessionCount: 234, crashes: 5, anrs: 2, apiErrors: 123, rageTaps: 187, failureScore: 67, sampleSessionIds: ['demo-004', 'demo-005'] },
        { path: ['Product Detail', 'Cart', 'Checkout'], sessionCount: 189, crashes: 4, anrs: 1, apiErrors: 98, rageTaps: 145, failureScore: 52, sampleSessionIds: ['demo-006', 'demo-007'] },
        { path: ['Home', 'Products', 'Product Detail', 'Cart'], sessionCount: 356, crashes: 3, anrs: 0, apiErrors: 67, rageTaps: 89, failureScore: 38, sampleSessionIds: ['demo-008', 'demo-009'] },
        { path: ['Cart', 'Checkout', 'Order Confirmation'], sessionCount: 278, crashes: 2, anrs: 1, apiErrors: 45, rageTaps: 67, failureScore: 28, sampleSessionIds: ['demo-010', 'demo-011'] },
    ],
    happyPathJourney: {
        path: ['Home', 'Products', 'Product Detail', 'Cart', 'Checkout', 'Order Confirmation'],
        sessionCount: 1128,
        crashes: 0,
        anrs: 0,
        apiErrors: 0,
        rageTaps: 0,
        failureScore: 0,
        health: 'healthy',
        sampleSessionIds: ['demo-happy-001', 'demo-happy-002', 'demo-happy-003'],
    },
    configuredHappyPath: {
        projectId: 'demo-project',
        path: ['Home', 'Products', 'Product Detail', 'Cart', 'Checkout', 'Order Confirmation'],
        targetScreen: 'Order Confirmation',
        confidence: 0.71,
        sampleSize: 750,
        updatedAt: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
    },
    exitAfterError: [
        { screen: 'Checkout', exitCount: 456, errorTypes: { api: 312, crash: 45, rage: 234 }, sampleSessionIds: ['demo-err-001', 'demo-err-002'] },
        { screen: 'Cart', exitCount: 234, errorTypes: { api: 145, crash: 23, rage: 156 }, sampleSessionIds: ['demo-err-003', 'demo-err-004'] },
        { screen: 'Product Detail', exitCount: 123, errorTypes: { api: 67, crash: 12, rage: 89 }, sampleSessionIds: ['demo-err-005'] },
        { screen: 'Search', exitCount: 89, errorTypes: { api: 45, crash: 5, rage: 67 }, sampleSessionIds: ['demo-err-006'] },
        { screen: 'Home', exitCount: 67, errorTypes: { api: 23, crash: 3, rage: 45 }, sampleSessionIds: ['demo-err-007'] },
    ],
    timeToFailure: {
        avgTimeBeforeFirstErrorMs: 45000,
        avgScreensBeforeCrash: 3.2,
        avgInteractionsBeforeRageTap: 12,
    },
    screenHealth: [
        { name: 'Home', visits: 12847, health: 'healthy', crashes: 3, anrs: 0, apiErrors: 45, rageTaps: 23, replayAvailable: true },
        { name: 'Products', visits: 9823, health: 'healthy', crashes: 5, anrs: 0, apiErrors: 67, rageTaps: 34, replayAvailable: true },
        { name: 'Product Detail', visits: 7456, health: 'degraded', crashes: 8, anrs: 2, apiErrors: 123, rageTaps: 89, replayAvailable: true },
        { name: 'Cart', visits: 4567, health: 'degraded', crashes: 12, anrs: 3, apiErrors: 189, rageTaps: 156, replayAvailable: true },
        { name: 'Search', visits: 3456, health: 'healthy', crashes: 2, anrs: 0, apiErrors: 34, rageTaps: 23, replayAvailable: true },
        { name: 'Checkout', visits: 2345, health: 'problematic', crashes: 23, anrs: 8, apiErrors: 345, rageTaps: 234, replayAvailable: true },
        { name: 'Order Confirmation', visits: 1876, health: 'degraded', crashes: 5, anrs: 1, apiErrors: 67, rageTaps: 45, replayAvailable: true },
        { name: 'Wishlist', visits: 1234, health: 'healthy', crashes: 1, anrs: 0, apiErrors: 12, rageTaps: 8, replayAvailable: false },
        { name: 'Profile', visits: 987, health: 'healthy', crashes: 0, anrs: 0, apiErrors: 5, rageTaps: 3, replayAvailable: false },
        { name: 'Settings', visits: 543, health: 'healthy', crashes: 0, anrs: 0, apiErrors: 2, rageTaps: 2, replayAvailable: false },
    ],
    topScreens: [
        { screen: 'Home', visits: 12847 },
        { screen: 'Products', visits: 9823 },
        { screen: 'Product Detail', visits: 7456 },
        { screen: 'Cart', visits: 4567 },
        { screen: 'Search', visits: 3456 },
        { screen: 'Checkout', visits: 2345 },
        { screen: 'Order Confirmation', visits: 1876 },
        { screen: 'Wishlist', visits: 1234 },
        { screen: 'Profile', visits: 987 },
        { screen: 'Settings', visits: 543 },
    ],
    entryPoints: [
        { screen: 'Home', count: 9876 },
        { screen: 'Product Detail', count: 1876 },
        { screen: 'Products', count: 654 },
        { screen: 'Cart', count: 234 },
        { screen: 'Search', count: 207 },
    ],
    exitPoints: [
        { screen: 'Order Confirmation', count: 1876 },
        { screen: 'Home', count: 2345 },
        { screen: 'Product Detail', count: 1234 },
        { screen: 'Cart', count: 987 },
        { screen: 'Checkout', count: 456 },
    ],
};

// ================================================================================
// Growth Observability (Session health and growth killers)
// ================================================================================

// Generate daily health data for last 30 days
const generateDailyHealth = () => {
    const data = [];
    const now = new Date();
    for (let i = 29; i >= 0; i--) {
        const date = new Date(now);
        date.setDate(date.getDate() - i);
        const dateStr = date.toISOString().split('T')[0];
        const baseClean = 600 + Math.round(Math.random() * 200);
        const baseError = 40 + Math.round(Math.random() * 30);
        const baseRage = 30 + Math.round(Math.random() * 20);
        const baseSlow = 20 + Math.round(Math.random() * 15);
        const baseCrash = 5 + Math.round(Math.random() * 5);
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

export const demoGrowthObservability: GrowthObservability = {
    sessionHealth: {
        clean: 9234,
        error: 1456,
        rage: 876,
        slow: 543,
        crash: 234,
    },
    firstSessionSuccessRate: 72,
    firstSessionStats: {
        total: 2456,
        clean: 1768,
        withCrash: 89,
        withAnr: 45,
        withRageTaps: 234,
        withSlowApi: 320,
    },
    growthKillers: [
        {
            reason: 'API errors on Checkout',
            affectedSessions: 456,
            percentOfTotal: 3.7,
            deltaVsPrevious: 12,
            relatedScreen: 'Checkout',
            sampleSessionIds: ['demo-gk-001', 'demo-gk-002', 'demo-gk-003'],
        },
        {
            reason: 'Slow startup (>3s API latency)',
            affectedSessions: 320,
            percentOfTotal: 2.6,
            deltaVsPrevious: -5,
            relatedScreen: 'Home',
            sampleSessionIds: ['demo-gk-004', 'demo-gk-005'],
        },
        {
            reason: 'Crash on first session',
            affectedSessions: 89,
            percentOfTotal: 0.7,
            deltaVsPrevious: 0,
            sampleSessionIds: ['demo-gk-006', 'demo-gk-007'],
        },
        {
            reason: 'Rage taps on Cart',
            affectedSessions: 234,
            percentOfTotal: 1.9,
            deltaVsPrevious: 8,
            relatedScreen: 'Cart',
            sampleSessionIds: ['demo-gk-008', 'demo-gk-009'],
        },
        {
            reason: 'ANR on first session',
            affectedSessions: 45,
            percentOfTotal: 0.4,
            deltaVsPrevious: -2,
            sampleSessionIds: ['demo-gk-010'],
        },
    ],
    dailyHealth: generateDailyHealth(),
};

// ================================================================================
// Observability Deep Metrics (for Replays/API page)
// ================================================================================

export const demoObservabilityDeepMetrics: ObservabilityDeepMetrics = {
    dataWindow: {
        totalSessions: 12847,
        analyzedSessions: 12847,
        sampled: false,
        visualReplayCoverageRate: 88.4,
        analyticsCoverageRate: 97.2,
    },
    reliability: {
        crashFreeSessionRate: 98.1,
        anrFreeSessionRate: 99.2,
        errorFreeSessionRate: 87.6,
        frustrationFreeSessionRate: 90.4,
        degradedSessionRate: 21.3,
        apiFailureRate: 1.84,
    },
    performance: {
        apiApdex: 0.874,
        p50ApiResponseMs: 168,
        p95ApiResponseMs: 912,
        p99ApiResponseMs: 1430,
        slowApiSessionRate: 7.6,
        p50StartupMs: 980,
        p95StartupMs: 3210,
        slowStartupRate: 12.8,
    },
    impact: {
        uniqueUsers: 8432,
        affectedUsers: 1276,
        affectedUserRate: 15.13,
        issueReoccurrenceRate: 71.4,
    },
    ingestHealth: {
        sdkUploadSuccessRate: 96.8,
        sessionsWithUploadFailures: 214,
        sessionsWithOfflinePersist: 167,
        sessionsWithMemoryEvictions: 73,
        sessionsWithCircuitBreakerOpen: 41,
        sessionsWithHeavyRetries: 92,
    },
    networkBreakdown: [
        { networkType: 'wifi', sessions: 7421, apiCalls: 221879, apiErrorRate: 1.24, avgLatencyMs: 172 },
        { networkType: 'cellular', sessions: 4022, apiCalls: 96444, apiErrorRate: 3.19, avgLatencyMs: 336 },
        { networkType: '5g', sessions: 612, apiCalls: 18890, apiErrorRate: 1.72, avgLatencyMs: 241 },
        { networkType: '4g', sessions: 504, apiCalls: 14492, apiErrorRate: 2.88, avgLatencyMs: 382 },
        { networkType: 'unknown', sessions: 288, apiCalls: 6710, apiErrorRate: 2.06, avgLatencyMs: 298 },
    ],
    releaseRisk: [
        {
            version: '2.4.1',
            sessions: 3456,
            degradedSessions: 973,
            failureRate: 28.15,
            deltaVsOverall: 6.85,
            crashCount: 51,
            anrCount: 19,
            errorCount: 514,
            firstSeen: new Date(Date.now() - 18 * day).toISOString(),
            latestSeen: new Date(Date.now() - 2 * day).toISOString(),
        },
        {
            version: '2.4.0',
            sessions: 2988,
            degradedSessions: 648,
            failureRate: 21.69,
            deltaVsOverall: 0.39,
            crashCount: 32,
            anrCount: 11,
            errorCount: 376,
            firstSeen: new Date(Date.now() - 31 * day).toISOString(),
            latestSeen: new Date(Date.now() - 5 * day).toISOString(),
        },
        {
            version: '2.3.9',
            sessions: 2701,
            degradedSessions: 463,
            failureRate: 17.14,
            deltaVsOverall: -4.16,
            crashCount: 19,
            anrCount: 7,
            errorCount: 292,
            firstSeen: new Date(Date.now() - 54 * day).toISOString(),
            latestSeen: new Date(Date.now() - 9 * day).toISOString(),
        },
    ],
    evidenceSessions: [
        {
            title: 'Crash/ANR outliers',
            description: 'Highest fatal stability impact sessions.',
            metric: 'stability',
            value: '2,734 degraded sessions',
            sessionIds: ['demo-obs-001', 'demo-obs-002', 'demo-obs-003'],
        },
        {
            title: 'API degradation outliers',
            description: 'High latency or high API failure sessions.',
            metric: 'api',
            value: '1.84% API failure rate',
            sessionIds: ['demo-obs-004', 'demo-obs-005', 'demo-obs-006'],
        },
        {
            title: 'Frustration hotspots',
            description: 'Sessions with strong rage/dead tap signals.',
            metric: 'ux-friction',
            value: '9.60% friction sessions',
            sessionIds: ['demo-obs-007', 'demo-obs-008', 'demo-obs-009'],
        },
        {
            title: 'Slow startup evidence',
            description: 'Cold starts above 3 seconds.',
            metric: 'startup',
            value: '12.80% slow startup',
            sessionIds: ['demo-obs-010', 'demo-obs-011', 'demo-obs-012'],
        },
        {
            title: 'SDK upload pipeline failures',
            description: 'Sessions where ingestion reliability degraded.',
            metric: 'ingest',
            value: '214 sessions with upload failures',
            sessionIds: ['demo-obs-013', 'demo-obs-014', 'demo-obs-015'],
        },
    ],
};

// ================================================================================
// User Engagement Trends (unique users per segment per day)
// ================================================================================

const generateUserEngagementTrends = (): UserEngagementTrends => {
    const daily = [];
    const now = new Date();
    let totalBouncers = 0, totalCasuals = 0, totalExplorers = 0, totalLoyalists = 0;

    for (let i = 29; i >= 0; i--) {
        const date = new Date(now);
        date.setDate(date.getDate() - i);
        const dateStr = date.toISOString().split('T')[0];
        const bouncers = 80 + Math.round(Math.random() * 40);
        const casuals = 150 + Math.round(Math.random() * 60);
        const explorers = 200 + Math.round(Math.random() * 80);
        const loyalists = 120 + Math.round(Math.random() * 50);
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
    sessionLimit: 10000,
    sessionsRemaining: 5433,
    percentUsed: 45.67,
    isAtLimit: false,
    isNearLimit: false,
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

import { realEvents } from './realSessionData';

// Process real events
const networkRequests = realEvents
    .filter((e: any) => e.type === 'network_request')
    .map((e: any) => ({
        requestId: e.requestId || `req-${Math.random()}`,
        timestamp: e.timestamp,
        method: e.method || 'GET',
        url: e.url || '',
        urlPath: e.urlPath,
        urlHost: e.urlHost,
        statusCode: e.statusCode || 0,
        duration: e.duration || 0,
        success: e.success ?? (e.statusCode < 400),
        requestBodySize: e.requestBodySize,
        responseBodySize: e.responseBodySize,
        errorMessage: e.errorMessage
    }));

// Filter out network requests from main event stream to avoid duplication
// (The frontend re-combines them on the timeline)
const sessionEvents = realEvents.filter((e: any) => e.type !== 'network_request');

export const demoFullSession = {
    id: DEMO_FEATURED_SESSION_ID,
    userId: 'user-789',
    deviceInfo: {
        model: 'iPhone 15 Pro',
        manufacturer: 'Apple',
        os: 'iOS',
        osVersion: '17.2',
        screenWidth: 393,
        screenHeight: 852,
        pixelRatio: 3,
        appVersion: '2.4.1',
        locale: 'en-US',
        timezone: 'America/Los_Angeles',
    },
    geoLocation: {
        ip: '192.168.1.1',
        country: 'United States',
        countryCode: 'US',
        region: 'California',
        city: 'San Francisco',
        latitude: 37.7749,
        longitude: -122.4194,
        timezone: 'America/Los_Angeles',
    },
    startTime: 1769126989388,
    endTime: 1769126989388 + 42000,
    duration: 42,
    events: sessionEvents,
    networkRequests: networkRequests,
    batches: [],
    stats: {
        duration: '0:42',
        durationMinutes: '0.7',
        eventCount: sessionEvents.length,
        frameCount: 45,
        screenshotSegmentCount: 0,
        totalSizeKB: '1820',
        kbPerMinute: '3640',
        eventsSizeKB: '140',
        screenshotSizeKB: '1780',
        networkStats: {
            total: networkRequests.length,
            successful: networkRequests.filter((r: any) => r.success).length,
            failed: networkRequests.filter((r: any) => !r.success).length,
            avgDuration: 245,
            totalBytes: 45678,
        },
    },
    metrics: {
        totalEvents: sessionEvents.length,
        touchCount: sessionEvents.filter((e: any) => e.type === 'touch' || e.type === 'gesture').length,
        scrollCount: 12,
        gestureCount: 3,
        inputCount: 2,
        navigationCount: sessionEvents.filter((e: any) => e.type === 'navigation' || e.type === 'screen_view').length,
        errorCount: 1,
        rageTapCount: 0,
        apiSuccessCount: networkRequests.filter((r: any) => r.success).length,
        apiErrorCount: networkRequests.filter((r: any) => !r.success).length,
        apiTotalCount: networkRequests.length,
        screensVisited: ['Login', 'Dashboard', 'Settings'],
        uniqueScreensCount: 3,
        interactionScore: 85,
        explorationScore: 72,
        uxScore: 78,
    },
};

// ================================================================================
// Issues Data (for Issues Feed)
// ================================================================================

export const demoIssuesResponse: { issues: Issue[], stats: any, total: number } = {
    issues: [
        {
            id: 'issue-1',
            projectId: 'demo-project',
            fingerprint: 'fp-1',
            issueType: 'crash',
            title: 'NSRangeException',
            subtitle: 'main.m in -[AppDelegate application:didFinishLaunchingWithOptions:]',
            culprit: 'AppDelegate.m:42',
            status: 'unresolved',
            firstSeen: new Date(Date.now() - 7 * day).toISOString(),
            lastSeen: new Date().toISOString(),
            eventCount: 124,
            userCount: 89,
            events24h: 12,
            events90d: 456,
        },
        {
            id: 'issue-2',
            projectId: 'demo-project',
            fingerprint: 'fp-2',
            issueType: 'error',
            title: 'Network Error: 404',
            subtitle: '/api/v1/auth/login',
            culprit: 'NetworkClient.ts:156',
            status: 'unresolved',
            firstSeen: new Date(Date.now() - 3 * day).toISOString(),
            lastSeen: new Date().toISOString(),
            eventCount: 2456,
            userCount: 1234,
            events24h: 312,
            events90d: 8900,
        },
        {
            id: 'issue-3',
            projectId: 'demo-project',
            fingerprint: 'fp-3',
            issueType: 'rage_tap',
            title: 'Rage Taps on "Checkout" button',
            subtitle: 'CartScreen',
            status: 'ongoing',
            firstSeen: new Date(Date.now() - 1 * day).toISOString(),
            lastSeen: new Date().toISOString(),
            eventCount: 45,
            userCount: 32,
            events24h: 15,
            events90d: 120,
        },
    ],
    stats: {
        totalIssues: 3,
        unresolvedCount: 2,
        ongoingCount: 1,
        resolvedCount: 0,
    },
    total: 3,
};

export const demoIssueSessions: IssueSession[] = [
    {
        id: 'session-1',
        deviceModel: 'iPhone 14 Pro',
        platform: 'ios',
        durationSeconds: 145,
        uxScore: 42,
        createdAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
        coverPhotoUrl: null,
    },
    {
        id: 'session-2',
        deviceModel: 'Pixel 7',
        platform: 'android',
        durationSeconds: 234,
        uxScore: 65,
        createdAt: new Date(Date.now() - 25 * 60 * 1000).toISOString(),
        coverPhotoUrl: null,
    },
];

// ================================================================================
// Errors & ANRs (for Errors and ANRs pages)
// ================================================================================

export const demoErrorsResponse: any = {
    errors: [
        {
            id: 'err-1',
            sessionId: 'session-1',
            projectId: 'demo-project',
            timestamp: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
            errorType: 'JS Error',
            errorName: 'TypeError',
            message: 'Cannot read property "map" of undefined',
            stack: `TypeError: Cannot read property 'map' of undefined
    at ProductList.render (ProductList.tsx:42:18)
    at renderWithHooks (react-dom.development.js:14985:18)
    at mountIndeterminateComponent (react-dom.development.js:17811:13)
    at beginWork (react-dom.development.js:19049:16)
    at HTMLUnknownElement.callCallback (react-dom.development.js:3945:14)
    at invokeGuardedCallbackDev (react-dom.development.js:3994:16)
    at invokeGuardedCallback (react-dom.development.js:4056:31)
    at beginWork$1 (react-dom.development.js:23964:7)
    at performUnitOfWork (react-dom.development.js:22776:12)
    at workLoopSync (react-dom.development.js:22707:5)`,
            screenName: 'Products',
            deviceModel: 'iPhone 14 Pro',
            appVersion: '2.4.1'
        },
        {
            id: 'err-2',
            sessionId: 'session-2',
            projectId: 'demo-project',
            timestamp: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
            errorType: 'JS Error',
            errorName: 'ReferenceError',
            message: 'config is not defined',
            stack: `ReferenceError: config is not defined
    at initializeApp (App.tsx:12:3)
    at Object.456 (index.tsx:5:1)
    at __webpack_require__ (bootstrap:19:1)
    at startup:4:1
    at index.tsx:10:1`,
            screenName: 'Home',
            deviceModel: 'Pixel 7',
            appVersion: '2.4.0'
        }
    ],
    summary: {
        total: 2,
        jsErrors: 2,
        promiseRejections: 0,
        unhandledExceptions: 0
    }
};

export const demoANRsResponse: any = {
    anrs: [
        {
            id: 'anr-1',
            sessionId: 'session-1',
            projectId: 'demo-project',
            timestamp: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
            durationMs: 5400,
            threadState: `Thread[main,5,main]
    at android.view.ViewRootImpl.draw(ViewRootImpl.java:4567)
    at android.view.ViewRootImpl.performDraw(ViewRootImpl.java:4231)
    at android.view.ViewRootImpl.performTraversals(ViewRootImpl.java:3123)
    at android.view.ViewRootImpl.doTraversal(ViewRootImpl.java:2121)
    at android.view.Choreographer$FrameDisplayEventReceiver.run(Choreographer.java:1123)
    at android.os.Handler.handleCallback(Handler.java:938)
    at android.os.Handler.dispatchMessage(Handler.java:99)
    at android.os.Looper.loop(Looper.java:223)
    at android.app.ActivityThread.main(ActivityThread.java:7656)
    at java.lang.reflect.Method.invoke(Native Method)`,
            deviceMetadata: {
                deviceModel: 'Samsung Galaxy S23',
                osVersion: 'Android 14',
                appVersion: '2.4.1'
            },
            status: 'open',
            occurrenceCount: 1,
            userCount: 1
        }
    ]
};
