/**
 * Reading a session's event stream from object storage.
 *
 * The full event stream lives in gzipped JSON artifacts. Tools never see this
 * module: the scoped data layer calls it with a project id it has already
 * checked against the grant. A reader yields parsed event batches and nothing
 * else: no object keys, no URLs, no bucket or endpoint names, and no error
 * text from the storage client.
 */

import { promisify } from 'node:util';
import { gunzip } from 'node:zlib';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { recordingArtifacts, sessions } from '../../db/schema.js';
import type { McpDb } from '../data/db.js';

const gunzipAsync = promisify(gunzip);

export interface ArtifactEventBatch {
    events: unknown[];
    /**
     * Set on the last batch when the reader stopped early: the session's event
     * data is larger than the read cap, or the time budget ran out.
     */
    capReached?: boolean;
    /** Decompressed size of this batch, for callers that keep batches in memory. */
    bytes?: number;
}

export interface ArtifactReadOptions {
    signal?: AbortSignal;
    /**
     * Read only the event files whose recorded time range overlaps this one
     * (epoch milliseconds), the ones closest to `toMs` first when there are
     * more than the cap. Without it the whole session is read.
     */
    window?: {
        fromMs: number;
        toMs: number;
        /**
         * The part of the window the caller cannot do without. When more files
         * overlap the window than the cap allows, the read still counts as
         * complete if the files kept reach back to this instant.
         */
        needFromMs?: number;
    };
    /** Stop, with `capReached`, once this many milliseconds have gone by. */
    budgetMs?: number;
}

export interface ArtifactSessionRef {
    projectId: string;
    sessionId: string;
}

export interface ArtifactReader {
    /** Event batches for one session, oldest first. Unknown sessions yield nothing. */
    readEventBatches(ref: ArtifactSessionRef, options?: ArtifactReadOptions): AsyncIterable<ArtifactEventBatch>;
    /**
     * Whether the session has any readable event file at all. Used after a
     * windowed read that found nothing, to tell "nothing recorded" from
     * "nothing in that window".
     */
    hasEvents?(ref: ArtifactSessionRef): Promise<boolean>;
}

/** A reader with no storage behind it: every session has no event artifacts. */
export const EMPTY_ARTIFACT_READER: ArtifactReader = {
    // eslint-disable-next-line require-yield
    async *readEventBatches() {
        return;
    },
};

// --- In-memory implementation (tests and demos) ---------------------------------

export class InMemoryArtifactReader implements ArtifactReader {
    private readonly batches = new Map<string, unknown[][]>();
    /** Every (project, session) pair asked for, in order. For tests. */
    readonly reads: Array<ArtifactSessionRef & { window?: { fromMs: number; toMs: number; needFromMs?: number } }> = [];

    private key(ref: ArtifactSessionRef): string {
        return `${ref.projectId}\u0000${ref.sessionId}`;
    }

    /** Appends one batch of events for a session. */
    put(ref: ArtifactSessionRef, events: unknown[]): void {
        const key = this.key(ref);
        const existing = this.batches.get(key) ?? [];
        existing.push(structuredClone(events));
        this.batches.set(key, existing);
    }

    clear(): void {
        this.batches.clear();
        this.reads.length = 0;
    }

    async *readEventBatches(ref: ArtifactSessionRef, options?: ArtifactReadOptions): AsyncIterable<ArtifactEventBatch> {
        this.reads.push(options?.window ? { ...ref, window: { ...options.window } } : { ...ref });
        // Keyed by project AND session: asking with the wrong project finds nothing.
        // A window is not applied here: callers filter events by time themselves.
        for (const events of this.batches.get(this.key(ref)) ?? []) {
            yield { events: structuredClone(events) };
        }
    }

    async hasEvents(ref: ArtifactSessionRef): Promise<boolean> {
        return (this.batches.get(this.key(ref)) ?? []).length > 0;
    }
}

// --- Object storage implementation ---------------------------------------------

/** Downloads one object's raw bytes. Matches `downloadRawFromS3ForArtifact` in `db/s3.ts`. */
export type ArtifactDownload = (projectId: string, key: string, endpointId: string | null) => Promise<Buffer | null>;

