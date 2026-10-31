/**
 * Session Thumbnail Service
 *
 * Screenshot-only thumbnail extraction for replay sessions.
 * Supports both legacy tar.gz JPEG archives and current binary.gz bundles.
 */

import { randomUUID } from 'node:crypto';

import { and, eq } from 'drizzle-orm';
import { db, recordingArtifacts, sessions } from '../db/client.js';
import { getRedis } from '../db/redis.js';
import { downloadFromS3ForArtifact } from '../db/s3.js';
import { logger } from '../logger.js';
import { extractFramesFromArchive } from './screenshotFrames.js';

export interface ThumbnailOptions {
    /**
     * Kept for API compatibility with existing callers.
     * Not used for screenshot archives where frame timestamps are explicit.
     */
    timeOffset?: number;
    /**
     * Kept for compatibility. Resizing is not performed in this service.
     */
    width?: number;
    /**
     * Kept for compatibility.
     */
    quality?: number;
    /**
     * Kept for compatibility. Response format is source JPEG.
     */
    format?: 'jpeg' | 'png' | 'webp';
}

const DEFAULT_OPTIONS: Required<ThumbnailOptions> = {
    timeOffset: 0.5,
    width: 375,
    quality: 5,
    format: 'jpeg',
};

interface ArchiveImage {
    name: string;
    data: Buffer;
    timestamp: number | null;
}

async function extractImagesFromArchive(
    archiveBuffer: Buffer,
    sessionStartTime: number
): Promise<ArchiveImage[]> {
    const frames = await extractFramesFromArchive(archiveBuffer, sessionStartTime);
    return frames.map((frame) => ({
        name: frame.filename,
        data: frame.data,
        timestamp: frame.timestamp,
    }));
}

export async function extractThumbnailFromScreenshotArchive(
    archiveBuffer: Buffer,
    options: ThumbnailOptions = {},
    sessionStartTime: number = 0
): Promise<Buffer | null> {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const files = await extractImagesFromArchive(archiveBuffer, sessionStartTime);

    logger.info(
        {
            archiveSize: archiveBuffer.length,
            sessionStartTime,
            requestedWidth: opts.width,
            requestedFormat: opts.format,
            totalFrames: files.length,
            firstFrames: files.slice(0, 5).map((file) => ({
                name: file.name,
                timestamp: file.timestamp,
                bytes: file.data.length,
            })),
        },
        '[sessionThumbnail] extractThumbnailFromScreenshotArchive'
    );

    if (files.length === 0) {
        logger.warn(
            {
                archiveSize: archiveBuffer.length,
                requestedWidth: opts.width,
                requestedFormat: opts.format,
            },
            '[sessionThumbnail] No JPEG frames found while extracting thumbnail'
        );
        return null;
    }

    logger.info(
        {
            chosenFrame: {
                name: files[0].name,
                timestamp: files[0].timestamp,
                bytes: files[0].data.length,
            },
        },
        '[sessionThumbnail] Selected first frame for thumbnail'
    );
    return files[0].data;
}

export async function extractThumbnailAtTimestampFromArchive(
    archiveBuffer: Buffer,
    targetTimestampMs: number,
    options: ThumbnailOptions = {},
    sessionStartTime: number = 0
): Promise<Buffer | null> {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const files = await extractImagesFromArchive(archiveBuffer, sessionStartTime);

    logger.info(
        {
            archiveSize: archiveBuffer.length,
            targetTimestampMs,
            sessionStartTime,
            requestedWidth: opts.width,
            requestedFormat: opts.format,
            totalFrames: files.length,
            firstFrames: files.slice(0, 8).map((file) => ({
                name: file.name,
                timestamp: file.timestamp,
                bytes: file.data.length,
            })),
        },
        '[sessionThumbnail] extractThumbnailAtTimestampFromArchive'
    );

    if (files.length === 0) {
        logger.warn(
            {
                archiveSize: archiveBuffer.length,
                targetTimestampMs,
            },
            '[sessionThumbnail] No JPEG frames found while extracting timestamped thumbnail'
        );
        return null;
    }

    let best = files[0];
    let bestDiff =
        best.timestamp == null
            ? Number.MAX_SAFE_INTEGER
            : Math.abs(best.timestamp - targetTimestampMs);

    for (const file of files) {
        if (file.timestamp == null) continue;
        const diff = Math.abs(file.timestamp - targetTimestampMs);
        if (diff < bestDiff) {
            best = file;
            bestDiff = diff;
        }
    }

    logger.info(
        {
            targetTimestampMs,
            chosenFrame: {
                name: best.name,
                timestamp: best.timestamp,
                bytes: best.data.length,
            },
            bestDiffMs: bestDiff,
        },
        '[sessionThumbnail] Selected closest frame for timestamped thumbnail'
    );

    return best.data;
}

