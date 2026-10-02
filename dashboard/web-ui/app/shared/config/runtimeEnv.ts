export interface RuntimeEnvSnapshot {
  VITE_STRIPE_PUBLISHABLE_KEY?: string;
  VITE_MAPBOX_TOKEN?: string;
  VITE_TURNSTILE_SITE_KEY?: string;

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

    SHOW_ISSUE_DETECTION_UI: readRuntimeEnvValue("SHOW_ISSUE_DETECTION_UI"),
  };
}

export function getStripePublishableKey(): string {
  return getRuntimeEnvSnapshot().VITE_STRIPE_PUBLISHABLE_KEY || "";
}

export function getMapboxToken(): string {
  return getRuntimeEnvSnapshot().VITE_MAPBOX_TOKEN || "";
}

export function isIssueDetectionUiEnabled(pathname?: string): boolean {
  if (pathname && (pathname.startsWith('/demo') || pathname.includes('/demo/'))) {
    return true;
  }
  return getRuntimeEnvSnapshot().SHOW_ISSUE_DETECTION_UI === "true";
}

export function getPublicRuntimeEnvSnapshot(): RuntimeEnvSnapshot {
  const snapshot = getRuntimeEnvSnapshot();

  return {
    VITE_STRIPE_PUBLISHABLE_KEY: snapshot.VITE_STRIPE_PUBLISHABLE_KEY,
    VITE_MAPBOX_TOKEN: snapshot.VITE_MAPBOX_TOKEN,
    VITE_TURNSTILE_SITE_KEY: snapshot.VITE_TURNSTILE_SITE_KEY,

    SHOW_ISSUE_DETECTION_UI: snapshot.SHOW_ISSUE_DETECTION_UI === "true" ? "true" : "false",
  };
}
