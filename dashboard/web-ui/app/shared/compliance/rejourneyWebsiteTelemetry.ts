// Dashboard shells do not need to download the website recording SDK.
let Rejourney: typeof import("@rejourneyco/browser")["Rejourney"] | undefined;
let consentGeneration = 0;
import type { NetworkRequestParams, PrimitiveMetadataValue, RejourneyWebConfig } from "@rejourneyco/browser";
import type { ApiTeam } from "~/shared/api/client";
import type { Project } from "~/shared/types";

export const REJOURNEY_PUBLIC_KEY = "rj_7797d985a1268e15da862b71121bf385";
export const CONSENT_STORAGE_KEY = "rejourney.webSdkConsent.v1";

const VISITOR_UUID_STORAGE_KEY = "rejourney.websiteVisitorUuid.v1";
const REVENUE_EVENT_STORAGE_PREFIX = "rejourney.websiteRevenueEventTracked.v1";
const CONSENT_VERSION = "2026-05-17.web-sdk";
const OFFICIAL_HOSTS = new Set([
  "rejourney.co",
  "www.rejourney.co",
  "localhost",
  "127.0.0.1",
  "rejourney.localtest.me",
]);

type ConsentChoice = "accepted" | "rejected";
type PrimitiveRecord = Record<string, PrimitiveMetadataValue>;

export type RejourneyRevenueEventInput = {
  transactionId: string;
  amount: number;
  currency?: string;
  teamId?: string;
  planId?: string;
  planName?: string;
  planDisplayName?: string;
  priceId?: string;
  productId?: string;
  subscriptionId?: string | null;
  checkoutSessionId?: string;
  billingInterval?: string;
  changeType?: string;
  source?: "stripe_checkout" | "stripe_plan_change";
  sessionReplayLimit?: number;
  videoRetentionDays?: number;
  isRenewal?: boolean;
  isTrialConversion?: boolean;
  dedupeKey?: string;
};

let rejourneyInitPromise: Promise<boolean> | null = null;
let clickTrackingInstalled = false;
let errorTrackingInstalled = false;
let performanceTrackingInstalled = false;
let engagementTrackingInstalled = false;
let websiteSessionStartLogged = false;
let consentAcceptedLogged = false;
let currentRouteKey = "";
let routeStartedAt = Date.now();
let routeViewSequence = 0;
let scrollMilestones = new Set<number>();
let lastDashboardContextKey = "";

function randomUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const value = Math.random() * 16 | 0;
    const nibble = char === "x" ? value : (value & 0x3) | 0x8;
    return nibble.toString(16);
  });
}

function safeLocalStorageGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeLocalStorageSet(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Runtime state still honors the user's choice when storage is unavailable.
  }
}

function safeSessionStorageGet(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSessionStorageSet(key: string, value: string): void {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // Non-critical enrichment only.
  }
}

function normalizePath(pathname: string): string {
  return pathname
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?=\/|$)/gi, "/:uuid")
    .replace(/\/[0-9a-f]{24,}(?=\/|$)/gi, "/:id")
    .replace(/\/\d{4,}(?=\/|$)/g, "/:number")
    .replace(/\/rj_[A-Za-z0-9_=-]+(?=\/|$)/g, "/:public_key");
}

function routeSurface(pathname: string): string {
  if (pathname.startsWith("/dashboard")) return "dashboard";
  if (pathname.startsWith("/demo")) return "demo";
  if (pathname.startsWith("/docs")) return "docs";
  if (pathname.startsWith("/engineering")) return "engineering";
  if (pathname.startsWith("/login") || pathname.startsWith("/invite")) return "auth";
  if (pathname.startsWith("/pricing")) return "pricing";
  if (pathname.startsWith("/privacy") || pathname.startsWith("/terms") || pathname.startsWith("/dpa")) return "legal";
  return "marketing";
}

