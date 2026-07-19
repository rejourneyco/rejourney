import { hasGoogleAdsConsent, readGoogleAdsConsentChoice } from "./googleAdsConsent";

export const GOOGLE_ADS_ATTRIBUTION_STORAGE_KEY = "rejourney.googleAdsAttribution.v1";

const ATTRIBUTION_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
const CLICK_ID_FIELDS = ["gclid", "gbraid", "wbraid"] as const;
const ATTRIBUTION_QUERY_FIELDS = [
  ...CLICK_ID_FIELDS,
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "matchtype",
  "device",
  "network",
  "loc",
] as const;

type AttributionQueryField = (typeof ATTRIBUTION_QUERY_FIELDS)[number];

export type GoogleAdsAttribution = Partial<Record<AttributionQueryField, string>> & {
  capturedAt: string;
  landingPage: string;
};

let pendingAttribution: GoogleAdsAttribution | null = null;

function safeRead(): GoogleAdsAttribution | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(GOOGLE_ADS_ATTRIBUTION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as GoogleAdsAttribution;
    const capturedAt = Date.parse(parsed.capturedAt);
    if (!Number.isFinite(capturedAt) || Date.now() - capturedAt > ATTRIBUTION_MAX_AGE_MS) {
      window.localStorage.removeItem(GOOGLE_ADS_ATTRIBUTION_STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function safeRemove(): void {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.removeItem(GOOGLE_ADS_ATTRIBUTION_STORAGE_KEY);
  } catch {
    // Consent cleanup is best effort when browser storage is unavailable.
  }
}

function safeWrite(attribution: GoogleAdsAttribution): void {
  try {
    window.localStorage.setItem(GOOGLE_ADS_ATTRIBUTION_STORAGE_KEY, JSON.stringify(attribution));
  } catch {
    // Attribution enrichment must never block navigation or signup.
  }
}

function cleanParam(value: string | null, maxLength = 255): string | undefined {
  const cleaned = value?.trim();
  return cleaned ? cleaned.slice(0, maxLength) : undefined;
}

function readAttributionFromUrl(href?: string): GoogleAdsAttribution | null {
  if (typeof window === "undefined" && !href) return null;

  let url: URL;
  try {
    url = new URL(href ?? window.location.href);
  } catch {
    return null;
  }

  const values: Partial<Record<AttributionQueryField, string>> = {};
  for (const field of ATTRIBUTION_QUERY_FIELDS) {
    const value = cleanParam(url.searchParams.get(field));
    if (value) values[field] = value;
  }

  const hasClickId = CLICK_ID_FIELDS.some((field) => Boolean(values[field]));
  const isGoogleCampaign = values.utm_source?.toLowerCase() === "google";
  if (!hasClickId && !isGoogleCampaign) return null;

  const attribution: GoogleAdsAttribution = {
    ...values,
    capturedAt: new Date().toISOString(),
    landingPage: `${url.origin}${url.pathname}`.slice(0, 2048),
  };
  return attribution;
}

export function captureGoogleAdsAttribution(href?: string): GoogleAdsAttribution | null {
  const consentChoice = readGoogleAdsConsentChoice();
  const consentGranted = consentChoice === "accepted";
  if (!consentGranted) safeRemove();
  if (consentChoice === "rejected") {
    pendingAttribution = null;
    return null;
  }

  const existing = consentGranted ? safeRead() : null;
  if (existing) return existing;

  if (!pendingAttribution) {
    pendingAttribution = readAttributionFromUrl(href);
  }

  if (!consentGranted || !pendingAttribution) return null;

  const attribution = pendingAttribution;
  pendingAttribution = null;
  safeWrite(attribution);
  return attribution;
}

export function grantGoogleAdsAttributionConsent(): GoogleAdsAttribution | null {
  return captureGoogleAdsAttribution();
}

export function clearGoogleAdsAttribution(): void {
  pendingAttribution = null;
  safeRemove();
}

export function getGoogleAdsAttribution(): GoogleAdsAttribution | null {
  if (!hasGoogleAdsConsent()) {
    captureGoogleAdsAttribution();
    return null;
  }
  return captureGoogleAdsAttribution();
}

export function appendGoogleAdsAttributionToUrl(path: string): string {
    const attribution = getGoogleAdsAttribution();
  const consentGranted = hasGoogleAdsConsent();
  if (!attribution && !consentGranted) return path;

  const url = new URL(path, window.location.origin);
  if (attribution) {
    for (const field of ATTRIBUTION_QUERY_FIELDS) {
      const value = attribution[field];
      if (value) url.searchParams.set(field, value);
    }
    url.searchParams.set("capturedAt", attribution.capturedAt);
    url.searchParams.set("landingPage", attribution.landingPage);
  }
  if (consentGranted) url.searchParams.set("googleAdsConsent", "accepted");
  return `${url.pathname}${url.search}`;
}