export interface StorageArtifactReaderOptions {
    db: McpDb;
    download: ArtifactDownload;
    /** Stored (compressed) bytes read per session before stopping. */
    maxStoredBytesPerSession?: number;
    /** Decompressed bytes parsed per session before stopping. */
    maxDecompressedBytesPerSession?: number;
    /** Decompressed bytes of a single event file before stopping. */
    maxDecompressedBytesPerArtifact?: number;
    /** Artifacts read per session before stopping. */
    maxArtifactsPerSession?: number;
    /** Artifacts read for a windowed read before stopping. */
    maxArtifactsPerWindow?: number;
    /** Downloads in flight for one read. */
    downloadConcurrency?: number;
    /** Downloads in flight for the whole process, across every read. */
    maxConcurrentDownloads?: number;
    /** One download taking longer than this ends the read as partial. */
    downloadTimeoutMs?: number;
    /** For tests. Milliseconds on a monotonic clock. */
    now?: () => number;
}

export const DEFAULT_MAX_STORED_BYTES_PER_SESSION = 4 * 1024 * 1024;
export const DEFAULT_MAX_DECOMPRESSED_BYTES_PER_SESSION = 32 * 1024 * 1024;
export const DEFAULT_MAX_DECOMPRESSED_BYTES_PER_ARTIFACT = 8 * 1024 * 1024;
export const DEFAULT_MAX_ARTIFACTS_PER_SESSION = 200;
export const DEFAULT_MAX_ARTIFACTS_PER_WINDOW = 48;
export const DEFAULT_DOWNLOAD_CONCURRENCY = 12;
export const DEFAULT_MAX_CONCURRENT_DOWNLOADS = 48;
export const DEFAULT_DOWNLOAD_TIMEOUT_MS = 6_000;

function isGzip(data: Buffer): boolean {
    return data.length > 2 && data[0] === 0x1f && data[1] === 0x8b;
}

function eventsFromParsed(parsed: unknown): unknown[] {
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { events?: unknown }).events)) {
        return (parsed as { events: unknown[] }).events;
    }
    return [];
}

/** A counting semaphore: at most `limit` holders, the rest wait in order. */
class Semaphore {
    private active = 0;
    private readonly waiting: Array<() => void> = [];

    constructor(private readonly limit: number) {}

    async run<T>(work: () => Promise<T>): Promise<T> {
        if (this.active >= this.limit) await new Promise<void>((resolve) => this.waiting.push(resolve));
        this.active += 1;
        try {
            return await work();
        } finally {
            this.active -= 1;
            this.waiting.shift()?.();
        }
    }
}

/** What one event file turned into. `stop` ends the read as partial. */
type Fetched =
    | { kind: 'events'; events: unknown[]; storedBytes: number; bytes: number }
    | { kind: 'skip' }
    | { kind: 'stop' };

const STOP: Fetched = { kind: 'stop' };

/**
 * Reads `kind = 'events'` artifacts only, oldest first, and stops at the
 * per-session caps or when the time budget runs out. The artifact list is
 * selected with the session's project in the WHERE clause, so a wrong project
 * id finds no artifacts whatever the caller believes.
 *
 * Event files are many and small (a typical session has about ten, a long one
 * over a hundred) and the object store may be on another continent, so
 * downloads run several at a time and batches are handed over in order. A
 * windowed read fetches only the files whose recorded time range overlaps the
 * window, which is all the lead-up to a crash needs.
 *
 * Objects are fetched whole (the existing storage layer has no ranged or
 * streaming read), so the stored-size cap is checked against the recorded
 * sizes before any download and against the real size after each.
 */
