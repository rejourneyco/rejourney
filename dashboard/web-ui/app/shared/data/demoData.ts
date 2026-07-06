/**
 * Demo Data
 * 
 * Static fixture data for demo mode. Provides realistic sample data
 * for all dashboard pages without requiring API calls.
 */

import { Project, RecordingSession, ProjectDailyStats } from '~/shared/types';
import { demoReplayFixture as existingDemoReplayFixture } from './demoReplayData';
import { demoReplayFixture as frankfurtDemoReplayFixture } from './demoReplayDataFrankfurt';
import { demoReplayFixture as webDemoReplayFixture } from './demoReplayDataWeb';

export const DEMO_NOW = Date.UTC(2026, 4, 18, 12, 0, 0);
export const DEMO_NOW_ISO = new Date(DEMO_NOW).toISOString();

let demoRandomSeed = 0x51f15eED;
const demoRandom = () => {
    demoRandomSeed = (demoRandomSeed * 1664525 + 1013904223) >>> 0;
    return demoRandomSeed / 0x100000000;
};

const demoRecordedReplayFixtures = [webDemoReplayFixture, frankfurtDemoReplayFixture, existingDemoReplayFixture] as const;

export const DEMO_REPLAY_SESSION_IDS: string[] = demoRecordedReplayFixtures.map((fixture) => fixture.sessionId);

const demoReplayFixtureById = new Map<string, DemoReplayFixture>(
    demoRecordedReplayFixtures.map((fixture) => [fixture.sessionId, fixture]),
);

function getDemoReplayFrameUrl(fixture: DemoReplayFixture | undefined): string | null {
    if (typeof fixture?.coverPhotoUrl === 'string' && fixture.coverPhotoUrl.trim()) {
        return fixture.coverPhotoUrl;
    }

    const coverFrame = fixture?.screenshotFrames?.find((frame: { file?: string }) => Boolean(frame.file));
    if (!fixture || !coverFrame?.file) return null;
    return `/demo/${fixture.sessionId}/frames/${coverFrame.file}`;
}

function hashDemoCoverSeed(seed: string): number {
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
        hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
    }
    return Math.abs(hash);
}

export function getDemoReplayCoverPhotoUrl(sessionId?: string | null, fallbackSeed?: string | null): string | null {
    const exactFixture = sessionId ? demoReplayFixtureById.get(sessionId) : undefined;
    const exactCover = getDemoReplayFrameUrl(exactFixture);
    if (exactCover) return exactCover;

    if (!fallbackSeed) return null;

    const coverableFixtures = demoRecordedReplayFixtures.filter((fixture) => Boolean(getDemoReplayFrameUrl(fixture)));
    if (coverableFixtures.length === 0) return null;
    const fallbackFixture = coverableFixtures[hashDemoCoverSeed(fallbackSeed) % coverableFixtures.length];
    return getDemoReplayFrameUrl(fallbackFixture);
}

// Keep the featured deep-link on the mobile recording while the replay list shows all recorded demos.
export const DEMO_FEATURED_SESSION_ID = frankfurtDemoReplayFixture.sessionId;

