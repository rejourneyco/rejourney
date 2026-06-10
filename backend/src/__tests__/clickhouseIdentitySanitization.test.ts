import { describe, expect, it } from 'vitest';
import { buildClickHouseApiEndpointEventRow } from '../services/clickhouseApiStatsSink.js';
import { buildClickHouseRevenueEventRow } from '../services/clickhouseRevenueEventsSink.js';

describe('ClickHouse identity sanitization', () => {
    it('omits session and artifact identity from API endpoint raw rows', () => {
        const row = buildClickHouseApiEndpointEventRow({
            projectId: '3f4f7d8a-7660-4a78-b944-442051c62eca',
            sessionId: 'session_123',
            artifactId: 'artifact_456',
            eventIndex: 1,
            method: 'GET',
            path: '/users/123?token=secret',
            statusCode: 200,
            isError: false,
            durationMs: 42,
            eventAt: new Date('2026-06-09T12:00:00.000Z'),
        });

        expect(row.session_id).toBe('');
        expect(row.artifact_id).toBe('');
        expect(JSON.stringify(row)).not.toContain('session_123');
        expect(JSON.stringify(row)).not.toContain('artifact_456');
    });

    it('keeps revenue facts while blanking visitor identifiers and raw metadata', () => {
        const row = buildClickHouseRevenueEventRow({
            projectId: '3f4f7d8a-7660-4a78-b944-442051c62eca',
            provider: 'revenuecat',
            occurredAt: new Date('2026-06-09T12:00:00.000Z'),
            externalTransactionId: 'txn_123',
            externalSourceId: 'session_123',
            amountCents: 999,
            grossAmountCents: 999,
            refundAmountCents: 0,
            feeCents: 0,
            netCents: 999,
            currency: 'USD',
            type: 'purchase',
            reportingCategory: 'subscription',
            metadata: {
                sessionId: 'session_123',
                userDisplayId: 'user_123',
                anonymousHash: 'anon_hash',
                anonymousDisplayId: 'anon_display',
                deviceId: 'device_123',
                eventName: 'Purchase',
                platform: 'ios',
                appVersion: '1.2.3',
            },
        });

        expect(row).toMatchObject({
            session_id: '',
            visitor_id: '',
            user_display_id: '',
            anonymous_hash: '',
            anonymous_display_id: '',
            device_id: '',
            external_source_id: '',
            metadata_json: '{}',
            platform: 'ios',
            app_version: '1.2.3',
            amount_cents: 999,
        });
        expect(JSON.stringify(row)).not.toContain('session_123');
        expect(JSON.stringify(row)).not.toContain('user_123');
        expect(JSON.stringify(row)).not.toContain('device_123');
    });
});
