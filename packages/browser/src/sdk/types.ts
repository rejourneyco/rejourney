export type PrimitiveMetadataValue = string | number | boolean;

export interface WebRecordingContext {
  userAgent: string;
  url: string;
  origin: string;
  referrer: string;
  webdriver: boolean;
  prerendering: boolean;
}

export type AcquisitionChannel =
  | 'direct'
  | 'organic_search'
  | 'paid_search'
  | 'paid_social'
  | 'organic_social'
  | 'referral'
  | 'email'
  | 'affiliate'
  | 'display'
  | 'internal'
  | 'unknown';

export interface WebAttributionContext {
  entryUrl: string;
  entryPath: string;
  entryQuery: Record<string, string>;
  referrer: string | null;
  referrerDomain: string | null;
  source: string | null;
  medium: string | null;
  campaign: string | null;
  term: string | null;
  content: string | null;
  clickIds: Record<string, string>;
  landingRoute: string;
  navigationType: 'navigate' | 'reload' | 'back_forward' | 'prerender' | 'unknown';
  channel: AcquisitionChannel;
}

export interface NetworkRequestParams {
  requestId?: string;
  url: string;
  method: string;
  statusCode: number;
  success?: boolean;
  duration: number;
  requestBodySize?: number;
  responseBodySize?: number;
  requestContentType?: string | null;
  responseContentType?: string | null;
  errorMessage?: string;
  cached?: boolean;
  startTimestamp?: number;
  endTimestamp?: number;
}

export interface RejourneyConsentState {
  analytics?: boolean;
  replay?: boolean;
}

export interface RrwebAssetCaptureOptions {
  objectURLs?: boolean;
  origins?: string[] | true | false;
  images?: boolean;
  video?: boolean;
  audio?: boolean;
  stylesheets?: boolean | 'without-fetch';
  processStylesheetsWithin?: number;
  stylesheetsRuleThreshold?: number;
}

export interface RejourneyWebConfig {
  publicKey?: string;
  apiUrl?: string;
  enabled?: boolean;
  autoStart?: boolean;
  disableInDev?: boolean;
  debug?: boolean;
  observeOnly?: boolean;
  captureReplay?: boolean;
  allowedDomains?: string[];
  maxSessionDuration?: number;
  idleTimeout?: number | false;
  collectGeoLocation?: boolean;
  captureAttribution?: boolean;
  attribution?: {
    allowedQueryParams?: string[];
    preserveClickIds?: boolean;
    captureReferrer?: boolean | 'domain-only';
    captureEntryUrl?: boolean | 'path-only';
    beforeSendAttribution?: (context: WebAttributionContext) => WebAttributionContext | null;
  };
  ignoreBots?: boolean;
  recordAutomation?: boolean;
  botUserAgentPattern?: RegExp;
  shouldRecord?: (context: WebRecordingContext) => boolean;
  autoTrackRoutes?: boolean;
  routeName?: (location: Location) => string;
  autoTrackNetwork?: boolean;
  networkIgnoreUrls?: (string | RegExp)[];
  networkCaptureSizes?: boolean;
  trackConsoleLogs?: boolean;
  trackLongTasks?: boolean;
  trackResourceErrors?: boolean;
  maskAllInputs?: boolean;
  maskInputOptions?: Record<string, boolean>;
  blockClass?: string | RegExp;
  blockSelector?: string;
  ignoreClass?: string | RegExp;
  ignoreSelector?: string;
  maskTextClass?: string | RegExp;
  maskTextSelector?: string;
  maskInputFn?: (value: string, element: HTMLElement) => string;
  maskTextFn?: (text: string, element: HTMLElement) => string;
  rrweb?: {
    checkoutEveryNms?: number;
    checkoutEveryNth?: number;
    sampling?: Record<string, unknown>;
    inlineStylesheet?: boolean | 'all';
    inlineImages?: boolean;
    collectFonts?: boolean;
    captureAssets?: RrwebAssetCaptureOptions;
    recordCanvas?: boolean;
    canvasSamplingFps?: number;
  };
  beforeSendEvent?: (event: RejourneyEvent) => RejourneyEvent | null;
  beforeSendNetwork?: (request: NetworkRequestParams) => NetworkRequestParams | null;
  onAuthError?: (error: { code: number; message: string; domain?: string }) => void;
}

