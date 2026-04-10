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
        debug: true,
        fps: 2,
      });
    });

    it('falls back to core defaults when optional fields are unset', () => {
      expect(buildNativeStartOptions(null, 'anon_1')).toEqual({
        userId: 'anon_1',
        apiUrl: 'https://api.rejourney.co',
        publicKey: '',
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
        wifiOnly: true,
        quality: 'high',
        captureLogs: false,
      });
    });
  });
});
