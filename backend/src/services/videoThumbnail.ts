/**
 * Video Thumbnail Service
 * 
 * Extracts thumbnail images from H.264 video segments using FFmpeg.
 * Replaces the deprecated keyframe-based cover photo system.
 */

import { spawn } from 'child_process';
import { eq, and } from 'drizzle-orm';
import { writeFile, unlink, mkdtemp, rmdir } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { db, recordingArtifacts, sessions } from '../db/client.js';
import { downloadFromS3ForProject } from '../db/s3.js';
import { logger } from '../logger.js';

export interface ThumbnailOptions {
    /** Time offset in seconds (default: 0.5 for first visible frame) */
    timeOffset?: number;
    /** Output width in pixels (default: 375) */
    width?: number;
    /** Image quality 1-31, lower is better (default: 5) */
    quality?: number;
    /** Output format (default: 'jpeg') */
    format?: 'jpeg' | 'png' | 'webp';
}

const DEFAULT_OPTIONS: Required<ThumbnailOptions> = {
    timeOffset: 0.5,
    width: 375,
    quality: 5,
    format: 'jpeg',
};

/**
 * Extract a thumbnail from a video buffer using FFmpeg
 * Uses temp file approach to allow FFmpeg to seek and read the moov atom
 */
export async function extractThumbnailFromBuffer(
    videoBuffer: Buffer,
    options: ThumbnailOptions = {}
): Promise<Buffer> {
    const opts = { ...DEFAULT_OPTIONS, ...options };

    logger.info({
        bufferSize: videoBuffer.length,
        timeOffset: opts.timeOffset,
        width: opts.width,
        format: opts.format
    }, '[videoThumbnail] extractThumbnailFromBuffer called');

    // Write video to temp file so FFmpeg can seek (required for MP4 moov atom)
    const tempDir = await mkdtemp(join(tmpdir(), 'rejourney-thumb-'));
    const tempVideoPath = join(tempDir, 'video.mp4');

    try {
        await writeFile(tempVideoPath, videoBuffer);
        logger.info({ tempVideoPath }, '[videoThumbnail] Wrote video to temp file');

        return await new Promise((resolve, reject) => {
            const ffmpegArgs = [
                '-i', tempVideoPath,      // Read from temp file (allows seeking)
                '-ss', String(opts.timeOffset),
                '-vframes', '1',          // Extract single frame
                '-vf', `scale=${opts.width}:-1`,
                '-q:v', String(opts.quality),
                '-f', 'image2pipe',
                '-vcodec', opts.format === 'png' ? 'png' : 'mjpeg',
                'pipe:1'                  // Write to stdout
            ];

            logger.info({ ffmpegArgs }, '[videoThumbnail] Spawning FFmpeg with args');

            const ffmpeg = spawn('ffmpeg', ffmpegArgs, {
                stdio: ['ignore', 'pipe', 'pipe']
            });

            const chunks: Buffer[] = [];
            let stderr = '';

            ffmpeg.stdout.on('data', (chunk: Buffer) => {
                chunks.push(chunk);
            });

            ffmpeg.stderr.on('data', (data: Buffer) => {
                stderr += data.toString();
            });

            ffmpeg.on('close', (code) => {
                logger.info({
                    exitCode: code,
                    chunksCount: chunks.length,
                    totalOutputBytes: chunks.reduce((acc, c) => acc + c.length, 0),
                    stderrLength: stderr.length,
                    stderrLast500: stderr.slice(-500)
                }, '[videoThumbnail] FFmpeg process closed');

                if (code === 0 && chunks.length > 0) {
                    resolve(Buffer.concat(chunks));
                } else {
                    const errorMsg = `FFmpeg exited with code ${code}: ${stderr.slice(-500)}`;
                    logger.error({ exitCode: code, stderrFull: stderr }, '[videoThumbnail] FFmpeg extraction failed');
                    reject(new Error(errorMsg));
                }
            });

            ffmpeg.on('error', (err) => {
                logger.error({ error: err.message, stack: err.stack }, '[videoThumbnail] FFmpeg spawn error');
                reject(new Error(`FFmpeg spawn error: ${err.message}`));
            });
        });
    } finally {
        // Clean up temp files
        try {
            await unlink(tempVideoPath);
            await rmdir(tempDir);
        } catch {
            // Ignore cleanup errors
        }
    }
}

/**
 * Get thumbnail for a session
 * Finds the first video segment and extracts a thumbnail from it.
 * Falls back to legacy frame-based artifacts for older sessions.
 */