export function createStorageArtifactReader(options: StorageArtifactReaderOptions): ArtifactReader {
    const maxStored = options.maxStoredBytesPerSession ?? DEFAULT_MAX_STORED_BYTES_PER_SESSION;
    const maxDecompressed = options.maxDecompressedBytesPerSession ?? DEFAULT_MAX_DECOMPRESSED_BYTES_PER_SESSION;
    const maxPerArtifact = Math.min(maxDecompressed, options.maxDecompressedBytesPerArtifact ?? DEFAULT_MAX_DECOMPRESSED_BYTES_PER_ARTIFACT);
    const maxArtifacts = options.maxArtifactsPerSession ?? DEFAULT_MAX_ARTIFACTS_PER_SESSION;
    const maxWindowArtifacts = options.maxArtifactsPerWindow ?? DEFAULT_MAX_ARTIFACTS_PER_WINDOW;
    const concurrency = Math.max(1, options.downloadConcurrency ?? DEFAULT_DOWNLOAD_CONCURRENCY);
    const downloadTimeoutMs = options.downloadTimeoutMs ?? DEFAULT_DOWNLOAD_TIMEOUT_MS;
    const now = options.now ?? (() => performance.now());
    const downloads = new Semaphore(Math.max(1, options.maxConcurrentDownloads ?? DEFAULT_MAX_CONCURRENT_DOWNLOADS));

    const readable = (ref: ArtifactSessionRef) =>
        and(
            eq(recordingArtifacts.sessionId, ref.sessionId),
            eq(sessions.projectId, ref.projectId),
            eq(recordingArtifacts.kind, 'events'),
            eq(recordingArtifacts.status, 'ready'),
        );

    async function fetchOne(projectId: string, artifact: { key: string; endpointId: string | null }): Promise<Fetched> {
        try {
            let timer: NodeJS.Timeout | undefined;
            const timedOut = new Promise<'timeout'>((resolve) => {
                timer = setTimeout(() => resolve('timeout'), downloadTimeoutMs);
                timer.unref?.();
            });
            const data = await Promise.race([
                downloads.run(() => options.download(projectId, artifact.key, artifact.endpointId)),
                timedOut,
            ]).finally(() => {
                if (timer) clearTimeout(timer);
            });
            if (data === 'timeout') return STOP;
            if (!data) return { kind: 'skip' };

            let json: Buffer = data;
            if (isGzip(data)) {
                try {
                    json = await gunzipAsync(data, { maxOutputLength: maxPerArtifact });
                } catch (error) {
                    if ((error as NodeJS.ErrnoException)?.code === 'ERR_BUFFER_TOO_LARGE') return STOP;
                    // Named .gz but holding raw JSON: fall through and parse as-is.
                    json = data;
                }
            }
            if (json.length > maxPerArtifact) return STOP;
            return { kind: 'events', events: eventsFromParsed(JSON.parse(json.toString('utf8'))), storedBytes: data.length, bytes: json.length };
        } catch {
            // An unreadable artifact is skipped, as the dashboard does. The
            // error may name the object key, so it is dropped here.
            return { kind: 'skip' };
        }
    }

    return {
        async hasEvents(ref) {
            const rows = await options.db
                .select({ one: sql<number>`1` })
                .from(recordingArtifacts)
                .innerJoin(sessions, eq(sessions.id, recordingArtifacts.sessionId))
                .where(readable(ref))
                .limit(1);
            return rows.length > 0;
        },

        async *readEventBatches(ref, readOptions) {
            const startedAt = now();
            const budgetMs = readOptions?.budgetMs;
            const outOfTime = () => budgetMs !== undefined && now() - startedAt >= budgetMs;
            const window = readOptions?.window;
            const cap = window ? maxWindowArtifacts : maxArtifacts;

            const columns = {
                key: recordingArtifacts.s3ObjectKey,
                endpointId: recordingArtifacts.endpointId,
                sizeBytes: recordingArtifacts.sizeBytes,
                startTime: recordingArtifacts.startTime,
            };
            let artifacts: Array<{ key: string; endpointId: string | null; sizeBytes: number | null; startTime: number | null }>;
            let listCapped = false;
            if (window) {
                // Newest first so that, over the cap, the files nearest the end of
                // the window are the ones kept; put back in order below.
                const rows = await options.db
                    .select(columns)
                    .from(recordingArtifacts)
                    .innerJoin(sessions, eq(sessions.id, recordingArtifacts.sessionId))
                    .where(
                        and(
                            readable(ref),
                            sql`(${recordingArtifacts.endTime} is null or ${recordingArtifacts.endTime} >= ${Math.floor(window.fromMs)})`,
                            sql`(${recordingArtifacts.startTime} is null or ${recordingArtifacts.startTime} <= ${Math.ceil(window.toMs)})`,
                        ),
                    )
                    .orderBy(sql`${recordingArtifacts.startTime} desc nulls last`, desc(recordingArtifacts.createdAt), desc(recordingArtifacts.id))
                    .limit(cap + 1);
                artifacts = rows.slice(0, cap).reverse();
                const oldestKept = artifacts[0]?.startTime;
                const coversNeed = window.needFromMs !== undefined && typeof oldestKept === 'number' && oldestKept <= window.needFromMs;
                listCapped = rows.length > cap && !coversNeed;
            } else {
                const rows = await options.db
                    .select(columns)
                    .from(recordingArtifacts)
                    .innerJoin(sessions, eq(sessions.id, recordingArtifacts.sessionId))
                    .where(readable(ref))
                    .orderBy(sql`${recordingArtifacts.startTime} asc nulls last`, asc(recordingArtifacts.createdAt), asc(recordingArtifacts.id))
                    .limit(cap + 1);
                listCapped = rows.length > cap;
                artifacts = rows.slice(0, cap);
            }

            // Recorded sizes decide how far the read may go before anything is fetched.
            let plannedBytes = 0;
            let planned = artifacts.length;
            for (const [index, artifact] of artifacts.entries()) {
                plannedBytes += typeof artifact.sizeBytes === 'number' && artifact.sizeBytes > 0 ? artifact.sizeBytes : 0;
                if (plannedBytes > maxStored) {
                    planned = index;
                    break;
                }
            }
            const stopsEarly = listCapped || planned < artifacts.length;

            const inFlight = new Map<number, Promise<Fetched>>();
            let nextToStart = 0;
            const fill = (from: number) => {
                while (nextToStart < planned && nextToStart < from + concurrency) {
                    if (readOptions?.signal?.aborted || outOfTime()) return;
                    const task = fetchOne(ref.projectId, artifacts[nextToStart]);
                    // Left behind when the read ends early; must not reject unhandled.
                    task.catch(() => undefined);
                    inFlight.set(nextToStart, task);
                    nextToStart += 1;
                }
            };

            let storedBytes = 0;
            let decompressedBytes = 0;
            for (let index = 0; index < planned; index += 1) {
                if (readOptions?.signal?.aborted) return;
                fill(index);
                const task = inFlight.get(index);
                if (!task) {
                    // Not started: the budget ran out before its turn.
                    yield { events: [], capReached: true };
                    return;
                }
                inFlight.delete(index);

                let fetched: Fetched;
                if (budgetMs === undefined) {
                    fetched = await task;
                } else {
                    let timer: NodeJS.Timeout | undefined;
                    const remaining = Math.max(0, budgetMs - (now() - startedAt));
                    fetched = await Promise.race([
                        task,
                        new Promise<Fetched>((resolve) => {
                            timer = setTimeout(() => resolve(STOP), remaining);
                            timer.unref?.();
                        }),
                    ]).finally(() => {
                        if (timer) clearTimeout(timer);
                    });
                }

                if (fetched.kind === 'skip') continue;
                if (fetched.kind === 'stop') {
                    yield { events: [], capReached: true };
                    return;
                }
                // The real size, so a wrong recorded size cannot stretch the cap.
                storedBytes += fetched.storedBytes;
                decompressedBytes += fetched.bytes;
                if (storedBytes > maxStored || decompressedBytes > maxDecompressed) {
                    yield { events: [], capReached: true };
                    return;
                }
                yield { events: fetched.events, bytes: fetched.bytes };
            }
            if (stopsEarly) yield { events: [], capReached: true };
        },
    };
}

