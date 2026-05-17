export function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

export function getLocation(): Location | null {
  return isBrowser() ? window.location : null;
}

export function getNavigator(): Navigator | null {
  return typeof navigator !== 'undefined' ? navigator : null;
}

export function getDocument(): Document | null {
  return typeof document !== 'undefined' ? document : null;
}

export function hasWindowOpener(): boolean {
  if (!isBrowser()) return false;
  try {
    return Boolean(window.opener);
  } catch {
    return false;
  }
}

export function now(): number {
  return Date.now();
}

export function safeSetTimeout(callback: () => void, ms: number): ReturnType<typeof setTimeout> | null {
  if (typeof setTimeout === 'undefined') return null;
  return setTimeout(callback, ms);
}

export function safeClearTimeout(timer: ReturnType<typeof setTimeout> | null | undefined): void {
  if (timer) clearTimeout(timer);
}

export function getCryptoRandomId(bytes = 12): string {
  const cryptoLike = isBrowser() ? window.crypto : undefined;
  if (cryptoLike?.getRandomValues) {
    const values = new Uint8Array(bytes);
    cryptoLike.getRandomValues(values);
    return Array.from(values, (value) => value.toString(16).padStart(2, '0')).join('');
  }

  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

export function getOrigin(): string {
  const location = getLocation();
  return location?.origin ?? '';
}

export function getCurrentUrl(): string {
  const location = getLocation();
  return location?.href ?? '';
}

export function getCurrentPath(): string {
  const location = getLocation();
  return location ? `${location.pathname}${location.search}${location.hash}` : '';
}

export function isLocalDevelopmentHost(hostname: string): boolean {
  return hostname === 'localhost'
    || hostname === '127.0.0.1'
    || hostname === '::1'
    || hostname.endsWith('.local')
    || hostname.endsWith('.localtest.me');
}
