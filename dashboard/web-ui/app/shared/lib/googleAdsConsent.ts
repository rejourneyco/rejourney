type GoogleConsentValue = "granted" | "denied";

export const GOOGLE_ADS_CONSENT_STORAGE_KEY = "rejourney.webSdkConsent.v1";

export type GoogleAdsConsentChoice = "accepted" | "rejected" | null;

export function readGoogleAdsConsentChoice(): GoogleAdsConsentChoice {
  if (typeof window === "undefined") return null;

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

export function updateGoogleAdsConsent(granted: boolean): void {
  if (typeof window === "undefined" || typeof window.gtag !== "function") return;

  const value: GoogleConsentValue = granted ? "granted" : "denied";
  window.gtag("consent", "update", {
    ad_storage: value,
    analytics_storage: value,
    ad_user_data: value,
    ad_personalization: value,
  });
}
