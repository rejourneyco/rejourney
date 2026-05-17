import { initRejourney, startRejourney, Rejourney } from '../sdk/client.js';
import type { RejourneyWebConfig } from '../sdk/types.js';

export interface RejourneyGatsbyOptions extends RejourneyWebConfig {
  publicKey: string;
  startOnMount?: boolean;
}

export function onClientEntry(options: RejourneyGatsbyOptions): void {
  if (typeof window === 'undefined') return;
  void initRejourney(options.publicKey, options).then(() => {
    if (options.startOnMount !== false) void startRejourney();
  });
}

export function onRouteUpdate(location: { pathname?: string; href?: string }): void {
  Rejourney.trackScreen(location.pathname || location.href || 'Unknown');
}

export { Rejourney, initRejourney, startRejourney };
