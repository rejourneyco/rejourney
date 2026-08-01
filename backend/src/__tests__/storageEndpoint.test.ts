import { describe, expect, it } from 'vitest';
import { resolvePublicStorageEndpointForSignedUrls } from '../utils/storageEndpoint.js';

describe('public storage endpoint resolution', () => {
    it('uses the explicit public endpoint when configured', () => {
        expect(resolvePublicStorageEndpointForSignedUrls({
            endpointUrl: 'http://minio:9000',
            configuredPublicEndpoint: 'https://objects.example.com',
            nodeEnv: 'production',
        })).toBe('https://objects.example.com');
    });

    it('does not expose the private Docker MinIO hostname in production', () => {
        expect(resolvePublicStorageEndpointForSignedUrls({
            endpointUrl: 'http://minio:9000',
            nodeEnv: 'production',
        })).toBeNull();
    });

    it('keeps the localhost convenience endpoint in development', () => {
        expect(resolvePublicStorageEndpointForSignedUrls({
            endpointUrl: 'http://minio:9000',
            nodeEnv: 'development',
        })).toBe('http://localhost:9000');
    });

    it('uses a normal external endpoint for signed downloads', () => {
        expect(resolvePublicStorageEndpointForSignedUrls({
            endpointUrl: 'https://s3.us-east-1.amazonaws.com',
            nodeEnv: 'production',
        })).toBe('https://s3.us-east-1.amazonaws.com');
    });
});
