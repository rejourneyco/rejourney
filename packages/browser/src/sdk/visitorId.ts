import { getCryptoRandomId, isBrowser } from './browser.js';

const VISITOR_KEY = 'rejourney:web:visitor_id';

export function createSessionId(): string {
  return `session_${Date.now()}_${getCryptoRandomId(16)}`;
}

export function createVisitorId(): string {
  return `web_anon_${getCryptoRandomId(16)}`;
}

export function getOrCreateVisitorId(): string {
  if (!isBrowser()) return createVisitorId();

  try {
    const existing = window.localStorage.getItem(VISITOR_KEY);
    if (existing) return existing;
    const created = createVisitorId();
    window.localStorage.setItem(VISITOR_KEY, created);
    return created;
  } catch {
    return createVisitorId();
  }
}

export function clearVisitorId(): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.removeItem(VISITOR_KEY);
  } catch {
    // ignore
  }
}
