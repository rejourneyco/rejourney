import { describe, expect, it } from 'vitest';
import type { Project } from '~/shared/types';
import {
  formatProjectPlatforms,
  hasUnsupportedNativeAndroid,
  normalizeSetupIntegrations,
  SETUP_PLATFORM_OPTIONS,
} from './setupUtils';

function projectWithPlatforms(platforms: Project['platforms']): Project {
  return { platforms } as Project;
}

describe('setup integration normalization', () => {
  it('offers only integrations with installable SDKs', () => {
    expect(SETUP_PLATFORM_OPTIONS.map((option) => option.id)).toEqual(['web', 'react-native', 'ios']);
  });

  it('collapses React Native runtime markers into one integration', () => {
    expect(normalizeSetupIntegrations(['react-native', 'ios', 'android'])).toEqual(['react-native']);
    expect(formatProjectPlatforms(projectWithPlatforms(['react-native', 'ios', 'android']))).toBe('React Native');
  });

  it('preserves supported multi-integration projects', () => {
    expect(normalizeSetupIntegrations(['web', 'ios'])).toEqual(['web', 'ios']);
    expect(formatProjectPlatforms(projectWithPlatforms(['web', 'ios']))).toBe('Web, iOS');
  });

  it('flags legacy Native Android selections without treating React Native Android as unsupported', () => {
    expect(hasUnsupportedNativeAndroid(['android'])).toBe(true);
    expect(hasUnsupportedNativeAndroid(['react-native', 'android'])).toBe(false);
    expect(formatProjectPlatforms(projectWithPlatforms(['android']))).toBe('Native Android (unsupported)');
  });
});
