import {
  EVENT_FLUSH_MAX_EVENTS,
  EVENT_FLUSH_INTERVAL_MS,
  RRWEB_FLUSH_INTERVAL_MS,
  RRWEB_FLUSH_MAX_BYTES,
  RRWEB_FLUSH_MAX_EVENTS,
  DEFAULT_API_URL,
  SDK_NAME,
  SDK_VERSION,
} from './constants.js';
import { getCurrentUrl, getDocument, getNavigator } from './browser.js';
import { enqueueChunk, listQueuedChunks, removeQueuedChunk, type QueuedUploadChunk } from './storage.js';
import { logger } from './logger.js';
import { normalizeBaseUrl } from './config.js';
import type {
  EventArtifactEnvelope,
  RejourneyEvent,
  RejourneySessionState,
  RejourneyWebConfig,
  RrwebChunkEnvelope,
  WebDeviceInfo,
} from './types.js';

export interface UploadQueueOptions {
  config: RejourneyWebConfig;
  getSession: () => RejourneySessionState | null;
  getDeviceInfo: () => WebDeviceInfo | null;
  getUserIdentity: () => string | null;
}

interface UploadResponse {
  presignedUrl?: string;
  batchId?: string;
  segmentId?: string;
  uploadId?: string;
  sessionId?: string;
  skipUpload?: boolean;
  reason?: string;
}

function ingestBaseUrl(config: RejourneyWebConfig): string {
  return normalizeBaseUrl(config.apiUrl, DEFAULT_API_URL);
}

const encoder = new TextEncoder();

function byteLength(input: unknown): number {
  return encoder.encode(JSON.stringify(input)).byteLength;
}

async function gzipJson(payload: unknown): Promise<Uint8Array> {
  const { gzipSync } = await import('fflate');
  return gzipSync(encoder.encode(JSON.stringify(payload)));
}

async function sha1Prefix(bytes: Uint8Array): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const digest = await crypto.subtle.digest('SHA-1', new Uint8Array(bytes).buffer);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('').slice(0, 8);
  }
  let hash = 0;
  for (const byte of bytes) hash = ((hash << 5) - hash + byte) | 0;
  return Math.abs(hash).toString(16).slice(0, 8).padStart(8, '0');
}

function buildHeaders(config: RejourneyWebConfig, session: RejourneySessionState, idempotencyKey?: string): HeadersInit {
  return {
    'content-type': 'application/json',
    'accept': 'application/json',
    'x-rejourney-key': config.publicKey || '',
    'x-upload-token': session.uploadToken,
    'x-platform': 'web',
    ...(session.observeOnly ? { 'x-rj-observe-only': '1' } : {}),
    ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
  };
}

async function postJson(url: string, body: unknown, headers: HeadersInit): Promise<UploadResponse> {
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    credentials: 'omit',
  });

  if (!response.ok) {
    throw new Error(`Upload request failed: ${response.status}`);
  }

  return response.json() as Promise<UploadResponse>;
}

async function putPayload(url: string, payload: Uint8Array): Promise<void> {
  const uploadBuffer = payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength) as ArrayBuffer;
  const body: BodyInit = typeof Blob !== 'undefined'
    ? new Blob([uploadBuffer], { type: 'application/json' })
    : uploadBuffer;
  const response = await fetch(url, {
    method: 'PUT',
    body,
    headers: {
      'content-type': 'application/json',
      'content-encoding': 'gzip',
    },
    credentials: 'omit',
  });

  if (!response.ok) {
    throw new Error(`Artifact upload failed: ${response.status}`);
  }
}

export class ReplayUploadQueue {
  private readonly options: UploadQueueOptions;
  private eventBuffer: RejourneyEvent[] = [];
  private rrwebBuffer: unknown[] = [];
  private rrwebSequence = 0;
  private eventBatchNumber = 0;
  private rrwebChunkStartedAt = Date.now();
  private eventFlushTimer: ReturnType<typeof setInterval> | null = null;
  private rrwebFlushTimer: ReturnType<typeof setInterval> | null = null;
  private flushing = false;

  constructor(options: UploadQueueOptions) {
    this.options = options;
  }

  start(): void {
    this.stopTimers();
    this.eventFlushTimer = setInterval(() => void this.flushEvents(), EVENT_FLUSH_INTERVAL_MS);
    this.rrwebFlushTimer = setInterval(() => void this.flushRrweb(), RRWEB_FLUSH_INTERVAL_MS);
    void this.drainPersisted();
  }

