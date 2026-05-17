import { describe, expect, it } from 'vitest';
import { buildSdkConfigResponse } from '../services/sdkConfig.js';

const baseProject = {
    id: 'project_1',
    teamId: 'team_1',
    name: 'Mobile App',
    rejourneyEnabled: true,
    recordingEnabled: true,
};

describe('SDK config response', () => {
    it('defaults missing legacy fields to privacy-preserving values', () => {
        expect(buildSdkConfigResponse(baseProject)).toEqual({
            projectId: 'project_1',
            teamId: 'team_1',
            name: 'Mobile App',
            rejourneyEnabled: true,
            recordingEnabled: true,
            textInputMasking: 'all',
            recordingFps: 1,
            maxRecordingMinutes: 10,
            webMaxObservabilityMinutes: 30,
            sampleRate: 100,
            billingBlocked: false,
            billingReason: undefined,
        });
    });

    it('normalizes secure-only masking, numeric bounds, and billing fields', () => {
        expect(buildSdkConfigResponse(
            {
                ...baseProject,
                textInputMasking: 'secure_only',
                recordingFps: 9,
                sampleRate: 250,
                maxRecordingMinutes: 99,
                webMaxObservabilityMinutes: 99,
            },
            {
                billingBlocked: true,
                billingReason: 'free tier exhausted',
            }
        )).toEqual({
            projectId: 'project_1',
            teamId: 'team_1',
            name: 'Mobile App',
            rejourneyEnabled: true,
            recordingEnabled: true,
            textInputMasking: 'secure_only',
            recordingFps: 3,
            maxRecordingMinutes: 10,
            webMaxObservabilityMinutes: 30,
            sampleRate: 100,
            billingBlocked: true,
            billingReason: 'free tier exhausted',
        });
    });

    it('returns a full disabled config shape for cache fallback', () => {
        expect(buildSdkConfigResponse({
            ...baseProject,
            rejourneyEnabled: false,
            recordingEnabled: true,
            textInputMasking: 'unknown-from-newer-dashboard',
            sampleRate: null,
            maxRecordingMinutes: null,
            webMaxObservabilityMinutes: null,
        })).toEqual({
            projectId: 'project_1',
            teamId: 'team_1',
            name: 'Mobile App',
            rejourneyEnabled: false,
            recordingEnabled: false,
            textInputMasking: 'all',
            recordingFps: 1,
            maxRecordingMinutes: 10,
            webMaxObservabilityMinutes: 30,
            sampleRate: 100,
            billingBlocked: false,
            billingReason: undefined,
            disabled: true,
            reason: 'Rejourney disabled by project admin',
        });
    });

    it('includes web allowed domains when configured', () => {
        expect(buildSdkConfigResponse({
            ...baseProject,
            webDomain: 'legacy.example.com',
            webAllowedDomains: ['https://App.Example.com/path', '*.shop.example.com'],
        })).toMatchObject({
            webDomain: 'app.example.com',
            webAllowedDomains: ['app.example.com', '*.shop.example.com', 'legacy.example.com'],
        });
    });
});