// --- Short-lived cache ------------------------------------------------------------

export interface CachingArtifactReaderOptions {
    /** How long a session's events are kept. */
    ttlMs?: number;
    /** Decompressed bytes kept in total. The oldest entries go first. */
    maxBytes?: number;
    /** Sessions larger than this are not kept. */
    maxSessionBytes?: number;
    /** For tests. Milliseconds on a monotonic clock. */
    now?: () => number;
}

export const DEFAULT_ARTIFACT_CACHE_TTL_MS = 90_000;
export const DEFAULT_ARTIFACT_CACHE_MAX_BYTES = 24 * 1024 * 1024;
export const DEFAULT_ARTIFACT_CACHE_MAX_SESSION_BYTES = 3 * 1024 * 1024;

/**
 * Keeps the events of recently read sessions for a short time. A client that
 * asks for a session's context usually asks for its timeline or one of its
 * crashes next, and each of those would otherwise download the same files.
 *
 * Only whole, complete reads are kept (never a windowed, capped or interrupted
 * one), and a windowed read is served from a kept whole one. The key is the
 * project and the session together, and the caller reaches this only after the
 * session row was found under the grant, so a hit cannot cross projects.
 */
export function createCachingArtifactReader(inner: ArtifactReader, options: CachingArtifactReaderOptions = {}): ArtifactReader {
    const ttlMs = options.ttlMs ?? DEFAULT_ARTIFACT_CACHE_TTL_MS;
    const maxBytes = options.maxBytes ?? DEFAULT_ARTIFACT_CACHE_MAX_BYTES;
    const maxSessionBytes = Math.min(maxBytes, options.maxSessionBytes ?? DEFAULT_ARTIFACT_CACHE_MAX_SESSION_BYTES);
    const now = options.now ?? (() => performance.now());
    const entries = new Map<string, { batches: unknown[][]; bytes: number; expiresAt: number }>();
    let totalBytes = 0;

    const keyOf = (ref: ArtifactSessionRef) => `${ref.projectId}\u0000${ref.sessionId}`;
    const drop = (key: string) => {
        const entry = entries.get(key);
        if (!entry) return;
        entries.delete(key);
        totalBytes -= entry.bytes;
    };
    const fresh = (key: string) => {
        const entry = entries.get(key);
        if (!entry) return null;
        if (entry.expiresAt <= now()) {
            drop(key);
            return null;
        }
        return entry;
    };

    return {
        hasEvents: async (ref) => {
            const cached = fresh(keyOf(ref));
            if (cached) return cached.batches.length > 0;
            return inner.hasEvents ? inner.hasEvents(ref) : true;
        },

        async *readEventBatches(ref, readOptions) {
            const key = keyOf(ref);
            const cached = fresh(key);
            if (cached) {
                // Copies, so one caller cannot change what the next one reads.
                for (const events of cached.batches) yield { events: structuredClone(events) };
                return;
            }

            const keep = !readOptions?.window;
            const batches: unknown[][] = [];
            let bytes = 0;
            let complete = true;
            for await (const batch of inner.readEventBatches(ref, readOptions)) {
                if (batch.capReached) complete = false;
                if (keep && complete) {
                    // Without a size the batch cannot be accounted for, so nothing is kept.
                    if (batch.bytes === undefined || bytes + batch.bytes > maxSessionBytes) complete = false;
                    else {
                        bytes += batch.bytes;
                        batches.push(structuredClone(batch.events));
                    }
                }
                yield batch;
            }
            // Reached only when the caller read to the end.
            if (!keep || !complete || readOptions?.signal?.aborted) return;
            drop(key);
            while (totalBytes + bytes > maxBytes && entries.size > 0) drop(entries.keys().next().value as string);
            entries.set(key, { batches, bytes, expiresAt: now() + ttlMs });
            totalBytes += bytes;
        },
    };
}

/**
 * The production reader, over the existing storage layer. `db/s3.ts` is
 * loaded on first use so that importing this module does not load the AWS SDK
 * or the API's configuration.
 */
export function createS3ArtifactReader(
    db: McpDb,
    limits: Omit<StorageArtifactReaderOptions, 'db' | 'download'> = {},
): ArtifactReader {
    let downloadPromise: Promise<ArtifactDownload> | null = null;
    const download: ArtifactDownload = async (projectId, key, endpointId) => {
        downloadPromise ??= import('../../db/s3.js').then((s3) => s3.downloadRawFromS3ForArtifact);
        return (await downloadPromise)(projectId, key, endpointId);
    };
    return createCachingArtifactReader(createStorageArtifactReader({ ...limits, db, download }));
}
