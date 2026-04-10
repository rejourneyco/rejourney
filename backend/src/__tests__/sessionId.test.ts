import { describe, expect, it } from 'vitest';
import { parseSessionStartedAt, parseSessionStartedAtOrNull } from '../services/sessionId.js';

describe('sessionId', () => {
    it('parses startedAt from timestamp-based session ids', () => {
        expect(parseSessionStartedAtOrNull('session_1771045973773_f81477f8042b4b299ba7de872bf5c0d2')?.toISOString())
            .toBe('2026-02-14T05:12:53.773Z');
    });

    it('treats fallback session ids as non-timestamp-based', () => {
        expect(parseSessionStartedAtOrNull('session_aabbccddeeff00112233445566778899')).toBeNull();
    });

    it('uses the provided fallback for non-timestamp-based session ids', () => {
        const fallback = new Date('2026-04-07T12:00:00.000Z');

        expect(parseSessionStartedAt('session_aabbccddeeff00112233445566778899', fallback)).toEqual(fallback);
    });
});