export interface SessionCoverSession {
    id: string;
    projectId: string;
    startedAt: Date;
}

export interface SessionCoverArtifact {
    id: string;
    s3ObjectKey: string;
    endpointId: string | null;
}

/** The session's first ready screenshot archive, whose first frame is the cover. */
export async function findSessionCoverArtifact(sessionId: string): Promise<SessionCoverArtifact | null> {
    const [artifact] = await db
        .select({
            id: recordingArtifacts.id,
            s3ObjectKey: recordingArtifacts.s3ObjectKey,
            endpointId: recordingArtifacts.endpointId,
        })
        .from(recordingArtifacts)
        .where(
            and(
                eq(recordingArtifacts.sessionId, sessionId),
                eq(recordingArtifacts.kind, 'screenshots'),
                eq(recordingArtifacts.status, 'ready')
            )
        )
        .orderBy(recordingArtifacts.timestamp)
        .limit(1);

    return artifact ?? null;
}

async function extractCoverFromArtifact(
    session: SessionCoverSession,
    artifact: SessionCoverArtifact,
    options: ThumbnailOptions
): Promise<Buffer | null> {
    const sessionId = session.id;

    logger.info(
        {
            sessionId,
            projectId: session.projectId,
            artifact,
        },
        '[sessionThumbnail] Downloading first screenshot artifact for thumbnail'
    );

    const archiveData = await downloadFromS3ForArtifact(
        session.projectId,
        artifact.s3ObjectKey,
        artifact.endpointId
    );
    if (!archiveData) {
        logger.warn(
            {
                sessionId,
                projectId: session.projectId,
                s3ObjectKey: artifact.s3ObjectKey,
                endpointId: artifact.endpointId,
            },
            '[sessionThumbnail] Screenshot artifact download returned empty data'
        );
        return null;
    }

    logger.info(
        {
            sessionId,
            projectId: session.projectId,
            s3ObjectKey: artifact.s3ObjectKey,
            endpointId: artifact.endpointId,
            archiveBytes: archiveData.length,
        },
        '[sessionThumbnail] Screenshot artifact downloaded for thumbnail'
    );

    const thumbnail = await extractThumbnailFromScreenshotArchive(archiveData, options, session.startedAt.getTime());
    if (!thumbnail) {
        logger.warn(
            {
                sessionId,
                projectId: session.projectId,
                s3ObjectKey: artifact.s3ObjectKey,
            },
            '[sessionThumbnail] Thumbnail extraction returned null'
        );
        return null;
    }

    logger.info(
        {
            sessionId,
            projectId: session.projectId,
            thumbnailBytes: thumbnail.length,
        },
        '[sessionThumbnail] Thumbnail extracted successfully'
    );

    return thumbnail;
}

export async function getSessionThumbnail(
    sessionId: string,
    options: ThumbnailOptions = {}
): Promise<Buffer | null> {
    logger.info({ sessionId, options }, '[sessionThumbnail] getSessionThumbnail');

    try {
        const [session] = await db
            .select({
                projectId: sessions.projectId,
                startedAt: sessions.startedAt,
            })
            .from(sessions)
            .where(eq(sessions.id, sessionId))
            .limit(1);

        if (!session) {
            logger.warn({ sessionId }, '[sessionThumbnail] Session not found while loading thumbnail');
            return null;
        }

        logger.info(
            { sessionId, projectId: session.projectId, sessionStartMs: session.startedAt.getTime() },
            '[sessionThumbnail] Session resolved for thumbnail lookup'
        );

        const artifact = await findSessionCoverArtifact(sessionId);
        if (!artifact) {
            logger.warn({ sessionId, projectId: session.projectId }, '[sessionThumbnail] No ready screenshot artifact found for thumbnail');
            return null;
        }

        return await extractCoverFromArtifact({ id: sessionId, ...session }, artifact, options);
    } catch (error) {
        logger.error({ error, sessionId }, '[sessionThumbnail] getSessionThumbnail failed');
        return null;
    }
}

