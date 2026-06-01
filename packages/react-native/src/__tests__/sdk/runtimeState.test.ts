import { describe, expect, it } from 'vitest';
import {
  DEFAULT_REMOTE_CONFIG,
  deriveRemoteStartState,
  evaluateInitAttempt,
  normalizeRemoteConfig,
} from '../../sdk/runtimeState';

describe('runtimeState', () => {
  describe('deriveRemoteStartState', () => {
    it('falls back to explicit defaults when remote config is unavailable', () => {
      expect(
        deriveRemoteStartState(null, () => true)
      ).toEqual({
        effectiveRemoteConfig: DEFAULT_REMOTE_CONFIG,
        sessionSampledOut: false,
        blockedReason: null,
      });
    });

    it('marks sampled-out sessions so start can abort before native capture', () => {
      expect(
        deriveRemoteStartState(
          {
            projectId: 'project_1',
            rejourneyEnabled: true,
            recordingEnabled: true,
            textInputMasking: 'all',
            imageVideoMasking: 'none',
            recordingFps: 1,
            sampleRate: 0,
            maxRecordingMinutes: 1,
          },
          () => false
        )
      ).toEqual({
        effectiveRemoteConfig: {
          projectId: 'project_1',
          rejourneyEnabled: true,
          recordingEnabled: true,
          textInputMasking: 'all',
          imageVideoMasking: 'none',
          recordingFps: 1,
          sampleRate: 0,
          maxRecordingMinutes: 1,
        },
        sessionSampledOut: true,
        blockedReason: null,
      });
    });

    it('uses the per-session sampling decision for partial sample rates', () => {
      const config = {
        projectId: 'project_1',
        rejourneyEnabled: true,
        recordingEnabled: true,
        textInputMasking: 'all' as const,
        imageVideoMasking: 'none' as const,
        recordingFps: 1,
        sampleRate: 50,
        maxRecordingMinutes: 1,
      };

      expect(deriveRemoteStartState(config, () => false).sessionSampledOut).toBe(true);
      expect(deriveRemoteStartState(config, () => true).sessionSampledOut).toBe(false);
    });

    it('surfaces disabled and billing-blocked configs as blockers', () => {
      expect(
        deriveRemoteStartState(
          {
            projectId: 'project_1',
            rejourneyEnabled: false,
            recordingEnabled: true,
            textInputMasking: 'all',
            imageVideoMasking: 'none',
            recordingFps: 1,
            sampleRate: 100,
            maxRecordingMinutes: 10,
          },
          () => true
        ).blockedReason
      ).toBe('disabled');

      expect(
        deriveRemoteStartState(
          {
            projectId: 'project_1',
            rejourneyEnabled: true,
            recordingEnabled: true,
            textInputMasking: 'all',
            imageVideoMasking: 'none',
            recordingFps: 1,
            sampleRate: 100,
            maxRecordingMinutes: 10,
            billingBlocked: true,
          },
          () => true
        ).blockedReason
      ).toBe('billingBlocked');
    });
  });

  describe('normalizeRemoteConfig', () => {
    it('normalizes legacy configs without textInputMasking to privacy-preserving defaults', () => {
      expect(
        normalizeRemoteConfig({
          projectId: 'project_1',
          rejourneyEnabled: true,
          recordingEnabled: false,
          sampleRate: 50,
          maxRecordingMinutes: 3,
        })
      ).toEqual({
        projectId: 'project_1',
        rejourneyEnabled: true,
        recordingEnabled: false,
        textInputMasking: 'all',
        imageVideoMasking: 'none',
        recordingFps: 1,
        sampleRate: 50,
        maxRecordingMinutes: 3,
        billingBlocked: undefined,
        billingReason: undefined,
      });
    });

    it('accepts secure-only text input masking and clamps numeric fields', () => {
      expect(
        normalizeRemoteConfig({
          textInputMasking: 'secure_only',
          imageVideoMasking: 'all',
          recordingFps: 99,
          sampleRate: 500,
          maxRecordingMinutes: 99,
        })
      ).toMatchObject({
        textInputMasking: 'secure_only',
        imageVideoMasking: 'all',
        recordingFps: 3,
        sampleRate: 100,
        maxRecordingMinutes: 10,
      });
    });
  });

  describe('evaluateInitAttempt', () => {
    it('marks invalid init attempts as failed and uninitialized', () => {
      expect(evaluateInitAttempt('')).toEqual({
        valid: false,
        initializationFailed: true,
        initialized: false,
      });
    });

    it('lets a valid init attempt clear the failed state', () => {
      expect(evaluateInitAttempt('pk_live_valid')).toEqual({
        valid: true,
        initializationFailed: false,
        initialized: true,
      });
    });
  });
});
