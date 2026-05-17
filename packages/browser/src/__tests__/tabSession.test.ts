import { describe, expect, it } from 'vitest';
import { clearTabSession, loadTabSession, saveTabSession } from '../sdk/tabSession.js';
import type { RejourneyWebConfig, RejourneySessionState } from '../sdk/types.js';

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

const config: RejourneyWebConfig = {
  publicKey: 'rj_live_test',
  maxSessionDuration: 30 * 60 * 1000,
};

const session: RejourneySessionState = {
  sessionId: 'session_1000_abc',
  visitorId: 'web_anon_123',
  uploadToken: 'token',
  uploadTokenExpiresAt: 3_600_000,
  startedAt: 1_000,
  lastActivityAt: 2_000,
  sampledIn: true,
  observeOnly: false,
  replayEnabled: true,
};

describe('tab session persistence', () => {
  it('restores an active session from tab-scoped storage', () => {
    const storage = createMemoryStorage();
    saveTabSession(config, session, 10_000, 5_000, 20_000, storage);

    const restored = loadTabSession(config, 'web_anon_123', 20_000, storage);

    expect(restored?.session.sessionId).toBe(session.sessionId);
    expect(restored?.backgroundStartedAt).toBe(10_000);
    expect(restored?.totalBackgroundTimeMs).toBe(5_000);
  });

  it('does not restore after the max session window', () => {
    const storage = createMemoryStorage();
    saveTabSession(config, session, null, 0, 20_000, storage);

    expect(loadTabSession(config, 'web_anon_123', 31 * 60 * 1000, storage)).toBeNull();
  });

  it('clears only the matching persisted session', () => {
    const storage = createMemoryStorage();
    saveTabSession(config, session, null, 0, 20_000, storage);

    clearTabSession(config, 'session_other', storage);
    expect(loadTabSession(config, 'web_anon_123', 20_000, storage)?.session.sessionId).toBe(session.sessionId);

    clearTabSession(config, session.sessionId, storage);
    expect(loadTabSession(config, 'web_anon_123', 20_000, storage)).toBeNull();
  });
});
