import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
    const store = new Map<string, Buffer | string>();
    const redis = {
        store,
        getBuffer: vi.fn(async (key: string) => {
            const value = store.get(key);
            if (value === undefined) return null;
            return Buffer.isBuffer(value) ? value : Buffer.from(value);
        }),
        get: vi.fn(async (key: string) => {
            const value = store.get(key);
            if (value === undefined) return null;
            return Buffer.isBuffer(value) ? value.toString() : value;
        }),
        set: vi.fn(async (key: string, value: string, _ex: string, _ttl: number, nx?: string) => {
            if (nx === 'NX' && store.has(key)) return null;
            store.set(key, value);
            return 'OK';
        }),
        setex: vi.fn(async (key: string, _ttlSeconds: number, value: Buffer | string) => {
            store.set(key, value);
            return 'OK';
        }),
        del: vi.fn(async (key: string) => (store.delete(key) ? 1 : 0)),
    };
    return {
        redis,
        db: { select: vi.fn() },
        downloadFromS3ForArtifact: vi.fn(),
        extractFramesFromArchive: vi.fn(),
    };
});

vi.mock('drizzle-orm', () => ({
    and: vi.fn((...args) => ({ args })),
    eq: vi.fn((...args) => ({ args })),
}));

vi.mock('../db/client.js', () => ({
    db: mocks.db,
    recordingArtifacts: {
        endpointId: 'recording_artifacts.endpoint_id',
        id: 'recording_artifacts.id',
        kind: 'recording_artifacts.kind',
        s3ObjectKey: 'recording_artifacts.s3_object_key',
        sessionId: 'recording_artifacts.session_id',
        status: 'recording_artifacts.status',
        timestamp: 'recording_artifacts.timestamp',
    },
    sessions: {
        id: 'sessions.id',
        projectId: 'sessions.project_id',
        startedAt: 'sessions.started_at',
    },
}));

vi.mock('../db/redis.js', () => ({
    getRedis: () => mocks.redis,
}));

vi.mock('../db/s3.js', () => ({
    downloadFromS3ForArtifact: mocks.downloadFromS3ForArtifact,
    getSignedDownloadUrl: vi.fn(),
    getSignedDownloadUrlForProject: vi.fn(),
    uploadToS3ForArtifact: vi.fn(),
}));

vi.mock('../services/screenshotFrames.js', () => ({
    extractFramesFromArchive: mocks.extractFramesFromArchive,
}));

vi.mock('../logger.js', () => ({
    logger: {
        debug: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
    },
}));

import {
    buildSessionCoverCacheKey,
    buildSessionCoverEtag,
    findSessionCoverArtifact,
    getOrBuildSessionCover,
    ifNoneMatchIncludes,
    resolveSessionCoverResponse,
} from '../services/sessionThumbnail.js';

const session = { id: 'session-1', projectId: 'project-1', startedAt: new Date(1_700_000_000_000) };
const artifact = { id: 'artifact-1', s3ObjectKey: 'sessions/session-1/screenshots/0.tar.gz', endpointId: 'endpoint-1' };
const coverKey = buildSessionCoverCacheKey(session.id, artifact.id);
const coverBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

function mockArchiveWithFirstFrame(data: Buffer) {
    mocks.downloadFromS3ForArtifact.mockResolvedValue(Buffer.from('archive'));
    mocks.extractFramesFromArchive.mockResolvedValue([
        { filename: '1.jpg', data, timestamp: 1_700_000_000_100 },
        { filename: '2.jpg', data: Buffer.from('second'), timestamp: 1_700_000_000_200 },
    ]);
}

function setexTtlFor(key: string): number | undefined {
    const call = mocks.redis.setex.mock.calls.find(([calledKey]) => calledKey === key);
    return call?.[1];
}

