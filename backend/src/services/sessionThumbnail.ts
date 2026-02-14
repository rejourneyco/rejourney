/**
 * Session Thumbnail Service
 *
 * Screenshot-only thumbnail extraction for replay sessions.
 * Archives are expected as tar.gz bundles of JPEG files.
 */

import { and, eq } from 'drizzle-orm';
import { gunzipSync } from 'zlib';
import { db, recordingArtifacts, sessions } from '../db/client.js';
import { downloadFromS3ForProject } from '../db/s3.js';
import { logger } from '../logger.js';

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

function parseTimestampFromScreenshotFilename(name: string): number | null {
    const base = name.replace(/^.*\//, '').replace(/\.(jpg|jpeg)$/i, '');
    if (!base) return null;

    // Expected formats:
    // 1) {segmentStart}_{segmentNum}_{frameTimestamp}.jpeg
    // 2) {timestamp}.jpeg
    const parts = base.split('_');
    if (parts.length >= 3) {
        const ts = Number.parseInt(parts[2], 10);
        return Number.isFinite(ts) && ts > 0 ? ts : null;
    }
    if (parts.length === 1) {
        const ts = Number.parseInt(parts[0], 10);
        return Number.isFinite(ts) && ts > 0 ? ts : null;
    }

    const fallback = Number.parseInt(parts[parts.length - 1], 10);
    return Number.isFinite(fallback) && fallback > 0 ? fallback : null;
}

function parseTarForJpegs(tarBuffer: Buffer): ArchiveImage[] {
    const files: ArchiveImage[] = [];
    let offset = 0;

    while (offset < tarBuffer.length - 512) {
        const header = tarBuffer.subarray(offset, offset + 512);
        if (header.every((b) => b === 0)) break;

        const nameEnd = header.indexOf(0);
        const name = header
            .subarray(0, nameEnd > 0 ? Math.min(nameEnd, 100) : 100)
            .toString('utf8')
            .trim();

        const sizeStr = header.subarray(124, 136).toString('utf8').trim();
        const size = Number.parseInt(sizeStr, 8) || 0;
        const typeFlag = header[156];
        const isRegularFile = typeFlag === 0 || typeFlag === 48; // '\0' or '0'

        offset += 512;

        if (isRegularFile && size > 0) {
            const data = tarBuffer.subarray(offset, offset + size);
            if (/\.(jpg|jpeg)$/i.test(name)) {
                files.push({
                    name,
                    data: Buffer.from(data),
                    timestamp: parseTimestampFromScreenshotFilename(name),
                });
            }
        }

        offset += Math.ceil(size / 512) * 512;
    }

    files.sort((a, b) => {
        const ta = a.timestamp ?? Number.MAX_SAFE_INTEGER;
        const tb = b.timestamp ?? Number.MAX_SAFE_INTEGER;
        if (ta !== tb) return ta - tb;
        return a.name.localeCompare(b.name);
    });

    return files;
}

function extractJpegFilesFromArchive(archiveBuffer: Buffer): ArchiveImage[] {
    // Most uploads are gzip-compressed tar archives; some test fixtures may already be raw tar.
    try {
        return parseTarForJpegs(gunzipSync(archiveBuffer));
    } catch {
        return parseTarForJpegs(archiveBuffer);
    }
}

export async function extractThumbnailFromScreenshotArchive(
    archiveBuffer: Buffer,
    options: ThumbnailOptions = {}
): Promise<Buffer | null> {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const files = extractJpegFilesFromArchive(archiveBuffer);

    logger.info(
        {
            archiveSize: archiveBuffer.length,
            requestedWidth: opts.width,
            requestedFormat: opts.format,
            totalFrames: files.length,
        },
        '[sessionThumbnail] extractThumbnailFromScreenshotArchive'
    );

    if (files.length === 0) return null;
    return files[0].data;
}

export async function extractThumbnailAtTimestampFromArchive(
    archiveBuffer: Buffer,
    targetTimestampMs: number,
    options: ThumbnailOptions = {}
): Promise<Buffer | null> {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const files = extractJpegFilesFromArchive(archiveBuffer);

    logger.info(
        {
            archiveSize: archiveBuffer.length,
            targetTimestampMs,
            requestedWidth: opts.width,
            requestedFormat: opts.format,
            totalFrames: files.length,
        },
        '[sessionThumbnail] extractThumbnailAtTimestampFromArchive'
    );

    if (files.length === 0) return null;

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

    return best.data;
}

export async function getSessionThumbnail(
    sessionId: string,
    options: ThumbnailOptions = {}
): Promise<Buffer | null> {
    logger.info({ sessionId }, '[sessionThumbnail] getSessionThumbnail');

    try {
        const [session] = await db
            .select({ projectId: sessions.projectId })
            .from(sessions)
            .where(eq(sessions.id, sessionId))
            .limit(1);

        if (!session) return null;

        const [artifact] = await db
            .select({
                id: recordingArtifacts.id,
                s3ObjectKey: recordingArtifacts.s3ObjectKey,
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

        if (!artifact) return null;

        const archiveData = await downloadFromS3ForProject(
            session.projectId,
            artifact.s3ObjectKey
        );
        if (!archiveData) return null;

        return await extractThumbnailFromScreenshotArchive(archiveData, options);
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
        const [session] = await db
            .select({
                projectId: sessions.projectId,
                startedAt: sessions.startedAt,
            })
            .from(sessions)
            .where(eq(sessions.id, sessionId))
            .limit(1);

        if (!session) return null;

        const artifacts = await db
            .select({
                s3ObjectKey: recordingArtifacts.s3ObjectKey,
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

        if (artifacts.length === 0) return null;

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

        const archiveData = await downloadFromS3ForProject(
            session.projectId,
            bestArtifact.s3ObjectKey
        );
        if (!archiveData) return null;

        return await extractThumbnailAtTimestampFromArchive(
            archiveData,
            targetTimestampMs,
            options
        );
    } catch (error) {
        logger.error(
            { error, sessionId, targetTimestampMs },
            '[sessionThumbnail] getThumbnailAtTimestamp failed'
        );
        return null;
    }
}
