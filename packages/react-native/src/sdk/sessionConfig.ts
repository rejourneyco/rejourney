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
  /** Remote text input masking policy. Unknown native versions ignore this. */
  textInputMasking?: 'all' | 'secure_only';
  /** Remote image/video masking policy. Unknown native versions ignore this. */
  imageVideoMasking?: 'none' | 'all';
  /** Capture eligible native sheets/dialog windows (default: true). */
  captureNativeSheets?: boolean;
  /**
   * Native flag consumed by ReplayOrchestrator._applySettings().
   * When false, visualCaptureEnabled stays false and VisualCapture never starts.
   * Must be set explicitly — _applySettings defaults this to true if absent.
   */
  captureScreen?: boolean;
  /** When true, telemetry is captured but visual recording is suppressed */
  observeOnly?: boolean;
  detectRageTaps?: boolean;
  rageTapThreshold?: number;
  rageTapTimeWindow?: number;
  rageTapRadius?: number;
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

function normalizePositiveNumber(value?: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }

  return value;
}

function normalizePositiveInteger(value?: number): number | undefined {
  const normalized = normalizePositiveNumber(value);
  return normalized === undefined ? undefined : Math.round(normalized);
}

export function buildNativeStartOptions(
  config: RejourneyConfig | null,
  userId: string,
  apiUrl: string = config?.apiUrl || DEFAULT_API_URL,
  publicKey: string = config?.publicRouteKey || '',
  effectiveOptions: {
    captureScreen?: boolean;
    textInputMasking?: 'all' | 'secure_only';
    imageVideoMasking?: 'none' | 'all';
    recordingFps?: number;
  } = {}
): NativeStartOptions {
  const options: NativeStartOptions = {
    userId,
    apiUrl,
    publicKey,
    captureNativeSheets: config?.captureNativeSheets ?? true,
  };

  if (typeof effectiveOptions.captureScreen === 'boolean') {
    options.captureScreen = effectiveOptions.captureScreen;
  }

  if (effectiveOptions.textInputMasking) {
    options.textInputMasking = effectiveOptions.textInputMasking;
  }

  if (effectiveOptions.imageVideoMasking) {
    options.imageVideoMasking = effectiveOptions.imageVideoMasking;
  }

  if (config?.debug) {
    options.debug = true;
  }

  const normalizedFps = normalizeCaptureFps(effectiveOptions.recordingFps ?? config?.captureFPS);
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

  if (config?.observeOnly === true) {
    options.observeOnly = true;
    // captureScreen=false is the native flag that _applySettings() reads to set
    // visualCaptureEnabled. Without this, _applySettings defaults captureScreen to
    // true and clobbers the visualCaptureEnabled=false written by setRemoteConfig.
    options.captureScreen = false;
  }

  if (typeof config?.detectRageTaps === 'boolean') {
    options.detectRageTaps = config.detectRageTaps;
  }

  const rageTapThreshold = normalizePositiveInteger(config?.rageTapThreshold);
  if (rageTapThreshold !== undefined) {
    options.rageTapThreshold = rageTapThreshold;
  }

  const rageTapTimeWindow = normalizePositiveInteger(config?.rageTapTimeWindow);
  if (rageTapTimeWindow !== undefined) {
    options.rageTapTimeWindow = rageTapTimeWindow;
  }

  const rageTapRadius = normalizePositiveNumber(config?.rageTapRadius);
  if (rageTapRadius !== undefined) {
    options.rageTapRadius = rageTapRadius;
  }

  return options;
}
