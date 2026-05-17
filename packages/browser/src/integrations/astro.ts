import { initRejourney, startRejourney, Rejourney } from '../sdk/client.js';
import type { RejourneyWebConfig } from '../sdk/types.js';

export interface RejourneyAstroOptions extends RejourneyWebConfig {
  publicKey: string;
  startOnMount?: boolean;
}

export function startRejourneyForAstro(options: RejourneyAstroOptions): void {
  if (typeof window === 'undefined') return;
  void initRejourney(options.publicKey, options).then(() => {
    if (options.startOnMount !== false) void startRejourney();
  });
}

export { Rejourney, initRejourney, startRejourney };
