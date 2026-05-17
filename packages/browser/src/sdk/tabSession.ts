import { isBrowser } from './browser.js';
import type { RejourneySessionState, RejourneyWebConfig } from './types.js';

const TAB_SESSION_SCHEMA_VERSION = 1;
const TAB_SESSION_KEY_PREFIX = 'rejourney:web:active_session:';
const UPLOAD_TOKEN_EXPIRY_SKEW_MS = 30_000;
const DEFAULT_MAX_SESSION_DURATION_MS = 30 * 60 * 1000;

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface StoredTabSession {
  schemaVersion: 1;
  publicKey: string;
  savedAt: number;
  session: RejourneySessionState;
  backgroundStartedAt: number | null;
  totalBackgroundTimeMs: number;
}

export interface RestoredTabSession {
  session: RejourneySessionState;
  backgroundStartedAt: number | null;
  totalBackgroundTimeMs: number;
}

function getStorage(storage?: StorageLike): StorageLike | null {
  if (storage) return storage;
  if (!isBrowser()) return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function getStorageKey(config: RejourneyWebConfig): string | null {
  const publicKey = config.publicKey?.trim();
  if (!publicKey) return null;
  return `${TAB_SESSION_KEY_PREFIX}${encodeURIComponent(publicKey)}`;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function maxSessionDurationMs(config: RejourneyWebConfig): number {
  const configured = finiteNumber(config.maxSessionDuration);
  return configured && configured > 0 ? configured : DEFAULT_MAX_SESSION_DURATION_MS;
}

function isValidStoredSession(value: unknown): value is StoredTabSession {
  if (!value || typeof value !== 'object') return false;
  const stored = value as Partial<StoredTabSession>;
  const session = stored.session as Partial<RejourneySessionState> | undefined;
  return stored.schemaVersion === TAB_SESSION_SCHEMA_VERSION &&
    typeof stored.publicKey === 'string' &&
    typeof stored.savedAt === 'number' &&
    typeof session?.sessionId === 'string' &&
    typeof session.visitorId === 'string' &&
    typeof session.uploadToken === 'string' &&
    typeof session.startedAt === 'number' &&
    typeof session.lastActivityAt === 'number' &&
    typeof session.sampledIn === 'boolean' &&
    typeof session.observeOnly === 'boolean' &&
    typeof session.replayEnabled === 'boolean';
}

export function loadTabSession(
  config: RejourneyWebConfig,
  visitorId: string,
  now = Date.now(),
  storage?: StorageLike,
): RestoredTabSession | null {
  const storageRef = getStorage(storage);
  const key = getStorageKey(config);
  if (!storageRef || !key || !visitorId) return null;

  try {
    const raw = storageRef.getItem(key);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as unknown;
    if (!isValidStoredSession(parsed)) {
      storageRef.removeItem(key);
      return null;
    }

    if (parsed.publicKey !== config.publicKey || parsed.session.visitorId !== visitorId) {
      return null;
    }

    const startedAt = finiteNumber(parsed.session.startedAt);
    const lastActivityAt = finiteNumber(parsed.session.lastActivityAt);
    if (startedAt === null || lastActivityAt === null || startedAt > now + 60_000) {
      storageRef.removeItem(key);
      return null;
    }

    if (now - startedAt >= maxSessionDurationMs(config)) {
      storageRef.removeItem(key);
      return null;
    }

    const uploadTokenExpiresAt = finiteNumber(parsed.session.uploadTokenExpiresAt);
    if (uploadTokenExpiresAt !== null && uploadTokenExpiresAt <= now + UPLOAD_TOKEN_EXPIRY_SKEW_MS) {
      storageRef.removeItem(key);
      return null;
    }

    const backgroundStartedAt = finiteNumber(parsed.backgroundStartedAt);
    const totalBackgroundTimeMs = finiteNumber(parsed.totalBackgroundTimeMs);
    return {
      session: {
        ...parsed.session,
        lastActivityAt: Math.max(lastActivityAt, startedAt),
      },
      backgroundStartedAt,
      totalBackgroundTimeMs: totalBackgroundTimeMs === null ? 0 : Math.max(0, totalBackgroundTimeMs),
    };
  } catch {
    storageRef.removeItem(key);
    return null;
  }
}

export function saveTabSession(
  config: RejourneyWebConfig,
  session: RejourneySessionState,
  backgroundStartedAt: number | null,
  totalBackgroundTimeMs: number,
  now = Date.now(),
  storage?: StorageLike,
): void {
  const storageRef = getStorage(storage);
  const key = getStorageKey(config);
  if (!storageRef || !key) return;

  const payload: StoredTabSession = {
    schemaVersion: TAB_SESSION_SCHEMA_VERSION,
    publicKey: config.publicKey || '',
    savedAt: now,
    session,
    backgroundStartedAt,
    totalBackgroundTimeMs: Math.max(0, Math.round(totalBackgroundTimeMs)),
  };

  try {
    storageRef.setItem(key, JSON.stringify(payload));
  } catch {
    // Ignore private browsing or quota failures; the SDK can still record the current page.
  }
}

export function clearTabSession(config: RejourneyWebConfig, sessionId?: string, storage?: StorageLike): void {
  const storageRef = getStorage(storage);
  const key = getStorageKey(config);
  if (!storageRef || !key) return;

  try {
    if (!sessionId) {
      storageRef.removeItem(key);
      return;
    }

    const raw = storageRef.getItem(key);
    if (!raw) return;
    const parsed = JSON.parse(raw) as unknown;
    if (isValidStoredSession(parsed) && parsed.session.sessionId !== sessionId) return;
    storageRef.removeItem(key);
  } catch {
    storageRef.removeItem(key);
  }
}
