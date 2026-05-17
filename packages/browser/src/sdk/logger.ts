import type { RejourneyWebConfig } from './types.js';

let debugEnabled = false;

export function configureLogger(config: RejourneyWebConfig): void {
  debugEnabled = config.debug === true;
}

export const logger = {
  debug: (...args: unknown[]) => {
    if (debugEnabled) console.debug('[Rejourney]', ...args);
  },
  info: (...args: unknown[]) => {
    if (debugEnabled) console.info('[Rejourney]', ...args);
  },
  warn: (...args: unknown[]) => {
    console.warn('[Rejourney]', ...args);
  },
  error: (...args: unknown[]) => {
    console.error('[Rejourney]', ...args);
  },
};
