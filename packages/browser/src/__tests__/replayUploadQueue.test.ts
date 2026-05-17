import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  enqueueChunk: vi.fn(),
  listQueuedChunks: vi.fn(),
  removeQueuedChunk: vi.fn(),
}));

vi.mock('../sdk/storage.js', () => ({
  enqueueChunk: mocks.enqueueChunk,
  listQueuedChunks: mocks.listQueuedChunks,
  removeQueuedChunk: mocks.removeQueuedChunk,
}));

import { ReplayUploadQueue } from '../sdk/replayUploadQueue.js';
import type { QueuedUploadChunk } from '../sdk/storage.js';

const session = {
  sessionId: 'session_1',
  uploadToken: 'upload-token',
  observeOnly: false,
  replayEnabled: true,
  sampledIn: true,
  startedAt: Date.now(),
  lastActivityAt: Date.now(),
};

const deviceInfo = {
  model: 'browser',
  os: 'web',
  screenWidth: 1200,
  screenHeight: 800,
  viewportWidth: 1200,
  viewportHeight: 800,
  browser: 'Chrome',
};

const eventChunk: QueuedUploadChunk = {
  id: 'events_session_1_0',
  kind: 'events',
  sessionId: 'session_1',
  sequence: 0,
  createdAt: Date.now(),
  expiresAt: Date.now() + 60_000,
  sizeBytes: 24,
  payload: new Uint8Array([31, 139, 8, 0]),
  meta: {
    eventCount: 1,
    userId: 'user_1',
  },
};

function buildQueue() {
  return new ReplayUploadQueue({
    config: {
      apiUrl: 'https://api.example.com',
      publicKey: 'pub_123',
    },
    getSession: () => session,
    getDeviceInfo: () => deviceInfo,
    getUserIdentity: () => 'user_1',
  } as any);
}

describe('ReplayUploadQueue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listQueuedChunks.mockResolvedValue([eventChunk]);
  });

  it('keeps queued chunks when persisted drain cannot upload them', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: vi.fn(),
    }));

    const drained = await buildQueue().drainPersisted();

    expect(drained).toBe(false);
    expect(mocks.removeQueuedChunk).not.toHaveBeenCalled();
  });

  it('removes queued chunks only after presign, upload, and complete succeed', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn(async () => ({ presignedUrl: 'https://upload.example.com/events', batchId: 'batch_1' })),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn(),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn(async () => ({ success: true })),
      }));

    const drained = await buildQueue().drainPersisted();

    expect(drained).toBe(true);
    expect(mocks.removeQueuedChunk).toHaveBeenCalledWith(eventChunk.id);
  });
});
