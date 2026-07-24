import type { Project } from '~/shared/types';

export type SetupIntegration = 'web' | 'ios' | 'react-native' | 'flutter';
export const SETUP_GATE_TOAST = "You can't have a Chicken before the Egg...Finish Setup";

export const SETUP_PLATFORM_OPTIONS: Array<{
  id: SetupIntegration;
  label: string;
  shortLabel: string;
  description: string;
}> = [
  {
    id: 'web',
    label: 'Web App or Shopify',
    shortLabel: 'Web',
    description: 'Browser SDK for marketing sites, dashboards, or SaaS apps.',
  },
  {
    id: 'react-native',
    label: 'React Native',
    shortLabel: 'React Native',
    description: 'Expo or React Navigation apps using the React Native SDK.',
  },
  {
    id: 'flutter',
    label: 'Flutter',
    shortLabel: 'Flutter',
    description: 'Dart apps using the native iOS and Android Flutter plugin.',
  },
  {
    id: 'ios',
    label: 'Native iOS',
    shortLabel: 'iOS',
    description: 'Swift or SwiftUI apps using the native package.',
  },
];

export function normalizeSetupIntegrations(platforms: readonly string[] | null | undefined): SetupIntegration[] {
  const values = new Set(platforms ?? []);
  const integrations: SetupIntegration[] = [];

  if (values.has('web')) integrations.push('web');
  if (values.has('react-native')) {
    integrations.push('react-native');
  } else if (values.has('flutter')) {
    integrations.push('flutter');
  } else if (values.has('ios')) {
    integrations.push('ios');
  }

  return integrations;
}

export function hasUnsupportedNativeAndroid(platforms: readonly string[] | null | undefined): boolean {
  const values = new Set(platforms ?? []);
  return values.has('android') && !values.has('react-native') && !values.has('flutter');
}

export function formatSetupPlatform(platform: string): string {
  if (platform === 'ios') return 'iOS';
  if (platform === 'android') return 'Android';
  if (platform === 'web') return 'Web';
  if (platform === 'react-native') return 'React Native';
  if (platform === 'flutter') return 'Flutter';
  return platform;
}

export function formatProjectPlatforms(project: Project | null | undefined): string {
  const labels = normalizeSetupIntegrations(project?.platforms).map(formatSetupPlatform);
  if (hasUnsupportedNativeAndroid(project?.platforms)) {
    labels.push('Native Android (unsupported)');
  }
  return labels.length > 0 ? labels.join(', ') : 'No platform selected';
}

export function projectHasRecentData(project: Project | null | undefined): boolean {
  return Boolean(
    (project?.sessionsTotal ?? 0) > 0 ||
    (project?.sessionsLast7Days ?? 0) > 0 ||
    (project?.errorsTotal ?? 0) > 0 ||
    (project?.errorsLast7Days ?? 0) > 0,
  );
}

export function shouldSurfaceSetup(projects: readonly Project[], selectedProject: Project | null | undefined): boolean {
  return projects.length === 0 || !projectHasRecentData(selectedProject);
}

export function shouldRedirectFromSetup(selectedProject: Project | null | undefined): boolean {
  return projectHasRecentData(selectedProject);
}

export function isSetupWizardRoute(pathname: string): boolean {
  const routeWithoutPrefix = pathname.replace(/^\/(dashboard|demo)/, '');
  return routeWithoutPrefix === '/setup' || routeWithoutPrefix.endsWith('/setup');
}

export function isSetupSupportRoute(pathname: string): boolean {
  const routeWithoutPrefix = pathname.replace(/^\/(dashboard|demo)/, '');
  return (
    isSetupWizardRoute(pathname) ||
    /^\/settings\/[^/]+\/github\/?$/.test(routeWithoutPrefix)
  );
}

