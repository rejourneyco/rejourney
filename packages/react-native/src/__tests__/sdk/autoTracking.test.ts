import { describe, expect, it } from 'vitest';
import { loadReactNavigationNative } from '../../sdk/autoTracking';

// Note: the happy path (module present) is verified by mobile integration tests
// where @react-navigation/native is installed. The lazy require() pattern used
// here uses createRequire in vitest's ESM environment and cannot be intercepted
// by vi.mock at unit test level.
describe('autoTracking optional dependencies', () => {
  it('throws a helpful error when react-navigation is unavailable', () => {
    expect(() => loadReactNavigationNative()).toThrow('@react-navigation/native');
  });
});
