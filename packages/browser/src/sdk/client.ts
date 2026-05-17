import { captureAttribution } from './attribution.js';
import {
  getCurrentPath,
  getCurrentUrl,
  getDocument,
  getNavigator,
  hasWindowOpener,
  isBrowser,
  isLocalDevelopmentHost,
  safeClearTimeout,
  safeSetTimeout,
} from './browser.js';
import { classifyWebClient } from './botDetection.js';
import { applyRemoteConfig, fetchRemoteConfig, isDomainAllowed, isSampledIn, mergeWebConfig, normalizeBaseUrl } from './config.js';
import { DEFAULT_API_URL, SDK_VERSION } from './constants.js';
import { collectWebDeviceInfoWithHints } from './deviceInfo.js';
import { cleanupErrorTracking, initErrorTracking } from './errors.js';
import {
  clearStoredUserIdentity,
  getStoredUserIdentityStorageKey,
  loadStoredUserIdentity,
  normalizeUserIdentity,
  saveStoredUserIdentity,
} from './identityStore.js';
import { cleanupInteractionTracking, initInteractionTracking } from './interactionTracking.js';
import { cleanupLifecycleTracking, initLifecycleTracking } from './lifecycle.js';
import { logger, configureLogger } from './logger.js';
import { disableNetworkInterceptor, initNetworkInterceptor } from './networkInterceptor.js';
import { ReplayUploadQueue } from './replayUploadQueue.js';
import { startRrwebRecorder, type RrwebRecorderHandle } from './recorder.js';
import { cleanupRouteTracking, getCurrentRouteName, initRouteTracking } from './routeTracking.js';
import { collectWebStartupTiming, type WebStartupTiming } from './startup.js';
import { clearAllQueues, clearSessionQueue } from './storage.js';
import {
  claimTabSessionLease,
  createTabSessionOwnerId,
  isTabSessionClaimedByAnotherOwner,
  releaseTabSessionLease,
} from './tabSessionLease.js';
import { clearTabSession, loadTabSession, saveTabSession } from './tabSession.js';
import { createSessionId, getOrCreateVisitorId } from './visitorId.js';
import type {
  NetworkRequestParams,
  PrimitiveMetadataValue,
  RejourneyAPI,
  RejourneyConsentState,
  RejourneyEvent,
  RejourneySessionState,
  RejourneyWebConfig,
  WebDeviceInfo,
} from './types.js';

interface AuthResponse {
  uploadToken: string;
  expiresIn: number;
}

export class RejourneyWebClient implements RejourneyAPI {
  private config: RejourneyWebConfig | null = null;
  private session: RejourneySessionState | null = null;
  private uploadQueue: ReplayUploadQueue | null = null;
  private recorder: RrwebRecorderHandle | null = null;
  private initialized = false;
  private starting: Promise<boolean> | null = null;
  private userIdentity: string | null = null;
  private identityProjectKey: string | null = null;
  private metadata: Record<string, PrimitiveMetadataValue> = {};
  private pendingEvents: RejourneyEvent[] = [];
  private consent: RejourneyConsentState = { analytics: true, replay: true };
  private deviceInfo: WebDeviceInfo | null = null;
  private currentScreen: string | null = null;
  private maxSessionTimer: ReturnType<typeof setTimeout> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private idleWakeInFlight: Promise<void> | null = null;
  private idlePaused = false;
  private backgroundStartedAt: number | null = null;
  private totalBackgroundTimeMs = 0;
  private restartOnForeground = false;
  private startupEventSessionId: string | null = null;
  private readonly tabSessionOwnerId = createTabSessionOwnerId();
  private tabSessionLeaseTimer: ReturnType<typeof setInterval> | null = null;
  private identityStorageListener: ((event: StorageEvent) => void) | null = null;

