import { getCurrentUrl, getLocation } from './browser.js';
import type { RejourneyWebConfig } from './types.js';

let unpatch: (() => void) | null = null;
let lastScreen: string | null = null;

function routeName(config: RejourneyWebConfig): string {
  const location = getLocation();
  if (!location) return 'Unknown';
  try {
    return config.routeName?.(location) || location.pathname || 'Home';
  } catch {
    return location.pathname || 'Home';
  }
}

export function initRouteTracking(
  config: RejourneyWebConfig,
  callback: (screenName: string, previousScreen: string | null, url: string) => void,
): void {
  if (typeof window === 'undefined' || unpatch) return;

  const emit = () => {
    const name = routeName(config);
    if (name === lastScreen) return;
    const previous = lastScreen;
    lastScreen = name;
    callback(name, previous, getCurrentUrl());
  };

  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;
  history.pushState = function patchedPushState(...args) {
    const result = originalPushState.apply(this, args);
    queueMicrotask(emit);
    return result;
  };
  history.replaceState = function patchedReplaceState(...args) {
    const result = originalReplaceState.apply(this, args);
    queueMicrotask(emit);
    return result;
  };
  window.addEventListener('popstate', emit);
  window.addEventListener('hashchange', emit);
  emit();

  unpatch = () => {
    history.pushState = originalPushState;
    history.replaceState = originalReplaceState;
    window.removeEventListener('popstate', emit);
    window.removeEventListener('hashchange', emit);
    unpatch = null;
    lastScreen = null;
  };
}

export function cleanupRouteTracking(): void {
  unpatch?.();
}

export function getCurrentRouteName(config: RejourneyWebConfig): string {
  return routeName(config);
}
