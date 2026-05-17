'use client';

import { useEffect } from 'react';
import { initRejourney, startRejourney, Rejourney } from '../sdk/client.js';
import type { RejourneyWebConfig } from '../sdk/types.js';

export interface RejourneyNextProps {
  publicKey: string;
  startOnMount?: boolean;
  options?: RejourneyWebConfig;
}

export function RejourneyNext({ publicKey, startOnMount = true, options }: RejourneyNextProps) {
  useEffect(() => {
    let cancelled = false;
    void initRejourney(publicKey, options).then(() => {
      if (!cancelled && startOnMount) void startRejourney();
    });
    return () => {
      cancelled = true;
    };
  }, [publicKey, startOnMount, options]);

  return null;
}

export { Rejourney, initRejourney, startRejourney };
