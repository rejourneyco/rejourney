import { afterEach, describe, expect, it, vi } from "vitest";

import { trackAccountActivationConversion } from "./googleAdsSignals";
import { GOOGLE_ADS_CONSENT_STORAGE_KEY } from "./googleAdsConsent";

const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");

function setTestWindow(value: unknown) {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value,
  });
}

function acceptedGoogleAdsStorage() {
  return {
    getItem: (key: string) => key === GOOGLE_ADS_CONSENT_STORAGE_KEY ? "accepted" : null,
  };
}

function restoreWindow() {
  if (originalWindowDescriptor) {
    Object.defineProperty(globalThis, "window", originalWindowDescriptor);
    return;
  }

  delete (globalThis as { window?: unknown }).window;
}

describe("Google Ads account activation conversion", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    restoreWindow();
  });

  it("sends the signup conversion when the conversion label is configured", () => {
    const gtag = vi.fn();
    setTestWindow({
      ENV: {
        VITE_GOOGLE_ADS_CONVERSION_ID: "18175283670",
        VITE_GOOGLE_ADS_SIGNUP_CONVERSION_LABEL: "Rt-7COH-3cccENaj09pD",
      },
      gtag,
      localStorage: acceptedGoogleAdsStorage(),
    });

    trackAccountActivationConversion("otp", {
      userId: "user-123",
      email: " Person@Example.com ",
    });

    expect(gtag).toHaveBeenCalledWith("set", "user_data", {
      email: "person@example.com",
    });
    expect(gtag).toHaveBeenCalledWith("event", "conversion", {
      send_to: "AW-18175283670/Rt-7COH-3cccENaj09pD",
      transaction_id: "signup_completed:user-123",
    });
  });

  it("sends the conversion only once per page lifecycle", () => {
    const gtag = vi.fn();
    setTestWindow({
      ENV: {
        VITE_GOOGLE_ADS_CONVERSION_ID: "AW-18175283670",
        VITE_GOOGLE_ADS_SIGNUP_CONVERSION_LABEL: "Rt-7COH-3cccENaj09pD",
      },
      gtag,
      localStorage: acceptedGoogleAdsStorage(),
    });

    trackAccountActivationConversion("otp");
    trackAccountActivationConversion("otp");

    expect(gtag).toHaveBeenCalledTimes(1);
  });

  it("does not send a conversion when the conversion label is missing", () => {
    const gtag = vi.fn();
    setTestWindow({
      ENV: {
        VITE_GOOGLE_ADS_CONVERSION_ID: "AW-18175283670",
      },
      gtag,
      localStorage: acceptedGoogleAdsStorage(),
    });

    trackAccountActivationConversion("github");

    expect(gtag).not.toHaveBeenCalled();
  });

  it("sends the conversion without waiting for the telemetry prompt during testing", () => {
    const gtag = vi.fn();
    setTestWindow({
      ENV: {
        VITE_GOOGLE_ADS_CONVERSION_ID: "AW-18175283670",
        VITE_GOOGLE_ADS_SIGNUP_CONVERSION_LABEL: "Rt-7COH-3cccENaj09pD",
      },
      gtag,
      localStorage: { getItem: () => null },
    });

    trackAccountActivationConversion("otp", {
      userId: "user-123",
      email: "person@example.com",
    });

    expect(gtag).toHaveBeenCalledWith("set", "user_data", {
      email: "person@example.com",
    });
    expect(gtag).toHaveBeenCalledWith("event", "conversion", {
      send_to: "AW-18175283670/Rt-7COH-3cccENaj09pD",
      transaction_id: "signup_completed:user-123",
    });
  });

  it("does not fail account activation when gtag is unavailable", () => {
    setTestWindow({
      ENV: {
        VITE_GOOGLE_ADS_CONVERSION_ID: "AW-18175283670",
        VITE_GOOGLE_ADS_SIGNUP_CONVERSION_LABEL: "Rt-7COH-3cccENaj09pD",
      },
      localStorage: acceptedGoogleAdsStorage(),
    });

    expect(() => trackAccountActivationConversion("github")).not.toThrow();
  });
});
