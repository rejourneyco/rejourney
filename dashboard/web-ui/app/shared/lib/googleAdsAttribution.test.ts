import { afterEach, describe, expect, it } from "vitest";

import {
  appendGoogleAdsAttributionToUrl,
  captureGoogleAdsAttribution,
  clearGoogleAdsAttribution,
  grantGoogleAdsAttributionConsent,
  GOOGLE_ADS_ATTRIBUTION_STORAGE_KEY,
} from "./googleAdsAttribution";
import { GOOGLE_ADS_CONSENT_STORAGE_KEY } from "./googleAdsConsent";

const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");

function setTestWindow(
  href: string,
  options: { consent?: "accepted" | "rejected"; attribution?: string } = {},
) {
  const values = new Map<string, string>();
  if (options.consent) values.set(GOOGLE_ADS_CONSENT_STORAGE_KEY, options.consent);
  if (options.attribution) values.set(GOOGLE_ADS_ATTRIBUTION_STORAGE_KEY, options.attribution);
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: new URL(href),
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
      },
    },
  });
  return values;
}

describe("Google Ads attribution", () => {
  afterEach(() => {
    clearGoogleAdsAttribution();
    if (originalWindowDescriptor) {
      Object.defineProperty(globalThis, "window", originalWindowDescriptor);
    } else {
      delete (globalThis as { window?: unknown }).window;
    }
  });

  it("holds landing identifiers in memory without persisting them before consent", () => {
    const values = setTestWindow(
      "https://rejourney.co/web-session-replay?gclid=click-1&utm_source=google&utm_medium=cpc&utm_campaign=123&matchtype=e&device=c",
    );

    const attribution = captureGoogleAdsAttribution();

    expect(attribution).toBeNull();
    expect(values.has(GOOGLE_ADS_ATTRIBUTION_STORAGE_KEY)).toBe(false);

    values.set(GOOGLE_ADS_CONSENT_STORAGE_KEY, "accepted");
    expect(grantGoogleAdsAttributionConsent()).toMatchObject({
      gclid: "click-1",
      utm_source: "google",
      utm_medium: "cpc",
      utm_campaign: "123",
      matchtype: "e",
      device: "c",
      landingPage: "https://rejourney.co/web-session-replay",
    });
    expect(values.has(GOOGLE_ADS_ATTRIBUTION_STORAGE_KEY)).toBe(true);
  });

  it("captures attribution immediately when consent was already accepted", () => {
    const values = setTestWindow(
      "https://rejourney.co/web-session-replay?gclid=click-1&utm_source=google",
      { consent: "accepted" },
    );

    const attribution = captureGoogleAdsAttribution();

    expect(attribution).toMatchObject({
      gclid: "click-1",
      utm_source: "google",
      landingPage: "https://rejourney.co/web-session-replay",
    });
    expect(values.has(GOOGLE_ADS_ATTRIBUTION_STORAGE_KEY)).toBe(true);
  });

  it("clears stored and pending attribution when consent is rejected", () => {
    const stored = JSON.stringify({
      gclid: "old-click",
      capturedAt: new Date().toISOString(),
      landingPage: "https://rejourney.co/",
    });
    const values = setTestWindow(
      "https://rejourney.co/pricing?gclid=new-click",
      { consent: "rejected", attribution: stored },
    );

    expect(captureGoogleAdsAttribution()).toBeNull();
    expect(values.has(GOOGLE_ADS_ATTRIBUTION_STORAGE_KEY)).toBe(false);
  });

  it("preserves the original first-touch attribution", () => {
    const firstTouch = JSON.stringify({
      gclid: "first-click",
      capturedAt: new Date().toISOString(),
      landingPage: "https://rejourney.co/",
    });
    setTestWindow("https://rejourney.co/pricing?gclid=second-click", {
      consent: "accepted",
      attribution: firstTouch,
    });

    expect(captureGoogleAdsAttribution()?.gclid).toBe("first-click");
  });

  it("adds stored attribution to the GitHub OAuth request", () => {
    const stored = JSON.stringify({
      gbraid: "braid-1",
      utm_source: "google",
      capturedAt: new Date().toISOString(),
      landingPage: "https://rejourney.co/mobile-session-replay",
    });
    setTestWindow("https://rejourney.co/login", {
      consent: "accepted",
      attribution: stored,
    });

    const result = new URL(appendGoogleAdsAttributionToUrl("/api/auth/github"), "https://rejourney.co");
    expect(result.searchParams.get("gbraid")).toBe("braid-1");
    expect(result.searchParams.get("landingPage")).toBe("https://rejourney.co/mobile-session-replay");
    expect(result.searchParams.get("googleAdsConsent")).toBe("accepted");
  });

  it("does not add attribution to auth requests before consent", () => {
    setTestWindow("https://rejourney.co/login?gclid=click-1");

    expect(appendGoogleAdsAttributionToUrl("/api/auth/github")).toBe("/api/auth/github");
  });
});
