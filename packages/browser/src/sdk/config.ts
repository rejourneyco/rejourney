import { DEFAULT_ALLOWED_ATTRIBUTION_PARAMS, DEFAULT_API_URL } from './constants.js';
import type { RejourneyWebConfig, RemoteSdkConfig } from './types.js';

export const DEFAULT_WEB_CONFIG: Required<
  Pick<
    RejourneyWebConfig,
    | 'enabled'
    | 'autoStart'
    | 'disableInDev'
    | 'debug'
    | 'observeOnly'
    | 'captureReplay'
    | 'allowedDomains'
    | 'idleTimeout'
    | 'collectGeoLocation'
    | 'captureAttribution'
    | 'autoTrackLinks'
    | 'ignoreBots'
    | 'recordAutomation'
    | 'autoTrackRoutes'
    | 'autoTrackNetwork'
    | 'networkCaptureSizes'
    | 'trackConsoleLogs'
    | 'trackLongTasks'
    | 'trackResourceErrors'
    | 'maskAllInputs'
    | 'imageVideoMasking'
  >
> & {
  apiUrl: string;
  maxSessionDuration: number;
  attribution: NonNullable<RejourneyWebConfig['attribution']>;
  maskInputOptions: Record<string, boolean>;
  blockClass: string;
  blockSelector: string;
  ignoreClass: string;
  ignoreSelector: string;
  maskTextClass: string;
  maskTextSelector: string;
  rrweb: NonNullable<RejourneyWebConfig['rrweb']>;
} = {
  apiUrl: DEFAULT_API_URL,
  enabled: true,
  autoStart: false,
  disableInDev: false,
  debug: false,
  observeOnly: false,
  captureReplay: true,
  allowedDomains: [],
  maxSessionDuration: 30 * 60 * 1000,
  idleTimeout: 60 * 1000,
  collectGeoLocation: true,
  captureAttribution: true,
  autoTrackLinks: true,
  attribution: {
    allowedQueryParams: DEFAULT_ALLOWED_ATTRIBUTION_PARAMS,
    preserveClickIds: false,
    captureReferrer: 'domain-only',
    captureEntryUrl: 'path-only',
  },
  ignoreBots: true,
  recordAutomation: false,
  autoTrackRoutes: true,
  autoTrackNetwork: true,
  networkCaptureSizes: false,
  trackConsoleLogs: true,
  trackLongTasks: false,
  trackResourceErrors: true,
  maskAllInputs: true,
  imageVideoMasking: 'none',
  maskInputOptions: {
    password: true,
    email: true,
    tel: true,
    hidden: true,
    text: false,
    number: true,
    search: false,
    url: false,
  },
  blockClass: 'rr-block',
  ignoreClass: 'rr-ignore',
  maskTextClass: 'rr-mask',
  blockSelector: '[data-rj-block], [data-rejourney-block]',
  ignoreSelector: '[data-rj-ignore], [data-rejourney-ignore]',
  maskTextSelector: '[data-rj-mask], [data-rejourney-mask], [data-private], [data-testid*="password"]',
  rrweb: {
    checkoutEveryNms: 60_000,
    checkoutEveryNth: 200,
    sampling: {
      mousemove: 50,
      scroll: 150,
      media: 800,
      input: 'last',
    },
    inlineStylesheet: true,
    inlineImages: false,
    collectFonts: false,
    captureAssets: {
      objectURLs: false,
      origins: false,
      images: false,
      stylesheets: 'without-fetch',
      processStylesheetsWithin: 2000,
    },
    recordCanvas: false,
  },
};

