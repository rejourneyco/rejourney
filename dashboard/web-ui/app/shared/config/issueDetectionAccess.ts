type IssueDetectionAvailability = {
  featureEnabled: boolean;
  isDemoMode: boolean;
  isSelfHosted: boolean;
};

export function shouldShowIssueDetectionUi({
  featureEnabled,
  isDemoMode,
  isSelfHosted,
}: IssueDetectionAvailability): boolean {
  return isDemoMode || (featureEnabled && !isSelfHosted);
}

export function isHostedOnlyIssueDetectionPath(pathname: string): boolean {
  return /^\/dashboard\/(?:leaks(?:\/|$)|automations(?:\/|$)|settings\/[^/]+\/github(?:\/|$))/.test(pathname);
}
