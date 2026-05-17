import { env } from '$env/dynamic/public';
import { Rejourney, startRejourneyOnMount } from '@rejourneyco/browser/svelte';

const fixtureUserId = 'web_fixture_user';

function resolveRejourneyApiUrl(): string | undefined {
  const configured = env.PUBLIC_REJOURNEY_API_URL?.trim();
  if (configured) return configured;
  if (typeof window === 'undefined') return undefined;
  return `${window.location.protocol}//${window.location.hostname}:3000`;
}

export function mountRejourney() {
  if (!env.PUBLIC_REJOURNEY_KEY) return () => undefined;

  Rejourney.setUserIdentity(fixtureUserId);

  return startRejourneyOnMount({
    publicKey: env.PUBLIC_REJOURNEY_KEY,
    apiUrl: resolveRejourneyApiUrl(),
    autoTrackRoutes: true,
    autoTrackNetwork: true,
    ignoreBots: false,
    recordAutomation: true,
  });
}
