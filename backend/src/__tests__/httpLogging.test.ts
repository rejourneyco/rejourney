import { describe, expect, it } from 'vitest';
import { getSafeRequestLogPath } from '../utils/httpLogging.js';

describe('request log path redaction', () => {
    it('drops signed query tokens from logged upload URLs', () => {
        expect(getSafeRequestLogPath({
            originalUrl: '/upload/artifact?token=secret&expires=123',
            url: '/upload/artifact?token=secret&expires=123',
        } as any)).toBe('/upload/artifact');
    });

    it('preserves a request path without a query string', () => {
        expect(getSafeRequestLogPath({
            originalUrl: '/health/ingest',
            url: '/health/ingest',
        } as any)).toBe('/health/ingest');
    });
});
