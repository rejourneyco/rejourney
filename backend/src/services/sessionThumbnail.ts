/**
 * Session Thumbnail Service
 *
 * Screenshot-only thumbnail extraction for replay sessions.
 * Supports both legacy tar.gz JPEG archives and current binary.gz bundles.
 */

import { and, eq } from 'drizzle-orm';
import { db, recordingArtifacts, sessions } from '../db/client.js';
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

        const sessionStartMs = session.startedAt.getTime();

        logger.info(
            { sessionId, projectId: session.projectId, sessionStartMs },
            '[sessionThumbnail] Session resolved for thumbnail lookup'
        );

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

        if (!artifact) {
            logger.warn({ sessionId, projectId: session.projectId }, '[sessionThumbnail] No ready screenshot artifact found for thumbnail');
            return null;
        }

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

        const thumbnail = await extractThumbnailFromScreenshotArchive(archiveData, options, sessionStartMs);
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
    } catch (error) {
        logger.error({ error, sessionId }, '[sessionThumbnail] getSessionThumbnail failed');
        return null;
    }
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