function readableRouteName(pathname: string): string {
  const normalized = normalizePath(pathname);
  if (normalized === "/") return "Marketing / Home";
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length === 0) return "Marketing / Home";

  const title = parts
    .slice(0, 4)
    .map((part) => part
      .replace(/^:/, "")
      .replace(/-/g, " ")
      .replace(/\b\w/g, (char) => char.toUpperCase()))
    .join(" / ");

  return title || normalized;
}

function routeDepth(pathname: string): number {
  return pathname.split("/").filter(Boolean).length;
}

function safeUrlPath(value: string): string {
  try {
    const parsed = new URL(value, window.location.href);
    return normalizePath(parsed.pathname);
  } catch {
    return "";
  }
}

function referrerDomain(): string {
  if (!document.referrer) return "direct";
  try {
    return new URL(document.referrer).hostname || "unknown";
  } catch {
    return "unknown";
  }
}

function getConnection(): { effectiveType?: string; downlink?: number; saveData?: boolean } {
  const nav = navigator as Navigator & {
    connection?: { effectiveType?: string; downlink?: number; saveData?: boolean };
  };

  return nav.connection || {};
}

function viewportMetadata(): PrimitiveRecord {
  const connection = getConnection();
  const nav = navigator as Navigator & { deviceMemory?: number };

  return stripUndefinedMetadata({
    viewport_width: window.innerWidth,
    viewport_height: window.innerHeight,
    screen_width: window.screen?.width,
    screen_height: window.screen?.height,
    device_pixel_ratio: Number(window.devicePixelRatio?.toFixed(2) || 1),
    touch_capable: navigator.maxTouchPoints > 0,
    color_scheme: window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light",
    reduced_motion: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
    browser_language: navigator.language || "unknown",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "unknown",
    hardware_concurrency: navigator.hardwareConcurrency || 0,
    device_memory_gb: nav.deviceMemory,
    connection_effective_type: connection.effectiveType,
    connection_downlink_mbps: connection.downlink,
    connection_save_data: connection.saveData,
  });
}

function stripUndefinedMetadata(input: Record<string, PrimitiveMetadataValue | undefined>): PrimitiveRecord {
  const metadata: PrimitiveRecord = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) metadata[key] = value;
  }
  return metadata;
}

function routeMetadata(pathname: string, search: string): PrimitiveRecord {
  const normalizedPath = normalizePath(pathname);
  const queryParams = new URLSearchParams(search);

  return {
    surface: routeSurface(pathname),
    route_template: normalizedPath,
    route_depth: routeDepth(pathname),
    route_has_query: queryParams.size > 0,
    route_query_count: queryParams.size,
    route_screen: readableRouteName(pathname),
  };
}

function teamMetadata(currentTeam: ApiTeam | null, teams: ApiTeam[]): PrimitiveRecord {
  return stripUndefinedMetadata({
    authenticated_team_count: teams.length,
    current_team_id: currentTeam?.id,
    current_team_plan: currentTeam?.billingPlan,
    current_team_has_owner: currentTeam?.ownerUserId ? true : undefined,
  });
}

function projectMetadata(project: Project | null, projectCount: number): PrimitiveRecord {
  return stripUndefinedMetadata({
    selected_project_id: project?.id,
    selected_project_has_web_domain: project?.webDomain ? true : undefined,
    selected_project_platforms: project?.platforms?.join(",") || undefined,
    selected_project_recording_enabled: project?.recordingEnabled,
    selected_project_rejourney_enabled: project?.rejourneyEnabled,
    selected_project_sessions_last_7_days: project?.sessionsLast7Days,
    available_project_count: projectCount,
  });
}

function sanitizeLabel(label: string): string {
  return label
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, "[email]")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, "[uuid]")
    .replace(/\brj_[A-Za-z0-9_=-]+\b/g, "[public_key]")
    .replace(/\b[A-Za-z0-9._~+/=-]{32,}\b/g, "[token]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function elementLabel(element: Element): string {
  const explicit = element.getAttribute("data-rj-event-label")
    || element.getAttribute("data-analytics-label")
    || element.getAttribute("aria-label")
    || element.getAttribute("title")
    || "";

  if (explicit) return sanitizeLabel(explicit);

  const text = element.textContent || "";
  return sanitizeLabel(text);
}

