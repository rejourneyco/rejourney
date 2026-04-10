import { describe, expect, it } from 'vitest';
import { loadReactNavigationNative } from '../../sdk/autoTracking';

describe('autoTracking optional dependencies', () => {
  it('loads react-navigation helpers through the provided loader', () => {
    const navigationModule = {
      createNavigationContainerRef: () => ({ current: null }),
    };

    expect(
      loadReactNavigationNative(() => navigationModule)
    ).toBe(navigationModule);
  });

  it('throws a helpful error when react-navigation is unavailable', () => {
    expect(() =>
      loadReactNavigationNative(() => {
        throw new Error('Cannot find module');
      })
    ).toThrow(
      '@react-navigation/native'
    );
  });
});