// Demo team for team context
export const DEMO_TEAM = {
    id: 'demo-team',
    name: 'ShopFlow Inc.',
    ownerUserId: 'demo-user',
    billingPlan: 'pro' as const,
    workspaceConfirmedAt: new Date(DEMO_NOW - 180 * 24 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date(DEMO_NOW - 180 * 24 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date(DEMO_NOW).toISOString(),
};

// Demo project
export const demoProjects: Project[] = [
    {
        id: 'demo-project-001',
        name: 'ShopFlow Mobile',
        platforms: ['ios', 'android', 'web'],
        bundleId: 'com.shopflow.mobile',
        webDomain: 'shopflow.example',
        webAllowedDomains: ['shopflow.example', 'checkout.shopflow.example'],
        teamId: 'demo-team',
        publicKey: 'rj_XXXXXXXX',
        rejourneyEnabled: true,
        recordingEnabled: true,
        imageVideoMasking: 'none',
        recordingFps: 1,
        sampleRate: 100,
        maxRecordingMinutes: 10,
        webMaxObservabilityMinutes: 30,
        createdAt: new Date(DEMO_NOW - 90 * 24 * 60 * 60 * 1000).toISOString(),
        sessionsLast7Days: 462,
        errorsLast7Days: 6,
    }
];

// Demo dashboard stats
export const demoDashboardStats = {
    totalSessions: 1842,
    avgDuration: 389, // 6.5 minutes in seconds
    errorRate: 1.1
};

// Generate time helpers
const now = DEMO_NOW;
const hour = 60 * 60 * 1000;
const day = 24 * hour;

type DemoReplayFixture = any;

type DemoReplaySessionMetadata = {
    userId?: string;
    deviceId: string;
    anonymousDisplayName?: string;
    isFirstSession: boolean;
    userFirstSeenAt: string;
    visitorSessionNumber: number;
    visitorFinalSessionNumber: number;
    appStartupTimeMs: number;
    retentionDays: number;
    retentionTier: 1 | 2 | 3 | 4 | 5 | 6;
    sdkVersion: string;
    networkType: NonNullable<RecordingSession['networkType']>;
    cellularGeneration?: RecordingSession['cellularGeneration'];
    checkoutStatus: NonNullable<RecordingSession['checkoutStatus']>;
    metadata: Record<string, unknown>;
};

const demoReplaySessionMetadataById: Record<string, DemoReplaySessionMetadata> = {
    [webDemoReplayFixture.sessionId]: {
        userId: '9f73c1e0-5b6a-4f22-9e31-2a54f6c8d7b0',
        deviceId: 'demo-web-device-docs-001',
        anonymousDisplayName: 'WebVisitor9B4C',
        isFirstSession: false,
        userFirstSeenAt: new Date(webDemoReplayFixture.startTime - 3 * day).toISOString(),
        visitorSessionNumber: 3,
        visitorFinalSessionNumber: 7,
        appStartupTimeMs: 1539,
        retentionDays: 30,
        retentionTier: 3,
        sdkVersion: '0.3.0',
        networkType: 'wired',
        checkoutStatus: 'none',
        metadata: {
            appName: 'Rejourney Website',
            appBundleId: 'rejourney.co',
            demoSource: 'sanitized-prod-rrweb-trim',
            userSegment: 'evaluating_team',
            loyaltyTier: 'Researching',
            acquisitionChannel: 'internal_docs',
            plan: 'growth',
            featureArea: 'web sdk docs',
            browser: 'Chrome',
            browserVersion: '148.0.7778.181',
            os: 'macOS',
            osVersion: '26.5.0',
            userAgent: webDemoReplayFixture.deviceInfo.userAgent,
            webReferral: 'https://www.reddit.com/r/webdev/comments/1eg9z1/check_out_rejourney_the_ultimate_session_replay_tool?utm_source=reddit&utm_medium=ads&utm_campaign=rejourney-launch&utm_content=classic-ad',
            utm_source: 'reddit',
            utm_medium: 'ads',
            utm_campaign: 'rejourney-launch',
            utm_content: 'classic-ad',
        },
    },
    [frankfurtDemoReplayFixture.sessionId]: {
        deviceId: 'demo-device-frankfurt-001',
        anonymousDisplayName: 'CoffeeRegular8F2A',
        isFirstSession: true,
        userFirstSeenAt: new Date(frankfurtDemoReplayFixture.startTime).toISOString(),
        visitorSessionNumber: 1,
        visitorFinalSessionNumber: 16,
        appStartupTimeMs: 684,
        retentionDays: 30,
        retentionTier: 3,
        sdkVersion: '1.1.0',
        networkType: 'wifi',
        checkoutStatus: 'none',
        metadata: {
            appName: 'Brew Coffee Labs',
            appBundleId: 'com.example.brew',
            demoSource: 'live-docker',
            userSegment: 'new_user',
            loyaltyTier: 'New',
            acquisitionChannel: 'community',
            plan: 'premium',
            featureArea: 'recipe discovery',
        },
    },
    [existingDemoReplayFixture.sessionId]: {
        deviceId: 'demo-device-001',
        anonymousDisplayName: 'AustinRegular4C1D',
        isFirstSession: false,
        userFirstSeenAt: new Date(DEMO_NOW - 21 * day).toISOString(),
        visitorSessionNumber: 6,
        visitorFinalSessionNumber: 9,
        appStartupTimeMs: 913,
        retentionDays: 30,
        retentionTier: 3,
        sdkVersion: '1.0.8',
        networkType: 'wifi',
        checkoutStatus: 'none',
        metadata: {
            appName: 'Campus Merch Live',
            appBundleId: 'com.codeolive.Merch',
            demoSource: 'demo-archive',
            userSegment: 'regular',
            loyaltyTier: 'Regular',
            acquisitionChannel: 'direct',
            plan: 'standard',
            featureArea: 'map and post discovery',
        },
    },
};

export const getDemoReplaySessionMetadata = (sessionId: string) => demoReplaySessionMetadataById[sessionId];

const buildRecordedDemoSession = (
    fixture: DemoReplayFixture,
    deviceId: string,
    isFirstSession: boolean
): RecordingSession => {
    const startupEvent = fixture.events.find((event: any) => event.type === 'app_startup') as { durationMs?: number } | undefined;
    const rawOs = String(fixture.deviceInfo.os || '').toLowerCase();
    const platform: RecordingSession['platform'] = rawOs === 'android' ? 'android' : rawOs === 'ios' ? 'ios' : 'web';
    const replayMetadata = getDemoReplaySessionMetadata(fixture.sessionId);
    const appStartupTimeMs = Math.round(startupEvent?.durationMs ?? replayMetadata?.appStartupTimeMs ?? 0);

    return {
        id: fixture.sessionId,
        projectId: 'demo-project-001',
        startedAt: new Date(fixture.startTime).toISOString(),
        endedAt: new Date(fixture.endTime).toISOString(),
        durationSeconds: fixture.durationSeconds,
        platform,
        appVersion: fixture.deviceInfo.appVersion || '1.0.0',
        sdkVersion: fixture.deviceInfo.sdkVersion || replayMetadata?.sdkVersion,
        deviceModel: fixture.deviceInfo.model || 'Unknown device',
        osVersion: fixture.deviceInfo.osVersion || 'Unknown',
        webReferral: (replayMetadata?.metadata?.webReferral as string) || fixture.webReferral || null,
        webLandingRoute: fixture.webLandingRoute ?? (platform === 'web' ? '/' : null),
        metadata: replayMetadata?.metadata,
        userId: (
            fixture.events.find((event: any) => event.type === 'user_identity_changed' && event.userId)?.userId ||
            replayMetadata?.userId ||
            'demo-user'
        ),
        anonymousDisplayName: replayMetadata?.anonymousDisplayName,
        deviceId: replayMetadata?.deviceId || deviceId,
        geoLocation: fixture.geoLocation,
        totalEvents: fixture.metrics.totalEvents,
        errorCount: fixture.metrics.errorCount,
        touchCount: fixture.metrics.touchCount,
        scrollCount: fixture.metrics.scrollCount,
        gestureCount: fixture.metrics.gestureCount,
        inputCount: fixture.metrics.inputCount,
        apiSuccessCount: fixture.stats.networkStats.successful,
        apiErrorCount: fixture.stats.networkStats.failed,
        apiTotalCount: fixture.stats.networkStats.total,
        apiAvgResponseMs: fixture.stats.networkStats.avgDuration,
        rageTapCount: fixture.metrics.rageTapCount ?? 0,
        deadTapCount: fixture.metrics.deadTapCount ?? fixture.events.filter((event: any) => event.frustrationKind === 'dead_tap').length,
        screensVisited: fixture.screensVisited,
        interactionScore: fixture.metrics.interactionScore ?? 79,
        explorationScore: fixture.metrics.explorationScore ?? 64,
        customEventCount: fixture.metrics.customEventCount,
        crashCount: fixture.metrics.crashCount ?? 0,
        anrCount: fixture.metrics.anrCount ?? 0,
        appStartupTimeMs,
        networkType: fixture.metrics.networkType || replayMetadata?.networkType || 'wifi',
        cellularGeneration: replayMetadata?.cellularGeneration,
        status: 'ready',
        effectiveStatus: 'ready',
        canOpenReplay: true,
        recordingDeleted: false,
        recordingDeletedAt: null,
        retentionDays: replayMetadata?.retentionDays,
        retentionTier: replayMetadata?.retentionTier,
        hasSuccessfulRecording: true,
        isFirstSession: replayMetadata?.isFirstSession ?? isFirstSession,
        userFirstSeenAt: replayMetadata?.userFirstSeenAt,
        visitorSessionNumber: replayMetadata?.visitorSessionNumber,
        visitorFinalSessionNumber: replayMetadata?.visitorFinalSessionNumber,
        checkoutStatus: replayMetadata?.checkoutStatus,
    };
};

// Demo sessions - varied states to showcase different features
const demoBaseSessions: RecordingSession[] = [
    buildRecordedDemoSession(webDemoReplayFixture, 'demo-web-device-docs-001', false),
    buildRecordedDemoSession(frankfurtDemoReplayFixture, 'demo-device-frankfurt-001', true),
    buildRecordedDemoSession(existingDemoReplayFixture, 'demo-device-001', false),
    // Session with crash
    {
        id: 'demo-session-002',
        projectId: 'demo-project-001',
        startedAt: new Date(now - 4 * hour).toISOString(),
        endedAt: new Date(now - 3.8 * hour).toISOString(),
        durationSeconds: 720,
        platform: 'android',
        appVersion: '2.3.0',
        deviceModel: 'Pixel 8 Pro',
        osVersion: '14',
        userId: 'user_new_042',
        deviceId: 'demo-device-002',
        geoLocation: {
            city: 'San Francisco',
            region: 'California',
            country: 'United States',
            countryCode: 'US'
        },
        totalEvents: 145,
        errorCount: 1,
        touchCount: 45,
        scrollCount: 32,
        gestureCount: 8,
        inputCount: 3,
        apiSuccessCount: 23,
        apiErrorCount: 1,
        apiTotalCount: 24,
        apiAvgResponseMs: 312,
        rageTapCount: 0,
        screensVisited: ['Home', 'Search', 'Products'],
        interactionScore: 65,
        explorationScore: 58,
        customEventCount: 2,
        crashCount: 1,
        anrCount: 0,
        appStartupTimeMs: 850,
        networkType: 'cellular',
        cellularGeneration: '5G',
        status: 'ready',
        isFirstSession: true,
    },
    // High engagement session
    {
        id: 'demo-session-003',
        projectId: 'demo-project-001',
        startedAt: new Date(now - 6 * hour).toISOString(),
        endedAt: new Date(now - 5 * hour).toISOString(),
        durationSeconds: 3600,
        platform: 'ios',
        appVersion: '2.3.1',
        deviceModel: 'iPhone 14',
        osVersion: '17.1',
        userId: 'user_loyal_007',
        deviceId: 'demo-device-003',
        geoLocation: {
            city: 'New York',
            region: 'New York',
            country: 'United States',
            countryCode: 'US'
        },
        totalEvents: 512,
        errorCount: 0,
        touchCount: 178,
        scrollCount: 145,
        gestureCount: 34,
        inputCount: 12,
        apiSuccessCount: 89,
        apiErrorCount: 0,
        apiTotalCount: 89,
        apiAvgResponseMs: 156,
        rageTapCount: 0,
        screensVisited: ['Home', 'Products', 'Product Detail', 'Wishlist', 'Cart', 'Checkout', 'Order Confirmation'],
        interactionScore: 95,
        explorationScore: 92,
        customEventCount: 8,
        crashCount: 0,
        anrCount: 0,
        appStartupTimeMs: 850,
        networkType: 'wifi',
        status: 'ready'
    },
    // Bounce session (short duration)
    {
        id: 'demo-session-004',
        projectId: 'demo-project-001',
        startedAt: new Date(now - 8 * hour).toISOString(),
        endedAt: new Date(now - 7.98 * hour).toISOString(),
        durationSeconds: 72,
        platform: 'android',
        appVersion: '2.3.1',
        deviceModel: 'Samsung Galaxy S24',
        osVersion: '14',
        anonymousDisplayName: 'FluffyPanda7F2B9C',
        deviceId: 'demo-device-004',
        geoLocation: {
            city: 'London',
            region: 'England',
            country: 'United Kingdom',
            countryCode: 'GB'
        },
        totalEvents: 12,
        errorCount: 0,
        touchCount: 5,
        scrollCount: 3,
        gestureCount: 0,
        inputCount: 0,
        apiSuccessCount: 4,
        apiErrorCount: 0,
        apiTotalCount: 4,
        apiAvgResponseMs: 890,
        rageTapCount: 0,
        screensVisited: ['Home'],
        interactionScore: 15,
        explorationScore: 8,
        customEventCount: 0,
        crashCount: 0,
        anrCount: 0,
        appStartupTimeMs: 850,
        networkType: 'cellular',
        cellularGeneration: '4G',
        isExpensive: true,
        status: 'ready'
    },
    // Session with rage taps
    {
        id: 'demo-session-005',
        projectId: 'demo-project-001',
        startedAt: new Date(now - 12 * hour).toISOString(),
        endedAt: new Date(now - 11.7 * hour).toISOString(),
        durationSeconds: 1080,
        platform: 'ios',
        appVersion: '2.2.9',
        deviceModel: 'iPhone 13 mini',
        osVersion: '16.7',
        userId: 'user_frustrated_088',
        deviceId: 'demo-device-005',
        geoLocation: {
            city: 'Chicago',
            region: 'Illinois',
            country: 'United States',
            countryCode: 'US'
        },
        totalEvents: 234,
        errorCount: 0,
        touchCount: 112,
        scrollCount: 56,
        gestureCount: 8,
        inputCount: 15,
        apiSuccessCount: 34,
        apiErrorCount: 2,
        apiTotalCount: 36,
        apiAvgResponseMs: 780,
        rageTapCount: 8,
        deadTapCount: 4,
        screensVisited: ['Home', 'Products', 'Product Detail', 'Cart', 'Checkout'],
        interactionScore: 78,
        explorationScore: 65,
        customEventCount: 3,
        crashCount: 0,
        anrCount: 0,
        appStartupTimeMs: 850,
        networkType: 'wifi',
        status: 'ready'
    },
    // European user
    {
        id: 'demo-session-006',
        projectId: 'demo-project-001',
        startedAt: new Date(now - 1 * day).toISOString(),
        endedAt: new Date(now - 1 * day + 25 * 60 * 1000).toISOString(),
        durationSeconds: 1500,
        platform: 'ios',
        appVersion: '2.3.1',
        deviceModel: 'iPhone 15',
        osVersion: '17.2',
        userId: 'user_eu_034',
        deviceId: 'demo-device-006',
        geoLocation: {
            city: 'Berlin',
            region: 'Berlin',
            country: 'Germany',
            countryCode: 'DE'
        },
        totalEvents: 198,
        errorCount: 0,
        touchCount: 67,
        scrollCount: 45,
        gestureCount: 9,
        inputCount: 6,
        apiSuccessCount: 38,
        apiErrorCount: 0,
        apiTotalCount: 38,
        apiAvgResponseMs: 234,
        rageTapCount: 1,
        screensVisited: ['Home', 'Products', 'Product Detail', 'Cart'],
        interactionScore: 76,
        explorationScore: 68,
        customEventCount: 4,
        crashCount: 0,
        anrCount: 0,
        appStartupTimeMs: 850,
        networkType: 'wifi',
        status: 'ready'
    },
    // Asian user
    {
        id: 'demo-session-007',
        projectId: 'demo-project-001',
        startedAt: new Date(now - 1.5 * day).toISOString(),
        endedAt: new Date(now - 1.5 * day + 18 * 60 * 1000).toISOString(),
        durationSeconds: 1080,
        platform: 'android',
        appVersion: '2.3.0',
        deviceModel: 'OnePlus 12',
        osVersion: '14',
        userId: 'user_asia_012',
        deviceId: 'demo-device-007',
        geoLocation: {
            city: 'Tokyo',
            region: 'Tokyo',
            country: 'Japan',
            countryCode: 'JP'
        },
        totalEvents: 167,
        errorCount: 0,
        touchCount: 58,
        scrollCount: 42,
        gestureCount: 7,
        inputCount: 4,
        apiSuccessCount: 32,
        apiErrorCount: 0,
        apiTotalCount: 32,
        apiAvgResponseMs: 189,
        rageTapCount: 0,
        screensVisited: ['Home', 'Search', 'Products', 'Product Detail'],
        interactionScore: 72,
        explorationScore: 70,
        customEventCount: 2,
        crashCount: 0,
        anrCount: 0,
        appStartupTimeMs: 850,
        networkType: 'wifi',
        status: 'ready'
    },
    // Multiple crashes session
    {
        id: 'demo-session-008',
        projectId: 'demo-project-001',
        startedAt: new Date(now - 2 * day).toISOString(),
        endedAt: new Date(now - 2 * day + 5 * 60 * 1000).toISOString(),
        durationSeconds: 300,
        platform: 'android',
        appVersion: '2.2.8',
        deviceModel: 'Samsung Galaxy A54',
        osVersion: '13',
        userId: 'user_crash_099',
        deviceId: 'demo-device-008',
        geoLocation: {
            city: 'Mumbai',
            region: 'Maharashtra',
            country: 'India',
            countryCode: 'IN'
        },
        totalEvents: 45,
        errorCount: 3,
        touchCount: 18,
        scrollCount: 12,
        gestureCount: 2,
        inputCount: 1,
        apiSuccessCount: 8,
        apiErrorCount: 4,
        apiTotalCount: 12,
        apiAvgResponseMs: 1250,
        rageTapCount: 2,
        screensVisited: ['Home', 'Products'],
        interactionScore: 35,
        explorationScore: 28,
        customEventCount: 0,
        crashCount: 2,
        anrCount: 0,
        appStartupTimeMs: 850,
        networkType: 'cellular',
        cellularGeneration: '4G',
        isConstrained: true,
        status: 'ready'
    },
    // Perfect session
    {
        id: 'demo-session-009',
        projectId: 'demo-project-001',
        startedAt: new Date(now - 2.5 * day).toISOString(),
        endedAt: new Date(now - 2.5 * day + 45 * 60 * 1000).toISOString(),
        durationSeconds: 2700,
        platform: 'ios',
        appVersion: '2.3.1',
        deviceModel: 'iPad Pro 12.9"',
        osVersion: '17.2',
        userId: 'user_power_001',
        deviceId: 'demo-device-009',
        geoLocation: {
            city: 'Seattle',
            region: 'Washington',
            country: 'United States',
            countryCode: 'US'
        },
        totalEvents: 456,
        errorCount: 0,
        touchCount: 145,
        scrollCount: 123,
        gestureCount: 28,
        inputCount: 9,
        apiSuccessCount: 78,
        apiErrorCount: 0,
        apiTotalCount: 78,
        apiAvgResponseMs: 134,
        rageTapCount: 0,
        screensVisited: ['Home', 'Categories', 'Products', 'Product Detail', 'Reviews', 'Cart', 'Checkout', 'Order Confirmation', 'Order History'],
        interactionScore: 98,
        explorationScore: 95,
        customEventCount: 12,
        crashCount: 0,
        anrCount: 0,
        appStartupTimeMs: 850,
        networkType: 'wifi',
        status: 'ready'
    },
    // Slow network session
    {
        id: 'demo-session-010',
        projectId: 'demo-project-001',
        startedAt: new Date(now - 3 * day).toISOString(),
        endedAt: new Date(now - 3 * day + 12 * 60 * 1000).toISOString(),
        durationSeconds: 720,
        platform: 'android',
        appVersion: '2.3.0',
        deviceModel: 'Xiaomi Redmi Note 12',
        osVersion: '13',
        anonymousDisplayName: 'SparklyFalcon8D3E7A',
        deviceId: 'demo-device-010',
        geoLocation: {
            city: 'São Paulo',
            region: 'São Paulo',
            country: 'Brazil',
            countryCode: 'BR'
        },
        totalEvents: 89,
        errorCount: 1,
        touchCount: 34,
        scrollCount: 28,
        gestureCount: 4,
        inputCount: 2,
        apiSuccessCount: 15,
        apiErrorCount: 3,
        apiTotalCount: 18,
        apiAvgResponseMs: 2340,
        rageTapCount: 4,
        screensVisited: ['Home', 'Products', 'Product Detail'],
        interactionScore: 48,
        explorationScore: 42,
        customEventCount: 1,
        crashCount: 0,
        anrCount: 2,
        appStartupTimeMs: 850,
        networkType: 'cellular',
        cellularGeneration: '3G',
        isConstrained: true,
        isExpensive: true,
        status: 'ready'
    },
    // Quick checkout session
    {
        id: 'demo-session-011',
        projectId: 'demo-project-001',
        startedAt: new Date(now - 3.5 * day).toISOString(),
        endedAt: new Date(now - 3.5 * day + 8 * 60 * 1000).toISOString(),
        durationSeconds: 480,
        platform: 'ios',
        appVersion: '2.3.1',
        deviceModel: 'iPhone 14 Pro Max',
        osVersion: '17.1',
        userId: 'user_returning_022',
        deviceId: 'demo-device-011',
        geoLocation: {
            city: 'Los Angeles',
            region: 'California',
            country: 'United States',
            countryCode: 'US'
        },
        totalEvents: 78,
        errorCount: 0,
        touchCount: 28,
        scrollCount: 18,
        gestureCount: 5,
        inputCount: 2,
        apiSuccessCount: 18,
        apiErrorCount: 0,
        apiTotalCount: 18,
        apiAvgResponseMs: 167,
        rageTapCount: 0,
        screensVisited: ['Home', 'Cart', 'Checkout', 'Order Confirmation'],
        interactionScore: 88,
        explorationScore: 45,
        customEventCount: 3,
        crashCount: 0,
        anrCount: 0,
        appStartupTimeMs: 850,
        networkType: 'wifi',
        status: 'ready'
    },
    // Search-heavy session
    {
        id: 'demo-session-012',
        projectId: 'demo-project-001',
        startedAt: new Date(now - 4 * day).toISOString(),
        endedAt: new Date(now - 4 * day + 22 * 60 * 1000).toISOString(),
        durationSeconds: 1320,
        platform: 'android',
        appVersion: '2.3.1',
        deviceModel: 'Google Pixel 7a',
        osVersion: '14',
        userId: 'user_searcher_055',
        deviceId: 'demo-device-012',
        geoLocation: {
            city: 'Toronto',
            region: 'Ontario',
            country: 'Canada',
            countryCode: 'CA'
        },
        totalEvents: 234,
        errorCount: 0,
        touchCount: 72,
        scrollCount: 89,
        gestureCount: 11,
        inputCount: 18,
        apiSuccessCount: 45,
        apiErrorCount: 0,
        apiTotalCount: 45,
        apiAvgResponseMs: 198,
        rageTapCount: 1,
        screensVisited: ['Home', 'Search', 'Search Results', 'Products', 'Product Detail', 'Search', 'Search Results'],
        interactionScore: 75,
        explorationScore: 82,
        customEventCount: 6,
        crashCount: 0,
        anrCount: 0,
        appStartupTimeMs: 850,
        networkType: 'wifi',
        status: 'ready'
    },
    // Cart abandonment
    {
        id: 'demo-session-013',
        projectId: 'demo-project-001',
        startedAt: new Date(now - 5 * day).toISOString(),
        endedAt: new Date(now - 5 * day + 15 * 60 * 1000).toISOString(),
        durationSeconds: 900,
        platform: 'ios',
        appVersion: '2.3.0',
        deviceModel: 'iPhone 12',
        osVersion: '16.7',
        userId: 'user_abandoned_033',
        deviceId: 'demo-device-013',
        geoLocation: {
            city: 'Miami',
            region: 'Florida',
            country: 'United States',
            countryCode: 'US'
        },
        totalEvents: 145,
        errorCount: 0,
        touchCount: 52,
        scrollCount: 38,
        gestureCount: 7,
        inputCount: 4,
        apiSuccessCount: 28,
        apiErrorCount: 0,
        apiTotalCount: 28,
        apiAvgResponseMs: 212,
        rageTapCount: 2,
        screensVisited: ['Home', 'Products', 'Product Detail', 'Cart', 'Checkout'],
        interactionScore: 68,
        explorationScore: 62,
        customEventCount: 4,
        crashCount: 0,
        anrCount: 0,
        appStartupTimeMs: 850,
        networkType: 'cellular',
        cellularGeneration: '5G',
        status: 'ready'
    },
    // Recent session - currently recording
    {
        id: 'demo-session-014',
        projectId: 'demo-project-001',
        startedAt: new Date(now - 5 * 60 * 1000).toISOString(),
        durationSeconds: 300,
        platform: 'ios',
        appVersion: '2.3.1',
        deviceModel: 'iPhone 15 Pro Max',
        osVersion: '17.2',
        userId: 'user_live_001',
        deviceId: 'demo-device-014',
        geoLocation: {
            city: 'Denver',
            region: 'Colorado',
            country: 'United States',
            countryCode: 'US'
        },
        totalEvents: 45,
        errorCount: 0,
        touchCount: 18,
        scrollCount: 12,
        gestureCount: 3,
        inputCount: 1,
        apiSuccessCount: 12,
        apiErrorCount: 0,
        apiTotalCount: 12,
        apiAvgResponseMs: 145,
        rageTapCount: 0,
        screensVisited: ['Home', 'Products'],
        interactionScore: 72,
        explorationScore: 45,
        customEventCount: 1,
        crashCount: 0,
        anrCount: 0,
        appStartupTimeMs: 850,
        networkType: 'wifi',
        status: 'recording'
    },
    // Old session (7 days ago)
    {
        id: 'demo-session-015',
        projectId: 'demo-project-001',
        startedAt: new Date(now - 7 * day).toISOString(),
        endedAt: new Date(now - 7 * day + 35 * 60 * 1000).toISOString(),
        durationSeconds: 2100,
        platform: 'android',
        appVersion: '2.2.5',
        deviceModel: 'Samsung Galaxy S23 Ultra',
        osVersion: '13',
        userId: 'user_weekly_078',
        deviceId: 'demo-device-015',
        geoLocation: {
            city: 'Sydney',
            region: 'New South Wales',
            country: 'Australia',
            countryCode: 'AU'
        },
        totalEvents: 345,
        errorCount: 1,
        touchCount: 112,
        scrollCount: 98,
        gestureCount: 18,
        inputCount: 7,
        apiSuccessCount: 56,
        apiErrorCount: 2,
        apiTotalCount: 58,
        apiAvgResponseMs: 278,
        rageTapCount: 1,
        screensVisited: ['Home', 'Products', 'Product Detail', 'Wishlist', 'Cart', 'Checkout'],
        interactionScore: 82,
        explorationScore: 78,
        customEventCount: 5,
        crashCount: 0,
        anrCount: 0,
        appStartupTimeMs: 850,
        networkType: 'wifi',
        status: 'ready'
    },
    // Web sessions with referral attribution for the demo overview dashboard
    {
        id: 'demo-web-session-001',
        projectId: 'demo-project-001',
        startedAt: new Date(now - 35 * 60 * 1000).toISOString(),
        endedAt: new Date(now - 28 * 60 * 1000).toISOString(),
        durationSeconds: 420,
        platform: 'web',
        appVersion: 'web-2026.05.1',
        deviceModel: 'Chrome on macOS',
        osVersion: 'macOS 15',
        webReferral: 'www.google.com',
        webLandingRoute: '/collections/summer-edit',
        metadata: {
            webReferral: 'www.google.com',
            webReferrerDomain: 'www.google.com',
            webAttributionSource: 'google',
            webAttributionChannel: 'organic_search',
            webAttributionCampaign: 'summer-edit',
            utm_source: 'google',
            utm_campaign: 'summer-edit',
        },
        anonymousDisplayName: 'WebVisitorA184F0',
        deviceId: 'demo-web-device-001',
        geoLocation: {
            city: 'Austin',
            region: 'Texas',
            country: 'United States',
            countryCode: 'US'
        },
        totalEvents: 88,
        errorCount: 0,
        touchCount: 28,
        scrollCount: 41,
        gestureCount: 0,
        inputCount: 3,
        apiSuccessCount: 19,
        apiErrorCount: 0,
        apiTotalCount: 19,
        apiAvgResponseMs: 132,
        rageTapCount: 0,
        screensVisited: ['/collections/summer-edit', '/products/linen-jacket', '/cart'],
        interactionScore: 83,
        explorationScore: 76,
        customEventCount: 4,
        crashCount: 0,
        anrCount: 0,
        networkType: 'wifi',
        status: 'ready',
        hasSuccessfulRecording: true,
        isFirstSession: true,
    },
    {
        id: 'demo-web-session-002',
        projectId: 'demo-project-001',
        startedAt: new Date(now - 2.2 * hour).toISOString(),
        endedAt: new Date(now - 2.05 * hour).toISOString(),
        durationSeconds: 540,
        platform: 'web',
        appVersion: 'web-2026.05.1',
        deviceModel: 'Safari on iPhone',
        osVersion: 'iOS 18',
        webReferral: 'instagram.com',
        webLandingRoute: '/drops/early-access',
        metadata: {
            webReferral: 'instagram.com',
            webReferrerDomain: 'instagram.com',
            webAttributionSource: 'instagram',
            webAttributionChannel: 'paid_social',
            webAttributionCampaign: 'creator-drop',
            utm_source: 'instagram',
            utm_campaign: 'creator-drop',
        },
        anonymousDisplayName: 'WebVisitorC82D11',
        deviceId: 'demo-web-device-002',
        geoLocation: {
            city: 'Los Angeles',
            region: 'California',
            country: 'United States',
            countryCode: 'US'
        },
        totalEvents: 126,
        errorCount: 1,
        touchCount: 48,
        scrollCount: 56,
        gestureCount: 1,
        inputCount: 5,
        apiSuccessCount: 27,
        apiErrorCount: 1,
        apiTotalCount: 28,
        apiAvgResponseMs: 218,
        rageTapCount: 1,
        screensVisited: ['/drops/early-access', '/products/canvas-tote', '/checkout'],
        interactionScore: 71,
        explorationScore: 69,
        customEventCount: 6,
        crashCount: 0,
        anrCount: 0,
        networkType: 'cellular',
        cellularGeneration: '5G',
        status: 'ready',
        hasSuccessfulRecording: true,
        isFirstSession: true,
    },
    {
        id: 'demo-web-session-003',
        projectId: 'demo-project-001',
        startedAt: new Date(now - 3.5 * hour).toISOString(),
        endedAt: new Date(now - 3.38 * hour).toISOString(),
        durationSeconds: 430,
        platform: 'web',
        appVersion: 'web-2026.05.1',
        deviceModel: 'Chrome on Windows',
        osVersion: 'Windows 11',
        webReferral: 'producthunt.com',
        webLandingRoute: '/new-arrivals',
        metadata: {
            webReferral: 'producthunt.com',
            webReferrerDomain: 'producthunt.com',
            webAttributionSource: 'producthunt',
            webAttributionChannel: 'launch',
            webAttributionCampaign: 'spring-launch',
            utm_source: 'producthunt',
            utm_campaign: 'spring-launch',
        },
        anonymousDisplayName: 'WebVisitorE61A93',
        deviceId: 'demo-web-device-003',
        geoLocation: {
            city: 'Toronto',
            region: 'Ontario',
            country: 'Canada',
            countryCode: 'CA'
        },
        totalEvents: 74,
        errorCount: 0,
        touchCount: 22,
        scrollCount: 36,
        gestureCount: 0,
        inputCount: 2,
        apiSuccessCount: 16,
        apiErrorCount: 0,
        apiTotalCount: 16,
        apiAvgResponseMs: 176,
        rageTapCount: 0,
        screensVisited: ['/new-arrivals', '/products/city-backpack'],
        interactionScore: 79,
        explorationScore: 81,
        customEventCount: 3,
        crashCount: 0,
        anrCount: 0,
        networkType: 'wifi',
        status: 'ready',
        hasSuccessfulRecording: true,
        isFirstSession: true,
    },
    {
        id: 'demo-web-session-004',
        projectId: 'demo-project-001',
        startedAt: new Date(now - 5.8 * hour).toISOString(),
        endedAt: new Date(now - 5.72 * hour).toISOString(),
        durationSeconds: 288,
        platform: 'web',
        appVersion: 'web-2026.05.1',
        deviceModel: 'Firefox on Linux',
        osVersion: 'Ubuntu 24.04',
        webReferral: 'news.ycombinator.com',
        webLandingRoute: '/engineering/replay-speed',
        metadata: {
            webReferral: 'news.ycombinator.com',
            webReferrerDomain: 'news.ycombinator.com',
            webAttributionSource: 'hacker_news',
            webAttributionChannel: 'community',
            webAttributionCampaign: 'engineering-post',
            utm_source: 'hacker_news',
            utm_campaign: 'engineering-post',
        },
        anonymousDisplayName: 'WebVisitorF0A221',
        deviceId: 'demo-web-device-004',
        geoLocation: {
            city: 'Berlin',
            region: 'Berlin',
            country: 'Germany',
            countryCode: 'DE'
        },
        totalEvents: 52,
        errorCount: 0,
        touchCount: 14,
        scrollCount: 29,
        gestureCount: 0,
        inputCount: 1,
        apiSuccessCount: 9,
        apiErrorCount: 0,
        apiTotalCount: 9,
        apiAvgResponseMs: 164,
        rageTapCount: 0,
        screensVisited: ['/engineering/replay-speed', '/pricing'],
        interactionScore: 67,
        explorationScore: 72,
        customEventCount: 2,
        crashCount: 0,
        anrCount: 0,
        networkType: 'wifi',
        status: 'ready',
        hasSuccessfulRecording: true,
        isFirstSession: true,
    },
    {
        id: 'demo-web-session-005',
        projectId: 'demo-project-001',
        startedAt: new Date(now - 9.25 * hour).toISOString(),
        endedAt: new Date(now - 9.2 * hour).toISOString(),
        durationSeconds: 180,
        platform: 'web',
        appVersion: 'web-2026.05.0',
        deviceModel: 'Edge on Windows',
        osVersion: 'Windows 11',
        webReferral: null,
        webLandingRoute: '/',
        metadata: {
            webAttributionSource: 'direct',
            webAttributionChannel: 'direct',
        },
        anonymousDisplayName: 'WebVisitorD91B73',
        deviceId: 'demo-web-device-005',
        geoLocation: {
            city: 'London',
            region: 'England',
            country: 'United Kingdom',
            countryCode: 'GB'
        },
        totalEvents: 31,
        errorCount: 0,
        touchCount: 9,
        scrollCount: 14,
        gestureCount: 0,
        inputCount: 0,
        apiSuccessCount: 6,
        apiErrorCount: 0,
        apiTotalCount: 6,
        apiAvgResponseMs: 143,
        rageTapCount: 0,
        screensVisited: ['/', '/pricing'],
        interactionScore: 54,
        explorationScore: 42,
        customEventCount: 1,
        crashCount: 0,
        anrCount: 0,
        networkType: 'wifi',
        status: 'ready',
        hasSuccessfulRecording: true,
        isFirstSession: true,
    }
];

const demoReferralSourceFixtures = [
    { source: 'www.google.com', channel: 'organic_search', campaign: 'summer-edit', sessions: 24 },
    { source: 'instagram.com', channel: 'paid_social', campaign: 'creator-drop', sessions: 18 },
    { source: null, channel: 'direct', campaign: null, sessions: 15 },
    { source: 'producthunt.com', channel: 'launch', campaign: 'spring-launch', sessions: 11 },
    { source: 'youtube.com', channel: 'video', campaign: 'review-roundup', sessions: 9 },
    { source: 'linkedin.com', channel: 'organic_social', campaign: 'founder-post', sessions: 9 },
    { source: 'x.com', channel: 'social', campaign: 'shipping-thread', sessions: 7 },
    { source: 'reddit.com', channel: 'community', campaign: 'r/ecommerce', sessions: 7 },
    { source: 'email.newsletter.shopflow.example', channel: 'email', campaign: 'weekend-drop', sessions: 6 },
    { source: 'tiktok.com', channel: 'paid_social', campaign: 'style-haul', sessions: 5 },
    { source: 'bing.com', channel: 'organic_search', campaign: 'brand-search', sessions: 4 },
    { source: 'news.ycombinator.com', channel: 'community', campaign: 'engineering-post', sessions: 3 },
] as const;

const demoReferralLocations = [
    { city: 'Austin', region: 'Texas', country: 'United States', countryCode: 'US' },
    { city: 'Los Angeles', region: 'California', country: 'United States', countryCode: 'US' },
    { city: 'Toronto', region: 'Ontario', country: 'Canada', countryCode: 'CA' },
    { city: 'Berlin', region: 'Berlin', country: 'Germany', countryCode: 'DE' },
    { city: 'London', region: 'England', country: 'United Kingdom', countryCode: 'GB' },
    { city: 'Seattle', region: 'Washington', country: 'United States', countryCode: 'US' },
];

export const demoReferralSourceSessions: RecordingSession[] = demoReferralSourceFixtures.flatMap((fixture, sourceIndex) =>
    Array.from({ length: fixture.sessions }, (_, offset): RecordingSession => {
        const location = demoReferralLocations[(sourceIndex + offset) % demoReferralLocations.length];
        const minutesAgo = 18 + sourceIndex * 36 + offset * 11;
        const durationSeconds = 120 + ((sourceIndex + offset) % 7) * 75;
        const sourceLabel = fixture.source || 'direct';

        return {
            id: `demo-referral-session-${sourceIndex + 1}-${offset + 1}`,
            projectId: 'demo-project-001',
            startedAt: new Date(now - minutesAgo * 60 * 1000).toISOString(),
            endedAt: new Date(now - minutesAgo * 60 * 1000 + durationSeconds * 1000).toISOString(),
            durationSeconds,
            platform: 'web',
            appVersion: offset % 3 === 0 ? 'web-2026.05.1' : 'web-2026.05.0',
            deviceModel: offset % 4 === 0 ? 'Safari on iPhone' : offset % 3 === 0 ? 'Firefox on Linux' : offset % 2 === 0 ? 'Chrome on Windows' : 'Chrome on macOS',
            osVersion: offset % 4 === 0 ? 'iOS 18' : offset % 3 === 0 ? 'Ubuntu 24.04' : offset % 2 === 0 ? 'Windows 11' : 'macOS 15',
            webReferral: fixture.source,
            webLandingRoute: offset % 4 === 0 ? '/drops/early-access' : offset % 3 === 0 ? '/pricing' : offset % 2 === 0 ? '/collections/summer-edit' : '/new-arrivals',
            metadata: {
                webReferral: fixture.source,
                webReferrerDomain: fixture.source,
                webAttributionSource: sourceLabel,
                webAttributionChannel: fixture.channel,
                webAttributionCampaign: fixture.campaign,
                utm_source: sourceLabel,
                utm_campaign: fixture.campaign,
            },
            anonymousDisplayName: `WebVisitor${String(sourceIndex + 1).padStart(2, '0')}${String(offset + 1).padStart(2, '0')}`,
            deviceId: `demo-referral-device-${sourceIndex + 1}-${offset + 1}`,
            geoLocation: location,
            totalEvents: 34 + ((sourceIndex + offset) % 9) * 13,
            errorCount: (sourceIndex + offset) % 11 === 0 ? 1 : 0,
            touchCount: 10 + ((sourceIndex + offset) % 6) * 6,
            scrollCount: 14 + ((sourceIndex + offset) % 8) * 5,
            gestureCount: offset % 5 === 0 ? 1 : 0,
            inputCount: offset % 4,
            apiSuccessCount: 7 + ((sourceIndex + offset) % 10) * 2,
            apiErrorCount: (sourceIndex + offset) % 13 === 0 ? 1 : 0,
            apiTotalCount: 8 + ((sourceIndex + offset) % 10) * 2,
            apiAvgResponseMs: 118 + ((sourceIndex + offset) % 9) * 24,
            rageTapCount: (sourceIndex + offset) % 17 === 0 ? 1 : 0,
            screensVisited: offset % 4 === 0
                ? ['/drops/early-access', '/products/canvas-tote', '/checkout']
                : offset % 3 === 0
                    ? ['/pricing', '/docs', '/signup']
                    : offset % 2 === 0
                        ? ['/collections/summer-edit', '/products/linen-jacket', '/cart']
                        : ['/new-arrivals', '/products/city-backpack'],
            interactionScore: 58 + ((sourceIndex + offset) % 8) * 5,
            explorationScore: 52 + ((sourceIndex + offset) % 9) * 4,
            customEventCount: 1 + ((sourceIndex + offset) % 5),
            crashCount: 0,
            anrCount: 0,
            networkType: offset % 4 === 0 ? 'cellular' : 'wifi',
            cellularGeneration: offset % 4 === 0 ? '5G' : undefined,
            status: 'ready',
            hasSuccessfulRecording: true,
            isFirstSession: offset % 3 === 0,
        };
    })
);

export const demoSessions: RecordingSession[] = [
    ...demoBaseSessions.map((session) => (
        session.id === DEMO_REPLAY_SESSION_IDS[0]
            ? {
                ...session,
                smartCaptureStatus: 'kept' as const,
                smartCaptureReason: 'High friction',
                smartCaptureRuleId: 'demo-rule-1',
                smartCaptureDecidedAt: new Date(DEMO_NOW - 20 * 60 * 1000).toISOString(),
            }
            : session
    )),
    ...demoReferralSourceSessions,
];

// Replays page demo fixtures should only include the real recorded demo replays.
export const demoReplaySessions: RecordingSession[] = demoSessions.filter(
    (session) => DEMO_REPLAY_SESSION_IDS.includes(session.id)
).sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());

// Generate daily stats for charts (last 30 days)
export const demoDailyStats: ProjectDailyStats[] = Array.from({ length: 30 }, (_, i) => {
    const date = new Date(now - (29 - i) * day);
    const isWeekend = date.getDay() === 0 || date.getDay() === 6;
    const baseSessions = isWeekend ? 280 : 420;
    const variance = demoRandom() * 0.3 - 0.15; // ±15% variance

    return {
        projectId: 'demo-project-001',
        date: date.toISOString().split('T')[0],
        totalSessions: Math.round(baseSessions * (1 + variance)),
        completedSessions: Math.round(baseSessions * (1 + variance) * 0.92),
        avgDurationSeconds: Math.round(300 + demoRandom() * 120),
        avgInteractionScore: Math.round(70 + demoRandom() * 15),
        avgApiErrorRate: Math.round((2 + demoRandom() * 2) * 100) / 100,
        p50Duration: Math.round(280 + demoRandom() * 60),
        p90Duration: Math.round(600 + demoRandom() * 200),
        p50InteractionScore: Math.round(72 + demoRandom() * 10),
        p90InteractionScore: Math.round(88 + demoRandom() * 8)
    };
});
