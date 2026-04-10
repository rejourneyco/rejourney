import { describe, expect, it } from 'vitest';
import { loadReactNavigationNative } from '../../sdk/autoTracking';

describe('loadReactNavigationNative (optional peer)', () => {
  it('returns the module when the loader succeeds', () => {
    const fake = { createNavigationContainerRef: () => ({}) };
    const mod = loadReactNavigationNative(() => fake);
    expect(mod).toBe(fake);
  });

  it('throws a clear error when the optional peer is missing', () => {
    expect(() =>
      loadReactNavigationNative(() => {
        throw new Error('Unable to resolve module @react-navigation/native');
      })
    ).toThrow(/@react-navigation\/native/);
  });
});
