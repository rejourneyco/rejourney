import { describe, expect, it } from 'vitest';
import {
    extractSdkPauseTransitionFromEvent,
    normalizeSdkPauseId,
    normalizeSdkPauseTransition,
    sessionAcceptsSdkPauseTransition,
    shouldApplySdkPauseTransition,
} from '../services/sessionSdkPause.js';

describe('SDK pause lifecycle', () => {
    it('extracts durable pause and resume markers from native custom events', () => {
        expect(extractSdkPauseTransitionFromEvent({
            type: 'custom',
            name: 'sdk_paused',
            timestamp: 1_777_000_001_000,
            payload: JSON.stringify({ pauseId: 'pause-1' }),
        })).toMatchObject({ pauseId: 'pause-1', paused: true });
        expect(extractSdkPauseTransitionFromEvent({
            type: 'custom',
            name: 'sdk_resumed',
            timestamp: 1_777_000_005_000,
            payload: { pauseId: 'pause-1' },
        })).toMatchObject({ pauseId: 'pause-1', paused: false });
    });

    it('rejects malformed IDs and irrelevant or invalid markers', () => {
        expect(normalizeSdkPauseId('../unsafe')).toBeNull();
        expect(normalizeSdkPauseId('x'.repeat(65))).toBeNull();
        expect(extractSdkPauseTransitionFromEvent({
            type: 'custom',
            name: 'other',
            timestamp: 1_777_000_001_000,
            payload: '{}',
        })).toBeNull();
        expect(extractSdkPauseTransitionFromEvent({
            type: 'custom',
            name: 'sdk_paused',
            timestamp: 'bad',
            payload: '{bad json',
        })).toBeNull();
    });

    it('orders transitions so delayed pauses lose and a matching same-ms resume wins', () => {
        const pauseAt = new Date('2026-04-08T12:01:00.000Z');
        const resumeAt = new Date('2026-04-08T12:02:00.000Z');

        expect(shouldApplySdkPauseTransition(null, pauseAt)).toBe(true);
        expect(shouldApplySdkPauseTransition(pauseAt, resumeAt)).toBe(true);
        expect(shouldApplySdkPauseTransition(resumeAt, pauseAt)).toBe(false);
        expect(shouldApplySdkPauseTransition(resumeAt, resumeAt)).toBe(false);
        expect(shouldApplySdkPauseTransition(pauseAt, pauseAt, {
            existingPaused: true,
            incomingPaused: false,
            samePauseId: true,
        })).toBe(true);
        expect(shouldApplySdkPauseTransition(pauseAt, pauseAt, {
            existingPaused: true,
            incomingPaused: false,
            samePauseId: false,
        })).toBe(false);
    });

    it('never reopens explicitly ended, completed, failed, deleted, or retention-purged sessions', () => {
        expect(sessionAcceptsSdkPauseTransition({ status: 'processing' })).toBe(true);
        expect(sessionAcceptsSdkPauseTransition({ status: 'ready' })).toBe(true);
        expect(sessionAcceptsSdkPauseTransition({
            status: 'processing',
            explicitEndedAt: new Date('2026-04-08T12:03:00.000Z'),
        })).toBe(false);
        expect(sessionAcceptsSdkPauseTransition({ status: 'failed' })).toBe(false);
        expect(sessionAcceptsSdkPauseTransition({ status: 'deleted' })).toBe(false);
        expect(sessionAcceptsSdkPauseTransition({ status: 'completed' })).toBe(false);
        expect(sessionAcceptsSdkPauseTransition({ status: 'processing', recordingDeleted: true })).toBe(false);
        expect(sessionAcceptsSdkPauseTransition({ status: 'processing', isReplayExpired: true })).toBe(false);
    });

    it('normalizes a future-skewed client timestamp with the session clock contract', () => {
        const serverNow = new Date('2026-04-08T12:00:00.000Z');
        const transition = normalizeSdkPauseTransition({
            pauseId: 'pause-1',
            paused: true,
            occurredAt: new Date('2026-04-08T13:00:00.000Z').getTime(),
            serverNow,
            session: { startedAt: new Date('2026-04-08T11:59:00.000Z') },
        });

        expect(transition?.occurredAt.toISOString()).toBe(serverNow.toISOString());
    });
});