  stopTimers(): void {
    if (this.eventFlushTimer) clearInterval(this.eventFlushTimer);
    if (this.rrwebFlushTimer) clearInterval(this.rrwebFlushTimer);
    this.eventFlushTimer = null;
    this.rrwebFlushTimer = null;
  }

  queueEvent(event: RejourneyEvent): void {
    const processed = this.options.config.beforeSendEvent?.(event) ?? event;
    if (!processed) return;

    this.eventBuffer.push(processed);
    if (this.eventBuffer.length >= EVENT_FLUSH_MAX_EVENTS) {
      void this.flushEvents();
    }
  }

  queueRrwebEvent(event: unknown): void {
    this.rrwebBuffer.push(event);
    if (this.rrwebBuffer.length >= RRWEB_FLUSH_MAX_EVENTS || byteLength(this.rrwebBuffer) >= RRWEB_FLUSH_MAX_BYTES) {
      void this.flushRrweb();
    }
  }

  async flushAll(): Promise<boolean> {
    await Promise.all([this.flushEvents(), this.flushRrweb()]);
    return this.drainPersisted();
  }

  async flushEvents(): Promise<void> {
    const session = this.options.getSession();
    const deviceInfo = this.options.getDeviceInfo();
    if (!session || !deviceInfo || this.eventBuffer.length === 0) return;

    const events = this.eventBuffer.splice(0, this.eventBuffer.length);
    const envelope: EventArtifactEnvelope = {
      version: 1,
      sessionId: session.sessionId,
      sdk: { name: SDK_NAME, version: SDK_VERSION },
      deviceInfo,
      events,
    };
    const payload = await gzipJson(envelope);
    const id = `events_${session.sessionId}_${this.eventBatchNumber}_${Date.now()}`;
    const sequence = this.eventBatchNumber++;

    await enqueueChunk({
      id,
      kind: 'events',
      sessionId: session.sessionId,
      sequence,
      createdAt: Date.now(),
      sizeBytes: payload.byteLength,
      payload,
      meta: {
        eventCount: events.length,
        userId: this.options.getUserIdentity(),
      },
    });

    await this.drainPersisted();
  }

  async flushRrweb(): Promise<void> {
    const session = this.options.getSession();
    if (!session || this.rrwebBuffer.length === 0 || !session.replayEnabled) return;

    const doc = getDocument();
    const nav = getNavigator();
    const chunkStartedAt = this.rrwebChunkStartedAt;
    const chunkEndedAt = Date.now();
    const sequence = this.rrwebSequence++;
    const envelope: RrwebChunkEnvelope = {
      version: 1,
      format: 'rrweb',
      sessionId: session.sessionId,
      sdk: { name: SDK_NAME, version: SDK_VERSION },
      page: {
        url: getCurrentUrl(),
        title: doc?.title || '',
        referrer: doc?.referrer || '',
      },
      viewport: {
        width: typeof window !== 'undefined' ? window.innerWidth : 0,
        height: typeof window !== 'undefined' ? window.innerHeight : 0,
        devicePixelRatio: typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1,
      },
      startedAt: session.startedAt,
      chunkStartedAt,
      chunkEndedAt,
      sequence,
      isCheckout: false,
      events: this.rrwebBuffer.splice(0, this.rrwebBuffer.length),
    };
    this.rrwebChunkStartedAt = Date.now();

    const payload = await gzipJson(envelope);
    const digest = await sha1Prefix(payload);
    const id = `rrweb_${session.sessionId}_${sequence}_${chunkStartedAt}_${digest}`;

    await enqueueChunk({
      id,
      kind: 'rrweb',
      sessionId: session.sessionId,
      sequence,
      createdAt: Date.now(),
      sizeBytes: payload.byteLength,
      payload,
      meta: {
        eventCount: envelope.events.length,
        startTime: chunkStartedAt,
        endTime: chunkEndedAt,
        userAgent: nav?.userAgent,
      },
    });

    await this.drainPersisted();
  }