function elementKind(element: Element): string {
  if (element instanceof HTMLAnchorElement) {
    if (element.href.startsWith("mailto:")) return "email_link";
    if (element.href.startsWith("tel:")) return "phone_link";
    try {
      const destination = new URL(element.href);
      return destination.origin === window.location.origin ? "internal_link" : "external_link";
    } catch {
      return "link";
    }
  }

  if (element instanceof HTMLButtonElement) return element.type === "submit" ? "submit_button" : "button";
  return element.getAttribute("role") || element.tagName.toLowerCase();
}

function interactionBaseProperties(): PrimitiveRecord {
  return {
    route_template: normalizePath(window.location.pathname),
    surface: routeSurface(window.location.pathname),
    viewport_width: window.innerWidth,
    viewport_height: window.innerHeight,
  };
}

function trackCustomEvent(name: string, properties: Record<string, unknown> = {}): void {
  if (!canTrackRejourneyWebsiteTelemetry()) return;
  Rejourney?.logEvent(name, properties);
}

function revenueEventStorageKey(dedupeKey: string): string {
  const normalized = dedupeKey.replace(/[^A-Za-z0-9_.:-]/g, "_").slice(0, 180);
  return `${REVENUE_EVENT_STORAGE_PREFIX}:${normalized}`;
}

function claimRevenueEventDedupeKey(dedupeKey: string): boolean {
  const storageKey = revenueEventStorageKey(dedupeKey);
  if (safeLocalStorageGet(storageKey)) return false;
  safeLocalStorageSet(storageKey, new Date().toISOString());
  return true;
}

export function trackRejourneyRevenueEvent(input: RejourneyRevenueEventInput): boolean {
  if (!canTrackRejourneyWebsiteTelemetry()) return false;

  const amount = Number(input.amount);
  const transactionId = input.transactionId.trim();
  if (!transactionId || !Number.isFinite(amount) || amount <= 0) return false;

  const dedupeKey = input.dedupeKey || transactionId;
  if (!claimRevenueEventDedupeKey(dedupeKey)) return false;

  const currency = (input.currency || "USD").trim().toUpperCase() || "USD";
  const amountMajor = Math.round(amount * 100) / 100;

  trackCustomEvent("purchase_completed", stripUndefinedMetadata({
    transactionId,
    orderId: transactionId,
    amount: amountMajor,
    currency,
    paymentProvider: "stripe",
    platform: "web",
    revenueSource: "rejourney_billing",
    source: input.source || "stripe_checkout",
    teamId: input.teamId,
    planId: input.planId,
    planName: input.planName,
    planDisplayName: input.planDisplayName,
    priceId: input.priceId,
    productId: input.productId,
    subscriptionId: input.subscriptionId || undefined,
    checkoutSessionId: input.checkoutSessionId,
    billingInterval: input.billingInterval,
    changeType: input.changeType,
    sessionReplayLimit: input.sessionReplayLimit,
    videoRetentionDays: input.videoRetentionDays,
    isRenewal: input.isRenewal ?? false,
    isTrialConversion: input.isTrialConversion ?? false,
  }));

  return true;
}

function installInteractionTracking(): void {
  if (clickTrackingInstalled) return;
  clickTrackingInstalled = true;

  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element
      ? event.target.closest("a,button,[role='button'],[data-rj-event-label],[data-analytics-label]")
      : null;
    if (!target) return;

    trackCustomEvent("website_element_clicked", {
      ...interactionBaseProperties(),
      element_kind: elementKind(target),
      element_tag: target.tagName.toLowerCase(),
      element_label: elementLabel(target),
      destination_path: target instanceof HTMLAnchorElement ? safeUrlPath(target.href) : "",
      opens_new_tab: target instanceof HTMLAnchorElement ? target.target === "_blank" : false,
    });
  }, { capture: true });

  document.addEventListener("submit", (event) => {
    const form = event.target instanceof HTMLFormElement ? event.target : null;
    if (!form) return;

    trackCustomEvent("website_form_submitted", {
      ...interactionBaseProperties(),
      form_id: sanitizeLabel(form.id || form.getAttribute("name") || "anonymous_form"),
      form_method: (form.method || "get").toLowerCase(),
      form_action_path: form.action ? safeUrlPath(form.action) : "",
    });
  }, { capture: true });
}

