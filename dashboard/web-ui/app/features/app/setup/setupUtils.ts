import type { Project } from '~/shared/types';

export type SetupPlatform = 'web' | 'ios' | 'android' | 'react-native';

export const SETUP_PLATFORM_OPTIONS: Array<{
  id: SetupPlatform;
  label: string;
  shortLabel: string;
  description: string;
}> = [
  {
    id: 'web',
    label: 'Web App',
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
    id: 'ios',
    label: 'Native iOS',
    shortLabel: 'iOS',
    description: 'Swift or SwiftUI apps using the native package.',
  },
  {
    id: 'android',
    label: 'Native Android',
    shortLabel: 'Android',
    description: 'Kotlin or Java apps using the Android SDK.',
  },
];

export function formatSetupPlatform(platform: string): string {
  if (platform === 'ios') return 'iOS';
  if (platform === 'android') return 'Android';
  if (platform === 'web') return 'Web';
  if (platform === 'react-native') return 'React Native';
  return platform;
}

export function formatProjectPlatforms(project: Project | null | undefined): string {
  const platforms = project?.platforms ?? [];
  if (platforms.length === 0) return 'No platform selected';
  return platforms.map(formatSetupPlatform).join(', ');
}

export function projectHasRecentData(project: Project | null | undefined): boolean {
  return Boolean(
    (project?.sessionsLast7Days ?? 0) > 0 ||
    (project?.errorsLast7Days ?? 0) > 0,
  );
}

export function shouldSurfaceSetup(projects: readonly Project[], selectedProject: Project | null | undefined): boolean {
  return projects.length === 0 || !projectHasRecentData(selectedProject);
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
    'Use the AI setup prompt below in your coding tool, then ship a test build/session and confirm data appears in Rejourney.',
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
      `Could you please integrate Rejourney into ${project?.name || 'our web application'}? It will allow us to record sessions and track user diagnostics.`,
      '',
      'Project details:',
      teamName ? `- Team: ${teamName}` : null,
      project?.name ? `- Project: ${project.name}` : null,
      project?.publicKey ? `- API Key: ${project.publicKey}` : null,
      project ? `- Platforms: ${formatProjectPlatforms(project)}` : null,
      project?.webAllowedDomains?.length
        ? `- Web allowed domains: ${project.webAllowedDomains.join(', ')}`
        : project?.webDomain
          ? `- Web allowed domain: ${project.webDomain}`
          : null,
      project?.bundleId ? `- iOS bundle ID: ${project.bundleId}` : null,
      project?.packageName ? `- Android package name: ${project.packageName}` : null,
      '',
      'Here are the quick options to get it set up:',
      '',
      'Option 1: Using an AI Coding Agent (Cursor, Copilot, v0, etc.) - Recommended',
      'Just copy and paste the prompt below into your AI editor. It has all the files and configurations needed:',
      '--------------------------------------------------',
      aiPrompt,
      '--------------------------------------------------',
      '',
      'Option 2: Manual Setup',
      '- Package install: Install the Rejourney package.',
      '- Initialize: Start the SDK with our project API key.',
      project?.publicKey ? `  API Key: ${project.publicKey}` : null,
      '',
      'Once complete, please trigger a local test session so we can verify the data on our end.',
      '',
      'Thank you!',
    ].filter((line): line is string => line !== null);

    return lines.join('\n');
  }

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
    'Next steps:',
    '1. Install the matching Rejourney SDK.',
    '2. Initialize it with the public key above.',
    '3. Confirm the production domains, bundle ID, and package name match the app before shipping.',
    '4. Send one local or staging test session and confirm it appears in Rejourney.',
    '',
    'I can send the full AI setup prompt from the Rejourney setup page if you want the coding-agent version.',
  ].filter((line): line is string => line !== null);

  return lines.join('\n');
}
