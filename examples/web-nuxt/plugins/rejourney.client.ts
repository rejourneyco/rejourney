import { Rejourney, defineRejourneyNuxtPlugin } from '@rejourneyco/browser/nuxt';

const fixtureUserId = 'web_fixture_user';

function resolveRejourneyApiUrl(configured: unknown): string | undefined {
  const value = String(configured || '').trim();
  if (value) return value;
  return `${window.location.protocol}//${window.location.hostname}:3000`;
}

export default defineNuxtPlugin(() => {
  const config = useRuntimeConfig();
  const publicKey = config.public.rejourneyKey;

  if (!publicKey) {
    return { provide: {} };
  }

  Rejourney.setUserIdentity(fixtureUserId);

  const install = defineRejourneyNuxtPlugin({
    publicKey: String(publicKey),
    apiUrl: resolveRejourneyApiUrl(config.public.rejourneyApiUrl),
    autoTrackRoutes: true,
    autoTrackNetwork: true,
    ignoreBots: false,
    recordAutomation: true,
  });

  return install();
});
