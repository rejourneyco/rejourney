/**
 * Copyright 2026 Rejourney
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Network Interceptor for Rejourney - Optimized Version
 * 
 * Automatically intercepts fetch() and XMLHttpRequest to log API calls.
 * 
 * PERFORMANCE OPTIMIZATIONS:
 * - Minimal synchronous overhead (just captures timing, no processing)
 * - Batched async logging (doesn't block requests)
 * - Circular buffer with max size limit
 * - Sampling for high-frequency endpoints
 * - No string allocations in hot path
 * - Lazy URL parsing
 * - PII Scrubbing for query parameters
 */

import type { NetworkRequestParams } from '../types';

let originalFetch: typeof fetch | null = null;
let originalXHROpen: typeof XMLHttpRequest.prototype.open | null = null;
let originalXHRSend: typeof XMLHttpRequest.prototype.send | null = null;

let logCallback: ((request: NetworkRequestParams) => void) | null = null;

const MAX_PENDING_REQUESTS = 100;
const pendingRequests: (NetworkRequestParams | null)[] = new Array(MAX_PENDING_REQUESTS).fill(null);
let pendingHead = 0;
let pendingTail = 0;
let pendingCount = 0;

let flushTimer: ReturnType<typeof setTimeout> | null = null;
const FLUSH_INTERVAL = 500;

const endpointCounts = new Map<string, { count: number; lastReset: number }>();
const SAMPLE_WINDOW = 10000;
const MAX_PER_ENDPOINT = 20;

const config = {
  enabled: true,
  ignorePatterns: [] as string[],
  maxUrlLength: 300,
  captureSizes: false,
};

const SENSITIVE_KEYS = ['token', 'key', 'secret', 'password', 'auth', 'access_token', 'api_key'];

function getUtf8Size(text: string): number {
  if (!text) return 0;
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(text).length;
  }
  return text.length;
}

function getBodySize(body: unknown): number {
  if (body == null) return 0;

  if (typeof body === 'string') return getUtf8Size(body);

  if (typeof ArrayBuffer !== 'undefined' && body instanceof ArrayBuffer) {
    return body.byteLength;
  }

  if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(body as any)) {
    return (body as ArrayBufferView).byteLength;
  }

  if (typeof Blob !== 'undefined' && body instanceof Blob) {
    return body.size;
  }

  if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) {
    return getUtf8Size(body.toString());
  }

  return 0;
}

