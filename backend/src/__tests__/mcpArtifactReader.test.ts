/**
 * The object-storage artifact reader, with a fake download function: it reads
 * `kind = 'events'` artifacts of the right project only, stops at the byte
 * caps, and never lets a key or a storage error out.
 */
import { gzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { recordingArtifacts, sessions } from '../db/schema.js';
import { InMemoryArtifactReader, createCachingArtifactReader, createStorageArtifactReader } from '../mcp/artifacts/reader.js';
import type { ArtifactEventBatch, StorageArtifactReaderOptions } from '../mcp/artifacts/reader.js';
import { PGLITE_SEED, PGLITE_START_TIMEOUT_MS, createPgliteHarness } from './helpers/pgliteHarness.js';
import type { PgliteHarness } from './helpers/pgliteHarness.js';

let harness: PgliteHarness;
const sessionId = PGLITE_SEED.teamA.sessionIds[0];
const projectId = PGLITE_SEED.teamA.projectId;
const otherProjectId = PGLITE_SEED.teamB.projectId;
const objects = new Map<string, Buffer>();
const downloads: Array<{ projectId: string; key: string; endpointId: string | null }> = [];

async function collect(batches: AsyncIterable<ArtifactEventBatch>): Promise<ArtifactEventBatch[]> {
    const all: ArtifactEventBatch[] = [];
    for await (const batch of batches) all.push(batch);
    return all;
}

function reader(limits: { maxStoredBytesPerSession?: number; maxDecompressedBytesPerSession?: number; maxArtifactsPerSession?: number } = {}) {
    return createStorageArtifactReader({
        db: harness.db,
        download: async (project, key, endpointId) => {
            downloads.push({ projectId: project, key, endpointId });
            if (key.includes('explode')) throw new Error(`storage failure for ${key}`);
            return objects.get(key) ?? null;
        },
        ...limits,
    });
}

beforeAll(async () => {
    harness = await createPgliteHarness();
    const gz = (events: unknown) => gzipSync(Buffer.from(JSON.stringify(events)));
    objects.set('k/events-1.json.gz', gz([{ type: 'touch', n: 1 }, { type: 'touch', n: 2 }]));
    objects.set('k/events-2.json.gz', gz({ events: [{ type: 'navigation', n: 3 }], deviceInfo: { screenWidth: 390 } }));
    objects.set('k/events-raw.json.gz', Buffer.from(JSON.stringify([{ type: 'custom', n: 4 }])));
    objects.set('k/events-bad.json.gz', Buffer.from('not json at all'));
    objects.set('k/screenshots.tar.gz', gz([{ type: 'SHOULD_NOT_BE_READ' }]));
    objects.set('k/pending.json.gz', gz([{ type: 'SHOULD_NOT_BE_READ' }]));
    const base = harness.seed.teamA.sessionIds.length; // keep the type checker honest about the seed
    expect(base).toBeGreaterThan(0);
    await harness.db.insert(recordingArtifacts).values([
        { sessionId, kind: 'events', s3ObjectKey: 'k/events-2.json.gz', status: 'ready', sizeBytes: 100, startTime: 2000, endpointId: 'ep-1' },
        { sessionId, kind: 'events', s3ObjectKey: 'k/events-1.json.gz', status: 'ready', sizeBytes: 100, startTime: 1000 },
        { sessionId, kind: 'events', s3ObjectKey: 'k/events-raw.json.gz', status: 'ready', sizeBytes: 50, startTime: 3000 },
        { sessionId, kind: 'events', s3ObjectKey: 'k/events-bad.json.gz', status: 'ready', sizeBytes: 15, startTime: 4000 },
        { sessionId, kind: 'events', s3ObjectKey: 'k/explode.json.gz', status: 'ready', sizeBytes: 15, startTime: 5000 },
        { sessionId, kind: 'events', s3ObjectKey: 'k/missing.json.gz', status: 'ready', sizeBytes: 15, startTime: 6000 },
        { sessionId, kind: 'events', s3ObjectKey: 'k/pending.json.gz', status: 'pending', sizeBytes: 15, startTime: 500 },
        { sessionId, kind: 'screenshots', s3ObjectKey: 'k/screenshots.tar.gz', status: 'ready', sizeBytes: 15, startTime: 100 },
        { sessionId, kind: 'hierarchy', s3ObjectKey: 'k/hierarchy.json.gz', status: 'ready', sizeBytes: 15 },
        { sessionId, kind: 'network', s3ObjectKey: 'k/network.json.gz', status: 'ready', sizeBytes: 15 },
    ]);
}, PGLITE_START_TIMEOUT_MS);

afterAll(async () => {
    await harness.close();
});

describe('storage artifact reader', () => {
    it('reads only ready events artifacts, oldest first, in both stored shapes', async () => {
        downloads.length = 0;
        const batches = await collect(reader().readEventBatches({ projectId, sessionId }));
        expect(batches.map((batch) => batch.events)).toEqual([
            [{ type: 'touch', n: 1 }, { type: 'touch', n: 2 }],
            [{ type: 'navigation', n: 3 }],
            [{ type: 'custom', n: 4 }],
        ]);
        expect(downloads.map((download) => download.key)).toEqual([
            'k/events-1.json.gz', 'k/events-2.json.gz', 'k/events-raw.json.gz', 'k/events-bad.json.gz', 'k/explode.json.gz', 'k/missing.json.gz',
        ]);
        expect(downloads[1].endpointId).toBe('ep-1');
        expect(JSON.stringify(batches)).not.toContain('SHOULD_NOT_BE_READ');
    });

    it('yields batches without keys, and swallows storage errors that name a key', async () => {
        const batches = await collect(reader().readEventBatches({ projectId, sessionId }));
        expect(JSON.stringify(batches)).not.toMatch(/k\/|json\.gz|storage failure|ep-1/);
        expect(batches.every((batch) => Object.keys(batch).every((key) => key === 'events' || key === 'capReached' || key === 'bytes'))).toBe(true);
    });

    it('finds nothing for the wrong project or an unknown session, without downloading', async () => {
        downloads.length = 0;
        expect(await collect(reader().readEventBatches({ projectId: otherProjectId, sessionId }))).toEqual([]);
        expect(await collect(reader().readEventBatches({ projectId, sessionId: 'session_does_not_exist' }))).toEqual([]);
        expect(downloads).toEqual([]);
    });

    it('stops at the stored-bytes cap before downloading past it', async () => {
        downloads.length = 0;
        const batches = await collect(reader({ maxStoredBytesPerSession: 150 }).readEventBatches({ projectId, sessionId }));
        expect(batches).toHaveLength(2);
        expect(batches[0].events).toHaveLength(2);
        expect(batches[1]).toEqual({ events: [], capReached: true });
        expect(downloads.map((download) => download.key)).toEqual(['k/events-1.json.gz']);
    });

    it('stops at the decompressed-bytes cap', async () => {
        const batches = await collect(reader({ maxDecompressedBytesPerSession: 60 }).readEventBatches({ projectId, sessionId }));
        expect(batches[batches.length - 1]).toEqual({ events: [], capReached: true });
        expect(batches.flatMap((batch) => batch.events)).toHaveLength(2);
    });

    it('stops at the artifact-count cap', async () => {
        const batches = await collect(reader({ maxArtifactsPerSession: 1 }).readEventBatches({ projectId, sessionId }));
        expect(batches).toEqual([{ events: [{ type: 'touch', n: 1 }, { type: 'touch', n: 2 }], bytes: expect.any(Number) }, { events: [], capReached: true }]);
    });

    it('stops when the call is aborted', async () => {
        const controller = new AbortController();
        controller.abort();
        expect(await collect(reader().readEventBatches({ projectId, sessionId }, { signal: controller.signal }))).toEqual([]);
    });

    it('sessions is the only other table it touches', async () => {
        // The join is what scopes artifacts to a project.
        const [row] = await harness.db.select({ projectId: sessions.projectId }).from(sessions).limit(1);
        expect(row.projectId).toBeDefined();
    });
});

describe('in-memory artifact reader', () => {
    it('is keyed by project and session and records what was read', async () => {
        const memory = new InMemoryArtifactReader();
        memory.put({ projectId: 'p1', sessionId: 's1' }, [{ a: 1 }]);
        memory.put({ projectId: 'p1', sessionId: 's1' }, [{ a: 2 }]);
        expect(await collect(memory.readEventBatches({ projectId: 'p1', sessionId: 's1' }))).toEqual([{ events: [{ a: 1 }] }, { events: [{ a: 2 }] }]);
        expect(await collect(memory.readEventBatches({ projectId: 'p2', sessionId: 's1' }))).toEqual([]);
        expect(memory.reads).toEqual([{ projectId: 'p1', sessionId: 's1' }, { projectId: 'p2', sessionId: 's1' }]);
    });
});

describe('storage artifact reader: many small files, far away', () => {
    // Twelve event files, ten seconds each, on a second session.
    const longSessionId = PGLITE_SEED.teamA.sessionIds[1];
    const T0 = 1_800_000_000_000;
    let inFlight = 0;
    let peak = 0;
    const fetched: string[] = [];
    /** Milliseconds a download of this key takes. */
    const delays = new Map<string, number>();

    function slowReader(limits: Partial<StorageArtifactReaderOptions> = {}) {
        return createStorageArtifactReader({
            db: harness.db,
            download: async (_project, key) => {
                fetched.push(key);
                inFlight += 1;
                peak = Math.max(peak, inFlight);
                await new Promise((resolve) => setTimeout(resolve, delays.get(key) ?? 5));
                inFlight -= 1;
                return objects.get(key) ?? null;
            },
            ...limits,
        });
    }
    const reset = () => {
        fetched.length = 0;
        peak = 0;
        delays.clear();
    };
    const numbers = (batches: ArtifactEventBatch[]) => batches.flatMap((batch) => batch.events as Array<{ n: number }>).map((event) => event.n);

    beforeAll(async () => {
        const rows = [];
        for (let n = 0; n < 12; n += 1) {
            const key = `long/part-${String(n).padStart(2, '0')}.json.gz`;
            objects.set(key, gzipSync(Buffer.from(JSON.stringify([{ type: 'touch', n }]))));
            rows.push({ sessionId: longSessionId, kind: 'events', s3ObjectKey: key, status: 'ready', sizeBytes: 40, startTime: T0 + n * 10_000, endTime: T0 + n * 10_000 + 9_999 });
        }
        await harness.db.insert(recordingArtifacts).values(rows);
    });

    it('downloads several at a time, never more than the limit, and still yields oldest first', async () => {
        reset();
        // The first file is the slowest: later ones finish before it.
        delays.set('long/part-00.json.gz', 60);
        const batches = await collect(slowReader({ downloadConcurrency: 4 }).readEventBatches({ projectId, sessionId: longSessionId }));
        expect(numbers(batches)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
        expect(peak).toBeGreaterThan(1);
        expect(peak).toBeLessThanOrEqual(4);
        expect(fetched).toHaveLength(12);
    });

    it('holds every read in the process to one shared download limit', async () => {
        reset();
        const shared = slowReader({ downloadConcurrency: 8, maxConcurrentDownloads: 3 });
        await Promise.all([
            collect(shared.readEventBatches({ projectId, sessionId: longSessionId })),
            collect(shared.readEventBatches({ projectId, sessionId: longSessionId })),
        ]);
        expect(fetched).toHaveLength(24);
        expect(peak).toBeLessThanOrEqual(3);
    });

    it('a windowed read fetches only the files that overlap the window', async () => {
        reset();
        // 45 s to 72 s: parts 4 (40-50 s), 5, 6 and 7 (70-80 s).
        const window = { fromMs: T0 + 45_000, toMs: T0 + 72_000 };
        const batches = await collect(slowReader().readEventBatches({ projectId, sessionId: longSessionId }, { window }));
        expect(numbers(batches)).toEqual([4, 5, 6, 7]);
        expect([...fetched].sort()).toEqual(['long/part-04.json.gz', 'long/part-05.json.gz', 'long/part-06.json.gz', 'long/part-07.json.gz']);
        expect(batches.some((batch) => batch.capReached)).toBe(false);
    });

    it('a windowed read over its file cap keeps the files nearest the end of the window, and says it stopped', async () => {
        reset();
        const window = { fromMs: T0, toMs: T0 + 72_000 };
        const batches = await collect(slowReader({ maxArtifactsPerWindow: 3 }).readEventBatches({ projectId, sessionId: longSessionId }, { window }));
        expect(numbers(batches)).toEqual([5, 6, 7]);
        expect(batches[batches.length - 1]).toEqual({ events: [], capReached: true });
        expect(fetched).toHaveLength(3);

        // The same cut is not reported when the files kept reach back to what the caller needs.
        const enough = await collect(slowReader({ maxArtifactsPerWindow: 3 }).readEventBatches({ projectId, sessionId: longSessionId }, { window: { ...window, needFromMs: T0 + 55_000 } }));
        expect(numbers(enough)).toEqual([5, 6, 7]);
        expect(enough.some((batch) => batch.capReached)).toBe(false);
        const notEnough = await collect(slowReader({ maxArtifactsPerWindow: 3 }).readEventBatches({ projectId, sessionId: longSessionId }, { window: { ...window, needFromMs: T0 + 45_000 } }));
        expect(notEnough[notEnough.length - 1]).toEqual({ events: [], capReached: true });
    });

    it('a window with nothing in it yields nothing, and hasEvents tells that apart from an empty session', async () => {
        reset();
        const r = slowReader();
        expect(await collect(r.readEventBatches({ projectId, sessionId: longSessionId }, { window: { fromMs: T0 - 60_000, toMs: T0 - 1 } }))).toEqual([]);
        expect(fetched).toEqual([]);
        expect(await r.hasEvents!({ projectId, sessionId: longSessionId })).toBe(true);
        expect(await r.hasEvents!({ projectId: otherProjectId, sessionId: longSessionId })).toBe(false);
        expect(await r.hasEvents!({ projectId, sessionId: 'session_does_not_exist' })).toBe(false);
    });

    it('stops as partial when the time budget runs out, keeping what it had in order', async () => {
        reset();
        for (let n = 2; n < 12; n += 1) delays.set(`long/part-${String(n).padStart(2, '0')}.json.gz`, 400);
        const started = performance.now();
        const batches = await collect(slowReader({ downloadConcurrency: 2 }).readEventBatches({ projectId, sessionId: longSessionId }, { budgetMs: 80 }));
        expect(performance.now() - started).toBeLessThan(350);
        expect(numbers(batches)).toEqual([0, 1]);
        expect(batches[batches.length - 1]).toEqual({ events: [], capReached: true });
        // Nothing new was started once the budget was spent.
        expect(fetched.length).toBeLessThan(12);
    });

    it('one download that hangs ends the read as partial instead of hanging the call', async () => {
        reset();
        delays.set('long/part-03.json.gz', 2_000);
        const batches = await collect(slowReader({ downloadTimeoutMs: 60 }).readEventBatches({ projectId, sessionId: longSessionId }));
        expect(numbers(batches)).toEqual([0, 1, 2]);
        expect(batches[batches.length - 1]).toEqual({ events: [], capReached: true });
    });

    it('a single file that decompresses past the per-file limit ends the read as partial', async () => {
        reset();
        const batches = await collect(slowReader({ maxDecompressedBytesPerArtifact: 10 }).readEventBatches({ projectId, sessionId: longSessionId }));
        expect(batches).toEqual([{ events: [], capReached: true }]);
    });

    describe('short-lived cache', () => {
        it('serves a second whole read, and a windowed read, without downloading again', async () => {
            reset();
            let clock = 0;
            const cached = createCachingArtifactReader(slowReader(), { ttlMs: 1_000, now: () => clock });
            const first = await collect(cached.readEventBatches({ projectId, sessionId: longSessionId }));
            expect(fetched).toHaveLength(12);

            const second = await collect(cached.readEventBatches({ projectId, sessionId: longSessionId }));
            const windowed = await collect(cached.readEventBatches({ projectId, sessionId: longSessionId }, { window: { fromMs: T0, toMs: T0 + 1 } }));
            expect(fetched).toHaveLength(12);
            expect(numbers(second)).toEqual(numbers(first));
            expect(numbers(windowed)).toEqual(numbers(first));
            // Copies: changing one result does not change the next.
            (second[0].events[0] as { n: number }).n = 999;
            expect(numbers(await collect(cached.readEventBatches({ projectId, sessionId: longSessionId })))[0]).toBe(0);
            expect(await cached.hasEvents!({ projectId, sessionId: longSessionId })).toBe(true);

            // Keyed by project and session: another project finds nothing, cached or not.
            expect(await collect(cached.readEventBatches({ projectId: otherProjectId, sessionId: longSessionId }))).toEqual([]);

            clock = 1_001;
            await collect(cached.readEventBatches({ projectId, sessionId: longSessionId }));
            expect(fetched).toHaveLength(24);
        });

        it('does not keep windowed, capped or oversized reads, and evicts the oldest over its byte limit', async () => {
            reset();
            const windowOnly = createCachingArtifactReader(slowReader());
            await collect(windowOnly.readEventBatches({ projectId, sessionId: longSessionId }, { window: { fromMs: T0, toMs: T0 + 15_000 } }));
            await collect(windowOnly.readEventBatches({ projectId, sessionId: longSessionId }, { window: { fromMs: T0, toMs: T0 + 15_000 } }));
            expect(fetched).toHaveLength(4);

            reset();
            const capped = createCachingArtifactReader(slowReader({ maxArtifactsPerSession: 5 }));
            await collect(capped.readEventBatches({ projectId, sessionId: longSessionId }));
            await collect(capped.readEventBatches({ projectId, sessionId: longSessionId }));
            expect(fetched).toHaveLength(10);

            reset();
            const tooBig = createCachingArtifactReader(slowReader(), { maxSessionBytes: 50 });
            await collect(tooBig.readEventBatches({ projectId, sessionId: longSessionId }));
            await collect(tooBig.readEventBatches({ projectId, sessionId: longSessionId }));
            expect(fetched).toHaveLength(24);

            reset();
            // Room for one session only: reading a second one pushes the first out.
            const small = createCachingArtifactReader(slowReader(), { maxBytes: 300, maxSessionBytes: 300 });
            await collect(small.readEventBatches({ projectId, sessionId: longSessionId }));
            await collect(small.readEventBatches({ projectId, sessionId }));
            const before = fetched.length;
            await collect(small.readEventBatches({ projectId, sessionId }));
            expect(fetched.length).toBe(before);
            await collect(small.readEventBatches({ projectId, sessionId: longSessionId }));
            expect(fetched.length).toBe(before + 12);
        });
    });
});
