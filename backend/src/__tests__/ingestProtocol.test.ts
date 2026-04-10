import { describe, expect, it } from 'vitest';
import { buildReplaySegmentId, parseBatchId, parseSegmentId } from '../services/ingestProtocol.js';

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
            endTime: null,
        });
    });

    it('parses segment ids for fallback session ids with fewer underscores', () => {
        const parsed = parseSegmentId('seg_session_aabbccddeeff00112233445566778899_hierarchy_1771045974000_deadbeef');

        expect(parsed).toEqual({
            sessionId: 'session_aabbccddeeff00112233445566778899',
            kind: 'hierarchy',
            startTime: 1771045974000,
            endTime: null,
        });
    });

    it('builds and parses deterministic replay segment ids with end time', () => {
        const segmentId = buildReplaySegmentId({
            sessionId: 'session_1771045973773_f81477f8042b4b299ba7de872bf5c0d2',
            kind: 'screenshots',
            startTime: 1771045974000,
            endTime: 1771045980000,
            frameCount: 12,
            declaredSizeBytes: 4096,
        });

        expect(segmentId).toMatch(
            /^seg_session_1771045973773_f81477f8042b4b299ba7de872bf5c0d2_screenshots_1771045974000_1771045980000_[0-9a-f]{8}$/,
        );
        expect(parseSegmentId(segmentId)).toEqual({
            sessionId: 'session_1771045973773_f81477f8042b4b299ba7de872bf5c0d2',
            kind: 'screenshots',
            startTime: 1771045974000,
            endTime: 1771045980000,
        });
    });

    it('builds and parses deterministic replay segment ids without end time', () => {
        const segmentId = buildReplaySegmentId({
            sessionId: 'session_aabbccddeeff00112233445566778899',
            kind: 'hierarchy',
            startTime: 1771045974000,
            frameCount: 1,
            declaredSizeBytes: 512,
        });

        expect(segmentId).toMatch(
            /^seg_session_aabbccddeeff00112233445566778899_hierarchy_1771045974000_na_[0-9a-f]{8}$/,
        );
        expect(parseSegmentId(segmentId)).toEqual({
            sessionId: 'session_aabbccddeeff00112233445566778899',
            kind: 'hierarchy',
            startTime: 1771045974000,
            endTime: null,
        });
    });

    it('disambiguates replay segments that share the same time window', () => {
        const firstSegmentId = buildReplaySegmentId({
            sessionId: 'session_aabbccddeeff00112233445566778899',
            kind: 'screenshots',
            startTime: 1771045974000,
            endTime: 1771045975000,
            frameCount: 3,
            declaredSizeBytes: 1024,
        });
        const secondSegmentId = buildReplaySegmentId({
            sessionId: 'session_aabbccddeeff00112233445566778899',
            kind: 'screenshots',
            startTime: 1771045974000,
            endTime: 1771045975000,
            frameCount: 4,
            declaredSizeBytes: 2048,
        });

        expect(firstSegmentId).not.toBe(secondSegmentId);
        expect(parseSegmentId(firstSegmentId)).toEqual({
            sessionId: 'session_aabbccddeeff00112233445566778899',
            kind: 'screenshots',
            startTime: 1771045974000,
            endTime: 1771045975000,
        });
        expect(parseSegmentId(secondSegmentId)).toEqual({
            sessionId: 'session_aabbccddeeff00112233445566778899',
            kind: 'screenshots',
            startTime: 1771045974000,
            endTime: 1771045975000,
        });
    });
});