// =============================================================================
// Session cover cache
// =============================================================================

// Bump when the bytes produced for the same artifact change.
const SESSION_COVER_CACHE_VERSION = 'v1';
// Covers are ~15-27 KB and keyed by the artifact they were cut from, so they never
// go stale; the TTL only bounds memory in the noeviction Redis shared with BullMQ.
const SESSION_COVER_STABLE_CACHE_TTL_SECONDS = Number(process.env.RJ_SESSION_COVER_CACHE_TTL_SECONDS ?? 60 * 60);
const SESSION_COVER_UNSTABLE_CACHE_TTL_SECONDS = Number(process.env.RJ_SESSION_COVER_UNSTABLE_CACHE_TTL_SECONDS ?? 300);
// An artifact that yielded no cover (missing object, no frames) is retried after a minute.
const SESSION_COVER_MISS_CACHE_TTL_SECONDS = Number(process.env.RJ_SESSION_COVER_MISS_CACHE_TTL_SECONDS ?? 60);
const SESSION_COVER_LOCK_TTL_SECONDS = 10;
// Total time a request waits for another request's build before building itself.
const SESSION_COVER_LOCK_WAIT_MAX_MS = 2000;
const SESSION_COVER_LOCK_POLL_MS = 100;
// A slow or reconnecting Redis must not hold the request; past this, act as a miss.
const SESSION_COVER_REDIS_TIMEOUT_MS = 250;

function withRedisTimeout<T>(operation: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    return Promise.race([
        operation,
        new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('Redis timeout')), SESSION_COVER_REDIS_TIMEOUT_MS);
        }),
    ]).finally(() => clearTimeout(timer));
}

const COVER_OPTIONS: ThumbnailOptions = { timeOffset: 0.5, width: 375, format: 'jpeg' };

export type SessionCoverCacheStatus = 'hit' | 'miss' | 'lock-hit' | 'wait-hit' | 'bypass';

export function buildSessionCoverCacheKey(sessionId: string, artifactId: string): string {
    return `session_cover:${SESSION_COVER_CACHE_VERSION}:${sessionId}:${artifactId}`;
}

/** Strong ETag: the cover is always the first frame of this artifact. */
export function buildSessionCoverEtag(artifactId: string): string {
    return `"session-cover-${SESSION_COVER_CACHE_VERSION}-${artifactId}"`;
}