export function normalizeBaseUrl(url: string | undefined, fallback: string): string {
  const value = (url || fallback).trim();
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function normalizeAllowedDomain(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  let candidate = value.trim().toLowerCase();
  if (!candidate) return null;
  candidate = candidate.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  candidate = candidate.replace(/^\/\//, '');
  candidate = candidate.split(/[/?#]/)[0] || '';
  candidate = candidate.replace(/\.$/, '');
  if (!candidate || candidate.includes('@') || /\s/.test(candidate)) return null;

  const wildcard = candidate.startsWith('*.');
  const hostWithPort = wildcard ? candidate.slice(2) : candidate;
  const parts = hostWithPort.split(':');
  if (parts.length > 2) return null;
  const [host, port] = parts;
  if (!host) return null;
  if (port && (!/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535)) return null;
  const validHost = host === 'localhost' ||
    /^\d{1,3}(\.\d{1,3}){3}$/.test(host) ||
    (host.includes('.') && host.split('.').every((label) => (
      /^[a-z0-9-]{1,63}$/.test(label) && !label.startsWith('-') && !label.endsWith('-')
    )));
  if (!validHost || (wildcard && (host === 'localhost' || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)))) return null;
  return `${wildcard ? '*.' : ''}${host}${port ? `:${port}` : ''}`;
}

function normalizeAllowedDomains(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const domains: string[] = [];
  for (const value of values) {
    const normalized = normalizeAllowedDomain(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    domains.push(normalized);
  }
  return domains;
}

function splitHostPort(value: string): { host: string; port: string | null; wildcard: boolean } | null {
  const normalized = normalizeAllowedDomain(value);
  if (!normalized) return null;
  const wildcard = normalized.startsWith('*.');
  const hostWithPort = wildcard ? normalized.slice(2) : normalized;
  const [host, port] = hostWithPort.split(':');
  if (!host) return null;
  return { host, port: port || null, wildcard };
}

export function isDomainAllowed(currentHost: string | undefined, allowedDomains: unknown): boolean {
  const normalizedAllowed = normalizeAllowedDomains(allowedDomains);
  if (normalizedAllowed.length === 0) return false;
  const current = currentHost ? splitHostPort(currentHost) : null;
  if (!current) return false;

  return normalizedAllowed.some((allowed) => {
    const rule = splitHostPort(allowed);
    if (!rule) return false;
    if (rule.port && rule.port !== current.port) return false;
    if (rule.wildcard) return current.host.endsWith(`.${rule.host}`);
    return rule.host === current.host;
  });
}

export function mergeWebConfig(publicKey: string, options: RejourneyWebConfig = {}): RejourneyWebConfig {
  return {
    ...DEFAULT_WEB_CONFIG,
    ...options,
    publicKey: options.publicKey || publicKey,
    apiUrl: normalizeBaseUrl(options.apiUrl, DEFAULT_WEB_CONFIG.apiUrl),
    allowedDomains: normalizeAllowedDomains(options.allowedDomains),
    attribution: {
      ...DEFAULT_WEB_CONFIG.attribution,
      ...(options.attribution || {}),
    },
    maskInputOptions: {
      ...DEFAULT_WEB_CONFIG.maskInputOptions,
      ...(options.maskInputOptions || {}),
    },
    rrweb: {
      ...DEFAULT_WEB_CONFIG.rrweb,
      ...(options.rrweb || {}),
      captureAssets: {
        ...DEFAULT_WEB_CONFIG.rrweb.captureAssets,
        ...(options.rrweb?.captureAssets || {}),
      },
    },
  };
}

export function applyRemoteConfig(local: RejourneyWebConfig, remote: RemoteSdkConfig): RejourneyWebConfig {
  const remoteEnabled = remote.enabled ?? remote.rejourneyEnabled;
  const remoteRecording = remote.recording ?? remote.recordingEnabled;
  const remoteMaxSessionMinutes = typeof remote.webMaxObservabilityMinutes === 'number'
    ? remote.webMaxObservabilityMinutes
    : remote.maxRecordingMinutes;
  const maxSessionDuration = typeof remoteMaxSessionMinutes === 'number'
    ? remoteMaxSessionMinutes * 60 * 1000
    : local.maxSessionDuration;
  const remoteAllowedDomains = remote.webAllowedDomains
    ? normalizeAllowedDomains(remote.webAllowedDomains)
    : undefined;
  const remoteImageVideoMasking = remote.imageVideoMasking === 'all' || remote.imageVideoMasking === 'none'
    ? remote.imageVideoMasking
    : undefined;

  return {
    ...local,
    enabled: remote.disabled ? false : (remoteEnabled ?? local.enabled),
    captureReplay: (remoteRecording ?? local.captureReplay) && local.captureReplay !== false,
    allowedDomains: remoteAllowedDomains ?? local.allowedDomains,
    maxSessionDuration,
    imageVideoMasking: remoteImageVideoMasking ?? local.imageVideoMasking,
    ...(remote.textInputMasking === 'secure_only'
      ? { maskAllInputs: false }
      : remote.textInputMasking === 'all'
        ? { maskAllInputs: true }
        : {}),
  };
}

export async function fetchRemoteConfig(config: RejourneyWebConfig): Promise<RemoteSdkConfig> {
  const publicKey = config.publicKey;
  if (!publicKey) throw new Error('Missing Rejourney public key');

  const response = await fetch(`${normalizeBaseUrl(config.apiUrl, DEFAULT_API_URL)}/api/sdk/config`, {
    method: 'GET',
    headers: {
      'x-public-key': publicKey,
      'x-platform': 'web',
      'accept': 'application/json',
    },
    credentials: 'omit',
  });

  if (!response.ok) {
    const message = await response.text().catch(() => response.statusText);
    config.onAuthError?.({ code: response.status, message: message || response.statusText });
    throw new Error(`Failed to fetch Rejourney config: ${response.status}`);
  }

  return response.json() as Promise<RemoteSdkConfig>;
}

export function isSampledIn(sampleRate: number | undefined): boolean {
  const normalized = typeof sampleRate === 'number' && Number.isFinite(sampleRate)
    ? Math.max(0, Math.min(100, sampleRate))
    : 100;
  if (normalized >= 100) return true;
  if (normalized <= 0) return false;
  return Math.random() * 100 < normalized;
}
