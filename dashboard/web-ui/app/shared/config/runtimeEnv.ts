export interface RuntimeEnvSnapshot {
  VITE_STRIPE_PUBLISHABLE_KEY?: string;
  VITE_MAPBOX_TOKEN?: string;
  VITE_TURNSTILE_SITE_KEY?: string;

  MCP_SERVER_URL?: string;
}

export const DEFAULT_MCP_SERVER_URL = "https://mcp.rejourney.co/mcp";

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

    MCP_SERVER_URL: readRuntimeEnvValue("MCP_SERVER_URL"),
  };
}

/** Accepts an http(s) override; anything else falls back to the hosted address. */
export function resolveMcpServerUrl(value: string | null | undefined): string {
  const trimmed = (value ?? "").trim();
  return /^https?:\/\/[^\s/]+\S*$/i.test(trimmed) ? trimmed : DEFAULT_MCP_SERVER_URL;
}

export function getMcpServerUrl(): string {
  return resolveMcpServerUrl(getRuntimeEnvSnapshot().MCP_SERVER_URL);
}

export function getStripePublishableKey(): string {
  return getRuntimeEnvSnapshot().VITE_STRIPE_PUBLISHABLE_KEY || "";
}

export function getMapboxToken(): string {
  return getRuntimeEnvSnapshot().VITE_MAPBOX_TOKEN || "";
}

export function getPublicRuntimeEnvSnapshot(): RuntimeEnvSnapshot {
  const snapshot = getRuntimeEnvSnapshot();

  return {
    VITE_STRIPE_PUBLISHABLE_KEY: snapshot.VITE_STRIPE_PUBLISHABLE_KEY,
    VITE_MAPBOX_TOKEN: snapshot.VITE_MAPBOX_TOKEN,
    VITE_TURNSTILE_SITE_KEY: snapshot.VITE_TURNSTILE_SITE_KEY,

    MCP_SERVER_URL: snapshot.MCP_SERVER_URL,
  };
}
