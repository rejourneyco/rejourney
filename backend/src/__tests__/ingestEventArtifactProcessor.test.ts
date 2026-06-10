import { describe, expect, it } from 'vitest';
import {
    buildWebAttributionMetadata,
    computeMobileFrustrationCountsForIngest,
    getFrustrationTapKindForIngest,
    isKeyboardAreaEventForIngest,
    mergeEventArtifactFrustrationCounts,
    registerTapForIngestRageInference,
} from '../services/ingestEventArtifactProcessor.js';
import { buildClickHouseApiEndpointEventRow } from '../services/clickhouseApiStatsSink.js';
import { normalizeIngestAppVersion } from '../services/ingestSessionLifecycle.js';
import {
    buildSessionEndMetricsMergeSet,
    shouldTrustClientFrustrationCountsForPlatform,
    summarizeSessionEndMetrics,
} from '../services/ingestSessionEnd.js';

describe('ingest event artifact processor attribution metadata', () => {
    it('maps web attribution and UTM query values into session metadata', () => {
        const metadata = buildWebAttributionMetadata({
            type: 'session_start',
            attribution: {
                source: 'Newsletter',
                medium: 'email',
                campaign: 'Spring Launch',
                term: 'session replay',
                content: 'hero_cta',
                campaignId: 'cmp_42',
                sourcePlatform: 'linkedin',
                creativeFormat: 'video',
                marketingTactic: 'retargeting',
                channel: 'email',
                referrer: 'https://www.google.com/search?q=rejourney',
                referrerDomain: 'www.google.com',
                landingRoute: 'Landing',
                entryPath: '/landing?utm_source=Newsletter&email=%5BREDACTED%5D',
                entryUrl: 'https://shop.example.com/landing?utm_source=Newsletter&email=%5BREDACTED%5D',
                navigationType: 'navigate',
                entryQuery: {
                    utm_source: 'Newsletter',
                    utm_medium: 'email',
                    utm_campaign: 'Spring Launch',
                    utm_term: 'session replay',
                    utm_content: 'hero_cta',
                    utm_id: 'cmp_42',
                    utm_source_platform: 'linkedin',
                    utm_creative_format: 'video',
                    utm_marketing_tactic: 'retargeting',
                },
            },
        });

        expect(metadata).toMatchObject({
            webReferral: 'www.google.com',
            webReferrer: 'https://www.google.com/search?q=rejourney',
            webReferrerDomain: 'www.google.com',
            webAttributionSource: 'Newsletter',
            webAttributionMedium: 'email',
            webAttributionCampaign: 'Spring Launch',
            webAttributionTerm: 'session replay',
            webAttributionContent: 'hero_cta',
            webAttributionCampaignId: 'cmp_42',
            webAttributionSourcePlatform: 'linkedin',
            webAttributionCreativeFormat: 'video',
            webAttributionMarketingTactic: 'retargeting',
            webAttributionChannel: 'email',
            webLandingRoute: 'Landing',
            webEntryPath: '/landing?utm_source=Newsletter&email=%5BREDACTED%5D',
            webEntryUrl: 'https://shop.example.com/landing?utm_source=Newsletter&email=%5BREDACTED%5D',
            webNavigationType: 'navigate',
            utm_id: 'cmp_42',
            utm_source: 'Newsletter',
            utm_medium: 'email',
            utm_campaign: 'Spring Launch',
            utm_term: 'session replay',
            utm_content: 'hero_cta',
            utm_source_platform: 'linkedin',
            utm_creative_format: 'video',
            utm_marketing_tactic: 'retargeting',
        });
    });

    it('falls back to entryQuery UTM values when normalized fields are absent', () => {
        const metadata = buildWebAttributionMetadata({
            type: 'session_start',
            attribution: {
                channel: 'paid_search',
                entryQuery: {
                    UTM_Source: 'Google',
                    utm_medium: 'cpc',
                    utm_campaign: 'Brand',
                },
            },
        });

        expect(metadata).toMatchObject({
            webReferral: 'Google',
            webAttributionSource: 'Google',
            webAttributionMedium: 'cpc',
            webAttributionCampaign: 'Brand',
            webAttributionChannel: 'paid_search',
            utm_source: 'Google',
            utm_medium: 'cpc',
            utm_campaign: 'Brand',
        });
    });
});