/** True when an If-None-Match header lists the given ETag (or `*`). */
export function ifNoneMatchIncludes(ifNoneMatch: string | string[] | undefined, etag: string): boolean {
    if (!ifNoneMatch) return false;
    const header = Array.isArray(ifNoneMatch) ? ifNoneMatch.join(',') : ifNoneMatch;
    const opaque = (tag: string) => tag.trim().replace(/^W\//, '');
    const target = opaque(etag);
    return header.split(',').some((candidate) => {
        const tag = candidate.trim();
        return tag === '*' || opaque(tag) === target;
    });
}

/**
 * Cover bytes for `artifact`, served from Redis when possible. Concurrent misses
 * share one build through a SET NX lock; an artifact that produced no cover is
 * cached as an empty value for a minute so repeated card renders do not re-download it.
 */
export async function getOrBuildSessionCover(
    session: SessionCoverSession,
    artifact: SessionCoverArtifact,
    { stable }: { stable: boolean }
): Promise<{ cover: Buffer | null; cacheStatus: SessionCoverCacheStatus }> {
    const redis = getRedis();
    const cacheKey = buildSessionCoverCacheKey(session.id, artifact.id);
    const lockKey = `${cacheKey}:lock`;
    const lockToken = randomUUID();

    const readCached = async (): Promise<Buffer | null> => {
        try {
            return await withRedisTimeout(redis.getBuffer(cacheKey));
        } catch (err) {
            logger.warn({ err, sessionId: session.id, artifactId: artifact.id }, '[sessionThumbnail] Failed to read cover cache');
            return null;
        }
    };
    const toCover = (cached: Buffer) => (cached.length > 0 ? cached : null);

    const cached = await readCached();
    if (cached) return { cover: toCover(cached), cacheStatus: 'hit' };

    let lockAcquired = false;
    let lockFailed = false;
    try {
        const lockResult = await withRedisTimeout(redis.set(lockKey, lockToken, 'EX', SESSION_COVER_LOCK_TTL_SECONDS, 'NX'));
        lockAcquired = lockResult === 'OK';
    } catch (err) {
        lockFailed = true;
        logger.warn({ err, sessionId: session.id, artifactId: artifact.id }, '[sessionThumbnail] Failed to acquire cover cache lock');
    }

    // Another request holds the lock: wait briefly for its cover. When Redis
    // itself failed there is nothing to wait for, so build directly.
    if (!lockAcquired && !lockFailed) {
        const waitUntil = Date.now() + SESSION_COVER_LOCK_WAIT_MAX_MS;
        while (Date.now() < waitUntil) {
            await new Promise((resolve) => setTimeout(resolve, SESSION_COVER_LOCK_POLL_MS));
            const waited = await readCached();
            if (waited) return { cover: toCover(waited), cacheStatus: 'wait-hit' };
        }
    }

    try {
        if (lockAcquired) {
            const raced = await readCached();
            if (raced) return { cover: toCover(raced), cacheStatus: 'lock-hit' };
        }

        let cover: Buffer | null = null;
        try {
            cover = await extractCoverFromArtifact(session, artifact, COVER_OPTIONS);
        } catch (error) {
            logger.error({ error, sessionId: session.id, artifactId: artifact.id }, '[sessionThumbnail] Cover build failed');
        }

        const ttlSeconds = !cover
            ? SESSION_COVER_MISS_CACHE_TTL_SECONDS
            : stable
                ? SESSION_COVER_STABLE_CACHE_TTL_SECONDS
                : SESSION_COVER_UNSTABLE_CACHE_TTL_SECONDS;
        try {
            await withRedisTimeout(redis.setex(cacheKey, ttlSeconds, cover ?? ''));
        } catch (err) {
            logger.warn({ err, sessionId: session.id, artifactId: artifact.id }, '[sessionThumbnail] Failed to write cover cache');
        }

        return { cover, cacheStatus: lockAcquired ? 'miss' : 'bypass' };
    } finally {
        if (lockAcquired) {
            try {
                const currentToken = await withRedisTimeout(redis.get(lockKey));
                if (currentToken === lockToken) await withRedisTimeout(redis.del(lockKey));
            } catch (err) {
                logger.warn({ err, sessionId: session.id, artifactId: artifact.id }, '[sessionThumbnail] Failed to release cover cache lock');
            }
        }
    }
}

export type SessionCoverResponse =
    | { status: 404 }
    | { status: 304; etag: string }
    | { status: 200; etag: string; cover: Buffer; cacheStatus: SessionCoverCacheStatus };

/**
 * Resolves what a cover request should answer. A matching If-None-Match is
 * answered 304 from the artifact id alone, before Redis or storage is touched.
 */
export async function resolveSessionCoverResponse(
    session: SessionCoverSession,
    { ifNoneMatch, stable }: { ifNoneMatch: string | string[] | undefined; stable: boolean }
): Promise<SessionCoverResponse> {
    const artifact = await findSessionCoverArtifact(session.id);
    if (!artifact) return { status: 404 };

    const etag = buildSessionCoverEtag(artifact.id);
    if (ifNoneMatchIncludes(ifNoneMatch, etag)) return { status: 304, etag };

    const { cover, cacheStatus } = await getOrBuildSessionCover(session, artifact, { stable });
    if (!cover) return { status: 404 };
    return { status: 200, etag, cover, cacheStatus };
}

export async function getThumbnailAtTimestamp(
    sessionId: string,
    targetTimestampMs: number,
    options: ThumbnailOptions = {}
): Promise<Buffer | null> {
    try {
        logger.info({ sessionId, targetTimestampMs, options }, '[sessionThumbnail] getThumbnailAtTimestamp');

        const [session] = await db
            .select({
                projectId: sessions.projectId,
                startedAt: sessions.startedAt,
            })
            .from(sessions)
            .where(eq(sessions.id, sessionId))
            .limit(1);

        if (!session) {
            logger.warn({ sessionId, targetTimestampMs }, '[sessionThumbnail] Session not found for timestamped thumbnail');
            return null;
        }

        const artifacts = await db
            .select({
                s3ObjectKey: recordingArtifacts.s3ObjectKey,
                endpointId: recordingArtifacts.endpointId,
                startTime: recordingArtifacts.startTime,
                endTime: recordingArtifacts.endTime,
                timestamp: recordingArtifacts.timestamp,
            })
            .from(recordingArtifacts)
            .where(
                and(
                    eq(recordingArtifacts.sessionId, sessionId),
                    eq(recordingArtifacts.kind, 'screenshots'),
                    eq(recordingArtifacts.status, 'ready')
                )
            )
            .orderBy(recordingArtifacts.timestamp);

        logger.info(
            {
                sessionId,
                projectId: session.projectId,
                targetTimestampMs,
                sessionStartMs: session.startedAt.getTime(),
                artifactCount: artifacts.length,
                artifacts: artifacts.slice(0, 10).map((artifact) => ({
                    s3ObjectKey: artifact.s3ObjectKey,
                    endpointId: artifact.endpointId,
                    startTime: artifact.startTime,
                    endTime: artifact.endTime,
                    timestamp: artifact.timestamp,
                })),
            },
            '[sessionThumbnail] Screenshot artifacts loaded for timestamped thumbnail'
        );

        if (artifacts.length === 0) {
            logger.warn(
                {
                    sessionId,
                    projectId: session.projectId,
                    targetTimestampMs,
                },
                '[sessionThumbnail] No ready screenshot artifacts found for timestamped thumbnail'
            );
            return null;
        }

        const sessionStartMs = session.startedAt.getTime();
        let bestArtifact = artifacts[0];

        for (const artifact of artifacts) {
            const artifactStartMs =
                artifact.startTime ?? artifact.timestamp ?? sessionStartMs;
            const artifactEndMs = artifact.endTime ?? artifactStartMs + 10_000;

            if (
                targetTimestampMs >= artifactStartMs &&
                targetTimestampMs <= artifactEndMs
            ) {
                bestArtifact = artifact;
                break;
            }
            if (artifactStartMs > targetTimestampMs) {
                break;
            }
            bestArtifact = artifact;
        }

        logger.info(
            {
                sessionId,
                projectId: session.projectId,
                targetTimestampMs,
                chosenArtifact: {
                    s3ObjectKey: bestArtifact.s3ObjectKey,
                    endpointId: bestArtifact.endpointId,
                    startTime: bestArtifact.startTime,
                    endTime: bestArtifact.endTime,
                    timestamp: bestArtifact.timestamp,
                },
            },
            '[sessionThumbnail] Selected artifact for timestamped thumbnail'
        );

        const archiveData = await downloadFromS3ForArtifact(
            session.projectId,
            bestArtifact.s3ObjectKey,
            bestArtifact.endpointId
        );
        if (!archiveData) {
            logger.warn(
                {
                    sessionId,
                    projectId: session.projectId,
                    targetTimestampMs,
                    s3ObjectKey: bestArtifact.s3ObjectKey,
                    endpointId: bestArtifact.endpointId,
                },
                '[sessionThumbnail] Timestamped screenshot artifact download returned empty data'
            );
            return null;
        }

        logger.info(
            {
                sessionId,
                projectId: session.projectId,
                targetTimestampMs,
                s3ObjectKey: bestArtifact.s3ObjectKey,
                endpointId: bestArtifact.endpointId,
                archiveBytes: archiveData.length,
            },
            '[sessionThumbnail] Timestamped screenshot artifact downloaded'
        );

        const thumbnail = await extractThumbnailAtTimestampFromArchive(
            archiveData,
            targetTimestampMs,
            options,
            sessionStartMs
        );
        if (!thumbnail) {
            logger.warn(
                {
                    sessionId,
                    projectId: session.projectId,
                    targetTimestampMs,
                    s3ObjectKey: bestArtifact.s3ObjectKey,
                },
                '[sessionThumbnail] Timestamped thumbnail extraction returned null'
            );
            return null;
        }

        logger.info(
            {
                sessionId,
                projectId: session.projectId,
                targetTimestampMs,
                thumbnailBytes: thumbnail.length,
            },
            '[sessionThumbnail] Timestamped thumbnail extracted successfully'
        );

        return thumbnail;
    } catch (error) {
        logger.error(
            { error, sessionId, targetTimestampMs },
            '[sessionThumbnail] getThumbnailAtTimestamp failed'
        );
        return null;
    }
}
