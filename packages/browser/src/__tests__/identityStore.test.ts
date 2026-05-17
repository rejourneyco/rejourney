import { describe, expect, it } from 'vitest';
import {
  clearStoredUserIdentity,
  loadStoredUserIdentity,
  normalizeUserIdentity,
  saveStoredUserIdentity,
} from '../sdk/identityStore.js';
import type { RejourneyWebConfig } from '../sdk/types.js';

function createMemoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(values.keys())[index] ?? null;
    },
    removeItem(key: string) {
      values.delete(key);
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  };
}

const config: RejourneyWebConfig = { publicKey: 'rj_live_test' };

describe('stored web user identity', () => {
  it('persists identity by project key across refreshes', () => {
    const storage = createMemoryStorage();

    expect(saveStoredUserIdentity(config, ' user_123 ', storage)).toBe('user_123');
    expect(loadStoredUserIdentity(config, storage)).toBe('user_123');
  });

  it('keeps identities scoped to the project key', () => {
    const storage = createMemoryStorage();

    saveStoredUserIdentity(config, 'user_123', storage);
    saveStoredUserIdentity({ publicKey: 'rj_live_other' }, 'user_456', storage);

    expect(loadStoredUserIdentity(config, storage)).toBe('user_123');
    expect(loadStoredUserIdentity({ publicKey: 'rj_live_other' }, storage)).toBe('user_456');
  });

  it('normalizes runtime numeric identities without throwing', () => {
    expect(normalizeUserIdentity(12345)).toBe('12345');
    expect(saveStoredUserIdentity(config, 12345, createMemoryStorage())).toBe('12345');
  });

  it('clears the stored identity', () => {
    const storage = createMemoryStorage();

    saveStoredUserIdentity(config, 'user_123', storage);
    clearStoredUserIdentity(config, storage);

    expect(loadStoredUserIdentity(config, storage)).toBeNull();
  });
});
