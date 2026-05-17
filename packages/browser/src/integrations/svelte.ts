import { initRejourney, startRejourney, Rejourney } from '../sdk/client.js';
import type { RejourneyWebConfig } from '../sdk/types.js';

export interface RejourneySvelteOptions extends RejourneyWebConfig {
  publicKey: string;
  startOnMount?: boolean;
}

export function startRejourneyOnMount(options: RejourneySvelteOptions): () => void {
  if (typeof window === 'undefined') return () => undefined;
  void initRejourney(options.publicKey, options).then(() => {
    if (options.startOnMount !== false) void startRejourney();
  });
  return () => {
    void Rejourney.stop();
  };
}

export { Rejourney, initRejourney, startRejourney };