  async init(publicKey: string, options: RejourneyWebConfig = {}): Promise<boolean> {
    const previousConfig = this.config;
    const nextConfig = mergeWebConfig(publicKey, options);
    const nextIdentityProjectKey = nextConfig.publicKey?.trim() || null;
    const carriedIdentity = this.userIdentity
      && ((this.identityProjectKey === null && previousConfig === null) || this.identityProjectKey === nextIdentityProjectKey)
      ? this.userIdentity
      : null;

    this.config = nextConfig;
    configureLogger(this.config);
    this.userIdentity = carriedIdentity
      ? saveStoredUserIdentity(this.config, carriedIdentity)
      : loadStoredUserIdentity(this.config);
    this.identityProjectKey = this.userIdentity ? nextIdentityProjectKey : null;
    this.initialized = true;
    this.startIdentityStorageSync();

    if (!isBrowser()) {
      logger.debug('Initialized in non-browser environment; start() will no-op until browser runtime.');
      return false;
    }

    if (this.config.disableInDev && isLocalDevelopmentHost(window.location.hostname)) {
      logger.info('Disabled on local development host.');
      return false;
    }

    if (this.config.autoStart) {
      return this.start();
    }

    return true;
  }

  async start(): Promise<boolean> {
    if (this.starting) return this.starting;
    this.starting = this.startInternal().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  async stop(): Promise<void> {
    await this.endActiveSession('stop');
  }

  setConsent(consent: RejourneyConsentState): void {
    this.consent = { ...this.consent, ...consent };
    if (consent.replay === false && this.recorder) {
      this.recorder.stop();
      this.recorder = null;
    }
    if (consent.analytics === false && consent.replay === false) {
      void this.stop().then(() => clearAllQueues());
    }
  }

  setUserIdentity(userId: string): void {
    const normalizedUserId = this.config
      ? saveStoredUserIdentity(this.config, userId)
      : normalizeUserIdentity(userId);
    if (!normalizedUserId) return;

    const projectKey = this.config?.publicKey?.trim() || null;
    if (this.userIdentity === normalizedUserId && this.identityProjectKey === projectKey) return;
    this.userIdentity = normalizedUserId;
    this.identityProjectKey = projectKey;
    this.queueUserIdentityEvent(normalizedUserId);
  }

  private applyExternalUserIdentity(userId: unknown): void {
    const normalizedUserId = normalizeUserIdentity(userId);
    const projectKey = this.config?.publicKey?.trim() || null;

    if (normalizedUserId) {
      if (this.userIdentity === normalizedUserId && this.identityProjectKey === projectKey) return;
      this.userIdentity = normalizedUserId;
      this.identityProjectKey = projectKey;
      this.queueUserIdentityEvent(normalizedUserId);
      return;
    }

    const hadIdentity = this.userIdentity !== null;
    this.userIdentity = null;
    this.identityProjectKey = null;
    if (hadIdentity) this.queueUserIdentityEvent(null);
  }

  private startIdentityStorageSync(): void {
    this.stopIdentityStorageSync();
    if (!isBrowser() || !this.config || typeof window.addEventListener !== 'function') return;

    const storageKey = getStoredUserIdentityStorageKey(this.config);
    if (!storageKey) return;

    const listener = (event: StorageEvent): void => {
      if (event.key !== storageKey) return;
      if (event.storageArea && event.storageArea !== window.localStorage) return;
      this.applyExternalUserIdentity(event.newValue);
    };

    window.addEventListener('storage', listener);
    this.identityStorageListener = listener;
  }

  private stopIdentityStorageSync(): void {
    if (!this.identityStorageListener || !isBrowser() || typeof window.removeEventListener !== 'function') {
      this.identityStorageListener = null;
      return;
    }

    window.removeEventListener('storage', this.identityStorageListener);
    this.identityStorageListener = null;
  }

  private queueUserIdentityEvent(userId: string | null): void {
    this.queueEvent({
      type: 'user_identity_changed',
      timestamp: Date.now(),
      userId,
      properties: { userId },
    });
  }

  clearUserIdentity(): void {
    const hadIdentity = this.userIdentity !== null;
    this.userIdentity = null;
    if (this.config) clearStoredUserIdentity(this.config);
    this.identityProjectKey = null;
    if (!hadIdentity) return;
    this.queueUserIdentityEvent(null);
  }

  setMetadata(keyOrProperties: string | Record<string, PrimitiveMetadataValue>, value?: PrimitiveMetadataValue): void {
    if (typeof keyOrProperties === 'string') {
      if (!keyOrProperties || value === undefined) return;
      this.metadata[keyOrProperties] = value;
      if (this.session) this.logEvent('$user_property', { key: keyOrProperties, value });
      return;
    }

    const properties: Record<string, PrimitiveMetadataValue> = {};
    for (const [key, propValue] of Object.entries(keyOrProperties)) {
      if (typeof propValue === 'string' || typeof propValue === 'number' || typeof propValue === 'boolean') {
        properties[key] = propValue;
      }
    }
    Object.assign(this.metadata, properties);
    if (this.session && Object.keys(properties).length > 0) {
      this.logEvent('$user_property', properties);
    }
  }

  logEvent(name: string, properties: Record<string, unknown> = {}): void {
    this.queueEvent({
      type: name === '$user_property' ? '$user_property' : 'custom',
      timestamp: Date.now(),
      name,
      properties,
      payload: properties,
    });
  }

  trackScreen(screenName: string, params: Record<string, unknown> = {}): void {
    const previousScreen = this.currentScreen;
    this.currentScreen = screenName;
    this.queueEvent({
      type: 'navigation',
      timestamp: Date.now(),
      screen: screenName,
      screenName,
      previousScreen,
      url: getCurrentUrl(),
      path: getCurrentPath(),
      payload: params,
    });
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  isRecording(): boolean {
    return Boolean(this.session);
  }

  getSessionId(): string | null {
    return this.session?.sessionId ?? null;
  }

  private async startInternal(): Promise<boolean> {
    if (!this.initialized || !this.config) {
      logger.warn('Call initRejourney(publicKey) before startRejourney().');
      return false;
    }
    if (this.session) return true;
    if (!isBrowser()) return false;
    if (this.config.enabled === false) return false;
    if (this.consent.analytics === false && this.consent.replay === false) return false;

    const classification = await classifyWebClient(this.config);
    if (!classification.shouldRecord) {
      logger.debug('Suppressed web SDK startup:', classification.reason);
      return false;
    }

    let remote;
    try {
      remote = await fetchRemoteConfig(this.config);
    } catch (error) {
      logger.warn('Unable to fetch remote config; web SDK not started.', error);
      return false;
    }

    this.config = applyRemoteConfig(this.config, remote);
    configureLogger(this.config);

    if (!isDomainAllowed(window.location.host, this.config.allowedDomains)) {
      logger.warn('Current browser domain is not allowed for this Rejourney project.');
      return false;
    }

    if (this.config.enabled === false || remote.billingBlocked) {
      logger.info('Remote config disabled Rejourney.', remote.reason || remote.billingReason);
      return false;
    }

    const sampledIn = isSampledIn(remote.sampleRate);
    const observeOnly = this.config.observeOnly === true || this.consent.replay === false;
    const replayEnabled = sampledIn && observeOnly === false && this.config.captureReplay !== false && this.consent.replay !== false;
    const visitorId = getOrCreateVisitorId();
    const deviceInfo = await this.collectDeviceInfo(visitorId);
    const storedTabSession = loadTabSession(this.config, visitorId);
    const shouldRejectStoredTabSession = Boolean(
      storedTabSession && (
        hasWindowOpener()
        || isTabSessionClaimedByAnotherOwner(
          this.config,
          storedTabSession.session.sessionId,
          this.tabSessionOwnerId,
        )
      ),
    );
    const restored = shouldRejectStoredTabSession ? null : storedTabSession;
    if (storedTabSession && !restored) {
      clearTabSession(this.config, storedTabSession.session.sessionId);
    }
    let restoredSession = false;
    let session: RejourneySessionState;

    if (restored) {
      restoredSession = true;
      session = {
        ...restored.session,
        sampledIn: restored.session.sampledIn,
        observeOnly: restored.session.observeOnly || observeOnly,
        replayEnabled: restored.session.replayEnabled && replayEnabled,
      };
    } else {
      const auth = await this.authenticateVisitor(visitorId, deviceInfo);
      if (!auth) return false;

      session = {
        sessionId: createSessionId(),
        visitorId,
        uploadToken: auth.uploadToken,
        uploadTokenExpiresAt: Date.now() + auth.expiresIn * 1000,
        startedAt: Date.now(),
        lastActivityAt: Date.now(),
        sampledIn,
        observeOnly,
        replayEnabled,
      };
    }
    this.session = session;
    this.totalBackgroundTimeMs = restored ? restored.totalBackgroundTimeMs : 0;
    this.backgroundStartedAt = restored ? restored.backgroundStartedAt : null;
    this.restartOnForeground = false;
    this.idlePaused = false;
    this.idleWakeInFlight = null;
    this.startTabSessionLease();
    this.scheduleMaxSessionTimer();
    this.currentScreen = getCurrentRouteName(this.config);
    this.deviceInfo = deviceInfo;
    this.uploadQueue = new ReplayUploadQueue({
      config: this.config,
      getSession: () => this.session,
      getDeviceInfo: () => this.deviceInfo,
      getUserIdentity: () => this.userIdentity,
    });
    this.uploadQueue.start();
    this.persistTabSession();

    if (!restoredSession) {
      const attribution = captureAttribution(this.config, this.currentScreen || undefined);
      this.queueEvent({
        type: 'session_start',
        timestamp: session.startedAt,
        attribution,
        platform: 'web',
      });
      this.queueStartupEvent(session.sessionId, session.startedAt);
    }
    if (this.userIdentity && !this.pendingEvents.some((event) => event.type === 'user_identity_changed')) {
      this.queueUserIdentityEvent(this.userIdentity);
    }
    for (const [key, value] of Object.entries(this.metadata)) {
      this.setMetadata(key, value);
    }
    for (const pendingEvent of this.pendingEvents.splice(0, this.pendingEvents.length)) {
      this.queueEvent(pendingEvent);
    }
    if (!restoredSession) {
      try {
        await this.uploadQueue.flushEvents();
      } catch (error) {
        logger.debug('Initial web session event flush deferred.', error);
      }
    }

    if (this.config.autoTrackRoutes !== false) {
      initRouteTracking(this.config, (screenName, previousScreen, url) => {
        this.currentScreen = screenName;
        this.queueEvent({
          type: 'navigation',
          timestamp: Date.now(),
          screen: screenName,
          screenName,
          previousScreen,
          url,
          path: getCurrentPath(),
        });
      });
    }

    initInteractionTracking(() => this.currentScreen, (event) => this.queueEvent(event));

    if (this.config.autoTrackNetwork !== false) {
      initNetworkInterceptor((request) => this.logNetworkRequest(request), this.config);
    }

    initErrorTracking(this.config, (event) => this.queueEvent(event));
    initLifecycleTracking({
      onHidden: () => void this.handleHidden('visibility_hidden'),
      onVisible: () => void this.handleVisible('visibility_visible'),
      onPageHide: (persisted) => void this.handlePageHide(persisted),
      onPageShow: () => {
        void this.handleVisible('pageshow');
      },
    });

    if (replayEnabled) {
      try {
        this.recorder = await startRrwebRecorder(this.config, (event) => this.uploadQueue?.queueRrwebEvent(event));
        if (!restoredSession) {
          await new Promise((resolve) => setTimeout(resolve, 0));
          await this.uploadQueue.flushRrweb();
        }
      } catch (error) {
        logger.warn('Failed to start rrweb recorder; continuing with analytics only.', error);
      }
    }

    this.scheduleIdleTimer();
    if (restoredSession) {
      await this.resumeRestoredTabSession();
    }
    logger.info('Rejourney web session started', session.sessionId);
    return true;
  }

  private getMaxSessionDurationMs(): number {
    const configured = Number(this.config?.maxSessionDuration);
    return Number.isFinite(configured) && configured > 0 ? configured : 30 * 60 * 1000;
  }

  private scheduleMaxSessionTimer(): void {
    safeClearTimeout(this.maxSessionTimer);
    this.maxSessionTimer = null;

    if (!this.session) return;
    const expiresAt = this.session.startedAt + this.getMaxSessionDurationMs();
    const remainingMs = Math.max(0, expiresAt - Date.now());
    this.maxSessionTimer = safeSetTimeout(() => {
      void this.handleMaxSessionDuration();
    }, remainingMs);
  }

  private clearMaxSessionTimer(): void {
    safeClearTimeout(this.maxSessionTimer);
    this.maxSessionTimer = null;
  }

  private getIdleTimeoutMs(): number | null {
    if (this.config?.idleTimeout === false) return null;
    const configured = Number(this.config?.idleTimeout);
    return Number.isFinite(configured) && configured > 0 ? configured : 60 * 1000;
  }

  private scheduleIdleTimer(): void {
    this.clearIdleTimer();
    const idleTimeoutMs = this.getIdleTimeoutMs();
    if (!this.session || idleTimeoutMs === null || this.idlePaused || this.backgroundStartedAt !== null || this.isPageHidden()) {
      return;
    }

    const idleAt = this.session.lastActivityAt + idleTimeoutMs;
    const remainingMs = Math.max(0, idleAt - Date.now());
    this.idleTimer = safeSetTimeout(() => {
      void this.handleIdleTimeout(idleAt);
    }, remainingMs);
  }

  private clearIdleTimer(): void {
    safeClearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  private isPageHidden(): boolean {
    return getDocument()?.visibilityState === 'hidden';
  }

  private queueLifecycleEvent(type: 'app_background' | 'app_foreground', timestamp: number, payload: Record<string, unknown>): void {
    this.queueEvent({
      type,
      timestamp,
      payload: {
        ...payload,
        screen: this.currentScreen ?? undefined,
        screenName: this.currentScreen ?? undefined,
        url: getCurrentUrl(),
        path: getCurrentPath(),
      },
    });
  }

  private persistTabSession(): void {
    if (!this.config || !this.session) return;
    saveTabSession(this.config, this.session, this.backgroundStartedAt, this.totalBackgroundTimeMs);
  }

  private startTabSessionLease(): void {
    this.clearTabSessionLeaseTimer();
    if (!this.config || !this.session) return;

    claimTabSessionLease(this.config, this.session.sessionId, this.tabSessionOwnerId);
    if (typeof setInterval === 'undefined') return;
    this.tabSessionLeaseTimer = setInterval(() => {
      if (this.config && this.session) {
        claimTabSessionLease(this.config, this.session.sessionId, this.tabSessionOwnerId);
      }
    }, 5_000);
  }

  private clearTabSessionLeaseTimer(): void {
    if (this.tabSessionLeaseTimer) clearInterval(this.tabSessionLeaseTimer);
    this.tabSessionLeaseTimer = null;
  }

  private releaseTabSessionLease(): void {
    this.clearTabSessionLeaseTimer();
    if (this.config && this.session) {
      releaseTabSessionLease(this.config, this.session.sessionId, this.tabSessionOwnerId);
    }
  }

  private async resumeRestoredTabSession(): Promise<void> {
    if (!this.session || !this.config) return;

    if (this.backgroundStartedAt !== null) {
      await this.handleVisible('tab_restore');
      return;
    }

    if (this.config.autoTrackRoutes !== false) return;

    const screenName = this.currentScreen ?? getCurrentRouteName(this.config);
    this.queueEvent({
      type: 'navigation',
      timestamp: Date.now(),
      screen: screenName,
      screenName,
      previousScreen: null,
      url: getCurrentUrl(),
      path: getCurrentPath(),
      payload: { reason: 'tab_restore' },
    });
  }

  private emitStartupEvent(sessionId: string, timestamp: number, timing: WebStartupTiming): void {
    if (this.startupEventSessionId === sessionId || this.session?.sessionId !== sessionId) return;
    this.startupEventSessionId = sessionId;
    this.queueEvent({
      type: 'app_startup',
      timestamp,
      durationMs: timing.durationMs,
      duration: timing.durationMs,
      platform: 'web',
      payload: { ...timing },
    });
  }

  private queueStartupEvent(sessionId: string, timestamp: number): void {
    const timing = collectWebStartupTiming();
    const documentRef = getDocument();
    if (timing && (timing.complete || documentRef?.readyState === 'complete')) {
      this.emitStartupEvent(sessionId, timestamp, timing);
      return;
    }

    if (typeof window === 'undefined' || documentRef?.readyState === 'complete') {
      if (timing) this.emitStartupEvent(sessionId, timestamp, timing);
      return;
    }

    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
    const emitBestStartupTiming = (): void => {
      const latestTiming = collectWebStartupTiming();
      if (latestTiming) this.emitStartupEvent(sessionId, timestamp, latestTiming);
    };
    const onLoad = (): void => {
      safeClearTimeout(fallbackTimer);
      safeSetTimeout(emitBestStartupTiming, 0);
    };

    window.addEventListener('load', onLoad, { once: true });
    fallbackTimer = safeSetTimeout(() => {
      window.removeEventListener('load', onLoad);
      emitBestStartupTiming();
    }, 10_000);
  }

  private markBackgroundStarted(reason: string, timestamp = Date.now()): void {
    if (!this.session || this.backgroundStartedAt !== null) return;
    this.backgroundStartedAt = timestamp;
    this.queueLifecycleEvent('app_background', timestamp, { reason });
    this.persistTabSession();
  }

  private pendingBackgroundDurationMs(now = Date.now()): number {
    return this.backgroundStartedAt === null ? 0 : Math.max(0, now - this.backgroundStartedAt);
  }

  private isActivityEvent(event: RejourneyEvent): boolean {
    return [
      'tap',
      'touch',
      'click',
      'rage_tap',
      'rage_click',
      'dead_tap',
      'dead_click',
      'scroll',
      'navigation',
      'screen_view',
      'custom',
    ].includes(event.type);
  }

  private isIdleWakeEvent(event: RejourneyEvent): boolean {
    return [
      'tap',
      'touch',
      'click',
      'rage_tap',
      'rage_click',
      'dead_tap',
      'dead_click',
      'scroll',
      'navigation',
      'screen_view',
      'custom',
    ].includes(event.type);
  }

  private markActivity(timestamp = Date.now()): void {
    if (!this.session) return;
    this.session.lastActivityAt = Math.max(this.session.lastActivityAt, timestamp);
    this.persistTabSession();
    this.scheduleIdleTimer();
  }

  private async handleIdleTimeout(idleAt: number): Promise<void> {
    if (!this.session || this.idlePaused || this.backgroundStartedAt !== null || this.isPageHidden()) return;
    if (Date.now() < idleAt) {
      this.scheduleIdleTimer();
      return;
    }

    this.clearIdleTimer();
    this.markBackgroundStarted('idle_timeout', idleAt);
    this.idlePaused = true;
    disableNetworkInterceptor();
    this.recorder?.stop();
    this.recorder = null;
    await this.uploadQueue?.flushAll();
    this.uploadQueue?.stopTimers();
  }

  private async resumeIdlePausedCapture(): Promise<void> {
    if (!this.config || !this.session || !this.idlePaused) return;
    this.idlePaused = false;
    this.uploadQueue?.start();
    if (this.config.autoTrackNetwork !== false) {
      initNetworkInterceptor((request) => this.logNetworkRequest(request), this.config);
    }
    if (this.session.replayEnabled && !this.recorder) {
      try {
        this.recorder = await startRrwebRecorder(this.config, (event) => this.uploadQueue?.queueRrwebEvent(event));
      } catch (error) {
        logger.warn('Failed to restart rrweb recorder after idle pause.', error);
      }
    }
  }

  private queueAfterIdleWake(event: RejourneyEvent): void {
    this.idleWakeInFlight ??= this.handleVisible('idle_activity').finally(() => {
      this.idleWakeInFlight = null;
    });
    void this.idleWakeInFlight.then(() => {
      this.queueEvent(event);
    });
  }

  private async handleHidden(reason: string): Promise<void> {
    if (!this.session) return;
    this.clearIdleTimer();
    this.markBackgroundStarted(reason);
    await this.uploadQueue?.flushAll();
  }

  private async handleVisible(reason: string): Promise<void> {
    if (!this.session) {
      if (this.restartOnForeground || this.config?.autoStart) {
        this.restartOnForeground = false;
        await this.start();
      }
      return;
    }

    this.startTabSessionLease();
    const now = Date.now();
    const maxSessionDurationMs = this.getMaxSessionDurationMs();
    const sessionExpired = now - this.session.startedAt >= maxSessionDurationMs;

    if (this.backgroundStartedAt !== null) {
      const backgroundDurationMs = this.pendingBackgroundDurationMs(now);
      if (sessionExpired || backgroundDurationMs >= maxSessionDurationMs) {
        const closeAnchorAtMs = this.backgroundStartedAt;
        await this.endActiveSession('background_timeout', {
          endedAt: now,
          closeAnchorAtMs,
          totalBackgroundTimeMs: this.totalBackgroundTimeMs + backgroundDurationMs,
        });
        await this.start();
        return;
      }

      if (this.idlePaused) {
        await this.resumeIdlePausedCapture();
      }
      const totalBackgroundTimeMs = this.totalBackgroundTimeMs + backgroundDurationMs;
      this.totalBackgroundTimeMs = totalBackgroundTimeMs;
      this.backgroundStartedAt = null;
      this.queueLifecycleEvent('app_foreground', now, {
        reason,
        backgroundDurationMs,
        totalBackgroundTimeMs,
        sessionContinued: true,
      });
      this.markActivity(now);
      this.persistTabSession();
      await this.uploadQueue?.flushAll();
      return;
    }

    if (sessionExpired) {
      await this.rotateSessionForMaxDuration(now);
      return;
    }

    this.scheduleIdleTimer();
  }

  private async handlePageHide(persisted: boolean): Promise<void> {
    if (!this.session) return;
    this.clearIdleTimer();
    this.markBackgroundStarted(persisted ? 'pagehide_bfcache' : 'pagehide');
    this.persistTabSession();
    this.releaseTabSessionLease();
    void this.uploadQueue?.flushAll();
  }

  private async handleMaxSessionDuration(): Promise<void> {
    if (!this.session) return;
    const now = Date.now();

    if (this.isPageHidden() || this.backgroundStartedAt !== null) {
      this.markBackgroundStarted('max_duration_hidden', now);
      await this.uploadQueue?.flushAll();
      return;
    }

    await this.rotateSessionForMaxDuration(now);
  }

  private async rotateSessionForMaxDuration(now = Date.now()): Promise<void> {
    await this.endActiveSession('max_duration', {
      endedAt: now,
      closeAnchorAtMs: now,
      totalBackgroundTimeMs: this.totalBackgroundTimeMs,
    });
    await this.start();
  }

  private async endActiveSession(
    reason: string,
    options: { endedAt?: number; closeAnchorAtMs?: number; totalBackgroundTimeMs?: number } = {},
  ): Promise<void> {
    const session = this.session;
    const endedAt = options.endedAt ?? Date.now();
    const totalBackgroundTimeMs = options.totalBackgroundTimeMs ?? this.totalBackgroundTimeMs + this.pendingBackgroundDurationMs(endedAt);
    const closeAnchorAtMs = options.closeAnchorAtMs ?? endedAt;

    this.clearMaxSessionTimer();
    this.clearIdleTimer();
    this.releaseTabSessionLease();
    this.recorder?.stop();
    this.recorder = null;
    cleanupRouteTracking();
    cleanupErrorTracking();
    cleanupLifecycleTracking();
    cleanupInteractionTracking();
    disableNetworkInterceptor();
    this.uploadQueue?.stopTimers();
    const uploadsFlushed = await this.uploadQueue?.flushAll() ?? true;

    if (session && this.config) {
      await this.sendSessionEnd(reason, {
        endedAt,
        closeAnchorAtMs,
        totalBackgroundTimeMs,
      });
      clearTabSession(this.config, session.sessionId);
      if (uploadsFlushed) {
        await clearSessionQueue(session.sessionId);
      } else {
        logger.warn('Retaining queued upload chunks after session end because final upload drain did not complete.');
      }
    }

    this.session = null;
    this.uploadQueue = null;
    this.backgroundStartedAt = null;
    this.totalBackgroundTimeMs = 0;
    this.restartOnForeground = false;
    this.idlePaused = false;
    this.idleWakeInFlight = null;
    this.startupEventSessionId = null;
  }

  private queueEvent(event: RejourneyEvent): void {
    if (this.consent.analytics === false) return;
    if (!this.session || !this.uploadQueue) {
      if (this.pendingEvents.length < 100) this.pendingEvents.push(event);
      return;
    }

    if (this.idlePaused) {
      if (this.isIdleWakeEvent(event)) {
        this.queueAfterIdleWake(event);
      }
      return;
    }

    if (this.isActivityEvent(event)) {
      this.markActivity(event.timestamp);
    }

    this.uploadQueue?.queueEvent(event);
  }

  private logNetworkRequest(request: NetworkRequestParams): void {
    const endTimestamp = request.endTimestamp || Date.now();
    const startTimestamp = request.startTimestamp || endTimestamp - request.duration;
    let urlPath = request.url;
    let urlHost = '';
    try {
      const parsed = new URL(request.url);
      urlPath = `${parsed.pathname}${parsed.search}`;
      urlHost = parsed.host;
    } catch {
      // leave fallback values
    }

    this.queueEvent({
      type: 'network_request',
      requestId: request.requestId || `req_${startTimestamp}_${Math.random().toString(36).slice(2)}`,
      timestamp: startTimestamp,
      method: request.method,
      url: request.url.slice(0, 500),
      urlPath,
      urlHost,
      statusCode: request.statusCode,
      duration: request.duration,
      endTimestamp,
      success: request.success ?? (request.statusCode >= 200 && request.statusCode < 400),
      requestBodySize: request.requestBodySize,
      responseBodySize: request.responseBodySize,
      requestContentType: request.requestContentType,
      responseContentType: request.responseContentType,
      errorMessage: request.errorMessage,
      cached: request.cached,
    });
  }

  private async authenticateVisitor(visitorId: string, deviceInfo: WebDeviceInfo): Promise<AuthResponse | null> {
    if (!this.config?.publicKey) return null;
    const apiUrl = normalizeBaseUrl(this.config.apiUrl, DEFAULT_API_URL);
    const nav = getNavigator();
    const userAgent = nav?.userAgent || '';
    const response = await fetch(`${apiUrl}/api/ingest/auth/device`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'accept': 'application/json',
        'x-rejourney-key': this.config.publicKey,
        'x-public-key': this.config.publicKey,
        'x-platform': 'web',
      },
      credentials: 'omit',
      body: JSON.stringify({
        deviceId: visitorId,
        metadata: {
          os: deviceInfo.os,
          osVersion: deviceInfo.osVersion,
          platform: 'web',
          browser: deviceInfo.browser,
          browserVersion: deviceInfo.browserVersion,
          origin: window.location.origin,
          userAgent,
          sdkVersion: SDK_VERSION,
          appVersion: SDK_VERSION,
        },
      }),
    });

    if (!response.ok) {
      this.config.onAuthError?.({ code: response.status, message: response.statusText, domain: window.location.hostname });
      logger.warn('Failed to authenticate Rejourney web visitor.', response.status);
      return null;
    }

    const json = (await response.json()) as AuthResponse;
    if (!json.uploadToken || typeof json.expiresIn !== 'number') return null;
    return json;
  }

  private async sendSessionEnd(
    reason: string,
    options: { endedAt?: number; closeAnchorAtMs?: number; totalBackgroundTimeMs?: number } = {},
  ): Promise<void> {
    if (!this.config || !this.session) return;
    const session = this.session;
    const endedAt = options.endedAt ?? Date.now();
    const closeAnchorAtMs = options.closeAnchorAtMs ?? endedAt;
    const totalBackgroundTimeMs = Math.max(0, Math.round(options.totalBackgroundTimeMs ?? 0));
    const body = JSON.stringify({
      sessionId: session.sessionId,
      endedAt,
      closeAnchorAtMs,
      totalBackgroundTimeMs,
      endReason: reason,
      lifecycleVersion: 2,
      isSampledIn: session.sampledIn,
      sdkVersion: SDK_VERSION,
    });

    const headers = {
      'content-type': 'application/json',
      'x-upload-token': session.uploadToken,
      'x-rejourney-key': this.config.publicKey || '',
      'x-platform': 'web',
    };

    const url = `${normalizeBaseUrl(this.config.apiUrl, DEFAULT_API_URL)}/api/ingest/session/end`;

    await fetch(url, {
      method: 'POST',
      headers,
      body,
      keepalive: body.length < 60_000,
      credentials: 'omit',
    }).catch(() => undefined);
  }

  private async collectDeviceInfo(visitorId: string): Promise<WebDeviceInfo> {
    return collectWebDeviceInfoWithHints(visitorId, getNavigator());
  }
}

export const Rejourney = new RejourneyWebClient();

export function initRejourney(publicKey: string, options?: RejourneyWebConfig): Promise<boolean> {
  return Rejourney.init(publicKey, options);
}

export function startRejourney(): Promise<boolean> {
  return Rejourney.start();
}

export function stopRejourney(): Promise<void> {
  return Rejourney.stop();
}