describe('ClickHouse API endpoint event rows', () => {
    it('normalizes network events into deterministic fact rows', () => {
        const row = buildClickHouseApiEndpointEventRow({
            projectId: '3f4f7d8a-7660-4a78-b944-442051c62eca',
            sessionId: 'sess_123',
            artifactId: 'artifact_456',
            eventIndex: 17,
            method: 'post',
            path: '/api/fixture',
            statusCode: 503,
            isError: true,
            durationMs: 123.6,
            eventAt: new Date('2026-05-21T14:15:16.789Z'),
            eventDate: '2026-05-22',
            region: null,
        });

        expect(row).toMatchObject({
            project_id: '3f4f7d8a-7660-4a78-b944-442051c62eca',
            event_date: '2026-05-22',
            event_time: '2026-05-21 14:15:16.789',
            session_id: '',
            artifact_id: '',
            event_index: 17,
            method: 'POST',
            path: '/api/fixture',
            endpoint: 'POST /api/fixture',
            region: 'unknown',
            status_code: 503,
            is_error: 1,
            duration_ms: 124,
            source: 'event_artifact',
            schema_version: 1,
        });
    });
});

describe('ingest app version normalization', () => {
    it('does not treat the web SDK version as the host app version', () => {
        expect(normalizeIngestAppVersion({
            platform: 'web',
            appVersion: '0.2.0',
            sdkVersion: '0.2.0',
        })).toBeNull();
    });

    it('keeps real host web app versions when they differ from the SDK version', () => {
        expect(normalizeIngestAppVersion({
            platform: 'web',
            appVersion: 'web-2026.05.1',
            sdkVersion: '0.2.0',
        })).toBe('web-2026.05.1');
    });
});

