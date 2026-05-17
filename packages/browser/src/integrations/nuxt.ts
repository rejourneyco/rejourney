import { initRejourney, startRejourney, Rejourney } from '../sdk/client.js';
import type { RejourneyWebConfig } from '../sdk/types.js';

export interface RejourneyNuxtOptions extends RejourneyWebConfig {
  publicKey: string;
  startOnMount?: boolean;
}

export function defineRejourneyNuxtPlugin(options: RejourneyNuxtOptions) {
  return () => {
    if (typeof window === 'undefined') {
      return { provide: { rejourney: Rejourney } };
    }

    void initRejourney(options.publicKey, options).then(() => {
      if (options.startOnMount !== false) void startRejourney();
    });

    return { provide: { rejourney: Rejourney } };
  };
}

export { Rejourney, initRejourney, startRejourney };
