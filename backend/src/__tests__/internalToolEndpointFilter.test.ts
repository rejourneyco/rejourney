import { describe, expect, it } from 'vitest';
import {
    shouldExcludeFromEndpointProductAnalytics,
    shouldExcludeNetworkEventFromProductAnalytics,
} from '../utils/internalToolEndpointFilter.js';

describe('internalToolEndpointFilter', () => {
    it('excludes ingest and upload relay endpoints from product analytics rollups', () => {
        expect(shouldExcludeFromEndpointProductAnalytics('POST /api/ingest/segment/presign')).toBe(true);
        expect(shouldExcludeFromEndpointProductAnalytics('PUT /upload/artifacts/95f8a6f8-5e44-4a03-8074-7b01151cb69d')).toBe(true);
    });

    it('keeps non-internal customer endpoints in product analytics rollups', () => {
        expect(shouldExcludeFromEndpointProductAnalytics('GET /api/v1/orders')).toBe(false);
    });

    it('excludes relative internal network events emitted by SDK/backend flows', () => {
        expect(
            shouldExcludeNetworkEventFromProductAnalytics({
                method: 'POST',
                url: '/api/ingest/segment/presign',
            }),
        ).toBe(true);

        expect(
            shouldExcludeNetworkEventFromProductAnalytics({
                method: 'PUT',
                url: '/upload/artifacts/95f8a6f8-5e44-4a03-8074-7b01151cb69d',
            }),
        ).toBe(true);
    });

    it('does not exclude unrelated relative API paths', () => {
        expect(
            shouldExcludeNetworkEventFromProductAnalytics({
                method: 'GET',
                url: '/api/v1/profile',
            }),
        ).toBe(false);
    });
});
