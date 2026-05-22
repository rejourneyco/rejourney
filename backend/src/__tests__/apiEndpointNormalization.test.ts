import { describe, expect, it } from 'vitest';
import {
    buildNormalizedApiEndpointLabel,
    isStaticAssetEndpointPath,
    normalizeApiEndpointPath,
} from '../utils/apiEndpointNormalization.js';

describe('apiEndpointNormalization', () => {
    it('normalizes high-cardinality route parameters', () => {
        expect(normalizeApiEndpointPath('/api/extractors/listings/9efd4cc8-f0b6-4ded-b7bd-a40851a5b465/similar/'))
            .toBe('/api/extractors/listings/:id/similar/');
        expect(normalizeApiEndpointPath('/v17.0/7367379443350615/activities'))
            .toBe('/v17.0/:id/activities');
        expect(normalizeApiEndpointPath('/api/extractors/feeds/TRD%20rims/listings/'))
            .toBe('/api/extractors/feeds/:feed/listings/');
    });

    it('builds normalized endpoint labels', () => {
        expect(buildNormalizedApiEndpointLabel('post', '/api/marketplace/d059317e-e798-42c9-9862-217a998834c6/evaluate/'))
            .toBe('POST /api/marketplace/:id/evaluate/');
    });

    it('detects static assets', () => {
        expect(isStaticAssetEndpointPath('/v/t39.30808-6/700827799_101_n.jpg')).toBe(true);
        expect(isStaticAssetEndpointPath('/api/v1/orders')).toBe(false);
    });
});
