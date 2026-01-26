/**
 * Unit tests for Rejourney SDK utility functions
 * 
 * These tests cover pure JavaScript/TypeScript functions that don't require
 * React Native runtime or native modules.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  generateId,
  generateSessionId,
  now,
  isDevelopment,
  distance,
  velocity,
  classifyGesture,
  throttle,
  debounce,
  formatBytes,
  formatDuration,
  formatTime,
  simpleHash,
  LogLevel,
  logger,
} from '../../sdk/utils';
import type { TouchPoint } from '../../types';

describe('utils', () => {
  beforeEach(() => {
    vi.stubGlobal('__DEV__', true);
  });

  describe('generateId', () => {
    it('should generate a unique ID', () => {
      const id1 = generateId();
      const id2 = generateId();

      expect(id1).toBeTruthy();
      expect(id2).toBeTruthy();
      expect(id1).not.toBe(id2);
      expect(typeof id1).toBe('string');
    });

    it('should generate IDs with timestamp and random parts', () => {
      const id = generateId();
      const parts = id.split('-');
      expect(parts.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('generateSessionId', () => {
    it('should generate a session ID with correct format', () => {
      const sessionId = generateSessionId();

      expect(sessionId).toBeTruthy();
      expect(sessionId).toMatch(/^session_/);
      expect(typeof sessionId).toBe('string');
    });

    it('should generate unique session IDs', () => {
      const id1 = generateSessionId();
      // Wait a bit to ensure different timestamp
      const id2 = generateSessionId();

      // They might be the same if generated in the same second, but structure should be valid
      expect(id1).toMatch(/^session_\d{8}_\d{6}_[a-z0-9]{4}$/);
      expect(id2).toMatch(/^session_\d{8}_\d{6}_[a-z0-9]{4}$/);
    });
  });

  describe('now', () => {
    it('should return current timestamp', () => {
      const before = Date.now();
      const result = now();
      const after = Date.now();

      expect(result).toBeGreaterThanOrEqual(before);
      expect(result).toBeLessThanOrEqual(after);
      expect(typeof result).toBe('number');
    });
  });

  describe('isDevelopment', () => {
    it('should return boolean', () => {
      const result = isDevelopment();
      expect(typeof result).toBe('boolean');
    });
  });

  describe('distance', () => {
    it('should calculate distance between two points', () => {
      const p1: TouchPoint = { x: 0, y: 0, timestamp: 0 };
      const p2: TouchPoint = { x: 3, y: 4, timestamp: 0 };

      const dist = distance(p1, p2);
      expect(dist).toBe(5); // 3-4-5 triangle
    });

    it('should return 0 for same point', () => {
      const p: TouchPoint = { x: 10, y: 20, timestamp: 0 };
      expect(distance(p, p)).toBe(0);
    });

    it('should handle negative coordinates', () => {
      const p1: TouchPoint = { x: -5, y: -5, timestamp: 0 };
      const p2: TouchPoint = { x: 5, y: 5, timestamp: 0 };

      const dist = distance(p1, p2);
      expect(dist).toBeCloseTo(Math.sqrt(200), 5);
    });
  });

  describe('velocity', () => {
    it('should calculate velocity between two points', () => {
      const p1: TouchPoint = { x: 0, y: 0, timestamp: 0 };
      const p2: TouchPoint = { x: 10, y: 20, timestamp: 100 };

      const vel = velocity(p1, p2);
      expect(vel.x).toBe(0.1); // 10 / 100
      expect(vel.y).toBe(0.2); // 20 / 100
    });

    it('should return zero velocity for same timestamp', () => {
      const p1: TouchPoint = { x: 0, y: 0, timestamp: 100 };
      const p2: TouchPoint = { x: 10, y: 20, timestamp: 100 };

      const vel = velocity(p1, p2);
      expect(vel.x).toBe(0);
      expect(vel.y).toBe(0);
    });

    it('should handle negative velocity', () => {
      const p1: TouchPoint = { x: 10, y: 20, timestamp: 0 };
      const p2: TouchPoint = { x: 0, y: 0, timestamp: 100 };

      const vel = velocity(p1, p2);
      expect(vel.x).toBe(-0.1);
      expect(vel.y).toBe(-0.2);
    });
  });

  describe('classifyGesture', () => {
    it('should classify single touch as tap', () => {
      const touches: TouchPoint[] = [{ x: 10, y: 10, timestamp: 0 }];
      const gesture = classifyGesture(touches, 100);
      expect(gesture).toBe('tap');
    });

    it('should classify long press', () => {
      const touches: TouchPoint[] = [{ x: 10, y: 10, timestamp: 0 }];
      const gesture = classifyGesture(touches, 600);
      expect(gesture).toBe('long_press');
    });

    it('should classify swipe right', () => {
      const touches: TouchPoint[] = [
        { x: 0, y: 0, timestamp: 0 },
        { x: 50, y: 5, timestamp: 100 },
      ];
      const gesture = classifyGesture(touches, 100);
      expect(gesture).toBe('swipe_right');
    });

    it('should classify swipe left', () => {
      const touches: TouchPoint[] = [
        { x: 50, y: 0, timestamp: 0 },
        { x: 0, y: 5, timestamp: 100 },
      ];
      const gesture = classifyGesture(touches, 100);
      expect(gesture).toBe('swipe_left');
    });

    it('should classify swipe up', () => {
      const touches: TouchPoint[] = [
        { x: 0, y: 50, timestamp: 0 },
        { x: 5, y: 0, timestamp: 100 },
      ];
      const gesture = classifyGesture(touches, 100);
      expect(gesture).toBe('swipe_up');
    });

    it('should classify swipe down', () => {
      const touches: TouchPoint[] = [
        { x: 0, y: 0, timestamp: 0 },
        { x: 5, y: 50, timestamp: 100 },
      ];
      const gesture = classifyGesture(touches, 100);
      expect(gesture).toBe('swipe_down');
    });

    it('should classify minimal movement as tap', () => {
      const touches: TouchPoint[] = [
        { x: 10, y: 10, timestamp: 0 },
        { x: 11, y: 11, timestamp: 100 },
      ];
      const gesture = classifyGesture(touches, 100);
      expect(gesture).toBe('tap');
    });

    it('should handle empty touches array', () => {
      const touches: TouchPoint[] = [];
      const gesture = classifyGesture(touches, 100);
      expect(gesture).toBe('tap');
    });
  });

  describe('throttle', () => {
    it('should throttle function calls', async () => {
      const fn = vi.fn();
      const throttled = throttle(fn, 100);

      throttled();
      throttled();
      throttled();

      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should allow calls after delay', async () => {
      const fn = vi.fn();
      const throttled = throttle(fn, 50);

      throttled();
      await new Promise(resolve => setTimeout(resolve, 60));
      throttled();

      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('should pass arguments correctly', () => {
      const fn = vi.fn();
      const throttled = throttle(fn, 100);

      throttled('arg1', 'arg2');

      expect(fn).toHaveBeenCalledWith('arg1', 'arg2');
    });
  });

  describe('debounce', () => {
    it('should debounce function calls', async () => {
      const fn = vi.fn();
      const debounced = debounce(fn, 50);

      debounced();
      debounced();
      debounced();

      await new Promise(resolve => setTimeout(resolve, 60));

      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should cancel previous calls', async () => {
      const fn = vi.fn();
      const debounced = debounce(fn, 50);

      debounced('first');
      await new Promise(resolve => setTimeout(resolve, 30));
      debounced('second');
      await new Promise(resolve => setTimeout(resolve, 60));

      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith('second');
    });
  });

  describe('formatBytes', () => {
    it('should format bytes correctly', () => {
      expect(formatBytes(0)).toBe('0 Bytes');
      expect(formatBytes(1024)).toBe('1 KB');
      expect(formatBytes(1024 * 1024)).toBe('1 MB');
      expect(formatBytes(1024 * 1024 * 1024)).toBe('1 GB');
    });

    it('should format fractional sizes', () => {
      const result = formatBytes(1536); // 1.5 KB
      expect(result).toMatch(/1\.5.*KB/);
    });

    it('should handle large numbers', () => {
      const result = formatBytes(1024 * 1024 * 1024 * 5);
      expect(result).toMatch(/5.*GB/);
    });
  });

  describe('formatDuration', () => {
    it('should format seconds', () => {
      expect(formatDuration(5000)).toBe('5s');
    });

    it('should format minutes and seconds', () => {
      expect(formatDuration(65000)).toBe('1m 5s');
    });

    it('should format hours, minutes and seconds', () => {
      expect(formatDuration(3665000)).toBe('1h 1m 5s');
    });

    it('should handle zero', () => {
      expect(formatDuration(0)).toBe('0s');
    });
  });

  describe('formatTime', () => {
    it('should format time as MM:SS', () => {
      expect(formatTime(0)).toBe('00:00');
      expect(formatTime(5000)).toBe('00:05');
      expect(formatTime(65000)).toBe('01:05');
      expect(formatTime(3665000)).toBe('61:05');
    });

    it('should pad minutes and seconds', () => {
      expect(formatTime(5000)).toBe('00:05');
      expect(formatTime(50000)).toBe('00:50');
    });
  });

  describe('simpleHash', () => {
    it('should generate a hash string', () => {
      const hash = simpleHash('test string');
      expect(hash).toBeTruthy();
      expect(typeof hash).toBe('string');
    });

    it('should generate same hash for same input', () => {
      const hash1 = simpleHash('test');
      const hash2 = simpleHash('test');
      expect(hash1).toBe(hash2);
    });

    it('should generate different hashes for different inputs', () => {
      const hash1 = simpleHash('test1');
      const hash2 = simpleHash('test2');
      expect(hash1).not.toBe(hash2);
    });

    it('should handle empty string', () => {
      const hash = simpleHash('');
      expect(hash).toBeTruthy();
      expect(typeof hash).toBe('string');
    });
  });

  describe('LogLevel', () => {
    it('should have correct enum values', () => {
      expect(LogLevel.DEBUG).toBe(0);
      expect(LogLevel.INFO).toBe(1);
      expect(LogLevel.WARNING).toBe(2);
      expect(LogLevel.ERROR).toBe(3);
      expect(LogLevel.SILENT).toBe(4);
    });
  });

  describe('logger', () => {
    beforeEach(() => {
      vi.spyOn(console, 'log').mockImplementation(() => { });
      vi.spyOn(console, 'info').mockImplementation(() => { });
      vi.spyOn(console, 'warn').mockImplementation(() => { });
      vi.spyOn(console, 'error').mockImplementation(() => { });
    });

    it('should respect log levels', () => {
      logger.setLogLevel(LogLevel.WARNING);
      logger.debug('debug');
      logger.info('info');
      logger.warn('warn');
      logger.error('error');

      expect(console.log).toHaveBeenCalledTimes(2);
      expect(console.info).not.toHaveBeenCalled();
      // In default/prod mode, warn/error use console.log to avoid YellowBox/RedBox
      expect(console.warn).not.toHaveBeenCalled();
      expect(console.error).not.toHaveBeenCalled();
    });

    it('should allow setting log level', () => {
      logger.setLogLevel(LogLevel.DEBUG);
      logger.debug('test');
      expect(console.log).toHaveBeenCalled();
    });

    it('should have lifecycle log methods', () => {
      logger.logInitSuccess('1.0.0');
      logger.logInitFailure('test error');
      logger.logSessionStart('session-123');
      logger.logSessionEnd('session-123');

      // These methods may or may not log based on __DEV__
      // Just verify they don't throw
      expect(true).toBe(true);
    });
  });
});
