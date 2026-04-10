import { describe, expect, it } from 'vitest';
import {
  DEFAULT_REMOTE_CONFIG,
  deriveRemoteStartState,
  evaluateInitAttempt,
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

    it('marks sampled-out sessions without mutating the effective config', () => {
      expect(
        deriveRemoteStartState(
          {
            projectId: 'project_1',
            rejourneyEnabled: true,
            recordingEnabled: true,
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
          sampleRate: 0,
          maxRecordingMinutes: 1,
        },
        sessionSampledOut: true,
        blockedReason: null,
      });
    });

    it('surfaces disabled and billing-blocked configs as blockers', () => {
      expect(
        deriveRemoteStartState(
          {
            projectId: 'project_1',
            rejourneyEnabled: false,
            recordingEnabled: true,
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
            sampleRate: 100,
            maxRecordingMinutes: 10,
            billingBlocked: true,
          },
          () => true
        ).blockedReason
      ).toBe('billingBlocked');
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
