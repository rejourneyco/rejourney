import { getCryptoRandomId, isBrowser } from './browser.js';
import type { RejourneyWebConfig } from './types.js';

const TAB_SESSION_LEASE_SCHEMA_VERSION = 1;
const TAB_SESSION_LEASE_KEY_PREFIX = 'rejourney:web:session_lease:';
const TAB_SESSION_LEASE_TTL_MS = 35 * 60 * 1000;

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

type StoredTabSessionLease = {
  schemaVersion: 1;
  publicKey: string;
  sessionId: string;
  ownerId: string;
  updatedAt: number;
};

export function createTabSessionOwnerId(): string {
  return `tab_${Date.now()}_${getCryptoRandomId(8)}`;
}

function getStorage(storage?: StorageLike): StorageLike | null {
  if (storage) return storage;
  if (!isBrowser()) return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function getLeaseKey(config: RejourneyWebConfig, sessionId: string): string | null {
  const publicKey = config.publicKey?.trim();
  if (!publicKey || !sessionId) return null;
  return `${TAB_SESSION_LEASE_KEY_PREFIX}${encodeURIComponent(publicKey)}:${encodeURIComponent(sessionId)}`;
}

function isStoredTabSessionLease(value: unknown): value is StoredTabSessionLease {
  if (!value || typeof value !== 'object') return false;
  const lease = value as Partial<StoredTabSessionLease>;
  return lease.schemaVersion === TAB_SESSION_LEASE_SCHEMA_VERSION &&
    typeof lease.publicKey === 'string' &&
    typeof lease.sessionId === 'string' &&
    typeof lease.ownerId === 'string' &&
    typeof lease.updatedAt === 'number' &&
    Number.isFinite(lease.updatedAt);
}

function readLease(
  config: RejourneyWebConfig,
  sessionId: string,
  storageRef: StorageLike,
): StoredTabSessionLease | null {
  const key = getLeaseKey(config, sessionId);
  if (!key) return null;

  try {
    const raw = storageRef.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!isStoredTabSessionLease(parsed) || parsed.publicKey !== config.publicKey || parsed.sessionId !== sessionId) {
      storageRef.removeItem(key);
      return null;
    }
    return parsed;
  } catch {
    storageRef.removeItem(key);
    return null;
  }
}

export function isTabSessionClaimedByAnotherOwner(
  config: RejourneyWebConfig,
  sessionId: string,
  ownerId: string,
  now = Date.now(),
  storage?: StorageLike,
): boolean {
  const storageRef = getStorage(storage);
  const key = getLeaseKey(config, sessionId);
  if (!storageRef || !key) return false;

  const lease = readLease(config, sessionId, storageRef);
  if (!lease || lease.ownerId === ownerId) return false;

  if (now - lease.updatedAt > TAB_SESSION_LEASE_TTL_MS) {
    try {
      storageRef.removeItem(key);
    } catch {
      // ignore
    }
    return false;
  }

  return true;
}

export function claimTabSessionLease(
  config: RejourneyWebConfig,
  sessionId: string,
  ownerId: string,
  now = Date.now(),
  storage?: StorageLike,
): boolean {
  const storageRef = getStorage(storage);
  const key = getLeaseKey(config, sessionId);
  if (!storageRef || !key || !ownerId) return true;
  if (isTabSessionClaimedByAnotherOwner(config, sessionId, ownerId, now, storageRef)) return false;

  const payload: StoredTabSessionLease = {
    schemaVersion: TAB_SESSION_LEASE_SCHEMA_VERSION,
    publicKey: config.publicKey || '',
    sessionId,
    ownerId,
    updatedAt: now,
  };

  try {
    storageRef.setItem(key, JSON.stringify(payload));
    return true;
  } catch {
    return true;
  }
}

export function releaseTabSessionLease(
  config: RejourneyWebConfig,
  sessionId: string,
  ownerId: string,
  storage?: StorageLike,
): void {
  const storageRef = getStorage(storage);
  const key = getLeaseKey(config, sessionId);
  if (!storageRef || !key) return;

  const lease = readLease(config, sessionId, storageRef);
  if (lease && lease.ownerId !== ownerId) return;

  try {
    storageRef.removeItem(key);
  } catch {
    // ignore
  }
}
