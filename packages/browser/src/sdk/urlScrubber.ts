import { SENSITIVE_QUERY_KEYS } from './constants.js';

const MAX_URL_LENGTH = 2048;
const MAX_QUERY_VALUE_LENGTH = 256;
const MAX_PATH_SEGMENT_LENGTH = 128;
const REDACTED = '[REDACTED]';

const SENSITIVE_PATH_KEYS = [
  ...SENSITIVE_QUERY_KEYS,
  'reset',
  'verify',
  'verification',
  'confirm',
  'confirmation',
  'login',
  'sso',
  'oauth',
  'callback',
];

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function looksLikeSensitivePathValue(value: string): boolean {
  const decoded = safeDecodeURIComponent(value).trim();
  if (!decoded) return false;
  if (/^[^@\s/]+@[^@\s/]+\.[^@\s/]+$/.test(decoded)) return true;
  if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(decoded)) return true;
  if (/^[0-9a-f]{24,}$/i.test(decoded)) return true;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(decoded)) return true;
  if (/^\+?[0-9][0-9 .()_-]{7,}[0-9]$/.test(decoded)) return true;
  if (decoded.length >= 32 && /^[A-Za-z0-9._~+/=-]+$/.test(decoded) && /[A-Za-z]/.test(decoded) && /\d/.test(decoded)) {
    return true;
  }
  return false;
}

function isSensitivePathKey(value: string): boolean {
  const decoded = safeDecodeURIComponent(value).toLowerCase();
  return SENSITIVE_PATH_KEYS.some((key) => decoded.includes(key));
}

function looksLikeInlineSensitivePathSegment(value: string): boolean {
  const decoded = safeDecodeURIComponent(value).toLowerCase();
  return decoded.length >= 24 && /[._-]/.test(decoded) && isSensitivePathKey(decoded);
}

function scrubPathname(pathname: string): string {
  const segments = pathname.split('/');
  return segments.map((segment, index) => {
    if (!segment) return segment;
    const previous = index > 0 ? segments[index - 1] ?? '' : '';
    if (
      isSensitivePathKey(previous) ||
      looksLikeSensitivePathValue(segment) ||
      looksLikeInlineSensitivePathSegment(segment)
    ) {
      return REDACTED;
    }
    return truncate(segment, MAX_PATH_SEGMENT_LENGTH);
  }).join('/');
}

export function scrubUrl(url: string, options: { allowedQueryParams?: string[]; pathOnly?: boolean } = {}): string {
  if (!url) return '';
  try {
    const parsed = new URL(url, typeof window !== 'undefined' ? window.location.href : 'https://example.com');
    const allowed = new Set((options.allowedQueryParams || []).map((key) => key.toLowerCase()));
    const scrubbed = new URL(parsed.href);
    const pathname = scrubPathname(scrubbed.pathname);

    for (const key of Array.from(scrubbed.searchParams.keys())) {
      const lower = key.toLowerCase();
      if (SENSITIVE_QUERY_KEYS.some((sensitive) => lower.includes(sensitive))) {
        scrubbed.searchParams.set(key, REDACTED);
      } else if (allowed.size > 0 && !allowed.has(lower)) {
        scrubbed.searchParams.delete(key);
      } else {
        const value = scrubbed.searchParams.get(key);
        if (value && value.length > MAX_QUERY_VALUE_LENGTH) {
          scrubbed.searchParams.set(key, value.slice(0, MAX_QUERY_VALUE_LENGTH));
        }
      }
    }

    const result = options.pathOnly
      ? `${pathname}${scrubbed.search}`
      : `${scrubbed.origin}${pathname}${scrubbed.search}`;
    return truncate(result, MAX_URL_LENGTH);
  } catch {
    let scrubbed = url;
    for (const key of SENSITIVE_QUERY_KEYS) {
      const regex = new RegExp(`([?&])([^&=]*${key}[^&=]*)=[^&]*`, 'gi');
      scrubbed = scrubbed.replace(regex, `$1$2=${REDACTED}`);
    }
    scrubbed = scrubbed.replace(/#.*/, '');
    return truncate(scrubbed, MAX_URL_LENGTH);
  }
}

export function referrerDomain(referrer: string): string | null {
  if (!referrer) return null;
  try {
    return new URL(referrer).hostname;
  } catch {
    return null;
  }
}