function installErrorTracking(): void {
  if (errorTrackingInstalled) return;
  errorTrackingInstalled = true;

  window.addEventListener("error", (event) => {
    trackCustomEvent("website_js_error", {
      ...interactionBaseProperties(),
      message: sanitizeLabel(event.message || "unknown_error"),
      source_path: event.filename ? safeUrlPath(event.filename) : "",
      line: event.lineno || 0,
      column: event.colno || 0,
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason instanceof Error ? event.reason.message : String(event.reason || "unknown_rejection");
    trackCustomEvent("website_unhandled_rejection", {
      ...interactionBaseProperties(),
      message: sanitizeLabel(reason),
    });
  });
}

function installPerformanceTracking(): void {
  if (performanceTrackingInstalled) return;
  performanceTrackingInstalled = true;

  window.setTimeout(() => {
    const navEntry = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    if (!navEntry) return;

    trackCustomEvent("website_page_performance", {
      route_template: normalizePath(window.location.pathname),
      surface: routeSurface(window.location.pathname),
      navigation_type: navEntry.type,
      dom_content_loaded_ms: Math.round(navEntry.domContentLoadedEventEnd),
      load_complete_ms: Math.round(navEntry.loadEventEnd),
      first_byte_ms: Math.round(navEntry.responseStart),
      transfer_size: navEntry.transferSize || 0,
      encoded_body_size: navEntry.encodedBodySize || 0,
    });
  }, 0);

  if (typeof PerformanceObserver === "undefined") return;

  try {
    const lcpObserver = new PerformanceObserver((entryList) => {
      const entries = entryList.getEntries();
      const latest = entries[entries.length - 1] as PerformanceEntry | undefined;
      if (!latest) return;
      trackCustomEvent("website_largest_contentful_paint", {
        route_template: normalizePath(window.location.pathname),
        surface: routeSurface(window.location.pathname),
        lcp_ms: Math.round(latest.startTime),
      });
    });
    lcpObserver.observe({ type: "largest-contentful-paint", buffered: true });
  } catch {
    // Browser does not support this observer type.
  }
}

function installEngagementTracking(): void {
  if (engagementTrackingInstalled) return;
  engagementTrackingInstalled = true;

  const trackScroll = () => {
    const scrollable = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    const percent = Math.min(100, Math.round((window.scrollY / scrollable) * 100));
    for (const milestone of [25, 50, 75, 90, 100]) {
      if (percent >= milestone && !scrollMilestones.has(milestone)) {
        scrollMilestones.add(milestone);
        trackCustomEvent("website_scroll_depth_reached", {
          ...interactionBaseProperties(),
          percent: milestone,
        });
      }
    }
  };

  window.addEventListener("scroll", trackScroll, { passive: true });

  for (const seconds of [15, 60, 180]) {
    window.setTimeout(() => {
      if (document.visibilityState !== "visible") return;
      trackCustomEvent("website_engagement_milestone", {
        ...interactionBaseProperties(),
        seconds_visible: seconds,
      });
    }, seconds * 1000);
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "hidden") return;
    trackCustomEvent("website_visibility_hidden", {
      ...interactionBaseProperties(),
      route_elapsed_ms: Date.now() - routeStartedAt,
      session_id: Rejourney?.getSessionId() || "",
    });
  });
}

function installAdvancedTracking(): void {
  installInteractionTracking();
  installErrorTracking();
  installPerformanceTracking();
  installEngagementTracking();
}

