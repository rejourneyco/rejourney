import { describe, expect, it } from 'vitest';
import { loadReactNavigationNative } from '../../sdk/autoTracking';

describe('loadReactNavigationNative (optional peer)', () => {
  it('throws a clear error when the optional peer is missing', () => {
    expect(() => loadReactNavigationNative()).toThrow(/@react-navigation\/native/);
  });
});
