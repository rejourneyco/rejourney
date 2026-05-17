import { isBrowser } from './browser.js';
import type { RejourneyWebConfig } from './types.js';

const IDENTITY_KEY_PREFIX = 'rejourney:web:user_identity:';
const MAX_USER_ID_LENGTH = 512;

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function getStorage(storage?: StorageLike): StorageLike | null {
  if (storage) return storage;
  if (!isBrowser()) return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function getStoredUserIdentityStorageKey(config: RejourneyWebConfig): string | null {
  const publicKey = config.publicKey?.trim();
  return publicKey ? `${IDENTITY_KEY_PREFIX}${encodeURIComponent(publicKey)}` : null;
}

export function normalizeUserIdentity(userId: unknown): string | null {
  const raw = typeof userId === 'number' && Number.isFinite(userId)
    ? String(userId)
    : typeof userId === 'string'
    ? userId
    : null;
  if (raw === null) return null;
  const normalized = raw.trim();
  return normalized ? normalized.slice(0, MAX_USER_ID_LENGTH) : null;
}

export function loadStoredUserIdentity(config: RejourneyWebConfig, storage?: StorageLike): string | null {
  const storageRef = getStorage(storage);
  const key = getStoredUserIdentityStorageKey(config);
  if (!storageRef || !key) return null;

  try {
    return normalizeUserIdentity(storageRef.getItem(key));
  } catch {
    return null;
  }
}

export function saveStoredUserIdentity(config: RejourneyWebConfig, userId: unknown, storage?: StorageLike): string | null {
  const normalized = normalizeUserIdentity(userId);
  const storageRef = getStorage(storage);
  const key = getStoredUserIdentityStorageKey(config);
  if (!normalized || !storageRef || !key) return normalized;

  try {
    storageRef.setItem(key, normalized);
  } catch {
    // Ignore storage failures; the in-memory identity still applies to the active page.
  }

  return normalized;
}

export function clearStoredUserIdentity(config: RejourneyWebConfig, storage?: StorageLike): void {
  const storageRef = getStorage(storage);
  const key = getStoredUserIdentityStorageKey(config);
  if (!storageRef || !key) return;

  try {
    storageRef.removeItem(key);
  } catch {
    // ignore
  }
}
