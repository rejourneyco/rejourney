import { getGoogleAdsConversionId, getGoogleAdsSignupConversionLabel } from "~/shared/config/runtimeEnv";

type EdgeSignalProperties = Record<string, string | number | boolean>;

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
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

function getDashboardPageLocation(): string {
  const origin = typeof window.location?.origin === "string" && window.location.origin
    ? window.location.origin
    : "https://rejourney.co";

  return `${origin.replace(/\/$/, "")}/dashboard/`;
}

async function waitForZarazTrack(deadline: number): Promise<ZarazTrack | null> {
  while (Date.now() < deadline) {
    const track = getZarazTrack();
    if (track) return track;

    await signalTimeout(Math.min(ZARAZ_READY_CHECK_INTERVAL_MS, Math.max(deadline - Date.now(), 0)));
  }

  return getZarazTrack();
}

function trackGoogleAdsSignupConversion(): void {
  const gtag = getGtagTrack();
  if (!gtag) return;

  const conversionId = getGoogleAdsConversionId();
  if (!conversionId) return;

  const signupConversionLabel = getGoogleAdsSignupConversionLabel();
  if (signupConversionLabel) {
    gtag("event", "conversion", {
      send_to: `${conversionId}/${signupConversionLabel}`,
    });
    return;
  }

  // Fallback for URL-based Google Ads conversion actions while the action label
  // is not configured in the app. The explicit event above is the precise path.
  gtag("config", conversionId, {
    page_location: getDashboardPageLocation(),
    page_path: "/dashboard/",
    page_title: "Rejourney Dashboard",
  });
}

export async function trackAccountActivationSignal(method: AccountActivationMethod): Promise<void> {
  if (typeof window === "undefined") return;

  trackGoogleAdsSignupConversion();

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
