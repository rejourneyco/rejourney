import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cleanupAutoTracking,
  initAutoTracking,
  loadReactNavigationNative,
  pauseAutoTracking,
  resumeAutoTracking,
} from '../../sdk/autoTracking';

const originalConsole = {
  log: console.log,
  info: console.info,
  warn: console.warn,
  error: console.error,
};

afterEach(() => {
  cleanupAutoTracking();
  console.log = originalConsole.log;
  console.info = originalConsole.info;
  console.warn = originalConsole.warn;
  console.error = originalConsole.error;
});

// Note: the happy path (module present) is verified by mobile integration tests
// where @react-navigation/native is installed. The lazy require() pattern used
// here uses createRequire in vitest's ESM environment and cannot be intercepted
// by vi.mock at unit test level.
describe('autoTracking optional dependencies', () => {
  it('throws a helpful error when react-navigation is unavailable', () => {
    expect(() => loadReactNavigationNative()).toThrow('@react-navigation/native');
  });

  it('does not overwrite console wrappers installed after Rejourney', () => {
    initAutoTracking({
      trackJSErrors: false,
      trackReactNativeErrors: false,
      trackPromiseRejections: true,
      trackConsoleLogs: true,
      autoTrackExpoRouter: false,
    });
    const rejourneyError = console.error;
    const rejourneyLog = console.log;
    const laterError = (...args: unknown[]) => rejourneyError(...args);
    const laterLog = (...args: unknown[]) => rejourneyLog(...args);
    console.error = laterError;
    console.log = laterLog;

    pauseAutoTracking();
    expect(console.error).toBe(laterError);
    expect(console.log).toBe(laterLog);

    resumeAutoTracking();
    expect(console.error).toBe(laterError);
    expect(console.log).toBe(laterLog);
  });

  it('observes the native runtime exception pipeline without suppressing React Native', () => {
    let listener: ((error: any) => void) | undefined;
    const register = (callback: (error: any) => void) => {
      listener = callback;
    };
    const globalWithRNListener = globalThis as typeof globalThis & {
      RN$registerExceptionListener?: typeof register;
    };
    globalWithRNListener.RN$registerExceptionListener = register;
    const captured: any[] = [];

    try {
      initAutoTracking(
        {
          trackJSErrors: false,
          trackReactNativeErrors: true,
          trackPromiseRejections: false,
          trackConsoleLogs: false,
          autoTrackExpoRouter: false,
        },
        { onError: (error) => captured.push(error) }
      );

      expect(listener).toBeTypeOf('function');
      const preventDefault = vi.fn();
      listener!({
        id: 42,
        message: 'startup exploded',
        name: 'TypeError',
        isFatal: true,
        stack: [{
          methodName: 'bootstrap',
          file: 'index.bundle',
          lineNumber: 12,
          column: 7,
        }],
        preventDefault,
      });

      expect(captured).toHaveLength(1);
      expect(captured[0]).toMatchObject({
        incidentId: 'rn-native-42',
        message: 'startup exploded',
        name: 'TypeError',
        source: 'react_native_runtime',
        handled: false,
        stack: 'at bootstrap (index.bundle:12:7)',
      });
      expect(preventDefault).not.toHaveBeenCalled();

      pauseAutoTracking();
      let pausedStackReads = 0;
      listener!({
        id: 43,
        message: 'paused error',
        get stack() {
          pausedStackReads++;
          return [{ methodName: 'must_not_format' }];
        },
      });
      expect(captured).toHaveLength(1);
      expect(pausedStackReads).toBe(0);

      resumeAutoTracking();
      listener!({
        id: 44,
        message: 'resumed error',
        extraData: { rawStack: 'raw hermes stack' },
      });
      expect(captured).toHaveLength(2);
      expect(captured[1].stack).toBe('raw hermes stack');
    } finally {
      delete globalWithRNListener.RN$registerExceptionListener;
    }
  });
});