describe('session cover ETag', () => {
    it('is a strong ETag derived from the artifact id', () => {
        expect(buildSessionCoverEtag('artifact-1')).toBe('"session-cover-v1-artifact-1"');
        expect(buildSessionCoverEtag('artifact-2')).not.toBe(buildSessionCoverEtag('artifact-1'));
    });

    it('matches If-None-Match lists, weak forms and *', () => {
        const etag = buildSessionCoverEtag('artifact-1');
        expect(ifNoneMatchIncludes(etag, etag)).toBe(true);
        expect(ifNoneMatchIncludes(`"other", ${etag}`, etag)).toBe(true);
        expect(ifNoneMatchIncludes(`W/${etag}`, etag)).toBe(true);
        expect(ifNoneMatchIncludes('*', etag)).toBe(true);
        expect(ifNoneMatchIncludes([`"other"`, etag], etag)).toBe(true);
    });

    it('does not match a missing header or another artifact', () => {
        const etag = buildSessionCoverEtag('artifact-1');
        expect(ifNoneMatchIncludes(undefined, etag)).toBe(false);
        expect(ifNoneMatchIncludes('', etag)).toBe(false);
        expect(ifNoneMatchIncludes(buildSessionCoverEtag('artifact-2'), etag)).toBe(false);
        expect(ifNoneMatchIncludes('"session-cover-v1-artifact-10"', etag)).toBe(false);
    });
});

function mockCoverArtifactRows(...rows: Array<typeof artifact[]>) {
    const limit = vi.fn();
    for (const row of rows) limit.mockResolvedValueOnce(row);
    const chain = { from: vi.fn(), where: vi.fn(), orderBy: vi.fn(), limit };
    chain.from.mockReturnValue(chain);
    chain.where.mockReturnValue(chain);
    chain.orderBy.mockReturnValue(chain);
    mocks.db.select.mockReturnValue(chain);
    return chain;
}

describe('findSessionCoverArtifact', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns the first ready screenshot artifact or null', async () => {
        const chain = mockCoverArtifactRows([artifact], []);
        const { limit } = chain;

        await expect(findSessionCoverArtifact('session-1')).resolves.toEqual(artifact);
        await expect(findSessionCoverArtifact('session-1')).resolves.toBeNull();
        expect(chain.orderBy).toHaveBeenCalledWith('recording_artifacts.timestamp');
        expect(limit).toHaveBeenCalledWith(1);
    });
});

