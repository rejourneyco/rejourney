import { describe, expect, it } from 'vitest';
import {
  buildNativeStartOptions,
  normalizeCaptureFps,
  shouldStartWithConfig,
} from '../../sdk/sessionConfig';

describe('sessionConfig', () => {
  describe('shouldStartWithConfig', () => {
    it('blocks recording when disabled locally', () => {
      expect(
        shouldStartWithConfig({ enabled: false }, false)
      ).toEqual({
        allowed: false,
        reason: 'disabled',
      });
    });

    it('blocks recording in development when disableInDev is enabled', () => {
      expect(
        shouldStartWithConfig({ disableInDev: true }, true)
      ).toEqual({
        allowed: false,
        reason: 'disabled-in-dev',
      });
    });

    it('allows recording in production when disableInDev is enabled', () => {
      expect(
        shouldStartWithConfig({ disableInDev: true }, false)
      ).toEqual({
        allowed: true,
      });
    });
  });

  describe('normalizeCaptureFps', () => {
    it('rounds and clamps capture fps into the native range', () => {
      expect(normalizeCaptureFps(0.2)).toBe(1);
      expect(normalizeCaptureFps(2.6)).toBe(3);
      expect(normalizeCaptureFps(90)).toBe(30);
    });

    it('ignores invalid capture fps values', () => {
      expect(normalizeCaptureFps(undefined)).toBeUndefined();
      expect(normalizeCaptureFps(Number.NaN)).toBeUndefined();
    });
  });

  describe('buildNativeStartOptions', () => {
    it('maps the JS config surface into native start options', () => {
      expect(
        buildNativeStartOptions(
          {
            apiUrl: 'https://api.example.com',
            publicRouteKey: 'pk_test_123',
            debug: true,
            captureFPS: 2.4,
          },
          'user_123'
        )
      ).toEqual({
        userId: 'user_123',
        apiUrl: 'https://api.example.com',
        publicKey: 'pk_test_123',
        captureNativeSheets: true,
        debug: true,
        fps: 2,
      });
    });

    it('falls back to core defaults when optional fields are unset', () => {
      expect(buildNativeStartOptions(null, 'anon_1')).toEqual({
        userId: 'anon_1',
        apiUrl: 'https://api.rejourney.co',
        publicKey: '',
        captureNativeSheets: true,
      });
    });

    it('forwards wifiOnly, captureQuality, and trackConsoleLogs for native startSessionWithOptions', () => {
      expect(
        buildNativeStartOptions(
          {
            publicRouteKey: 'pk_x',
            wifiOnly: true,
            captureQuality: 'high',
            trackConsoleLogs: false,
          },
          'u1'
        )
      ).toEqual({
        userId: 'u1',
        apiUrl: 'https://api.rejourney.co',
        publicKey: 'pk_x',
        captureNativeSheets: true,
        wifiOnly: true,
        quality: 'high',
        captureLogs: false,
      });
    });

    it('forwards collectGeoLocation: false to suppress backend geolocation lookup', () => {
      expect(
        buildNativeStartOptions({ collectGeoLocation: false }, 'u1')
      ).toEqual({
        userId: 'u1',
        apiUrl: 'https://api.rejourney.co',
        publicKey: '',
        captureNativeSheets: true,
        collectGeoLocation: false,
      });
    });

    it('forwards collectGeoLocation: true explicitly', () => {
      expect(
        buildNativeStartOptions({ collectGeoLocation: true }, 'u1')
      ).toMatchObject({ collectGeoLocation: true });
    });

    it('omits collectGeoLocation when not set, leaving native to use its default', () => {
      const opts = buildNativeStartOptions({}, 'u1');
      expect(opts).not.toHaveProperty('collectGeoLocation');
    });

    it('omits wifiOnly when not set', () => {
      const opts = buildNativeStartOptions({}, 'u1');
      expect(opts).not.toHaveProperty('wifiOnly');
    });

    it('omits captureLogs when trackConsoleLogs is not set', () => {
      const opts = buildNativeStartOptions({}, 'u1');
      expect(opts).not.toHaveProperty('captureLogs');
    });

    it('forwards effective recording and masking options to native', () => {
      expect(
        buildNativeStartOptions({}, 'u1', undefined, undefined, {
          captureScreen: false,
          textInputMasking: 'secure_only',
          imageVideoMasking: 'all',
          recordingFps: 3,
        })
      ).toMatchObject({
        captureScreen: false,
        textInputMasking: 'secure_only',
        imageVideoMasking: 'all',
        fps: 3,
      });
    });

    it('lets remote FPS override the local capture FPS when provided', () => {
      expect(
        buildNativeStartOptions({ captureFPS: 2 }, 'u1', undefined, undefined, {
          recordingFps: 3,
        })
      ).toMatchObject({ fps: 3 });
    });

    it('defaults native sheet capture to true and forwards explicit false', () => {
      expect(buildNativeStartOptions({}, 'u1')).toMatchObject({ captureNativeSheets: true });
      expect(buildNativeStartOptions({ captureNativeSheets: false }, 'u1')).toMatchObject({ captureNativeSheets: false });
    });

    it('forwards rage tap settings to native startSessionWithOptions', () => {
      expect(
        buildNativeStartOptions(
          {
            detectRageTaps: false,
            rageTapThreshold: 4.6,
            rageTapTimeWindow: 750.2,
            rageTapRadius: 72.5,
          },
          'u1'
        )
      ).toMatchObject({
        detectRageTaps: false,
        rageTapThreshold: 5,
        rageTapTimeWindow: 750,
        rageTapRadius: 72.5,
      });
    });
  });

  describe('shouldStartWithConfig edge cases', () => {
    it('allows recording when config is null', () => {
      expect(shouldStartWithConfig(null, false)).toEqual({ allowed: true });
    });

    it('allows recording when enabled is explicitly true', () => {
      expect(shouldStartWithConfig({ enabled: true }, false)).toEqual({ allowed: true });
    });

    it('allows recording in dev when disableInDev is false', () => {
      expect(shouldStartWithConfig({ disableInDev: false }, true)).toEqual({ allowed: true });
    });
  });
});
