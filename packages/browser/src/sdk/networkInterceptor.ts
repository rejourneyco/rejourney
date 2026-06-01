import { scrubUrl } from './urlScrubber.js';
import type { NetworkRequestParams, RejourneyWebConfig } from './types.js';

let originalFetch: typeof fetch | null = null;
let originalXHROpen: typeof XMLHttpRequest.prototype.open | null = null;
let originalXHRSend: typeof XMLHttpRequest.prototype.send | null = null;
let requestCallback: ((request: NetworkRequestParams) => void) | null = null;
let currentConfig: RejourneyWebConfig | null = null;

function bodySize(body: unknown): number {
  if (!body) return 0;
  if (typeof body === 'string') return new TextEncoder().encode(body).byteLength;
  if (body instanceof ArrayBuffer) return body.byteLength;
  if (ArrayBuffer.isView(body)) return body.byteLength;
  if (typeof Blob !== 'undefined' && body instanceof Blob) return body.size;
  if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) return body.toString().length;
  return 0;
}

const INTERNAL_NETWORK_PATH_PREFIXES = [
  '/api/sdk/config',
  '/api/ingest',
  '/upload/artifacts',
] as const;
const MAX_REGISTERED_INTERNAL_URLS = 200;

const registeredInternalUrls = new Set<string>();
const registeredInternalUrlOrder: string[] = [];

function normalizePath(path: string): string {
  const withLeadingSlash = path.startsWith('/') ? path : `/${path}`;
  return withLeadingSlash.length > 1 ? withLeadingSlash.replace(/\/+$/, '') : withLeadingSlash;
}

function basePathForUrl(url: string | undefined): string {
  if (!url) return '';
  try {
    const parsed = new URL(url, typeof window !== 'undefined' ? window.location.href : 'http://rejourney.local');
    return parsed.pathname && parsed.pathname !== '/' ? normalizePath(parsed.pathname) : '';
  } catch {
    return '';
  }
}

function pathForUrl(url: string): string {
  try {
    const parsed = new URL(url, typeof window !== 'undefined' ? window.location.href : 'http://rejourney.local');
    return normalizePath(parsed.pathname || '/');
  } catch {
    return normalizePath((url.split('?')[0] || url).split('#')[0] || '/');
  }
}

function normalizeUrlForComparison(url: string): string | null {
  try {
    const parsed = new URL(url, typeof window !== 'undefined' ? window.location.href : 'http://rejourney.local');
    parsed.hash = '';
    return parsed.toString();
  } catch {
    const trimmed = url.trim();
    const withoutHash = trimmed.split('#')[0];
    return withoutHash || null;
  }
}

