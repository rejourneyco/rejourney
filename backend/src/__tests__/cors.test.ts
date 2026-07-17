import { describe, expect, it } from 'vitest';
import { CORS_ALLOWED_HEADERS } from '../config/cors.js';

describe('CORS Allowed Headers Configuration', () => {
    it('contains all required headers for session recording and analytics', () => {
        const requiredHeaders = [
            'Content-Type',
            'Authorization',
            'X-Rejourney-Key',
            'X-Public-Key',
            'X-Platform',
            'X-API-Key',
            'X-CSRF-Token',
            'X-Device-Id',
            'X-Upload-Token',
            'X-Ingest-Token',
            'Idempotency-Key',
            'X-Session-Id',
            'X-RJ-Observe-Only',
        ];

        // Ensure every required header exists in the allowed list (case-insensitively or exact match)
        const allowedHeadersLower = CORS_ALLOWED_HEADERS.map((h) => h.toLowerCase());

        for (const header of requiredHeaders) {
            expect(allowedHeadersLower).toContain(header.toLowerCase());
        }
    });

    it('specifically includes the X-RJ-Observe-Only header for analytics-only sessions', () => {
        expect(CORS_ALLOWED_HEADERS).toContain('X-RJ-Observe-Only');
    });
});
