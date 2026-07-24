import { getGoogleAdsConversionId, getGoogleAdsSignupConversionLabel } from "~/shared/config/runtimeEnv";
import { hasGoogleAdsConsent } from "~/shared/lib/googleAdsConsent";

type EdgeSignalProperties = Record<string, string | number | boolean>;

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
    __rejourneyGoogleAdsSignupTracked?: boolean;
    zaraz?: {
      track?: (eventName: string, eventProperties?: EdgeSignalProperties) => Promise<unknown> | unknown;
    };
  }
}

type ZarazTrack = NonNullable<NonNullable<Window["zaraz"]>["track"]>;
type GtagTrack = NonNullable<Window["gtag"]>;

export type AccountActivationMethod = "otp" | "github";

const SIGNAL_BUDGET_MS = 3500;
const MIN_TRACK_DISPATCH_MS = 1000;
const ZARAZ_READY_CHECK_INTERVAL_MS = 50;

function signalTimeout(timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, timeoutMs);
  });
}

function getZarazTrack(): ZarazTrack | null {
  const track = window.zaraz?.track;
  if (typeof track !== "function") return null;

  return track.bind(window.zaraz);
}

function getGtagTrack(): GtagTrack | null {
  return typeof window.gtag === "function" ? window.gtag.bind(window) : null;
}

async function waitForZarazTrack(deadline: number): Promise<ZarazTrack | null> {
  while (Date.now() < deadline) {
    const track = getZarazTrack();
    if (track) return track;

    await signalTimeout(Math.min(ZARAZ_READY_CHECK_INTERVAL_MS, Math.max(deadline - Date.now(), 0)));
  }

  return getZarazTrack();
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

export async function trackAccountActivationSignal(
  method: AccountActivationMethod,
  identity?: { userId: string; email: string },
): Promise<void> {
  if (typeof window === "undefined") return;

  trackGoogleAdsSignupConversion(identity);

  if (!window.zaraz) return;

  const deadline = Date.now() + SIGNAL_BUDGET_MS;
  const track = await waitForZarazTrack(deadline);
  if (!track) return;

  try {
    const dispatchTimeoutMs = Math.max(deadline - Date.now(), MIN_TRACK_DISPATCH_MS);
    await Promise.race([
      Promise.resolve(track("account_activated", { method })),
      signalTimeout(dispatchTimeoutMs),
    ]);
  } catch {
    // This is a best-effort edge analytics signal. It must never block login.
  }
}