describe('getOrBuildSessionCover', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.redis.store.clear();
    });

    it('builds the first frame on a miss and caches it for an hour when stable', async () => {
        mockArchiveWithFirstFrame(coverBytes);

        const result = await getOrBuildSessionCover(session, artifact, { stable: true });

        expect(result.cacheStatus).toBe('miss');
        expect(result.cover?.equals(coverBytes)).toBe(true);
        expect(mocks.downloadFromS3ForArtifact).toHaveBeenCalledWith('project-1', artifact.s3ObjectKey, 'endpoint-1');
        expect(mocks.extractFramesFromArchive).toHaveBeenCalledWith(Buffer.from('archive'), session.startedAt.getTime());
        expect(setexTtlFor(coverKey)).toBe(60 * 60);
        // The build lock is released once the cover is cached.
        expect(mocks.redis.store.has(`${coverKey}:lock`)).toBe(false);
    });

    it('keeps an unstable session cover only briefly', async () => {
        mockArchiveWithFirstFrame(coverBytes);

        await getOrBuildSessionCover(session, artifact, { stable: false });

        expect(setexTtlFor(coverKey)).toBe(300);
    });

    it('serves a cached cover without touching storage', async () => {
        mocks.redis.store.set(coverKey, coverBytes);

        const result = await getOrBuildSessionCover(session, artifact, { stable: true });

        expect(result.cacheStatus).toBe('hit');
        expect(result.cover?.equals(coverBytes)).toBe(true);
        expect(mocks.downloadFromS3ForArtifact).not.toHaveBeenCalled();
        expect(mocks.redis.set).not.toHaveBeenCalled();
    });

    it('caches a missing cover for a minute and then answers it from Redis', async () => {
        mocks.downloadFromS3ForArtifact.mockResolvedValue(null);

        const first = await getOrBuildSessionCover(session, artifact, { stable: true });
        expect(first).toEqual({ cover: null, cacheStatus: 'miss' });
        expect(setexTtlFor(coverKey)).toBe(60);

        const second = await getOrBuildSessionCover(session, artifact, { stable: true });
        expect(second).toEqual({ cover: null, cacheStatus: 'hit' });
        expect(mocks.downloadFromS3ForArtifact).toHaveBeenCalledTimes(1);
    });

    it('caches an archive without frames as a miss', async () => {
        mocks.downloadFromS3ForArtifact.mockResolvedValue(Buffer.from('archive'));
        mocks.extractFramesFromArchive.mockResolvedValue([]);

        const result = await getOrBuildSessionCover(session, artifact, { stable: true });

        expect(result.cover).toBeNull();
        expect(setexTtlFor(coverKey)).toBe(60);
    });

    it('treats a storage error as no cover, like the uncached path', async () => {
        mocks.downloadFromS3ForArtifact.mockRejectedValue(new Error('storage down'));

        const result = await getOrBuildSessionCover(session, artifact, { stable: true });

        expect(result.cover).toBeNull();
        expect(setexTtlFor(coverKey)).toBe(60);
    });

    it('builds once for concurrent misses', async () => {
        let releaseDownload!: (value: Buffer) => void;
        mocks.downloadFromS3ForArtifact.mockImplementation(
            () => new Promise<Buffer>((resolve) => { releaseDownload = resolve; }),
        );
        mocks.extractFramesFromArchive.mockResolvedValue([
            { filename: '1.jpg', data: coverBytes, timestamp: 1_700_000_000_100 },
        ]);

        const first = getOrBuildSessionCover(session, artifact, { stable: true });
        const second = getOrBuildSessionCover(session, artifact, { stable: true });
        await vi.waitFor(() => expect(mocks.downloadFromS3ForArtifact).toHaveBeenCalledTimes(1));
        releaseDownload(Buffer.from('archive'));

        const results = await Promise.all([first, second]);
        expect(results.map((result) => result.cacheStatus).sort()).toEqual(['miss', 'wait-hit']);
        for (const result of results) expect(result.cover?.equals(coverBytes)).toBe(true);
        expect(mocks.downloadFromS3ForArtifact).toHaveBeenCalledTimes(1);
    });

    it('stops waiting on a held lock after about two seconds and builds itself', async () => {
        mocks.redis.store.set(`${coverKey}:lock`, 'other-request');
        mockArchiveWithFirstFrame(coverBytes);
        vi.useFakeTimers();
        try {
            const pending = getOrBuildSessionCover(session, artifact, { stable: true });
            await vi.advanceTimersByTimeAsync(1900);
            expect(mocks.downloadFromS3ForArtifact).not.toHaveBeenCalled();
            await vi.advanceTimersByTimeAsync(300);
            const result = await pending;
            expect(result.cacheStatus).toBe('bypass');
            expect(result.cover?.equals(coverBytes)).toBe(true);
        } finally {
            vi.useRealTimers();
        }
        // The other request's lock is left alone.
        expect(mocks.redis.store.get(`${coverKey}:lock`)).toBe('other-request');
    });

    it('builds directly without waiting when taking the lock fails', async () => {
        mocks.redis.set.mockRejectedValueOnce(new Error('OOM command not allowed'));
        mockArchiveWithFirstFrame(coverBytes);
        vi.useFakeTimers();
        try {
            const pending = getOrBuildSessionCover(session, artifact, { stable: true });
            await vi.advanceTimersByTimeAsync(0);
            await vi.waitFor(() => expect(mocks.downloadFromS3ForArtifact).toHaveBeenCalledTimes(1));
            const result = await pending;
            expect(result.cacheStatus).toBe('bypass');
            expect(result.cover?.equals(coverBytes)).toBe(true);
        } finally {
            vi.useRealTimers();
        }
    });

    it('treats a Redis that does not answer as a miss within the timeout', async () => {
        const never = () => new Promise<never>(() => undefined);
        mocks.redis.getBuffer.mockImplementationOnce(never);
        mocks.redis.set.mockImplementationOnce(never);
        mocks.redis.setex.mockImplementationOnce(never);
        mockArchiveWithFirstFrame(coverBytes);
        vi.useFakeTimers();
        try {
            const pending = getOrBuildSessionCover(session, artifact, { stable: true });
            await vi.advanceTimersByTimeAsync(250);
            await vi.advanceTimersByTimeAsync(250);
            await vi.waitFor(() => expect(mocks.downloadFromS3ForArtifact).toHaveBeenCalledTimes(1));
            await vi.advanceTimersByTimeAsync(250);
            const result = await pending;
            expect(result.cacheStatus).toBe('bypass');
            expect(result.cover?.equals(coverBytes)).toBe(true);
        } finally {
            vi.useRealTimers();
        }
    });

    it('keys the cache by artifact so a new first artifact is built fresh', async () => {
        mocks.redis.store.set(coverKey, coverBytes);
        const newerBytes = Buffer.from([0xff, 0xd8, 9, 9]);
        mockArchiveWithFirstFrame(newerBytes);

        const result = await getOrBuildSessionCover(session, { ...artifact, id: 'artifact-0' }, { stable: true });

        expect(result.cacheStatus).toBe('miss');
        expect(result.cover?.equals(newerBytes)).toBe(true);
    });
});

