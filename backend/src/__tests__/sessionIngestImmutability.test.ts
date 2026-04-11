import { describe, expect, it } from 'vitest';
import { ApiError } from '../middleware/errorHandler.js';
import {
    assertSessionAcceptsNewIngestWork,
    isSessionIngestImmutable,
} from '../services/sessionIngestImmutability.js';

describe('sessionIngestImmutability', () => {
    it('treats failed and deleted sessions as immutable', () => {
        expect(isSessionIngestImmutable({ status: 'failed' })).toBe(true);
        expect(isSessionIngestImmutable({ status: 'deleted' })).toBe(true);
    });

    it('treats purged or expired recordings as immutable', () => {
        expect(isSessionIngestImmutable({ status: 'processing', recordingDeleted: true })).toBe(true);
        expect(isSessionIngestImmutable({ status: 'ready', isReplayExpired: true })).toBe(true);
    });

    it('allows processing and ready sessions to accept new ingest', () => {
        expect(isSessionIngestImmutable({ status: 'processing' })).toBe(false);
        expect(isSessionIngestImmutable({ status: 'ready' })).toBe(false);
    });

    it('throws conflict from assertSessionAcceptsNewIngestWork when immutable', () => {
        expect(() =>
            assertSessionAcceptsNewIngestWork({
                status: 'failed',
            }),
        ).toThrow(ApiError);
        try {
            assertSessionAcceptsNewIngestWork({ status: 'failed' });
        } catch (e: any) {
            expect(e.statusCode).toBe(409);
        }
    });

    it('does not throw for a ready session', () => {
        expect(() => assertSessionAcceptsNewIngestWork({ status: 'ready' })).not.toThrow();
    });
});
