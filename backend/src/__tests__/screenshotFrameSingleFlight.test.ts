/**
 * Frame builds are single-flight across pods.
 *
 * Frame object keys are deterministic, so two pods building one session PUT
 * byte-identical objects to identical keys and S3 answers with a transient
 * 409 OperationAborted. These tests drive the real lock against an in-memory
 * Redis so the winner/loser split is exercised end to end rather than mocked away.
 */
import { gzipSync } from 'node:zlib';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    db: { select: vi.fn() },
    downloadFromS3ForArtifact: vi.fn(),
    getSignedDownloadUrl: vi.fn(),
    getSignedDownloadUrlForProject: vi.fn(),
    uploadToS3ForArtifact: vi.fn(),
    redis: null as any,
}));

/** Minimal Redis supporting exactly what the lease and frame cache use. */
function createFakeRedis() {
    const store = new Map<string, string>();
    return {
        store,
        async get(key: string) { return store.get(key) ?? null; },
        async setex(key: string, _ttl: number, value: string) { store.set(key, value); return 'OK'; },
        async del(key: string) { return store.delete(key) ? 1 : 0; },
        async set(key: string, value: string, ..._rest: unknown[]) {
            // Always called as SET key value PX <ttl> NX by the lease.
            if (store.has(key)) return null;
            store.set(key, value);
            return 'OK';
        },
        async eval(script: string, _numKeys: number, key: string, token: string, _ttl?: string) {
            if (store.get(key) !== token) return 0;
            if (script.includes('del')) { store.delete(key); return 1; }
            return 1; // pexpire
        },
    };
}

vi.mock('drizzle-orm', () => ({
    and: vi.fn((...args) => ({ args })),
    eq: vi.fn((...args) => ({ args })),
}));

vi.mock('../db/client.js', () => ({
    db: mocks.db,
    recordingArtifacts: {
        endpointId: 'x', endTime: 'x', frameCount: 'x', id: 'x', kind: 'x',
        s3ObjectKey: 'x', sessionId: 'x', startTime: 'x', status: 'x',
    },
    sessions: { endedAt: 'x', id: 'x', projectId: 'x', startedAt: 'x' },
}));

vi.mock('../db/redis.js', () => ({ getRedis: () => mocks.redis }));

vi.mock('../db/s3.js', () => ({
    downloadFromS3ForArtifact: mocks.downloadFromS3ForArtifact,
    getSignedDownloadUrl: mocks.getSignedDownloadUrl,
    getSignedDownloadUrlForProject: mocks.getSignedDownloadUrlForProject,
    uploadToS3ForArtifact: mocks.uploadToS3ForArtifact,
}));

