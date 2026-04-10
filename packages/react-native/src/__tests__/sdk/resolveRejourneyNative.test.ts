import { describe, expect, it } from 'vitest';
import { resolveRejourneyNativeModule } from '../../sdk/resolveRejourneyNative';
import type { Spec } from '../../NativeRejourney';

const stubSpec = { startSession: async () => ({ success: true, sessionId: 'x' }) } as unknown as Spec;

describe('resolveRejourneyNativeModule', () => {
  it('prefers TurboModuleRegistry when it returns a module', () => {
    const result = resolveRejourneyNativeModule({
      TurboModuleRegistry: { get: () => stubSpec },
      NativeModules: { Rejourney: stubSpec },
    });
    expect(result.via).toBe('TurboModules');
    expect(result.module).toBe(stubSpec);
  });

  it('falls back to NativeModules when Turbo get returns null', () => {
    const result = resolveRejourneyNativeModule({
      TurboModuleRegistry: { get: () => null },
      NativeModules: { Rejourney: stubSpec },
    });
    expect(result.via).toBe('NativeModules');
    expect(result.module).toBe(stubSpec);
  });

  it('falls back to NativeModules when TurboModuleRegistry.get throws', () => {
    const result = resolveRejourneyNativeModule({
      TurboModuleRegistry: {
        get: () => {
          throw new Error('not ready');
        },
      },
      NativeModules: { Rejourney: stubSpec },
    });
    expect(result.via).toBe('NativeModules');
    expect(result.module).toBe(stubSpec);
    expect(result.turboLookupError).toBeInstanceOf(Error);
  });

  it('returns none when nothing resolves', () => {
    const result = resolveRejourneyNativeModule({
      TurboModuleRegistry: { get: () => null },
      NativeModules: {},
    });
    expect(result).toEqual({
      module: null,
      via: 'none',
      turboLookupError: undefined,
    });
  });
});