describe('resolveSessionCoverResponse', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.redis.store.clear();
    });

    it('answers 304 for a matching ETag before Redis or storage is touched', async () => {
        mockCoverArtifactRows([artifact]);

        const result = await resolveSessionCoverResponse(session, {
            ifNoneMatch: buildSessionCoverEtag(artifact.id),
            stable: true,
        });

        expect(result).toEqual({ status: 304, etag: buildSessionCoverEtag(artifact.id) });
        expect(mocks.redis.getBuffer).not.toHaveBeenCalled();
        expect(mocks.downloadFromS3ForArtifact).not.toHaveBeenCalled();
    });

    it('serves the cover with its ETag when the browser holds an older artifact', async () => {
        mockCoverArtifactRows([artifact]);
        mockArchiveWithFirstFrame(coverBytes);

        const result = await resolveSessionCoverResponse(session, {
            ifNoneMatch: buildSessionCoverEtag('artifact-old'),
            stable: true,
        });

        expect(result.status).toBe(200);
        if (result.status !== 200) return;
        expect(result.etag).toBe(buildSessionCoverEtag(artifact.id));
        expect(result.cover.equals(coverBytes)).toBe(true);
        expect(result.cacheStatus).toBe('miss');
    });

    it('is a 404 without a ready screenshot artifact, even for a stale ETag', async () => {
        mockCoverArtifactRows([]);

        const result = await resolveSessionCoverResponse(session, {
            ifNoneMatch: buildSessionCoverEtag(artifact.id),
            stable: true,
        });

        expect(result).toEqual({ status: 404 });
        expect(mocks.downloadFromS3ForArtifact).not.toHaveBeenCalled();
    });

    it('is a 404 when the artifact yields no cover', async () => {
        mockCoverArtifactRows([artifact]);
        mocks.downloadFromS3ForArtifact.mockResolvedValue(null);

        await expect(resolveSessionCoverResponse(session, { ifNoneMatch: undefined, stable: true }))
            .resolves.toEqual({ status: 404 });
    });
});

describe('frameUrlSigningDate', () => {
    it('rounds down to the start of the hour so URLs are stable within it', async () => {
        const actual = await vi.importActual<typeof import('../services/screenshotFrames.js')>(
            '../services/screenshotFrames.js',
        );
        const hourStart = Date.UTC(2026, 9, 31, 14, 0, 0);

        expect(actual.frameUrlSigningDate(hourStart).getTime()).toBe(hourStart);
        expect(actual.frameUrlSigningDate(hourStart + 59 * 60_000 + 59_999).getTime()).toBe(hourStart);
        expect(actual.frameUrlSigningDate(hourStart + 60 * 60_000).getTime()).toBe(hourStart + 60 * 60_000);
    });
});
