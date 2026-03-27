export interface RuntimeEnvSnapshot {
  VITE_STRIPE_PUBLISHABLE_KEY?: string;
  VITE_MAPBOX_TOKEN?: string;
  VITE_TURNSTILE_SITE_KEY?: string;
}

const DEFAULT_TURNSTILE_SITE_KEY = "0x4AAAAAACFAymkezoYB_TBw";

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
  };
}

export function getStripePublishableKey(): string {
  return getRuntimeEnvSnapshot().VITE_STRIPE_PUBLISHABLE_KEY || "";
}

export function getMapboxToken(): string {
  return getRuntimeEnvSnapshot().VITE_MAPBOX_TOKEN || "";
}

export function getTurnstileSiteKey(): string {
  return getRuntimeEnvSnapshot().VITE_TURNSTILE_SITE_KEY || DEFAULT_TURNSTILE_SITE_KEY;
}

export function getPublicRuntimeEnvSnapshot(): RuntimeEnvSnapshot {
  const snapshot = getRuntimeEnvSnapshot();

  return {
    VITE_STRIPE_PUBLISHABLE_KEY: snapshot.VITE_STRIPE_PUBLISHABLE_KEY,
    VITE_MAPBOX_TOKEN: snapshot.VITE_MAPBOX_TOKEN,
    VITE_TURNSTILE_SITE_KEY: snapshot.VITE_TURNSTILE_SITE_KEY,
  };
}
