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

    it('treats ready, finalized, or explicitly ended sessions as immutable', () => {
        expect(isSessionIngestImmutable({ status: 'processing' })).toBe(false);
        expect(isSessionIngestImmutable({ status: 'ready' })).toBe(true);
        expect(
            isSessionIngestImmutable({
                status: 'processing',
                finalizedAt: new Date(),
            }),
        ).toBe(true);
        expect(
            isSessionIngestImmutable({
                status: 'processing',
                explicitEndedAt: new Date(),
            }),
        ).toBe(true);
    });

    it('allows sessions auto-closed for inactivity to reopen for new ingest', () => {
        expect(
            isSessionIngestImmutable({
                status: 'ready',
                finalizedAt: new Date(),
                explicitEndedAt: new Date(),
                closeSource: 'inactivity',
            }),
        ).toBe(false);
    });

    it('throws conflict from assertSessionAcceptsNewIngestWork when immutable', () => {
        expect(() =>
            assertSessionAcceptsNewIngestWork({
                status: 'ready',
            }),
        ).toThrow(ApiError);
        try {
            assertSessionAcceptsNewIngestWork({ status: 'ready' });
        } catch (e: any) {
            expect(e.statusCode).toBe(409);
        }
    });
});
