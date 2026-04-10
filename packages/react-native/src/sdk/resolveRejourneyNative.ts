import type { Spec } from '../NativeRejourney';

/**
 * Minimal RN runtime shape needed to resolve the Rejourney native module.
 * Kept separate from index.ts for unit tests (Turbo vs bridge fallback).
 */
export type ReactNativeModuleRuntime = {
  NativeModules?: { Rejourney?: Spec | null } & Record<string, unknown>;
  TurboModuleRegistry?: {
    get?: (name: string) => unknown;
  };
};

export type RejourneyNativeResolution = {
  module: Spec | null;
  via: 'TurboModules' | 'NativeModules' | 'none';
  /** Populated when TurboModuleRegistry.get('Rejourney') threw (runtime not ready, etc.). */
  turboLookupError?: unknown;
};

/**
 * Resolve Rejourney from TurboModuleRegistry first, then NativeModules (legacy / interop).
 */
export function resolveRejourneyNativeModule(
  rn: ReactNativeModuleRuntime
): RejourneyNativeResolution {
  const { NativeModules, TurboModuleRegistry } = rn;
  let turboLookupError: unknown;

  if (TurboModuleRegistry && typeof TurboModuleRegistry.get === 'function') {
    try {
      const mod = TurboModuleRegistry.get('Rejourney');
      if (mod) {
        return { module: mod as Spec, via: 'TurboModules' };
      }
    } catch (e) {
      turboLookupError = e;
    }
  }

  if (NativeModules?.Rejourney) {
    return { module: NativeModules.Rejourney, via: 'NativeModules', turboLookupError };
  }

  return { module: null, via: 'none', turboLookupError };
}
