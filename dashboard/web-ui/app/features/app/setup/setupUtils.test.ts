import { describe, expect, it } from 'vitest';
import type { Project } from '~/shared/types';
import {
  formatProjectPlatforms,
  hasUnsupportedNativeAndroid,
  isSetupSupportRoute,
  isSetupWizardRoute,
  normalizeSetupIntegrations,
  shouldRedirectFromSetup,
  SETUP_PLATFORM_OPTIONS,
} from './setupUtils';

function projectWithPlatforms(platforms: Project['platforms']): Project {
  return { platforms } as Project;
}

describe('setup integration normalization', () => {
  it('offers only integrations with installable SDKs', () => {
    expect(SETUP_PLATFORM_OPTIONS.map((option) => option.id)).toEqual(['web', 'react-native', 'flutter', 'ios']);
  });

  it('collapses React Native runtime markers into one integration', () => {
    expect(normalizeSetupIntegrations(['react-native', 'ios', 'android'])).toEqual(['react-native']);
    expect(formatProjectPlatforms(projectWithPlatforms(['react-native', 'ios', 'android']))).toBe('React Native');
  });

  it('preserves supported multi-integration projects', () => {
    expect(normalizeSetupIntegrations(['web', 'ios'])).toEqual(['web', 'ios']);
    expect(formatProjectPlatforms(projectWithPlatforms(['web', 'ios']))).toBe('Web, iOS');
  });

  it('normalizes Flutter as one cross-platform mobile integration', () => {
    expect(normalizeSetupIntegrations(['flutter', 'ios', 'android'])).toEqual(['flutter']);
    expect(formatProjectPlatforms(projectWithPlatforms(['flutter', 'ios', 'android']))).toBe('Flutter');
    expect(hasUnsupportedNativeAndroid(['flutter', 'android'])).toBe(false);
  });

  it('flags legacy Native Android selections without treating React Native Android as unsupported', () => {
    expect(hasUnsupportedNativeAndroid(['android'])).toBe(true);
    expect(hasUnsupportedNativeAndroid(['react-native', 'android'])).toBe(false);
    expect(formatProjectPlatforms(projectWithPlatforms(['android']))).toBe('Native Android (unsupported)');
  });
});

describe('completed setup routing', () => {
  it('redirects projects that have already received sessions', () => {
    expect(shouldRedirectFromSetup({ sessionsTotal: 1 } as Project)).toBe(true);
    expect(shouldRedirectFromSetup({ sessionsLast7Days: 1 } as Project)).toBe(true);
  });

  it('keeps projects without received data in setup', () => {
    expect(shouldRedirectFromSetup({ sessionsTotal: 0, sessionsLast7Days: 0 } as Project)).toBe(false);
    expect(shouldRedirectFromSetup(null)).toBe(false);
  });

  it('distinguishes the onboarding wizard from other setup-support routes', () => {
    expect(isSetupWizardRoute('/dashboard/setup')).toBe(true);
    expect(isSetupWizardRoute('/dashboard/settings/project-1/github')).toBe(false);
    expect(isSetupSupportRoute('/dashboard/settings/project-1/github')).toBe(true);
  });
});
