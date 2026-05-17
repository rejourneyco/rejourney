import {
  QUEUED_CHUNK_MAX_BYTES,
  QUEUED_CHUNK_MAX_COUNT,
  QUEUED_CHUNK_TTL_MS,
} from './constants.js';
import { isBrowser } from './browser.js';

export type QueueKind = 'events' | 'rrweb' | 'telemetry';

export interface QueuedUploadChunk {
  id: string;
  kind: QueueKind;
  sessionId: string;
  sequence: number;
  createdAt: number;
  expiresAt: number;
  sizeBytes: number;
  payload: Uint8Array;
  meta: Record<string, unknown>;
}

const DB_NAME = 'rejourney-web';
const DB_VERSION = 1;
const STORE_NAME = 'uploadQueue';

let dbPromise: Promise<IDBDatabase | null> | null = null;

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function openDatabase(): Promise<IDBDatabase | null> {
  if (!isBrowser() || typeof indexedDB === 'undefined') return Promise.resolve(null);
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt');
        store.createIndex('sessionId', 'sessionId');
        store.createIndex('kind', 'kind');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });

  return dbPromise;
}

async function withStore<T>(
  mode: IDBTransactionMode,
  callback: (store: IDBObjectStore) => IDBRequest<T> | Promise<T>,
): Promise<T | null> {
  const db = await openDatabase();
  if (!db) return null;

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode);
    const store = transaction.objectStore(STORE_NAME);
    let callbackResult: IDBRequest<T> | Promise<T>;

    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);

    try {
      callbackResult = callback(store);
    } catch (error) {
      reject(error);
      return;
    }

    if (callbackResult instanceof IDBRequest) {
      callbackResult.onsuccess = () => resolve(callbackResult.result);
      callbackResult.onerror = () => reject(callbackResult.error);
      return;
    }

    Promise.resolve(callbackResult).then(resolve, reject);
  });
}

export async function enqueueChunk(chunk: Omit<QueuedUploadChunk, 'expiresAt'>): Promise<void> {
  const expiresAt = chunk.createdAt + QUEUED_CHUNK_TTL_MS;
  await withStore('readwrite', (store) => store.put({ ...chunk, expiresAt }));
  await pruneQueue();
}

export async function listQueuedChunks(sessionId?: string): Promise<QueuedUploadChunk[]> {
  const chunks = await withStore('readonly', async (store) => {
    if (sessionId) {
      const index = store.index('sessionId');
      return requestToPromise(index.getAll(sessionId)) as Promise<QueuedUploadChunk[]>;
    }
    return requestToPromise(store.getAll()) as Promise<QueuedUploadChunk[]>;
  });

  return (chunks || []).sort((a, b) => a.createdAt - b.createdAt);
}

export async function removeQueuedChunk(id: string): Promise<void> {
  await withStore('readwrite', (store) => store.delete(id));
}

export async function clearSessionQueue(sessionId: string): Promise<void> {
  const chunks = await listQueuedChunks(sessionId);
  await Promise.all(chunks.map((chunk) => removeQueuedChunk(chunk.id)));
}

export async function clearAllQueues(): Promise<void> {
  await withStore('readwrite', (store) => store.clear());
}

export async function pruneQueue(): Promise<void> {
  const chunks = await listQueuedChunks();
  const now = Date.now();
  const expired = chunks.filter((chunk) => chunk.expiresAt <= now);
  await Promise.all(expired.map((chunk) => removeQueuedChunk(chunk.id)));

  const live = chunks.filter((chunk) => chunk.expiresAt > now);
  let totalBytes = live.reduce((sum, chunk) => sum + chunk.sizeBytes, 0);
  const ordered = [...live].sort((a, b) => {
    if (a.kind !== b.kind) {
      if (a.kind === 'rrweb') return -1;
      if (b.kind === 'rrweb') return 1;
    }
    return a.createdAt - b.createdAt;
  });

  while ((ordered.length > QUEUED_CHUNK_MAX_COUNT || totalBytes > QUEUED_CHUNK_MAX_BYTES) && ordered.length > 0) {
    const removed = ordered.shift();
    if (!removed) break;
    totalBytes -= removed.sizeBytes;
    await removeQueuedChunk(removed.id);
  }
}
