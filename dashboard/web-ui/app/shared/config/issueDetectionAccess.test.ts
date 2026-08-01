import { describe, expect, it } from 'vitest';
import {
  isHostedOnlyIssueDetectionPath,
  shouldShowIssueDetectionUi,
} from './issueDetectionAccess';

describe('issue detection access', () => {
  it('never exposes hosted issue detection to a self-hosted user', () => {
    expect(shouldShowIssueDetectionUi({
      featureEnabled: true,
      isDemoMode: false,
      isSelfHosted: true,
    })).toBe(false);
  });

  it('keeps the public demo available and requires the feature flag in cloud', () => {
    expect(shouldShowIssueDetectionUi({
      featureEnabled: false,
      isDemoMode: true,
      isSelfHosted: true,
    })).toBe(true);
    expect(shouldShowIssueDetectionUi({
      featureEnabled: true,
      isDemoMode: false,
      isSelfHosted: false,
    })).toBe(true);
    expect(shouldShowIssueDetectionUi({
      featureEnabled: false,
      isDemoMode: false,
      isSelfHosted: false,
    })).toBe(false);
  });

  it('identifies every hosted-only dashboard route', () => {
    expect(isHostedOnlyIssueDetectionPath('/dashboard/leaks')).toBe(true);
    expect(isHostedOnlyIssueDetectionPath('/dashboard/leaks/')).toBe(true);
    expect(isHostedOnlyIssueDetectionPath('/dashboard/automations')).toBe(true);
    expect(isHostedOnlyIssueDetectionPath('/dashboard/automations/leaks')).toBe(true);
    expect(isHostedOnlyIssueDetectionPath('/dashboard/settings/project-1/github')).toBe(true);

    expect(isHostedOnlyIssueDetectionPath('/demo/leaks')).toBe(false);
    expect(isHostedOnlyIssueDetectionPath('/dashboard/general')).toBe(false);
    expect(isHostedOnlyIssueDetectionPath('/dashboard/settings/project-1')).toBe(false);
  });
});