export function buildDeveloperSetupInstructions({
  project,
  teamName,
  aiPrompt,
}: {
  project: Project | null;
  teamName?: string | null;
  aiPrompt: string;
}): string {
  const lines = [
    'Please finish the Rejourney SDK setup for this app.',
    '',
    'Project details:',
    teamName ? `- Team: ${teamName}` : null,
    project?.name ? `- Project: ${project.name}` : null,
    project?.publicKey ? `- Public key: ${project.publicKey}` : null,
    project ? `- Platforms: ${formatProjectPlatforms(project)}` : null,
    project?.webAllowedDomains?.length
      ? `- Web allowed domains: ${project.webAllowedDomains.join(', ')}`
      : project?.webDomain
        ? `- Web allowed domain: ${project.webDomain}`
        : null,
    project?.bundleId ? `- iOS bundle ID: ${project.bundleId}` : null,
    project?.packageName ? `- Android package name: ${project.packageName}` : null,
    '',
    'Use the AI setup instructions below in your coding tool, then ship a test build/session and confirm data appears in Rejourney.',
    '',
    aiPrompt,
  ].filter((line): line is string => line !== null);

  return lines.join('\n');
}

export function buildDeveloperSetupEmail({
  project,
  teamName,
  aiPrompt,
}: {
  project: Project | null;
  teamName?: string | null;
  aiPrompt?: string;
}): string {
  if (aiPrompt) {
    const lines = [
      'Hi,',
      '',
      `Please integrate Rejourney into ${project?.name || 'this app'}. You may not have Rejourney dashboard context, so this email includes the project details and setup instructions you need.`,
      '',
      'Project context:',
      teamName ? `- Team: ${teamName}` : null,
      project?.name ? `- Project: ${project.name}` : null,
      project?.publicKey ? `- Public key: ${project.publicKey}` : null,
      project ? `- Platforms: ${formatProjectPlatforms(project)}` : null,
      project?.webAllowedDomains?.length
        ? `- Web allowed domains: ${project.webAllowedDomains.join(', ')}`
        : project?.webDomain
          ? `- Web allowed domain: ${project.webDomain}`
          : null,
      project?.bundleId ? `- iOS bundle ID: ${project.bundleId}` : null,
      project?.packageName ? `- Android package name: ${project.packageName}` : null,
      '',
      'Implementation goal:',
      '- Install the matching Rejourney SDK for the app stack you find in the repo.',
      '- Initialize Rejourney with the public key above.',
      '- Add the route/screen tracking and privacy controls described in the instructions.',
      '- Run a local or staging test session when finished.',
      '',
      'Use the AI setup instructions below as the source of truth. They are written for an AI coding assistant, but they also work as the implementation checklist for a developer reviewing the code directly.',
      '',
      'AI setup instructions:',
      '--------------------------------------------------',
      aiPrompt,
      '--------------------------------------------------',
      '',
      'Before you mark this complete:',
      '- Confirm the production domains, bundle ID, and package name in the repo match the project context above.',
      '- Do not send PII in custom events or metadata.',
      '- Reply with what changed and whether a test session appeared in Rejourney.',
      '',
      'Thank you!',
    ].filter((line): line is string => line !== null);

    return lines.join('\n');
  }

  const lines = [
    'Please finish the Rejourney SDK setup for this app. You may not have Rejourney dashboard context, so the project details are included below.',
    '',
    'Project context:',
    teamName ? `- Team: ${teamName}` : null,
    project?.name ? `- Project: ${project.name}` : null,
    project?.publicKey ? `- Public key: ${project.publicKey}` : null,
    project ? `- Platforms: ${formatProjectPlatforms(project)}` : null,
    project?.webAllowedDomains?.length
      ? `- Web allowed domains: ${project.webAllowedDomains.join(', ')}`
      : project?.webDomain
        ? `- Web allowed domain: ${project.webDomain}`
        : null,
    project?.bundleId ? `- iOS bundle ID: ${project.bundleId}` : null,
    project?.packageName ? `- Android package name: ${project.packageName}` : null,
    '',
    'Implementation checklist:',
    '1. Install the matching Rejourney SDK.',
    '2. Initialize it with the public key above.',
    '3. Add route/screen tracking and privacy controls for this app stack.',
    '4. Confirm the production domains, bundle ID, and package name match the app before shipping.',
    '5. Send one local or staging test session and confirm it appears in Rejourney.',
    '',
    'I can send the full AI setup instructions from the Rejourney setup page if you want the coding-agent version.',
  ].filter((line): line is string => line !== null);

  return lines.join('\n');
}