async function getFetchResponseSize(response: Response): Promise<number> {
  const contentLength = response.headers?.get?.('content-length');
  if (contentLength) {
    const parsed = parseInt(contentLength, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }

  try {
    const cloned = response.clone();
    const buffer = await cloned.arrayBuffer();
    return buffer.byteLength;
  } catch {
    return 0;
  }
}

function getXhrResponseSize(xhr: XMLHttpRequest): number {
  try {
    const contentLength = xhr.getResponseHeader('content-length');
    if (contentLength) {
      const parsed = parseInt(contentLength, 10);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
  } catch {
    // Ignore header access errors and fall through to body inspection.
  }

  const responseType = xhr.responseType;

  if (responseType === '' || responseType === 'text') {
    return getUtf8Size(xhr.responseText || '');
  }

  if (responseType === 'arraybuffer') {
    return typeof ArrayBuffer !== 'undefined' && xhr.response instanceof ArrayBuffer
      ? xhr.response.byteLength
      : 0;
  }

  if (responseType === 'blob') {
    return typeof Blob !== 'undefined' && xhr.response instanceof Blob
      ? xhr.response.size
      : 0;
  }

  if (responseType === 'json') {
    try {
      return getUtf8Size(JSON.stringify(xhr.response ?? ''));
    } catch {
      return 0;
    }
  }

  return 0;
}

/**
 * Scrub sensitive data from URL
 */
function scrubUrl(url: string): string {
  try {
    if (url.indexOf('?') === -1) return url;

    const urlObj = new URL(url);
    let modified = false;

    SENSITIVE_KEYS.forEach(key => {
      if (urlObj.searchParams.has(key)) {
        urlObj.searchParams.set(key, '[REDACTED]');
        modified = true;
      }
    });

    return modified ? urlObj.toString() : url;
  } catch {
    // Ignore error, fallback to primitive scrubbing

    let scrubbed = url;
    SENSITIVE_KEYS.forEach(key => {
      const regex = new RegExp(`([?&])${key}=[^&]*`, 'gi');
      scrubbed = scrubbed.replace(regex, `$1${key}=[REDACTED]`);
    });
    return scrubbed;
  }
}

/**
 * Fast check if URL should be ignored (no regex for speed)
 */
function shouldIgnoreUrl(url: string): boolean {
  const patterns = config.ignorePatterns;
  for (let i = 0; i < patterns.length; i++) {
    const pattern = patterns[i];
    if (pattern && url.indexOf(pattern) !== -1) return true;
  }
  return false;
}

/**
 * Check if we should sample this request (rate limiting per endpoint)
 */
function shouldSampleRequest(urlPath: string): boolean {
  const now = Date.now();
  let entry = endpointCounts.get(urlPath);

  if (!entry || now - entry.lastReset > SAMPLE_WINDOW) {
    entry = { count: 0, lastReset: now };
    endpointCounts.set(urlPath, entry);
  }

  entry.count++;
  return entry.count <= MAX_PER_ENDPOINT;
}

/**
 * Add request to pending buffer (non-blocking)
 */
function queueRequest(request: NetworkRequestParams): void {
  if (pendingCount >= MAX_PENDING_REQUESTS) {
    // Buffer full, drop oldest
    pendingHead = (pendingHead + 1) % MAX_PENDING_REQUESTS;
    pendingCount--;
  }

  request.url = scrubUrl(request.url);

  pendingRequests[pendingTail] = request;
  pendingTail = (pendingTail + 1) % MAX_PENDING_REQUESTS;
  pendingCount++;

  if (!flushTimer) {
    flushTimer = setTimeout(flushPendingRequests, FLUSH_INTERVAL);
  }
}

/**
 * Flush pending requests to callback
 */
function flushPendingRequests(): void {
  flushTimer = null;

  if (!logCallback || pendingCount === 0) return;
  while (pendingCount > 0) {
    const request = pendingRequests[pendingHead];
    pendingRequests[pendingHead] = null; // Allow GC
    pendingHead = (pendingHead + 1) % MAX_PENDING_REQUESTS;
    pendingCount--;

    if (request) {
      try {
        logCallback(request);
      } catch {
        // Ignore
      }
    }
  }
}

/**
 * Parse URL efficiently (only extract what we need)
 */
function parseUrlFast(url: string): { host: string; path: string } {
  // Fast path for common patterns
  let hostEnd = -1;
  let pathStart = -1;

  const protoEnd = url.indexOf('://');
  if (protoEnd !== -1) {
    const afterProto = protoEnd + 3;
    const slashPos = url.indexOf('/', afterProto);
    if (slashPos !== -1) {
      hostEnd = slashPos;
      pathStart = slashPos;
    } else {
      hostEnd = url.length;
      pathStart = url.length;
    }

    return {
      host: url.substring(afterProto, hostEnd),
      path: pathStart < url.length ? url.substring(pathStart) : '/',
    };
  }

  return { host: '', path: url };
}

/**
 * Intercept fetch - minimal overhead version
 */
function interceptFetch(): void {
  if (typeof globalThis.fetch === 'undefined') return;
  if (originalFetch) return;

  originalFetch = globalThis.fetch;

  globalThis.fetch = function optimizedFetch(
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> {
    if (!config.enabled || !logCallback) {
      return originalFetch!(input, init);
    }

    const url = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : (input as Request).url;

    if (shouldIgnoreUrl(url)) {
      return originalFetch!(input, init);
    }

    // Parse URL and check sampling
    const { path } = parseUrlFast(url);
    if (!shouldSampleRequest(path)) {
      return originalFetch!(input, init);
    }

    const startTime = Date.now();
    const method = ((init?.method || 'GET').toUpperCase()) as NetworkRequestParams['method'];

    const requestBodySize = config.captureSizes ? getBodySize(init?.body) : 0;

    return originalFetch!(input, init).then(
      async (response) => {
        const responseBodySize = config.captureSizes
          ? await getFetchResponseSize(response)
          : 0;

        queueRequest({
          requestId: `f${startTime}`,
          method,
          url: url.length > config.maxUrlLength ? url.substring(0, config.maxUrlLength) : url,
          statusCode: response.status,
          duration: Date.now() - startTime,
          startTimestamp: startTime,
          endTimestamp: Date.now(),
          success: response.ok,
          requestBodySize,
          responseBodySize,
        });
        return response;
      },
      (error) => {
        queueRequest({
          requestId: `f${startTime}`,
          method,
          url: url.length > config.maxUrlLength ? url.substring(0, config.maxUrlLength) : url,
          statusCode: 0,
          duration: Date.now() - startTime,
          startTimestamp: startTime,
          endTimestamp: Date.now(),
          success: false,
          errorMessage: error?.message || 'Network error',
          requestBodySize,
        });
        throw error;
      }
    );
  };
}

/**
 * Intercept XMLHttpRequest - minimal overhead version
 */
function interceptXHR(): void {
  if (typeof XMLHttpRequest === 'undefined') return;
  if (originalXHROpen) return;

  originalXHROpen = XMLHttpRequest.prototype.open;
  originalXHRSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (
    method: string,
    url: string | URL,
    async: boolean = true,
    username?: string | null,
    password?: string | null
  ): void {
    const urlString = typeof url === 'string' ? url : url.toString();

    (this as any).__rj = {
      m: method.toUpperCase(),
      u: urlString,
      t: 0,
    };

    return originalXHROpen!.call(this, method, urlString, async, username, password);
  };

  XMLHttpRequest.prototype.send = function (body?: any): void {
    const data = (this as any).__rj;

    if (!config.enabled || !logCallback || !data || shouldIgnoreUrl(data.u)) {
      return originalXHRSend!.call(this, body);
    }
    const { path } = parseUrlFast(data.u);
    if (!shouldSampleRequest(path)) {
      return originalXHRSend!.call(this, body);
    }

    if (config.captureSizes && body) {
      data.reqSize = getBodySize(body);
    } else {
      data.reqSize = 0;
    }

    data.t = Date.now();

    const onComplete = () => {
      const endTime = Date.now();

      const responseBodySize = config.captureSizes ? getXhrResponseSize(this) : 0;

      queueRequest({
        requestId: `x${data.t}`,
        method: data.m as NetworkRequestParams['method'],
        url: data.u.length > config.maxUrlLength ? data.u.substring(0, config.maxUrlLength) : data.u,
        statusCode: this.status,
        duration: endTime - data.t,
        startTimestamp: data.t,
        endTimestamp: endTime,
        success: this.status >= 200 && this.status < 400,
        errorMessage: this.status === 0 ? 'Network error' : undefined,
        requestBodySize: data.reqSize,
        responseBodySize,
      });
    };

    this.addEventListener('load', onComplete);
    this.addEventListener('error', onComplete);
    this.addEventListener('abort', onComplete);

    return originalXHRSend!.call(this, body);
  };
}

/**
 * Initialize network interception
 */
export function initNetworkInterceptor(
  callback: (request: NetworkRequestParams) => void,
  options?: {
    ignoreUrls?: (string | RegExp)[];
    captureSizes?: boolean;
  }
): void {
  logCallback = callback;

  if (options?.ignoreUrls) {
    config.ignorePatterns = options.ignoreUrls
      .filter((p): p is string => typeof p === 'string');
  }

  if (options?.captureSizes !== undefined) {
    config.captureSizes = options.captureSizes;
  }

  interceptFetch();
  interceptXHR();
}

/**
 * Disable network interception
 */
export function disableNetworkInterceptor(): void {
  config.enabled = false;

  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  flushPendingRequests();
}

/**
 * Re-enable network interception
 */
export function enableNetworkInterceptor(): void {
  config.enabled = true;
}

/**
 * Force flush pending requests (call before app termination)
 */
export function flushNetworkRequests(): void {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  flushPendingRequests();
}

/**
 * Restore original fetch and XHR
 */
export function restoreNetworkInterceptor(): void {
  if (originalFetch) {
    globalThis.fetch = originalFetch;
    originalFetch = null;
  }

  if (originalXHROpen && originalXHRSend) {
    XMLHttpRequest.prototype.open = originalXHROpen;
    XMLHttpRequest.prototype.send = originalXHRSend;
    originalXHROpen = null;
    originalXHRSend = null;
  }

  logCallback = null;

  // Clear state
  pendingHead = 0;
  pendingTail = 0;
  pendingCount = 0;
  endpointCounts.clear();

  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
}

/**
 * Get stats for debugging
 */
export function getNetworkInterceptorStats(): {
  pendingCount: number;
  endpointCount: number;
  enabled: boolean;
} {
  return {
    pendingCount,
    endpointCount: endpointCounts.size,
    enabled: config.enabled,
  };
}