function hasInternalPathPrefix(path: string, config: RejourneyWebConfig): boolean {
  const normalizedPath = normalizePath(path);
  const apiBasePath = basePathForUrl(config.apiUrl);
  const prefixes = apiBasePath
    ? [
        ...INTERNAL_NETWORK_PATH_PREFIXES,
        ...INTERNAL_NETWORK_PATH_PREFIXES.map((prefix) => normalizePath(`${apiBasePath}${prefix}`)),
      ]
    : INTERNAL_NETWORK_PATH_PREFIXES;

  return prefixes.some((prefix) => normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`));
}

function isRegisteredInternalUrl(url: string): boolean {
  const normalizedUrl = normalizeUrlForComparison(url);
  return Boolean(normalizedUrl && registeredInternalUrls.has(normalizedUrl));
}

export function registerInternalNetworkUrl(url: string): void {
  const normalizedUrl = normalizeUrlForComparison(url);
  if (!normalizedUrl || registeredInternalUrls.has(normalizedUrl)) return;
  registeredInternalUrls.add(normalizedUrl);
  registeredInternalUrlOrder.push(normalizedUrl);

  while (registeredInternalUrlOrder.length > MAX_REGISTERED_INTERNAL_URLS) {
    const evicted = registeredInternalUrlOrder.shift();
    if (evicted) registeredInternalUrls.delete(evicted);
  }
}

export function shouldIgnoreNetworkUrl(url: string, config: RejourneyWebConfig): boolean {
  if (isRegisteredInternalUrl(url) || hasInternalPathPrefix(pathForUrl(url), config)) {
    return true;
  }

  const ignoreUrls = config.networkIgnoreUrls || [];

  return ignoreUrls.some((pattern) => {
    if (!pattern) return false;
    if (typeof pattern === 'string') return url.includes(pattern);
    pattern.lastIndex = 0;
    return pattern.test(url);
  });
}

function queueNetworkRequest(request: NetworkRequestParams): void {
  if (!requestCallback || !currentConfig) return;
  const processed = currentConfig.beforeSendNetwork?.(request) ?? request;
  if (!processed) return;
  requestCallback(processed);
}

function responseSize(response: Response): number {
  const contentLength = response.headers.get('content-length');
  if (!contentLength) return 0;
  const parsed = Number(contentLength);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function initNetworkInterceptor(
  callback: (request: NetworkRequestParams) => void,
  config: RejourneyWebConfig,
): void {
  if (typeof window === 'undefined') return;
  requestCallback = callback;
  currentConfig = config;

  if (!originalFetch && typeof window.fetch === 'function') {
    originalFetch = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const startedAt = Date.now();
      const url = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
      const method = (init?.method || (typeof input !== 'string' && !(input instanceof URL) ? input.method : undefined) || 'GET').toUpperCase();

      if (shouldIgnoreNetworkUrl(url, config)) {
        return originalFetch!(input, init);
      }

      try {
        const response = await originalFetch!(input, init);
        const endedAt = Date.now();
        queueNetworkRequest({
          requestId: `req_${startedAt}_${Math.random().toString(36).slice(2)}`,
          url: scrubUrl(url),
          method,
          statusCode: response.status,
          success: response.ok,
          duration: endedAt - startedAt,
          startTimestamp: startedAt,
          endTimestamp: endedAt,
          requestBodySize: config.networkCaptureSizes ? bodySize(init?.body) : 0,
          responseBodySize: config.networkCaptureSizes ? responseSize(response) : 0,
          requestContentType: init?.headers instanceof Headers ? init.headers.get('content-type') : null,
          responseContentType: response.headers.get('content-type'),
        });
        return response;
      } catch (error) {
        const endedAt = Date.now();
        queueNetworkRequest({
          requestId: `req_${startedAt}_${Math.random().toString(36).slice(2)}`,
          url: scrubUrl(url),
          method,
          statusCode: 0,
          success: false,
          duration: endedAt - startedAt,
          startTimestamp: startedAt,
          endTimestamp: endedAt,
          errorMessage: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    };
  }

  if (!originalXHROpen && typeof XMLHttpRequest !== 'undefined') {
    originalXHROpen = XMLHttpRequest.prototype.open;
    originalXHRSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function patchedOpen(
      method: string,
      url: string | URL,
      async?: boolean,
      username?: string | null,
      password?: string | null,
    ) {
      const xhr = this as XMLHttpRequest & { __rjMethod?: string; __rjUrl?: string; __rjStart?: number; __rjBodySize?: number };
      xhr.__rjMethod = String(method || 'GET').toUpperCase();
      xhr.__rjUrl = String(url);
      return originalXHROpen!.call(this, method, String(url), async ?? true, username ?? null, password ?? null);
    };

    XMLHttpRequest.prototype.send = function patchedSend(body?: Document | XMLHttpRequestBodyInit | null) {
      const xhr = this as XMLHttpRequest & { __rjMethod?: string; __rjUrl?: string; __rjStart?: number; __rjBodySize?: number };
      const url = xhr.__rjUrl || '';
      if (!shouldIgnoreNetworkUrl(url, config)) {
        xhr.__rjStart = Date.now();
        xhr.__rjBodySize = config.networkCaptureSizes ? bodySize(body) : 0;
        xhr.addEventListener('loadend', () => {
          const endedAt = Date.now();
          const status = xhr.status || 0;
          queueNetworkRequest({
            requestId: `xhr_${xhr.__rjStart}_${Math.random().toString(36).slice(2)}`,
            url: scrubUrl(url),
            method: xhr.__rjMethod || 'GET',
            statusCode: status,
            success: status >= 200 && status < 400,
            duration: endedAt - (xhr.__rjStart || endedAt),
            startTimestamp: xhr.__rjStart,
            endTimestamp: endedAt,
            requestBodySize: xhr.__rjBodySize,
            responseBodySize: config.networkCaptureSizes ? Number(xhr.getResponseHeader('content-length') || 0) : 0,
            responseContentType: xhr.getResponseHeader('content-type'),
          });
        });
      }
      return originalXHRSend!.call(this, body);
    };
  }
}

export function disableNetworkInterceptor(): void {
  if (originalFetch && typeof window !== 'undefined') {
    window.fetch = originalFetch;
  }
  if (originalXHROpen && originalXHRSend && typeof XMLHttpRequest !== 'undefined') {
    XMLHttpRequest.prototype.open = originalXHROpen;
    XMLHttpRequest.prototype.send = originalXHRSend;
  }
  originalFetch = null;
  originalXHROpen = null;
  originalXHRSend = null;
  requestCallback = null;
  currentConfig = null;
}
