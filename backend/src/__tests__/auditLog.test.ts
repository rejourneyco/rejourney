import { describe, expect, it } from 'vitest';
import type { Request } from 'express';
import { buildAuditFieldChanges, buildAuditRequestMetadata } from '../services/auditLog.js';

describe('auditLog helpers', () => {
    it('captures changed fields including boolean toggles', () => {
        const changes = buildAuditFieldChanges(
            {
                name: 'Swoopa',
                recordingEnabled: true,
                rejourneyEnabled: true,
                sampleRate: 100,
            },
            {
                name: 'Swoopa',
                recordingEnabled: true,
                rejourneyEnabled: false,
                sampleRate: 50,
            },
        );

        expect(changes.changedFields).toEqual(['rejourneyEnabled', 'sampleRate']);
        expect(changes.previousValue).toEqual({
            rejourneyEnabled: true,
            sampleRate: 100,
        });
        expect(changes.newValue).toEqual({
            rejourneyEnabled: false,
            sampleRate: 50,
        });
    });

    it('builds stable request metadata for audit rows', () => {
        const req = {
            baseUrl: '/api/teams',
            headers: {
                'x-request-id': 'req_123',
            },
            method: 'PUT',
            originalUrl: '/api/teams/team_123',
            path: '/team_123',
            route: {
                path: '/:teamId',
            },
            user: {
                email: 'owner@example.com',
            },
        } as unknown as Request;

        expect(buildAuditRequestMetadata(req)).toEqual({
            actorEmail: 'owner@example.com',
            requestId: 'req_123',
            requestMethod: 'PUT',
            requestRoute: '/api/teams/:teamId',
        });
    });
});
