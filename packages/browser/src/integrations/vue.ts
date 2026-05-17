import { Rejourney, initRejourney, startRejourney } from '../sdk/client.js';
import type { RejourneyAPI, RejourneyWebConfig } from '../sdk/types.js';

export interface VueRouterLike {
  afterEach?: (callback: (to: { name?: unknown; path?: string; fullPath?: string }) => void) => void | (() => void);
}

export interface RejourneyVueOptions extends RejourneyWebConfig {
  publicKey: string;
  router?: VueRouterLike;
  startOnMount?: boolean;
}

export function createRejourney(options: RejourneyVueOptions) {
  return {
    install(app: { config?: { globalProperties?: Record<string, unknown> }; provide?: (key: string, value: RejourneyAPI) => void }) {
      app.config ??= {};
      app.config.globalProperties ??= {};
      app.config.globalProperties.$rejourney = Rejourney;
      app.provide?.('rejourney', Rejourney);

      if (typeof window === 'undefined') return;

      void initRejourney(options.publicKey, options).then(() => {
        if (options.startOnMount !== false) void startRejourney();
      });

      options.router?.afterEach?.((to) => {
        Rejourney.trackScreen(String(to.name || to.fullPath || to.path || window.location.pathname));
      });
    },
  };
}

export function useRejourney(): RejourneyAPI {
  return Rejourney;
}

export { Rejourney, initRejourney, startRejourney };