export interface RemoteSdkConfig {
  projectId?: string;
  teamId?: string;
  name?: string;
  rejourneyEnabled?: boolean;
  recordingEnabled?: boolean;
  disabled?: boolean;
  enabled?: boolean;
  recording?: boolean;
  reason?: string;
  textInputMasking?: 'all' | 'secure_only';
  recordingFps?: number;
  maxRecordingMinutes?: number;
  webMaxObservabilityMinutes?: number;
  webDomain?: string;
  webAllowedDomains?: string[];
  sampleRate?: number;
  billingBlocked?: boolean;
  billingReason?: string;
  hiddenRolloverMinutes?: number;
}

export interface RejourneySessionState {
  sessionId: string;
  visitorId: string;
  uploadToken: string;
  uploadTokenExpiresAt?: number;
  startedAt: number;
  lastActivityAt: number;
  sampledIn: boolean;
  observeOnly: boolean;
  replayEnabled: boolean;
}

export type RejourneyEvent =
  | {
      type: 'session_start';
      timestamp: number;
      attribution?: WebAttributionContext | null;
      platform: 'web';
    }
  | {
      type: 'app_startup';
      timestamp: number;
      durationMs: number;
      duration?: number;
      platform: 'web';
      payload?: Record<string, unknown>;
    }
  | {
      type: 'navigation' | 'screen_view';
      timestamp: number;
      screen?: string;
      screenName?: string;
      previousScreen?: string | null;
      url?: string;
      path?: string;
      payload?: Record<string, unknown>;
    }
  | {
      type: 'network_request';
      timestamp: number;
      requestId: string;
      method: string;
      url: string;
      urlPath?: string;
      urlHost?: string;
      statusCode: number;
      duration: number;
      endTimestamp: number;
      success: boolean;
      requestBodySize?: number;
      responseBodySize?: number;
      requestContentType?: string | null;
      responseContentType?: string | null;
      errorMessage?: string;
      cached?: boolean;
    }
  | {
      type: 'error' | 'resource_error';
      timestamp: number;
      name?: string;
      message: string;
      stack?: string;
      filename?: string;
      lineno?: number;
      colno?: number;
    }
  | {
      type: 'anr' | 'long_task' | 'ui_freeze';
      timestamp: number;
      durationMs: number;
      threadState?: string;
      stack?: string;
    }
  | {
      type: 'tap' | 'touch' | 'click' | 'rage_tap' | 'rage_click' | 'dead_tap' | 'dead_click' | 'scroll';
      timestamp: number;
      x?: number;
      y?: number;
      screen?: string;
      screenName?: string;
      viewportWidth?: number;
      viewportHeight?: number;
      scrollX?: number;
      scrollY?: number;
      payload?: Record<string, unknown>;
    }
  | {
      type: 'custom' | '$user_property' | 'user_identity_changed' | string;
      timestamp: number;
      name?: string;
      properties?: Record<string, unknown>;
      payload?: Record<string, unknown> | string;
      userId?: string | null;
    };

export interface EventArtifactEnvelope {
  version: 1;
  sessionId: string;
  sdk: {
    name: '@rejourneyco/browser';
    version: string;
  };
  deviceInfo: WebDeviceInfo;
  events: RejourneyEvent[];
}

export interface RrwebChunkEnvelope {
  version: 1;
  format: 'rrweb';
  sessionId: string;
  sdk: {
    name: '@rejourneyco/browser';
    version: string;
  };
  page: {
    url: string;
    title: string;
    referrer: string;
  };
  viewport: {
    width: number;
    height: number;
    devicePixelRatio: number;
  };
  startedAt: number;
  chunkStartedAt: number;
  chunkEndedAt: number;
  sequence: number;
  isCheckout: boolean;
  events: unknown[];
}

export interface WebDeviceInfo {
  platform: 'web';
  os: string;
  osVersion?: string;
  browser?: string;
  browserVersion?: string;
  model: string;
  screenWidth: number;
  screenHeight: number;
  pixelRatio: number;
  userAgent: string;
  language?: string;
  timezone?: string;
  deviceId: string;
  sdkVersion: string;
  appVersion?: string;
  networkType?: string;
  effectiveConnectionType?: string;
  connectionSaveData?: boolean;
}

export interface RejourneyAPI {
  init(publicKey: string, options?: RejourneyWebConfig): Promise<boolean>;
  start(): Promise<boolean>;
  stop(): Promise<void>;
  setConsent(consent: RejourneyConsentState): void;
  setUserIdentity(userId: string): void;
  clearUserIdentity(): void;
  setMetadata(key: string, value: PrimitiveMetadataValue): void;
  setMetadata(properties: Record<string, PrimitiveMetadataValue>): void;
  logEvent(name: string, properties?: Record<string, unknown>): void;
  trackScreen(screenName: string, params?: Record<string, unknown>): void;
  isInitialized(): boolean;
  isRecording(): boolean;
  getSessionId(): string | null;
}