vi.mock('../logger.js', () => ({
    logger: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

// Shorten the wait-for-other-builder window; the service reads it at module load.
process.env.RJ_SCREENSHOT_FRAME_BUILD_WAIT_MS = '600';

const { getSessionScreenshotFrames } = await import('../services/screenshotFrames.js');

const START = new Date('2026-06-12T18:00:00.000Z');
const SESSION_ID = 'session-single-flight';

function tarHeader(name: string, size: number): Buffer {
    const header = Buffer.alloc(512, 0);
    header.write(name, 0, 100, 'utf8');
    header.write('0000777\0', 100, 8, 'ascii');
    header.write('0000000\0', 108, 8, 'ascii');
    header.write('0000000\0', 116, 8, 'ascii');
    header.write(size.toString(8).padStart(11, '0') + '\0', 124, 12, 'ascii');
    header.write('00000000000\0', 136, 12, 'ascii');
    header.fill(0x20, 148, 156);
    header[156] = '0'.charCodeAt(0);
    let checksum = 0;
    for (const byte of header) checksum += byte;
    header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
    return header;
}

function tarGzipFiles(files: Array<{ name: string; data: Buffer }>): Buffer {
    const parts: Buffer[] = [];
    for (const file of files) {
        const padding = Buffer.alloc((512 - (file.data.length % 512)) % 512, 0);
        parts.push(tarHeader(file.name, file.data.length), file.data, padding);
    }
    parts.push(Buffer.alloc(1024, 0));
    return gzipSync(Buffer.concat(parts));
}

/** Shape-based (not call-ordered) so concurrent callers each resolve correctly. */
function stubSessionAndSegments(segments: Array<Record<string, unknown>>): void {
    mocks.db.select.mockImplementation(() => ({
        from: vi.fn(() => ({
            where: vi.fn(() => ({
                limit: vi.fn(async () => [{ projectId: 'project-1', startedAt: START, endedAt: null }]),
                orderBy: vi.fn(async () => segments),
            })),
        })),
    }));
}

function twoFrameArchive(): Buffer {
    return tarGzipFiles([
        { name: `${START.getTime()}_1_100.jpeg`, data: Buffer.from([0xff, 0xd8, 0xff, 0x01, 0xd9]) },
        { name: `${START.getTime()}_1_200.jpeg`, data: Buffer.from([0xff, 0xd8, 0xff, 0x02, 0xd9]) },
    ]);
}

const SEGMENT = {
    artifactId: 'artifact-1',
    archiveS3Key: 'tenant/team/project/session/screenshots/segment.tar.gz',
    endpointId: 'endpoint-1',
    startTime: START.getTime(),
    endTime: null,
    frameCount: 2,
};

describe('screenshot frame build single-flight', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.redis = createFakeRedis();
        mocks.uploadToS3ForArtifact.mockResolvedValue({ success: true, endpointId: 'endpoint-1' });
        mocks.downloadFromS3ForArtifact.mockResolvedValue(twoFrameArchive());
        stubSessionAndSegments([SEGMENT]);
    });

    it('uploads each deterministic frame key once when two builders race', async () => {
        const [first, second] = await Promise.all([
            getSessionScreenshotFrames(SESSION_ID, { urlMode: 'none' }),
            getSessionScreenshotFrames(SESSION_ID, { urlMode: 'none' }),
        ]);

        // Two frames, one build: without the lease this is 4 PUTs and 2 S3 409s.
        expect(mocks.uploadToS3ForArtifact).toHaveBeenCalledTimes(2);

        const keys = mocks.uploadToS3ForArtifact.mock.calls.map((c) => c[1]);
        expect(new Set(keys).size).toBe(2);

        // Both callers still get the frames.
        expect(first?.totalFrames).toBe(2);
        expect(second?.totalFrames).toBe(2);
    });

    it('releases the lease so a later build can proceed', async () => {
        await getSessionScreenshotFrames(SESSION_ID, { urlMode: 'none' });

        const leaseKeys = [...mocks.redis.store.keys()].filter((k: string) => k.includes(':build:'));
        expect(leaseKeys).toEqual([]);
    });

    it('does not download or upload anything when another pod holds the lease', async () => {
        // Pre-take the lease as a different pod would.
        await mocks.redis.set(`screenshot_frames:build:v1:${SESSION_ID}`, 'other-pod-token', 'PX', 60_000, 'NX');

        const result = await getSessionScreenshotFrames(SESSION_ID, { urlMode: 'none' });

        expect(mocks.uploadToS3ForArtifact).not.toHaveBeenCalled();
        expect(mocks.downloadFromS3ForArtifact).not.toHaveBeenCalled();
        // Nothing cached yet by the other pod, so there is no progress to report.
        expect(result).toBeNull();
    });

    it('returns the other pod\'s finished index instead of rebuilding', async () => {
        await mocks.redis.set(`screenshot_frames:build:v1:${SESSION_ID}`, 'other-pod-token', 'PX', 60_000, 'NX');
        await mocks.redis.setex(`screenshot_frames:v2:${SESSION_ID}`, 1, JSON.stringify({
            sessionId: SESSION_ID,
            totalFrames: 1,
            sessionStartTime: START.getTime(),
            status: 'ready',
            processedSegments: 1,
            totalSegments: 1,
            frames: [{ timestamp: START.getTime() + 100, s3Key: 'k', endpointId: 'e', directReady: true, index: 0, sizeBytes: 5 }],
            extractedAt: Date.now(),
        }));

        const result = await getSessionScreenshotFrames(SESSION_ID, { urlMode: 'none' });

        expect(result?.totalFrames).toBe(1);
        expect(mocks.uploadToS3ForArtifact).not.toHaveBeenCalled();
    });

    it('still builds when Redis cannot coordinate, so a lock outage never blocks frames', async () => {
        mocks.redis = {
            get: async () => { throw new Error('redis down'); },
            setex: async () => { throw new Error('redis down'); },
            del: async () => { throw new Error('redis down'); },
            set: async () => { throw new Error('redis down'); },
            eval: async () => { throw new Error('redis down'); },
        };

        const result = await getSessionScreenshotFrames(SESSION_ID, { urlMode: 'none' });

        expect(result?.totalFrames).toBe(2);
        expect(mocks.uploadToS3ForArtifact).toHaveBeenCalledTimes(2);
    });

    it('does not publish a ready index after losing the lease mid-build', async () => {
        const lockKey = `screenshot_frames:build:v1:${SESSION_ID}`;
        // Steal the lease while the archive download is in flight.
        mocks.downloadFromS3ForArtifact.mockImplementation(async () => {
            mocks.redis.store.set(lockKey, 'stolen-by-another-pod');
            return twoFrameArchive();
        });

        const result = await getSessionScreenshotFrames(SESSION_ID, { urlMode: 'none' });

        // The caller still gets its frames...
        expect(result?.totalFrames).toBe(2);

        // ...but must not publish a 'ready' index the lease no longer covers. Only the
        // placeholder written before the lease was stolen may remain.
        const published = JSON.parse(mocks.redis.store.get(`screenshot_frames:v2:${SESSION_ID}`)!);
        expect(published.status).toBe('building');
        expect(published.totalFrames).toBe(0);

        // And it must not steal the lease back on release.
        expect(mocks.redis.store.get(lockKey)).toBe('stolen-by-another-pod');
    });
});
