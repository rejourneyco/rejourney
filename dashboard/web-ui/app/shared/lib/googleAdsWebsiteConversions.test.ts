import { afterEach, describe, expect, it, vi } from "vitest";

import { GOOGLE_ADS_CONSENT_STORAGE_KEY } from "./googleAdsConsent";
import {
  getGoogleAdsPageConversionRule,
  trackGoogleAdsWebsiteConversion,
} from "./googleAdsWebsiteConversions";

const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");

function installWindow() {
  const values = new Map([[GOOGLE_ADS_CONSENT_STORAGE_KEY, "accepted"]]);
  const sessionValues = new Map<string, string>();
  const gtag = vi.fn();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      ENV: {
        VITE_GOOGLE_ADS_CONVERSION_ID: "AW-123",
        VITE_GOOGLE_ADS_DEMO_OPENED_CONVERSION_LABEL: "demo-label",
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
});