function beforeSendNetwork(request: NetworkRequestParams): NetworkRequestParams | null {
  try {
    const url = new URL(request.url, window.location.href);
    if (url.pathname.startsWith("/api/auth/")) return null;
    if (url.pathname.includes("/token") || url.pathname.includes("/oauth")) return null;
  } catch {
    if (/\/api\/auth\//.test(request.url)) return null;
  }

  return request;
}

const REJOURNEY_OPTIONS: RejourneyWebConfig = {
  autoStart: false,
  autoTrackRoutes: true,
  autoTrackNetwork: true,
  networkCaptureSizes: true,
  captureReplay: true,
  captureAttribution: true,
  attribution: { preserveClickIds: false },
  collectGeoLocation: true,
  maskAllInputs: true,
  trackConsoleLogs: false,
  trackLongTasks: true,
  trackResourceErrors: true,
  ignoreBots: true,
  recordAutomation: false,
  routeName: (location) => readableRouteName(location.pathname),
  networkIgnoreUrls: ["/health", "/health/ready"],
  beforeSendNetwork,
};

export function readStoredRejourneyConsent(): ConsentChoice | null {
  const storedValue = safeLocalStorageGet(CONSENT_STORAGE_KEY);
  return storedValue === "accepted" || storedValue === "rejected" ? storedValue : null;
}

export function writeStoredRejourneyConsent(value: ConsentChoice): void {
  safeLocalStorageSet(CONSENT_STORAGE_KEY, value);
}

export function isOfficialWebsiteHost(hostname: string): boolean {
  return OFFICIAL_HOSTS.has(hostname) || hostname.endsWith(".rejourney.co");
}

export function isEmbeddedFrame(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

export function canTrackRejourneyWebsiteTelemetry(): boolean {
  if (typeof window === "undefined") return false;
  if (readStoredRejourneyConsent() !== "accepted") return false;
  if (isEmbeddedFrame() || !isOfficialWebsiteHost(window.location.hostname)) return false;
  return true;
}

export function getOrCreateWebsiteVisitorUuid(): string {
  const stored = safeLocalStorageGet(VISITOR_UUID_STORAGE_KEY);
  if (stored) return stored;

  const uuid = randomUuid();
  safeLocalStorageSet(VISITOR_UUID_STORAGE_KEY, uuid);
  return uuid;
}

export function disableRejourneyWebsiteTelemetry(): void {
  consentGeneration += 1;
  Rejourney?.setConsent({ analytics: false, replay: false });
  Rejourney?.clearUserIdentity();
  void Rejourney?.stop();
}

function ensureRejourneyInitialized(): Promise<boolean> {
  if (!rejourneyInitPromise) {
    rejourneyInitPromise = import("@rejourneyco/browser")
      .then((sdk) => {
        Rejourney = sdk.Rejourney;
        return Rejourney.init(REJOURNEY_PUBLIC_KEY, REJOURNEY_OPTIONS);
      }).catch((error) => {
        rejourneyInitPromise = null;
        throw error;
      });
  }

  return rejourneyInitPromise;
}

export function syncRejourneyWebsiteContext(params: {
  pathname: string;
  search: string;
  userId: string | null;
  currentTeam: ApiTeam | null;
  teams: ApiTeam[];
}): void {
  const visitorUuid = getOrCreateWebsiteVisitorUuid();
  const sessionVisitId = safeSessionStorageGet("rejourney.websiteVisitId.v1") || randomUuid();
  safeSessionStorageSet("rejourney.websiteVisitId.v1", sessionVisitId);

  Rejourney?.setMetadata({
    app: "rejourney-website",
    sdk_client: "official_npm_package",
    consent_version: CONSENT_VERSION,
    visitor_uuid: visitorUuid,
    visit_uuid: sessionVisitId,
    authenticated: Boolean(params.userId),
    referrer_domain: referrerDomain(),
    ...viewportMetadata(),
    ...routeMetadata(params.pathname, params.search),
    ...teamMetadata(params.currentTeam, params.teams),
  });

  Rejourney?.setUserIdentity(params.userId || `anon_${visitorUuid}`);
}

export async function startRejourneyWebsiteTelemetry(params: {
  pathname: string;
  search: string;
  userId: string | null;
  currentTeam: ApiTeam | null;
  teams: ApiTeam[];
  source: "stored_consent" | "banner_accept";
}): Promise<boolean> {
  writeStoredRejourneyConsent("accepted");
  const generation = consentGeneration;
  await ensureRejourneyInitialized();
  // Consent or route may change while the SDK chunk is downloading.
  if (generation !== consentGeneration || readStoredRejourneyConsent() !== "accepted") return false;
  Rejourney?.setConsent({ analytics: true, replay: true });
  syncRejourneyWebsiteContext(params);
  const started = await Rejourney?.start();
  if (!started || generation !== consentGeneration) return false;
  installAdvancedTracking();

  const sessionId = Rejourney?.getSessionId();
  if (sessionId) {
    Rejourney?.setMetadata("rejourney_session_id", sessionId);
  }

  if (websiteSessionStartLogged) return true;
  websiteSessionStartLogged = true;

  Rejourney?.logEvent("website_session_started", {
    source: params.source,
    session_id: sessionId || "",
    route_template: normalizePath(params.pathname),
    surface: routeSurface(params.pathname),
    visitor_uuid: getOrCreateWebsiteVisitorUuid(),
  });

  return true;
}

export function trackRejourneyRouteView(params: {
  pathname: string;
  search: string;
  userId: string | null;
  currentTeam: ApiTeam | null;
  teams: ApiTeam[];
}): void {
  if (!canTrackRejourneyWebsiteTelemetry()) return;

  const nextRouteKey = `${params.pathname}${params.search}`;
  if (nextRouteKey === currentRouteKey) return;

  const previousRouteKey = currentRouteKey;
  currentRouteKey = nextRouteKey;
  routeStartedAt = Date.now();
  routeViewSequence += 1;
  scrollMilestones = new Set<number>();

  syncRejourneyWebsiteContext(params);
  Rejourney?.trackScreen(readableRouteName(params.pathname), {
    route_template: normalizePath(params.pathname),
    surface: routeSurface(params.pathname),
  });
  Rejourney?.logEvent("website_route_viewed", {
    sequence: routeViewSequence,
    route_template: normalizePath(params.pathname),
    route_screen: readableRouteName(params.pathname),
    surface: routeSurface(params.pathname),
    route_depth: routeDepth(params.pathname),
    has_query: new URLSearchParams(params.search).size > 0,
    previous_route_template: previousRouteKey ? normalizePath(previousRouteKey.split("?")[0] || previousRouteKey) : "",
    session_id: Rejourney?.getSessionId() || "",
  });
}

export function trackRejourneyConsentAccepted(): void {
  if (!canTrackRejourneyWebsiteTelemetry()) return;
  if (consentAcceptedLogged) return;
  consentAcceptedLogged = true;

  Rejourney?.logEvent("website_consent_accepted", {
    consent_version: CONSENT_VERSION,
    visitor_uuid: getOrCreateWebsiteVisitorUuid(),
    surface: routeSurface(window.location.pathname),
    route_template: normalizePath(window.location.pathname),
  });
}

export function trackRejourneyDashboardContext(params: {
  pathname: string;
  currentTeam: ApiTeam | null;
  teams: ApiTeam[];
  selectedProject: Project | null;
  projectCount: number;
}): void {
  if (!canTrackRejourneyWebsiteTelemetry()) return;

  const metadata = {
    ...routeMetadata(params.pathname, window.location.search),
    ...teamMetadata(params.currentTeam, params.teams),
    ...projectMetadata(params.selectedProject, params.projectCount),
  };
  const contextKey = [
    params.pathname,
    params.currentTeam?.id || "",
    params.selectedProject?.id || "",
    params.projectCount,
  ].join(":");

  Rejourney?.setMetadata(metadata);
  if (contextKey === lastDashboardContextKey) return;
  lastDashboardContextKey = contextKey;

  Rejourney?.logEvent("dashboard_context_synced", {
    route_template: normalizePath(params.pathname),
    surface: routeSurface(params.pathname),
    team_id: params.currentTeam?.id || "",
    project_id: params.selectedProject?.id || "",
    project_platforms: params.selectedProject?.platforms?.join(",") || "",
    project_count: params.projectCount,
  });
}
