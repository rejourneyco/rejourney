/**
 * Optional Expo Router integration for @rejourneyco/react-native
 *
 * This file is only loaded when you import '@rejourneyco/react-native/expo-router'.
 * It contains require('expo-router') and related subpaths. Metro bundles require()
 * at build time, so keeping this in a separate entry ensures apps that use
 * Expo with react-navigation (without expo-router) never pull in expo-router
 * and avoid "Requiring unknown module" crashes.
 *
 * If you use expo-router, add this once (e.g. in your root _layout.tsx):
 *   import '@rejourneyco/react-native/expo-router';
 */

import { trackScreen, setExpoRouterPollingInterval, isExpoRouterTrackingEnabled } from './sdk/autoTracking';
import { normalizeScreenName, getScreenNameFromPath } from './sdk/navigation';

const MAX_POLLING_ERRORS = 10;

function extractScreenNameFromRouterState(
  state: any,
  getScreenNameFromPathFn: (path: string, segments: string[]) => string,
  normalizeScreenNameFn: (name: string) => string,
  accumulatedSegments: string[] = []
): string | null {
  if (!state?.routes) return null;

  const route = state.routes[state.index ?? state.routes.length - 1];
  if (!route) return null;

  const newSegments = [...accumulatedSegments, route.name];

  if (route.state) {
    return extractScreenNameFromRouterState(
      route.state,
      getScreenNameFromPathFn,
      normalizeScreenNameFn,
      newSegments
    );
  }

  const cleanSegments = newSegments.filter((s) => !s.startsWith('(') && !s.endsWith(')'));

  if (cleanSegments.length === 0) {
    for (let i = newSegments.length - 1; i >= 0; i--) {
      const seg = newSegments[i];
      if (seg && !seg.startsWith('(') && !seg.endsWith(')')) {
        cleanSegments.push(seg);
        break;
      }
    }
  }

  const pathname = '/' + cleanSegments.join('/');
  return getScreenNameFromPathFn(pathname, newSegments);
}

function setupExpoRouterPolling(): void {
  let lastDetectedScreen = '';
  let pollingErrors = 0;

  try {
    const EXPO_ROUTER = 'expo-router';
    const expoRouter = require(EXPO_ROUTER);
    const router = expoRouter.router;

    if (!router) {
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.debug('[Rejourney] Expo Router: router object not found');
      }
      return;
    }

    const intervalId = setInterval(() => {
      try {
        let state: any = null;
        if (typeof router.getState === 'function') {
          state = router.getState();
        } else if ((router as any).rootState) {
          state = (router as any).rootState;
        }

        if (!state) {
          try {
            const STORE_PATH = 'expo-router/build/global-state/router-store';
            const storeModule = require(STORE_PATH);
            if (storeModule?.store) {
              state = storeModule.store.state;
              if (!state && storeModule.store.navigationRef?.current) {
                state = storeModule.store.navigationRef.current.getRootState?.();
              }
              if (!state) {
                state = storeModule.store.rootState || storeModule.store.initialState;
              }
            }
          } catch {
            // Ignore
          }
        }

        if (!state) {
          try {
            const IMPERATIVE_PATH = 'expo-router/build/imperative-api';
            const imperative = require(IMPERATIVE_PATH);
            if (imperative?.router) {
              state = imperative.router.getState?.();
            }
          } catch {
            // Ignore
          }
        }

        if (state) {
          pollingErrors = 0;
          const screenName = extractScreenNameFromRouterState(
            state,
            getScreenNameFromPath,
            normalizeScreenName
          );
          if (screenName && screenName !== lastDetectedScreen) {
            lastDetectedScreen = screenName;
            trackScreen(screenName);
          }
        } else {
          pollingErrors++;
          if (pollingErrors >= MAX_POLLING_ERRORS) {
            clearInterval(intervalId);
            setExpoRouterPollingInterval(null);
          }
        }
      } catch {
        pollingErrors++;
        if (pollingErrors >= MAX_POLLING_ERRORS) {
          clearInterval(intervalId);
          setExpoRouterPollingInterval(null);
        }
      }
    }, 500);

    setExpoRouterPollingInterval(intervalId);
  } catch (e) {
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.debug('[Rejourney] Expo Router not available:', e);
    }
  }
}

let attempts = 0;
const maxAttempts = 5;

function trySetup(): void {
  attempts++;
  try {
    const EXPO_ROUTER = 'expo-router';
    const expoRouter = require(EXPO_ROUTER);
    if (expoRouter?.router && isExpoRouterTrackingEnabled()) {
      setupExpoRouterPolling();
      return;
    }
  } catch {
    // Not ready or not installed
  }
  if (attempts < maxAttempts) {
    setTimeout(trySetup, 200 * attempts);
  }
}

setTimeout(trySetup, 200);