describe('ingest mobile frustration event compatibility', () => {
    it('recognizes UIKit keyboard touch labels without suppressing app copy that mentions keyboards', () => {
        expect(isKeyboardAreaEventForIngest({ label: 'UIKeyboardLayoutStar Preview' })).toBe(true);
        expect(isKeyboardAreaEventForIngest({ targetLabel: 'UIInputSetHostView' })).toBe(true);
        expect(isKeyboardAreaEventForIngest({ properties: { targetLabel: 'Keyboard shortcuts button' } })).toBe(false);
    });

    it('recognizes explicit rage and dead tap shapes from old and new SDK payloads', () => {
        expect(getFrustrationTapKindForIngest({ type: 'rage_tap' })).toBe('rage_tap');
        expect(getFrustrationTapKindForIngest({ type: 'rage_click' })).toBe('rage_tap');
        expect(getFrustrationTapKindForIngest({ type: 'gesture', gestureType: 'rage_tap' })).toBe('rage_tap');
        expect(getFrustrationTapKindForIngest({ type: 'gesture', frustrationKind: 'dead_tap' })).toBe('dead_tap');
        expect(getFrustrationTapKindForIngest({ type: 'touch', gestureType: 'tap' })).toBeNull();
    });

    it('infers rage only after three nearby taps in the native rage window', () => {
        const recentTaps: Array<{ x: number; y: number; timestamp: number }> = [];

        expect(registerTapForIngestRageInference(recentTaps, { x: 100, y: 100, timestamp: 1000 })).toBe(false);
        expect(registerTapForIngestRageInference(recentTaps, { x: 108, y: 104, timestamp: 1300 })).toBe(false);
        expect(registerTapForIngestRageInference(recentTaps, { x: 97, y: 112, timestamp: 1700 })).toBe(true);
        expect(recentTaps).toHaveLength(0);
    });

    it('does not infer rage for two taps, distant taps, or taps outside the window', () => {
        const twoTaps: Array<{ x: number; y: number; timestamp: number }> = [];
        expect(registerTapForIngestRageInference(twoTaps, { x: 100, y: 100, timestamp: 1000 })).toBe(false);
        expect(registerTapForIngestRageInference(twoTaps, { x: 105, y: 105, timestamp: 1200 })).toBe(false);

        const distantTaps: Array<{ x: number; y: number; timestamp: number }> = [];
        expect(registerTapForIngestRageInference(distantTaps, { x: 100, y: 100, timestamp: 1000 })).toBe(false);
        expect(registerTapForIngestRageInference(distantTaps, { x: 180, y: 100, timestamp: 1200 })).toBe(false);
        expect(registerTapForIngestRageInference(distantTaps, { x: 100, y: 110, timestamp: 1300 })).toBe(false);

        const expiredTaps: Array<{ x: number; y: number; timestamp: number }> = [];
        expect(registerTapForIngestRageInference(expiredTaps, { x: 100, y: 100, timestamp: 1000 })).toBe(false);
        expect(registerTapForIngestRageInference(expiredTaps, { x: 103, y: 104, timestamp: 2101 })).toBe(false);
        expect(registerTapForIngestRageInference(expiredTaps, { x: 101, y: 102, timestamp: 2200 })).toBe(false);
    });

    it('does not trust mobile session-end rage summaries because old packages counted keyboard typing', () => {
        expect(shouldTrustClientFrustrationCountsForPlatform('ios')).toBe(false);
        expect(shouldTrustClientFrustrationCountsForPlatform('android')).toBe(false);
        expect(shouldTrustClientFrustrationCountsForPlatform('swift')).toBe(false);
        expect(shouldTrustClientFrustrationCountsForPlatform('expo')).toBe(false);
        expect(shouldTrustClientFrustrationCountsForPlatform('rn')).toBe(false);
        expect(shouldTrustClientFrustrationCountsForPlatform('react_native')).toBe(false);
        expect(shouldTrustClientFrustrationCountsForPlatform('react native ios')).toBe(false);
        expect(shouldTrustClientFrustrationCountsForPlatform('mobile')).toBe(false);
        expect(shouldTrustClientFrustrationCountsForPlatform('web')).toBe(true);

        const mobileUpdates = buildSessionEndMetricsMergeSet(
            { touchCount: 12, rageTapCount: 7, apiTotalCount: 2 },
            { trustClientFrustrationCounts: false }
        );
        expect(mobileUpdates).toMatchObject({ touchCount: 12, apiTotalCount: 2 });
        expect(mobileUpdates).not.toHaveProperty('rageTapCount');

        expect(summarizeSessionEndMetrics(
            { touchCount: 12, rageTapCount: 7 },
            { trustClientFrustrationCounts: false }
        )).toEqual({ touchCount: 12 });

        expect(buildSessionEndMetricsMergeSet(
            { rageTapCount: 3 },
            { trustClientFrustrationCounts: true }
        )).toMatchObject({ rageTapCount: 3 });
    });

    it('computes canonical mobile frustration counts from raw events and ignores keyboard typing clusters', () => {
        const events = [
            { timestamp: 1000, type: 'touch', gestureType: 'tap', label: '_UISearchBarSearchContainerView', x: 93, y: 165 },
            { timestamp: 1200, type: 'touch', gestureType: 'tap', label: 'UIKeyboardLayoutStar Preview', x: 100, y: 634 },
            { timestamp: 1400, type: 'touch', gestureType: 'tap', label: 'UIKeyboardLayoutStar Preview', x: 220, y: 637 },
            { timestamp: 1600, type: 'touch', gestureType: 'tap', label: 'UIKeyboardLayoutStar Preview', x: 221, y: 627 },
            { timestamp: 1900, type: 'touch', gestureType: 'tap', label: 'PlatformGroupContainer', x: 112, y: 724 },
            { timestamp: 2100, type: 'gesture', gestureType: 'dead_tap', frustrationKind: 'dead_tap', label: 'PlatformGroupContainer', x: 112, y: 724 },
            { timestamp: 2300, type: 'touch', gestureType: 'tap', label: 'PlatformGroupContainer', x: 100, y: 732 },
            { timestamp: 2500, type: 'gesture', gestureType: 'dead_tap', frustrationKind: 'dead_tap', label: 'PlatformGroupContainer', x: 100, y: 732 },
        ];

        expect(computeMobileFrustrationCountsForIngest(events)).toEqual({
            rageTapCount: 0,
            deadTapCount: 2,
        });
    });

    it('replaces stale client frustration summaries on the first processed events artifact', () => {
        expect(mergeEventArtifactFrustrationCounts(
            { rageTapCount: 9, deadTapCount: 1, eventsSizeBytes: 0 },
            { rageTapCount: 0, deadTapCount: 2 }
        )).toEqual({ rageTapCount: 0, deadTapCount: 2 });

        expect(mergeEventArtifactFrustrationCounts(
            { rageTapCount: 2, deadTapCount: 1, eventsSizeBytes: 2048 },
            { rageTapCount: 1, deadTapCount: 3 }
        )).toEqual({ rageTapCount: 3, deadTapCount: 4 });
    });
});