export async function getSessionThumbnail(
    sessionId: string,
    options: ThumbnailOptions = {}
): Promise<Buffer | null> {
    logger.info({ sessionId }, '[videoThumbnail] getSessionThumbnail called');

    try {
        // Get session to find projectId
        const [session] = await db
            .select({ projectId: sessions.projectId })
            .from(sessions)
            .where(eq(sessions.id, sessionId))
            .limit(1);

        if (!session) {
            logger.warn({ sessionId }, '[videoThumbnail] Session not found for thumbnail');
            return null;
        }

        logger.info({ sessionId, projectId: session.projectId }, '[videoThumbnail] Session found, looking for video artifacts');

        // First, try to find video segment artifacts (new format)
        const [videoArtifact] = await db
            .select({
                id: recordingArtifacts.id,
                s3ObjectKey: recordingArtifacts.s3ObjectKey,
                kind: recordingArtifacts.kind,
                status: recordingArtifacts.status,
            })
            .from(recordingArtifacts)
            .where(and(
                eq(recordingArtifacts.sessionId, sessionId),
                eq(recordingArtifacts.kind, 'video'),
                eq(recordingArtifacts.status, 'ready')
            ))
            .orderBy(recordingArtifacts.timestamp)
            .limit(1);

        logger.info({
            sessionId,
            videoArtifactFound: !!videoArtifact,
            videoArtifactId: videoArtifact?.id,
            videoArtifactKind: videoArtifact?.kind,
            videoArtifactStatus: videoArtifact?.status,
            s3Key: videoArtifact?.s3ObjectKey
        }, '[videoThumbnail] Video artifact query result');

        if (videoArtifact) {
            // New video segment path - extract thumbnail using FFmpeg
            logger.info({ sessionId, s3Key: videoArtifact.s3ObjectKey }, '[videoThumbnail] Downloading video from S3');

            const videoData = await downloadFromS3ForProject(
                session.projectId,
                videoArtifact.s3ObjectKey
            );

            if (!videoData) {
                logger.warn({ sessionId, artifactId: videoArtifact.id, s3Key: videoArtifact.s3ObjectKey }, '[videoThumbnail] Failed to download video segment from S3');
                return null;
            }

            logger.info({ sessionId, videoSize: videoData.length }, '[videoThumbnail] Video downloaded, extracting thumbnail');

            // Extract thumbnail
            const thumbnail = await extractThumbnailFromBuffer(videoData, options);

            logger.info({
                sessionId,
                artifactId: videoArtifact.id,
                thumbnailSize: thumbnail.length
            }, '[videoThumbnail] Thumbnail extracted from video successfully');

            return thumbnail;
        }

        // Legacy frame support removed
        logger.info({ sessionId }, '[videoThumbnail] No video artifact found');

        // Log ALL artifacts for this session to debug
        const allArtifacts = await db
            .select({
                id: recordingArtifacts.id,
                kind: recordingArtifacts.kind,
                status: recordingArtifacts.status,
                s3ObjectKey: recordingArtifacts.s3ObjectKey,
            })
            .from(recordingArtifacts)
            .where(eq(recordingArtifacts.sessionId, sessionId))
            .limit(20);

        logger.warn({
            sessionId,
            totalArtifacts: allArtifacts.length,
            artifacts: allArtifacts.map(a => ({ id: a.id, kind: a.kind, status: a.status }))
        }, '[videoThumbnail] No video segments or frames found - listing all artifacts');

        return null;
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : undefined;
        logger.error({
            errorMessage,
            errorStack,
            sessionId
        }, '[videoThumbnail] Failed to extract session thumbnail');
        return null;
    }
}

/**
 * Get thumbnail at a specific timestamp
 * Useful for screen-specific thumbnails in heatmaps.
 * Falls back to legacy frame-based artifacts for older sessions.
 */
export async function getThumbnailAtTimestamp(
    sessionId: string,
    targetTimestampMs: number,
    options: ThumbnailOptions = {}
): Promise<Buffer | null> {
    try {
        // Get session to find projectId and startTime
        const [session] = await db
            .select({
                projectId: sessions.projectId,
                startedAt: sessions.startedAt
            })
            .from(sessions)
            .where(eq(sessions.id, sessionId))
            .limit(1);

        if (!session) {
            return null;
        }

        const sessionStartMs = session.startedAt.getTime();

        // First try video segments (new format)
        const videoArtifacts = await db
            .select({
                id: recordingArtifacts.id,
                s3ObjectKey: recordingArtifacts.s3ObjectKey,
                startTime: recordingArtifacts.startTime,
                endTime: recordingArtifacts.endTime,
            })
            .from(recordingArtifacts)
            .where(and(
                eq(recordingArtifacts.sessionId, sessionId),
                eq(recordingArtifacts.kind, 'video'),
                eq(recordingArtifacts.status, 'ready')
            ))
            .orderBy(recordingArtifacts.startTime);

        if (videoArtifacts.length > 0) {
            // Find the segment that contains or is closest to target timestamp
            let bestSegment = videoArtifacts[0];
            let bestSegmentStartMs = bestSegment.startTime || sessionStartMs;

            for (const segment of videoArtifacts) {
                const segmentStartMs = segment.startTime || sessionStartMs;
                if (segmentStartMs <= targetTimestampMs) {
                    bestSegment = segment;
                    bestSegmentStartMs = segmentStartMs;
                } else {
                    break;
                }
            }

            // Calculate offset within the segment
            const segmentOffsetSec = Math.max(0, (targetTimestampMs - bestSegmentStartMs) / 1000);

            // Download and extract
            const videoData = await downloadFromS3ForProject(
                session.projectId,
                bestSegment.s3ObjectKey
            );

            if (videoData) {
                return await extractThumbnailFromBuffer(videoData, {
                    ...options,
                    timeOffset: segmentOffsetSec
                });
            }
        }

        // Legacy frame support removed

        return null;
    } catch (error) {
        logger.error({ error, sessionId, targetTimestampMs }, 'Failed to get thumbnail at timestamp');
        return null;
    }
}
