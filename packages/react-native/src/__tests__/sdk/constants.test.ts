/**
 * Unit tests for Rejourney SDK constants
 * 
 * Verifies that constants are correctly defined and have expected values.
 */

import { describe, it, expect } from 'vitest';
import {
  SDK_VERSION,
  DEFAULT_CONFIG,
  EVENT_TYPES,
  GESTURE_TYPES,
  PLAYBACK_SPEEDS,
  CAPTURE_SETTINGS,
  MEMORY_SETTINGS,
  CPU_SETTINGS,
  STORAGE_SETTINGS,
  UPLOAD_SETTINGS,
  PRIVACY,
} from '../../sdk/constants';

describe('constants', () => {
  describe('SDK_VERSION', () => {
    it('should be a valid version string', () => {
      expect(SDK_VERSION).toBeTruthy();
      expect(typeof SDK_VERSION).toBe('string');
      expect(SDK_VERSION).toMatch(/^\d+\.\d+\.\d+/);
    });
  });

  describe('DEFAULT_CONFIG', () => {
    it('should have all required properties', () => {
      expect(DEFAULT_CONFIG).toHaveProperty('enabled');
      expect(DEFAULT_CONFIG).toHaveProperty('captureFPS');
      expect(DEFAULT_CONFIG).toHaveProperty('captureOnEvents');
      expect(DEFAULT_CONFIG).toHaveProperty('maxSessionDuration');
      expect(DEFAULT_CONFIG).toHaveProperty('maxStorageSize');
      expect(DEFAULT_CONFIG).toHaveProperty('autoScreenTracking');
      expect(DEFAULT_CONFIG).toHaveProperty('autoGestureTracking');
      expect(DEFAULT_CONFIG).toHaveProperty('privacyOcclusion');
    });

    it('should have valid default values', () => {
      expect(DEFAULT_CONFIG.enabled).toBe(true);
      expect(DEFAULT_CONFIG.captureFPS).toBeGreaterThan(0);
      expect(DEFAULT_CONFIG.maxSessionDuration).toBeGreaterThan(0);
      expect(DEFAULT_CONFIG.maxStorageSize).toBeGreaterThan(0);
      expect(typeof DEFAULT_CONFIG.autoScreenTracking).toBe('boolean');
      expect(typeof DEFAULT_CONFIG.autoGestureTracking).toBe('boolean');
    });
  });

  describe('EVENT_TYPES', () => {
    it('should have all event type constants', () => {
      expect(EVENT_TYPES.GESTURE).toBe('gesture');
      expect(EVENT_TYPES.SCREEN_CHANGE).toBe('screen_change');
      expect(EVENT_TYPES.CUSTOM).toBe('custom');
      expect(EVENT_TYPES.APP_STATE).toBe('app_state');
      expect(EVENT_TYPES.FRUSTRATION).toBe('frustration');
      expect(EVENT_TYPES.ERROR).toBe('error');
    });

    it('should have string values', () => {
      Object.values(EVENT_TYPES).forEach(value => {
        expect(typeof value).toBe('string');
      });
    });
  });

  describe('GESTURE_TYPES', () => {
    it('should have all gesture type constants', () => {
      expect(GESTURE_TYPES.TAP).toBe('tap');
      expect(GESTURE_TYPES.DOUBLE_TAP).toBe('double_tap');
      expect(GESTURE_TYPES.LONG_PRESS).toBe('long_press');
      expect(GESTURE_TYPES.SWIPE_LEFT).toBe('swipe_left');
      expect(GESTURE_TYPES.SWIPE_RIGHT).toBe('swipe_right');
      expect(GESTURE_TYPES.SWIPE_UP).toBe('swipe_up');
      expect(GESTURE_TYPES.SWIPE_DOWN).toBe('swipe_down');
      expect(GESTURE_TYPES.PINCH).toBe('pinch');
      expect(GESTURE_TYPES.SCROLL).toBe('scroll');
      expect(GESTURE_TYPES.RAGE_TAP).toBe('rage_tap');
    });
  });

  describe('PLAYBACK_SPEEDS', () => {
    it('should be an array of numbers', () => {
      expect(Array.isArray(PLAYBACK_SPEEDS)).toBe(true);
      PLAYBACK_SPEEDS.forEach(speed => {
        expect(typeof speed).toBe('number');
        expect(speed).toBeGreaterThan(0);
      });
    });

    it('should have expected speeds', () => {
      expect(PLAYBACK_SPEEDS).toContain(0.5);
      expect(PLAYBACK_SPEEDS).toContain(1);
      expect(PLAYBACK_SPEEDS).toContain(2);
      expect(PLAYBACK_SPEEDS).toContain(4);
    });
  });

  describe('CAPTURE_SETTINGS', () => {
    it('should have valid capture settings', () => {
      expect(CAPTURE_SETTINGS.DEFAULT_FPS).toBeGreaterThan(0);
      expect(CAPTURE_SETTINGS.MIN_FPS).toBeGreaterThan(0);
      expect(CAPTURE_SETTINGS.MAX_FPS).toBeGreaterThan(CAPTURE_SETTINGS.MIN_FPS);
      expect(CAPTURE_SETTINGS.CAPTURE_SCALE).toBeGreaterThan(0);
      expect(CAPTURE_SETTINGS.CAPTURE_SCALE).toBeLessThanOrEqual(1);
      expect(CAPTURE_SETTINGS.MIN_CAPTURE_DELTA_TIME).toBeGreaterThan(0);
    });
  });

  describe('MEMORY_SETTINGS', () => {
    it('should have valid memory settings', () => {
      expect(MEMORY_SETTINGS.MAX_EVENTS_IN_MEMORY).toBeGreaterThan(0);
      expect(MEMORY_SETTINGS.MEMORY_WARNING_THRESHOLD_MB).toBeGreaterThan(0);
      expect(typeof MEMORY_SETTINGS.AGGRESSIVE_CLEANUP_ENABLED).toBe('boolean');
      expect(MEMORY_SETTINGS.BITMAP_POOL_SIZE).toBeGreaterThan(0);
    });
  });

  describe('CPU_SETTINGS', () => {
    it('should have valid CPU settings', () => {
      expect(CPU_SETTINGS.CPU_THROTTLE_THRESHOLD).toBeGreaterThan(0);
      expect(CPU_SETTINGS.CPU_THROTTLE_THRESHOLD).toBeLessThanOrEqual(100);
      expect(CPU_SETTINGS.THROTTLED_MIN_INTERVAL).toBeGreaterThan(0);
      expect(CPU_SETTINGS.LOW_BATTERY_THRESHOLD).toBeGreaterThanOrEqual(0);
      expect(CPU_SETTINGS.LOW_BATTERY_THRESHOLD).toBeLessThanOrEqual(100);
      expect(typeof CPU_SETTINGS.THERMAL_THROTTLE_ENABLED).toBe('boolean');
      expect(CPU_SETTINGS.MAX_CONSECUTIVE_CAPTURES).toBeGreaterThan(0);
      expect(CPU_SETTINGS.CAPTURE_COOLDOWN_MS).toBeGreaterThan(0);
    });
  });

  describe('STORAGE_SETTINGS', () => {
    it('should have valid storage settings', () => {
      expect(STORAGE_SETTINGS.MAX_STORAGE_SIZE).toBeGreaterThan(0);
      expect(STORAGE_SETTINGS.STORAGE_WARNING_THRESHOLD).toBeGreaterThan(0);
      expect(STORAGE_SETTINGS.STORAGE_WARNING_THRESHOLD).toBeLessThanOrEqual(1);
      expect(STORAGE_SETTINGS.MAX_SESSIONS_TO_KEEP).toBeGreaterThan(0);
      expect(STORAGE_SETTINGS.SESSION_EXPIRY_HOURS).toBeGreaterThan(0);
      expect(typeof STORAGE_SETTINGS.USE_BINARY_FORMAT).toBe('boolean');
    });
  });

  describe('UPLOAD_SETTINGS', () => {
    it('should have valid upload settings', () => {
      expect(UPLOAD_SETTINGS.BATCH_INTERVAL_MS).toBeGreaterThan(0);
      expect(UPLOAD_SETTINGS.MAX_RETRY_ATTEMPTS).toBeGreaterThan(0);
      expect(UPLOAD_SETTINGS.RETRY_DELAY_MULTIPLIER).toBeGreaterThan(1);
      expect(UPLOAD_SETTINGS.INITIAL_RETRY_DELAY_MS).toBeGreaterThan(0);
      expect(UPLOAD_SETTINGS.MAX_EVENTS_PER_BATCH).toBeGreaterThan(0);
      expect(typeof UPLOAD_SETTINGS.CELLULAR_BATTERY_AWARE).toBe('boolean');
    });
  });

  describe('PRIVACY', () => {
    it('should have privacy constants', () => {
      expect(PRIVACY.OCCLUSION_COLOR).toBeTruthy();
      expect(typeof PRIVACY.OCCLUSION_COLOR).toBe('string');
      expect(Array.isArray(PRIVACY.SENSITIVE_COMPONENT_TYPES)).toBe(true);
      expect(PRIVACY.SENSITIVE_COMPONENT_TYPES.length).toBeGreaterThan(0);
    });

    it('should have valid sensitive component types', () => {
      expect(PRIVACY.SENSITIVE_COMPONENT_TYPES).toContain('TextInput');
      expect(PRIVACY.SENSITIVE_COMPONENT_TYPES).toContain('SecureTextEntry');
      expect(PRIVACY.SENSITIVE_COMPONENT_TYPES).toContain('PasswordField');
    });
  });
});
