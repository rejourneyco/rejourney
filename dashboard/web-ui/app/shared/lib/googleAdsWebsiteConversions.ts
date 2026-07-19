import {
  getGoogleAdsConversionId,
  getGoogleAdsWebsiteConversionLabel,
} from "~/shared/config/runtimeEnv";
import { hasGoogleAdsConsent } from "./googleAdsConsent";

export type GoogleAdsWebsiteConversionName =
  | "demo_opened"
  | "pricing_viewed"
  | "docs_opened";

type PageConversionRule = {
  eventName: GoogleAdsWebsiteConversionName;
  delayMs: number;
  requiresInteraction: boolean;
};

const TRACKED_PREFIX = "rejourney.googleAdsWebsiteConversion.v1";
const SESSION_ID_KEY = "rejourney.googleAdsMeasurementSession.v1";

function measurementSessionId(): string {
  try {
    const existing = window.sessionStorage.getItem(SESSION_ID_KEY);
    if (existing) return existing;
    const generated = typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    window.sessionStorage.setItem(SESSION_ID_KEY, generated);
    return generated;
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

function trackedKey(eventName: GoogleAdsWebsiteConversionName): string {
  return `${TRACKED_PREFIX}.${eventName}`;
}

export function trackGoogleAdsWebsiteConversion(eventName: GoogleAdsWebsiteConversionName): boolean {
  if (typeof window === "undefined" || !hasGoogleAdsConsent()) return false;
  if (typeof window.gtag !== "function") return false;

  const conversionId = getGoogleAdsConversionId();
  const label = getGoogleAdsWebsiteConversionLabel(eventName);
  if (!conversionId || !label) return false;

  try {
    if (window.sessionStorage.getItem(trackedKey(eventName)) === "1") return false;
    window.sessionStorage.setItem(trackedKey(eventName), "1");
  } catch {
    // Storage is only a dedupe aid. Google also receives transaction_id.
  }

  window.gtag("event", "conversion", {
    send_to: `${conversionId}/${label}`,
    transaction_id: `${eventName}:${measurementSessionId()}`,
  });
  return true;
}

export function getGoogleAdsPageConversionRule(pathname: string): PageConversionRule | null {
  const normalized = pathname.replace(/^\/[a-z]{2}(?=\/)/i, "");
  if (normalized === "/demo" || normalized.startsWith("/demo/")) {
    return { eventName: "demo_opened", delayMs: 15_000, requiresInteraction: true };
  }
  if (normalized === "/pricing" || normalized.startsWith("/pricing/")) {
    return { eventName: "pricing_viewed", delayMs: 10_000, requiresInteraction: true };
  }
  if (normalized.startsWith("/docs/") && normalized !== "/docs/") {
    return { eventName: "docs_opened", delayMs: 3_000, requiresInteraction: false };
  }
  return null;
}
