import { getGoogleAdsConversionId, getGoogleAdsSignupConversionLabel } from "~/shared/config/runtimeEnv";
import { hasGoogleAdsConsent } from "~/shared/lib/googleAdsConsent";

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
    __rejourneyGoogleAdsSignupTracked?: boolean;
  }
}

type GtagTrack = NonNullable<Window["gtag"]>;

export type AccountActivationMethod = "otp" | "github";

function getGtagTrack(): GtagTrack | null {
  return typeof window.gtag === "function" ? window.gtag.bind(window) : null;
}

function trackGoogleAdsSignupConversion(identity?: { userId: string; email: string }): void {
  if (window.__rejourneyGoogleAdsSignupTracked) return;
  if (!hasGoogleAdsConsent()) return;

  const gtag = getGtagTrack();
  if (!gtag) return;

  const conversionId = getGoogleAdsConversionId();
  if (!conversionId) return;

  const signupConversionLabel = getGoogleAdsSignupConversionLabel();
  if (!signupConversionLabel) return;

  window.__rejourneyGoogleAdsSignupTracked = true;
  const normalizedEmail = identity?.email.trim().toLowerCase();
  if (normalizedEmail) {
    gtag("set", "user_data", { email: normalizedEmail });
  }
  gtag("event", "conversion", {
    send_to: `${conversionId}/${signupConversionLabel}`,
    ...(identity?.userId ? { transaction_id: `signup_completed:${identity.userId}` } : {}),
  });
}

export function trackAccountActivationConversion(
  _method: AccountActivationMethod,
  identity?: { userId: string; email: string },
): void {
  if (typeof window === "undefined") return;

  trackGoogleAdsSignupConversion(identity);
}
