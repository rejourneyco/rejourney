import { afterEach, describe, expect, it, vi } from "vitest";

import { GOOGLE_ADS_CONSENT_STORAGE_KEY } from "./googleAdsConsent";
import {
  getGoogleAdsPageConversionRule,
  trackGoogleAdsWebsiteConversion,
} from "./googleAdsWebsiteConversions";

const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");

function installWindow(
  withStoredTelemetryConsent = true,
  consentBypassForInitialTesting?: string,
) {
  const values = new Map<string, string>();
  if (withStoredTelemetryConsent) {
    values.set(GOOGLE_ADS_CONSENT_STORAGE_KEY, "accepted");
  }
  const sessionValues = new Map<string, string>();
  const gtag = vi.fn();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      ENV: {
        VITE_GOOGLE_ADS_CONVERSION_ID: "AW-123",
        VITE_GOOGLE_ADS_DEMO_OPENED_CONVERSION_LABEL: "demo-label",
        VITE_GOOGLE_ADS_PRICING_VIEWED_CONVERSION_LABEL: "pricing-label",
        ...(consentBypassForInitialTesting === undefined
          ? {}
          : { VITE_GOOGLE_ADS_CONSENT_BYPASS_FOR_INITIAL_TESTING: consentBypassForInitialTesting }),
      },
      gtag,
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
      },
      sessionStorage: {
        getItem: (key: string) => sessionValues.get(key) ?? null,
        setItem: (key: string, value: string) => sessionValues.set(key, value),
      },
    },
  });
  return gtag;
}

describe("Google Ads website conversions", () => {
  afterEach(() => {
    if (originalWindowDescriptor) {
      Object.defineProperty(globalThis, "window", originalWindowDescriptor);
    } else {
      delete (globalThis as { window?: unknown }).window;
    }
  });

  it("uses meaningful engagement rules for demo, pricing, and setup docs", () => {
    expect(getGoogleAdsPageConversionRule("/demo")).toMatchObject({
      eventName: "demo_opened",
      requiresInteraction: true,
    });
    expect(getGoogleAdsPageConversionRule("/pricing")).toMatchObject({
      eventName: "pricing_viewed",
      requiresInteraction: true,
    });
    expect(getGoogleAdsPageConversionRule("/docs/web/getting-started")).toMatchObject({
      eventName: "docs_opened",
      requiresInteraction: false,
    });
    expect(getGoogleAdsPageConversionRule("/docs")).toBeNull();
  });

  it("dispatches once per browser session with a transaction ID", () => {
    const gtag = installWindow();
    expect(trackGoogleAdsWebsiteConversion("demo_opened")).toBe(true);
    expect(trackGoogleAdsWebsiteConversion("demo_opened")).toBe(false);
    expect(gtag).toHaveBeenCalledTimes(1);
    expect(gtag).toHaveBeenCalledWith("event", "conversion", expect.objectContaining({
      send_to: "AW-123/demo-label",
      transaction_id: expect.stringMatching(/^demo_opened:/),
    }));
  });

  it("dispatches without waiting for the telemetry prompt during the Ads test", () => {
    const gtag = installWindow(false);

    expect(trackGoogleAdsWebsiteConversion("pricing_viewed")).toBe(true);
    expect(gtag).toHaveBeenCalledWith("event", "conversion", expect.objectContaining({
      send_to: "AW-123/pricing-label",
      transaction_id: expect.stringMatching(/^pricing_viewed:/),
    }));
  });

  it("requires prompt consent when the temporary environment bypass is explicitly false", () => {
    const gtag = installWindow(false, "false");

    expect(trackGoogleAdsWebsiteConversion("pricing_viewed")).toBe(false);
    expect(gtag).not.toHaveBeenCalled();
  });
});
