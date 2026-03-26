import { describe, expect, it } from 'vitest';
import { parseBatchId, parseSegmentId } from '../services/ingestProtocol.js';

describe('ingestProtocol', () => {
    it('parses batch ids for timestamp-based session ids', () => {
        const parsed = parseBatchId('batch_session_1771045973773_f81477f8042b4b299ba7de872bf5c0d2_events_7_deadbeef');

        expect(parsed).toEqual({
            sessionId: 'session_1771045973773_f81477f8042b4b299ba7de872bf5c0d2',
            contentType: 'events',
            batchNumber: '7',
        });
    });

    it('parses batch ids for server-minted fallback session ids', () => {
        const parsed = parseBatchId('batch_session_aabbccddeeff00112233445566778899_events_3_deadbeef');

        expect(parsed).toEqual({
            sessionId: 'session_aabbccddeeff00112233445566778899',
            contentType: 'events',
            batchNumber: '3',
        });
    });

    it('parses segment ids for timestamp-based session ids', () => {
        const parsed = parseSegmentId('seg_session_1771045973773_f81477f8042b4b299ba7de872bf5c0d2_screenshots_1771045974000_deadbeef');

        expect(parsed).toEqual({
            sessionId: 'session_1771045973773_f81477f8042b4b299ba7de872bf5c0d2',
            kind: 'screenshots',
            startTime: 1771045974000,
        });
    });

    it('parses segment ids for fallback session ids with fewer underscores', () => {
        const parsed = parseSegmentId('seg_session_aabbccddeeff00112233445566778899_hierarchy_1771045974000_deadbeef');

        expect(parsed).toEqual({
            sessionId: 'session_aabbccddeeff00112233445566778899',
            kind: 'hierarchy',
            startTime: 1771045974000,
        });
    });
});