  async drainPersisted(): Promise<boolean> {
    if (this.flushing) return false;
    this.flushing = true;
    let fullyDrained = true;
    try {
      const session = this.options.getSession();
      if (!session) return true;

      const chunks = await listQueuedChunks(session.sessionId);
      for (const chunk of chunks) {
        try {
          if (chunk.kind === 'events') {
            await this.uploadEventChunk(session, chunk);
          } else if (chunk.kind === 'rrweb') {
            await this.uploadRrwebChunk(session, chunk);
          }
          await removeQueuedChunk(chunk.id);
        } catch (error) {
          logger.debug('Deferring queued chunk upload', error);
          fullyDrained = false;
          break;
        }
      }
      return fullyDrained;
    } finally {
      this.flushing = false;
    }
  }

  private async uploadEventChunk(session: RejourneySessionState, chunk: QueuedUploadChunk): Promise<void> {
    const config = this.options.config;
    const deviceInfo = this.options.getDeviceInfo();
    const idempotencyKey = chunk.id;
    const baseUrl = ingestBaseUrl(config);
    const presign = await postJson(
      `${baseUrl}/api/ingest/presign`,
      {
        sessionId: session.sessionId,
        contentType: 'events',
        batchNumber: chunk.sequence,
        sizeBytes: chunk.sizeBytes,
        platform: 'web',
        deviceModel: deviceInfo?.model,
        appVersion: deviceInfo?.appVersion,
        osVersion: deviceInfo?.osVersion || deviceInfo?.os,
        os: deviceInfo?.os,
        browser: deviceInfo?.browser,
        browserVersion: deviceInfo?.browserVersion,
        networkType: deviceInfo?.networkType,
        effectiveConnectionType: deviceInfo?.effectiveConnectionType,
        connectionSaveData: deviceInfo?.connectionSaveData,
        sdkVersion: SDK_VERSION,
        isSampledIn: session.sampledIn,
      },
      buildHeaders(config, session, idempotencyKey),
    );

    if (presign.skipUpload) return;
    if (!presign.presignedUrl || !presign.batchId) {
      throw new Error('Event presign response missing upload URL');
    }

    await putPayload(presign.presignedUrl, chunk.payload);
    await postJson(
      `${baseUrl}/api/ingest/batch/complete`,
      {
        batchId: presign.batchId,
        actualSizeBytes: chunk.sizeBytes,
        eventCount: chunk.meta.eventCount,
        userId: chunk.meta.userId || undefined,
      },
      buildHeaders(config, session, idempotencyKey),
    );
  }

  private async uploadRrwebChunk(session: RejourneySessionState, chunk: QueuedUploadChunk): Promise<void> {
    const config = this.options.config;
    const deviceInfo = this.options.getDeviceInfo();
    const idempotencyKey = chunk.id;
    const baseUrl = ingestBaseUrl(config);
    const presign = await postJson(
      `${baseUrl}/api/ingest/rrweb/presign`,
      {
        sessionId: session.sessionId,
        sequence: chunk.sequence,
        startTime: chunk.meta.startTime,
        endTime: chunk.meta.endTime,
        eventCount: chunk.meta.eventCount,
        sizeBytes: chunk.sizeBytes,
        compression: 'gzip',
        platform: 'web',
        deviceModel: deviceInfo?.model,
        appVersion: deviceInfo?.appVersion,
        osVersion: deviceInfo?.osVersion || deviceInfo?.os,
        os: deviceInfo?.os,
        browser: deviceInfo?.browser,
        browserVersion: deviceInfo?.browserVersion,
        networkType: deviceInfo?.networkType,
        effectiveConnectionType: deviceInfo?.effectiveConnectionType,
        connectionSaveData: deviceInfo?.connectionSaveData,
        sdkVersion: SDK_VERSION,
        isCheckout: false,
        isSampledIn: session.sampledIn,
      },
      buildHeaders(config, session, idempotencyKey),
    );

    if (presign.skipUpload) return;
    const uploadId = presign.uploadId || presign.segmentId || chunk.id;
    if (!presign.presignedUrl) {
      throw new Error('rrweb presign response missing upload URL');
    }

    await putPayload(presign.presignedUrl, chunk.payload);
    await postJson(
      `${baseUrl}/api/ingest/rrweb/complete`,
      {
        uploadId,
        segmentId: uploadId,
        actualSizeBytes: chunk.sizeBytes,
        eventCount: chunk.meta.eventCount,
      },
      buildHeaders(config, session, idempotencyKey),
    );
  }
}
