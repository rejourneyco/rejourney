import { getGoogleAdsConsentBypassForInitialTesting } from "~/shared/config/runtimeEnv";

type GoogleConsentValue = "granted" | "denied";

export const GOOGLE_ADS_CONSENT_STORAGE_KEY = "rejourney.webSdkConsent.v1";

export type GoogleAdsConsentChoice = "accepted" | "rejected" | null;

/**
 * Temporary launch-testing override.
 *
 * Google Ads measurement is intentionally allowed without waiting for the
 * Rejourney website-telemetry/session-recording prompt. Keep all Rejourney
 * telemetry consent checks unchanged. Set this back to false after the initial
 * Google Ads signal-validation period.
 */
export function isGoogleAdsConsentBypassForInitialTestingEnabled(): boolean {
  return getGoogleAdsConsentBypassForInitialTesting();
}

export function readGoogleAdsConsentChoice(): GoogleAdsConsentChoice {
  if (typeof window === "undefined") return null;
  if (isGoogleAdsConsentBypassForInitialTestingEnabled()) return "accepted";

  try {
    const value = window.localStorage.getItem(GOOGLE_ADS_CONSENT_STORAGE_KEY);
    return value === "accepted" || value === "rejected" ? value : null;
  } catch {
    return null;
  }
}

export function hasGoogleAdsConsent(): boolean {
  return readGoogleAdsConsentChoice() === "accepted";
}

export function isGoogleAdsConsentPromptRequired(): boolean {
  return !isGoogleAdsConsentBypassForInitialTestingEnabled();
}

export function updateGoogleAdsConsent(granted: boolean): void {
  if (typeof window === "undefined" || typeof window.gtag !== "function") return;

  const value: GoogleConsentValue =
    isGoogleAdsConsentBypassForInitialTestingEnabled() || granted ? "granted" : "denied";
  window.gtag("consent", "update", {
    ad_storage: value,
    analytics_storage: value,
    ad_user_data: value,
    ad_personalization: value,
  });
}
