import type { RejourneyConfig } from '../types';

const DEFAULT_API_URL = 'https://api.rejourney.co';
const MIN_CAPTURE_FPS = 1;
const MAX_CAPTURE_FPS = 30;

export interface NativeStartOptions {
  userId: string;
  apiUrl: string;
  publicKey: string;
  debug?: boolean;
  fps?: number;
  /** Native image quality preset (RejourneyModule / RejourneyImpl `quality`) */
  quality?: 'low' | 'medium' | 'high';
  wifiOnly?: boolean;
  /** Native replay console capture toggle (ReplayOrchestrator `captureLogs`) */
  captureLogs?: boolean;
  /** When false, suppresses IP geolocation lookup for this session */
  collectGeoLocation?: boolean;
}

export interface StartGateResult {
  allowed: boolean;
  reason?: string;
}

export function shouldStartWithConfig(
  config: RejourneyConfig | null,
  isDev: boolean
): StartGateResult {
  if (!config) {
    return { allowed: true };
  }

  if (config.enabled === false) {
    return { allowed: false, reason: 'disabled' };
  }

  if (isDev && config.disableInDev) {
    return { allowed: false, reason: 'disabled-in-dev' };
  }

  return { allowed: true };
}

export function normalizeCaptureFps(captureFPS?: number): number | undefined {
  if (typeof captureFPS !== 'number' || !Number.isFinite(captureFPS)) {
    return undefined;
  }

  return Math.max(
    MIN_CAPTURE_FPS,
    Math.min(MAX_CAPTURE_FPS, Math.round(captureFPS))
  );
}

export function buildNativeStartOptions(
  config: RejourneyConfig | null,
  userId: string,
  apiUrl: string = config?.apiUrl || DEFAULT_API_URL,
  publicKey: string = config?.publicRouteKey || ''
): NativeStartOptions {
  const options: NativeStartOptions = {
    userId,
    apiUrl,
    publicKey,
  };

  if (config?.debug) {
    options.debug = true;
  }

  const normalizedFps = normalizeCaptureFps(config?.captureFPS);
  if (normalizedFps !== undefined) {
    options.fps = normalizedFps;
  }

  if (config?.captureQuality) {
    options.quality = config.captureQuality;
  }

  if (typeof config?.wifiOnly === 'boolean') {
    options.wifiOnly = config.wifiOnly;
  }

  if (typeof config?.trackConsoleLogs === 'boolean') {
    options.captureLogs = config.trackConsoleLogs;
  }

  if (typeof config?.collectGeoLocation === 'boolean') {
    options.collectGeoLocation = config.collectGeoLocation;
  }

  return options;
}
