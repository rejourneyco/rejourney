import { describe, expect, it } from 'vitest';
import {
  claimTabSessionLease,
  isTabSessionClaimedByAnotherOwner,
  releaseTabSessionLease,
} from '../sdk/tabSessionLease.js';
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

describe('tab session lease', () => {
  it('blocks a second active tab from claiming the same restored session', () => {
    const storage = createMemoryStorage();

    expect(claimTabSessionLease(config, 'session_123', 'owner_a', 10_000, storage)).toBe(true);
    expect(isTabSessionClaimedByAnotherOwner(config, 'session_123', 'owner_b', 12_000, storage)).toBe(true);
    expect(claimTabSessionLease(config, 'session_123', 'owner_b', 12_000, storage)).toBe(false);
  });

  it('allows the same owner to renew its lease', () => {
    const storage = createMemoryStorage();

    claimTabSessionLease(config, 'session_123', 'owner_a', 10_000, storage);

    expect(claimTabSessionLease(config, 'session_123', 'owner_a', 12_000, storage)).toBe(true);
    expect(isTabSessionClaimedByAnotherOwner(config, 'session_123', 'owner_a', 12_000, storage)).toBe(false);
  });

  it('expires stale leases', () => {
    const storage = createMemoryStorage();

    claimTabSessionLease(config, 'session_123', 'owner_a', 10_000, storage);

    expect(isTabSessionClaimedByAnotherOwner(config, 'session_123', 'owner_b', 36 * 60 * 1000, storage)).toBe(false);
    expect(claimTabSessionLease(config, 'session_123', 'owner_b', 36 * 60 * 1000, storage)).toBe(true);
  });

  it('only releases the lease for the owning tab', () => {
    const storage = createMemoryStorage();

    claimTabSessionLease(config, 'session_123', 'owner_a', 10_000, storage);
    releaseTabSessionLease(config, 'session_123', 'owner_b', storage);

    expect(isTabSessionClaimedByAnotherOwner(config, 'session_123', 'owner_b', 12_000, storage)).toBe(true);

    releaseTabSessionLease(config, 'session_123', 'owner_a', storage);

    expect(isTabSessionClaimedByAnotherOwner(config, 'session_123', 'owner_b', 13_000, storage)).toBe(false);
  });
});
