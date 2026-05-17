'use client';

import { useEffect } from 'react';
import { Rejourney } from '@rejourneyco/browser';
import { RejourneyNext } from '@rejourneyco/browser/next';

const publicKey = process.env.NEXT_PUBLIC_REJOURNEY_KEY;
const fixtureUserId = 'web_fixture_user';

function resolveRejourneyApiUrl(): string | undefined {
  const configured = process.env.NEXT_PUBLIC_REJOURNEY_API_URL?.trim();
  if (configured) return configured;
  if (typeof window === 'undefined') return undefined;
  return `${window.location.protocol}//${window.location.hostname}:3000`;
}

export function RejourneyClient() {
  useEffect(() => {
    if (!publicKey) return;
    Rejourney.setUserIdentity(fixtureUserId);
  }, []);

  if (!publicKey) return null;

  return (
    <RejourneyNext
      publicKey={publicKey}
      options={{
        apiUrl: resolveRejourneyApiUrl(),
        autoTrackRoutes: true,
        autoTrackNetwork: true,
        ignoreBots: false,
        recordAutomation: true,
        trackConsoleLogs: false,
      }}
    />
  );
}
