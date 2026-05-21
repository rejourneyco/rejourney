import { describe, expect, it } from 'vitest';
import { buildWebAttributionMetadata } from '../services/ingestEventArtifactProcessor.js';
import { buildClickHouseApiEndpointEventRow } from '../services/clickhouseApiStatsSink.js';

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
            session_id: 'sess_123',
            artifact_id: 'artifact_456',
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
