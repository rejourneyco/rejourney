import { createHash } from 'crypto';
import { describe, expect, it } from 'vitest';
import {
    buildIngestDeviceRateLimitKey,
    buildIngestProjectRateLimitKey,
} from '../utils/ingestRateLimitKey.js';

function buildUploadToken(payload: Record<string, unknown>): string {
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64');
    return `${payloadB64}.signature`;
}

describe('ingestRateLimitKey', () => {
    it('builds the project key from req.project when available', () => {
        const key = buildIngestProjectRateLimitKey({
            headers: {},
            body: {},
            path: '/presign',
            project: { id: 'project_live' },
        });

        expect(key).toBe('rate:ingest:project:project_live');
    });

    it('builds the project key from the signed upload token when req.project is absent', () => {
        const key = buildIngestProjectRateLimitKey({
            headers: {
                'x-upload-token': buildUploadToken({
                    projectId: 'project_from_token',
                    deviceId: 'device_from_token',
                }),
            },
            body: {},
            path: '/segment/presign',
        });

        expect(key).toBe('rate:ingest:project:project_from_token');
    });

    it('keys upload traffic by signed project and device identity instead of proxy ip', () => {
        const key = buildIngestDeviceRateLimitKey({
            headers: {
                'x-upload-token': buildUploadToken({
                    projectId: 'project_live',
                    deviceId: 'device_live',
                }),
                'x-forwarded-for': '10.42.0.1, 203.0.113.9',
                'cf-connecting-ip': '198.51.100.42',
            },
            body: {
                deviceId: 'ignored_body_device',
                sessionId: 'ignored_session',
            },
            path: '/presign',
            project: { id: 'project_live' },
        });

        expect(key).toBe('rate:ingest:device:project:project_live:device_live');
    });

    it('keys device auth by public project key fingerprint and device id', () => {
        const projectKey = 'rj_public_key_123';
        const fingerprint = createHash('sha256').update(projectKey).digest('hex').slice(0, 16);

        const key = buildIngestDeviceRateLimitKey({
            headers: {
                'x-rejourney-key': projectKey,
            },
            body: {
                deviceId: 'device_auth_1',
            },
            path: '/auth/device',
        });

        expect(key).toBe(`rate:ingest:device:project-key:${fingerprint}:device_auth_1`);
    });

    it('keys tokenless ingest requests by explicit session id before using an invalid bucket', () => {
        const key = buildIngestDeviceRateLimitKey({
            headers: {
                'x-rejourney-key': 'rj_public_key_456',
                'x-session-id': 'session_header_1',
            },
            body: {},
            path: '/presign',
            project: { id: 'project_live' },
        });

        expect(key).toBe('rate:ingest:session:project:project_live:session_header_1');
    });

    it('isolates malformed requests into an invalid ingest bucket without using req.ip', () => {
        const key = buildIngestDeviceRateLimitKey({
            headers: {},
            body: {},
            path: '/auth/device',
        });

        expect(key).toBe('rate:ingest:invalid:unscoped:/auth/device');
        expect(key).not.toContain('10.42.0.1');
    });
});
