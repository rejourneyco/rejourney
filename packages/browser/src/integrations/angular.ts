import { Rejourney, initRejourney, startRejourney } from '../sdk/client.js';
import type { RejourneyAPI, RejourneyWebConfig } from '../sdk/types.js';

export interface RejourneyAngularOptions extends RejourneyWebConfig {
  publicKey: string;
  startOnMount?: boolean;
}

export class RejourneyService {
  readonly client: RejourneyAPI = Rejourney;

  init(publicKey: string, options?: RejourneyWebConfig): Promise<boolean> {
    return initRejourney(publicKey, options);
  }

  start(): Promise<boolean> {
    return startRejourney();
  }
}

export function createRejourneyAppInitializer(options: RejourneyAngularOptions): () => Promise<boolean> {
  return () => initRejourney(options.publicKey, options).then((initialized) => {
    if (initialized && options.startOnMount !== false) return startRejourney();
    return initialized;
  });
}

export function rejourneyMask(element: HTMLElement): void {
  element.setAttribute('data-rj-mask', '');
}

export function rejourneyBlock(element: HTMLElement): void {
  element.setAttribute('data-rj-block', '');
}

export { Rejourney, initRejourney, startRejourney };
