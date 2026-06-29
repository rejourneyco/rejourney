export interface RuntimeEnvSnapshot {
  VITE_STRIPE_PUBLISHABLE_KEY?: string;
  VITE_MAPBOX_TOKEN?: string;
  VITE_TURNSTILE_SITE_KEY?: string;
  VITE_GOOGLE_ADS_CONVERSION_ID?: string;
  VITE_GOOGLE_ADS_SIGNUP_CONVERSION_LABEL?: string;
  SHOW_ISSUE_DETECTION_UI?: string;
}

function readRuntimeEnvValue(key: keyof RuntimeEnvSnapshot): string | undefined {
  const fromWindow = typeof window !== "undefined" ? window.ENV?.[key] : undefined;
  const fromProcess = typeof process !== "undefined" ? process.env?.[key] : undefined;
  const fromImportMeta = (import.meta.env as Record<string, string | undefined>)[key];

  return fromWindow || fromProcess || fromImportMeta || undefined;
}

export function getRuntimeEnvSnapshot(): RuntimeEnvSnapshot {
  return {
    VITE_STRIPE_PUBLISHABLE_KEY: readRuntimeEnvValue("VITE_STRIPE_PUBLISHABLE_KEY"),
    VITE_MAPBOX_TOKEN: readRuntimeEnvValue("VITE_MAPBOX_TOKEN"),
    VITE_TURNSTILE_SITE_KEY: readRuntimeEnvValue("VITE_TURNSTILE_SITE_KEY"),
    VITE_GOOGLE_ADS_CONVERSION_ID: readRuntimeEnvValue("VITE_GOOGLE_ADS_CONVERSION_ID"),
    VITE_GOOGLE_ADS_SIGNUP_CONVERSION_LABEL: readRuntimeEnvValue("VITE_GOOGLE_ADS_SIGNUP_CONVERSION_LABEL"),
    SHOW_ISSUE_DETECTION_UI: readRuntimeEnvValue("SHOW_ISSUE_DETECTION_UI"),
  };
}

export function getStripePublishableKey(): string {
  return getRuntimeEnvSnapshot().VITE_STRIPE_PUBLISHABLE_KEY || "";
}

export function getMapboxToken(): string {
  return getRuntimeEnvSnapshot().VITE_MAPBOX_TOKEN || "";
}

export function getGoogleAdsConversionId(): string {
  const rawValue = getRuntimeEnvSnapshot().VITE_GOOGLE_ADS_CONVERSION_ID?.trim();
  if (!rawValue) return "";

  if (/^aw-/i.test(rawValue)) {
    return `AW-${rawValue.slice(3)}`;
  }

  return /^\d+$/.test(rawValue) ? `AW-${rawValue}` : rawValue;
}

export function getGoogleAdsSignupConversionLabel(): string {
  return getRuntimeEnvSnapshot().VITE_GOOGLE_ADS_SIGNUP_CONVERSION_LABEL?.trim() || "";
}

export function isIssueDetectionUiEnabled(): boolean {
  return getRuntimeEnvSnapshot().SHOW_ISSUE_DETECTION_UI === "true";
}

export function getPublicRuntimeEnvSnapshot(): RuntimeEnvSnapshot {
  const snapshot = getRuntimeEnvSnapshot();

  return {
    VITE_STRIPE_PUBLISHABLE_KEY: snapshot.VITE_STRIPE_PUBLISHABLE_KEY,
    VITE_MAPBOX_TOKEN: snapshot.VITE_MAPBOX_TOKEN,
    VITE_TURNSTILE_SITE_KEY: snapshot.VITE_TURNSTILE_SITE_KEY,
    VITE_GOOGLE_ADS_CONVERSION_ID: snapshot.VITE_GOOGLE_ADS_CONVERSION_ID,
    VITE_GOOGLE_ADS_SIGNUP_CONVERSION_LABEL: snapshot.VITE_GOOGLE_ADS_SIGNUP_CONVERSION_LABEL,
    SHOW_ISSUE_DETECTION_UI: snapshot.SHOW_ISSUE_DETECTION_UI === "true" ? "true" : "false",
  };
}
