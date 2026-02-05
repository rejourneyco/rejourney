/**
 * Video Thumbnail Service
 * 
 * Extracts thumbnail images from H.264 video segments using FFmpeg,
 * or from screenshot tar.gz archives for screenshot-based sessions.
 * Replaces the deprecated keyframe-based cover photo system.
 */

import { spawn } from 'child_process';
import { eq, and } from 'drizzle-orm';
import { writeFile, unlink, mkdtemp, rmdir } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { gunzipSync } from 'zlib';
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
 * Extract the first JPEG image from a screenshot tar.gz archive.
 * Screenshot archives contain multiple JPEG files named by timestamp.
 * Returns the first (earliest) image in the archive.
 * 
 * Uses manual tar parsing to avoid external dependencies.
 * TAR format: 512-byte header blocks followed by file data (padded to 512 bytes).
 */
export async function extractThumbnailFromScreenshotArchive(
    archiveBuffer: Buffer,
    options: ThumbnailOptions = {}
): Promise<Buffer | null> {
    const opts = { ...DEFAULT_OPTIONS, ...options };

    logger.info({
        bufferSize: archiveBuffer.length,
        width: opts.width
    }, '[videoThumbnail] extractThumbnailFromScreenshotArchive called');

    try {
        // Decompress gzip
        const tarBuffer = gunzipSync(archiveBuffer);
        
        // Parse tar archive manually
        const files: Array<{ name: string; data: Buffer }> = [];
        let offset = 0;
        
        while (offset < tarBuffer.length - 512) {
            // Read 512-byte tar header
            const header = tarBuffer.subarray(offset, offset + 512);
            
            // Check for empty header (end of archive marker - two 512-byte zero blocks)
            if (header.every(byte => byte === 0)) {
                break;
            }
            
            // Extract filename (bytes 0-99, null-terminated)
            const nameEnd = header.indexOf(0);
            const name = header.subarray(0, nameEnd > 0 ? Math.min(nameEnd, 100) : 100).toString('utf8').trim();
            
            // Extract file size (bytes 124-135, octal string)
            const sizeStr = header.subarray(124, 136).toString('utf8').trim();
            const size = parseInt(sizeStr, 8) || 0;
            
            // Extract file type (byte 156: '0' or '\0' = regular file)
            const typeFlag = header[156];
            const isRegularFile = typeFlag === 0 || typeFlag === 48; // 0 or '0'
            
            offset += 512; // Move past header
            
            if (isRegularFile && size > 0) {
                // Read file content
                const data = tarBuffer.subarray(offset, offset + size);
                
                // Only collect JPEG files
                if (name.endsWith('.jpg') || name.endsWith('.jpeg')) {
                    files.push({ name, data: Buffer.from(data) });
                }
            }
            
            // Move to next header (file data is padded to 512-byte boundary)
            offset += Math.ceil(size / 512) * 512;
        }
        
        if (files.length === 0) {
            logger.warn({}, '[videoThumbnail] No JPEG files found in screenshot archive');
            return null;
        }
        
        // Sort by filename (which is by timestamp) and get the first one
        files.sort((a, b) => a.name.localeCompare(b.name));
        const firstImage = files[0];
        
        logger.info({
            fileName: firstImage.name,
            imageSize: firstImage.data.length,
            totalFilesFound: files.length
        }, '[videoThumbnail] First screenshot extracted from archive');

        // If we need to resize, use FFmpeg, otherwise return as-is
        if (opts.width && opts.width !== 375) {
            try {
                return await resizeImage(firstImage.data, opts.width);
            } catch {
                return firstImage.data; // Fall back to original on resize error
            }
        } else {
            return firstImage.data;
        }
    } catch (err: unknown) {
        const error = err as Error;
        logger.error({ error: error.message }, '[videoThumbnail] Error extracting from screenshot archive');
        return null;
    }
}

/**
 * Extract thumbnail from screenshot archive at a specific timestamp.
 * Screenshot filenames contain timestamps in format: {timestamp}_{segmentNum}_{frameTimestamp}.jpeg
 * Example: 1770267115816_1_1770267116000.jpeg
 * We find the frame with the closest frameTimestamp to the target.
 */
export async function extractThumbnailAtTimestampFromArchive(
    archiveBuffer: Buffer,
    targetTimestampMs: number,
    options: ThumbnailOptions = {}
): Promise<Buffer | null> {
    const opts = { ...DEFAULT_OPTIONS, ...options };

    logger.info({
        bufferSize: archiveBuffer.length,
        targetTimestampMs,
        width: opts.width
    }, '[videoThumbnail] extractThumbnailAtTimestampFromArchive called');

    try {
        // Decompress gzip
        const tarBuffer = gunzipSync(archiveBuffer);
        
        // Parse tar archive manually
        const files: Array<{ name: string; data: Buffer; timestamp: number }> = [];
        let offset = 0;
        
        while (offset < tarBuffer.length - 512) {
            // Read 512-byte tar header
            const header = tarBuffer.subarray(offset, offset + 512);
            
            // Check for empty header (end of archive marker)
            if (header.every(byte => byte === 0)) {
                break;
            }
            
            // Extract filename (bytes 0-99, null-terminated)
            const nameEnd = header.indexOf(0);
            const name = header.subarray(0, nameEnd > 0 ? Math.min(nameEnd, 100) : 100).toString('utf8').trim();
            
            // Extract file size (bytes 124-135, octal string)
            const sizeStr = header.subarray(124, 136).toString('utf8').trim();
            const size = parseInt(sizeStr, 8) || 0;
            
            // Extract file type (byte 156: '0' or '\0' = regular file)
            const typeFlag = header[156];
            const isRegularFile = typeFlag === 0 || typeFlag === 48; // 0 or '0'
            
            offset += 512; // Move past header
            
            if (isRegularFile && size > 0) {
                // Read file content
                const data = tarBuffer.subarray(offset, offset + size);
                
                // Only collect JPEG files
                if (name.endsWith('.jpg') || name.endsWith('.jpeg')) {
                    // Parse timestamp from filename
                    // Format: {segmentStart}_{segmentNum}_{frameTimestamp}.jpeg
                    // Or just: {timestamp}.jpeg
                    const basename = name.replace(/^.*\//, '').replace(/\.(jpg|jpeg)$/, '');
                    const parts = basename.split('_');
                    
                    let frameTimestamp: number;
                    if (parts.length >= 3) {
                        // Full format: use the third part (frameTimestamp)
                        frameTimestamp = parseInt(parts[2], 10);
                    } else if (parts.length === 1) {
                        // Simple format: just the timestamp
                        frameTimestamp = parseInt(parts[0], 10);
                    } else {
                        // Unknown format, use last part
                        frameTimestamp = parseInt(parts[parts.length - 1], 10);
                    }
                    
                    if (!isNaN(frameTimestamp) && frameTimestamp > 0) {
                        files.push({ name, data: Buffer.from(data), timestamp: frameTimestamp });
                    }
                }
            }
            
            // Move to next header (file data is padded to 512-byte boundary)
            offset += Math.ceil(size / 512) * 512;
        }
        
        if (files.length === 0) {
            logger.warn({ targetTimestampMs }, '[videoThumbnail] No JPEG files found in screenshot archive');
            return null;
        }
        
        // Sort by timestamp
        files.sort((a, b) => a.timestamp - b.timestamp);
        
        // Find the frame closest to target timestamp
        let closestFile = files[0];
        let minDiff = Math.abs(files[0].timestamp - targetTimestampMs);
        
        for (const file of files) {
            const diff = Math.abs(file.timestamp - targetTimestampMs);
            if (diff < minDiff) {
                minDiff = diff;
                closestFile = file;
            }
            // If we've passed the target and diff is increasing, no need to continue
            if (file.timestamp > targetTimestampMs && diff > minDiff) {
                break;
            }
        }
        
        logger.info({
            targetTimestampMs,
            closestTimestamp: closestFile.timestamp,
            timeDiff: minDiff,
            fileName: closestFile.name,
            imageSize: closestFile.data.length,
            totalFilesFound: files.length
        }, '[videoThumbnail] Found closest screenshot to target timestamp');

        // If we need to resize, use FFmpeg, otherwise return as-is
        if (opts.width && opts.width !== 375) {
            try {
                return await resizeImage(closestFile.data, opts.width);
            } catch {
                return closestFile.data; // Fall back to original on resize error
            }
        } else {
            return closestFile.data;
        }
    } catch (err: unknown) {
        const error = err as Error;
        logger.error({ error: error.message, targetTimestampMs }, '[videoThumbnail] Error extracting from screenshot archive at timestamp');
        return null;
    }
}

/**
 * Resize an image buffer using FFmpeg
 */
async function resizeImage(imageBuffer: Buffer, width: number): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const ffmpegArgs = [
            '-i', 'pipe:0',               // Read from stdin
            '-vf', `scale=${width}:-1`,   // Scale width, maintain aspect ratio
            '-f', 'image2pipe',
            '-vcodec', 'mjpeg',
            'pipe:1'                       // Write to stdout
        ];

        const ffmpeg = spawn('ffmpeg', ffmpegArgs, {
            stdio: ['pipe', 'pipe', 'pipe']
        });

        const chunks: Buffer[] = [];

        ffmpeg.stdout.on('data', (chunk: Buffer) => {
            chunks.push(chunk);
        });

        ffmpeg.on('close', (code) => {
            if (code === 0 && chunks.length > 0) {
                resolve(Buffer.concat(chunks));
            } else {
                reject(new Error(`FFmpeg resize failed with code ${code}`));
            }
        });

        ffmpeg.on('error', (err) => {
            reject(err);
        });

        // Write image to stdin
        ffmpeg.stdin.write(imageBuffer);
        ffmpeg.stdin.end();
    });
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

        // No video found - try screenshot artifacts (iOS screenshot-based capture)
        logger.info({ sessionId }, '[videoThumbnail] No video artifact found, looking for screenshots');

        const [screenshotArtifact] = await db
            .select({
                id: recordingArtifacts.id,
                s3ObjectKey: recordingArtifacts.s3ObjectKey,
                kind: recordingArtifacts.kind,
                status: recordingArtifacts.status,
            })
            .from(recordingArtifacts)
            .where(and(
                eq(recordingArtifacts.sessionId, sessionId),
                eq(recordingArtifacts.kind, 'screenshots'),
                eq(recordingArtifacts.status, 'ready')
            ))
            .orderBy(recordingArtifacts.timestamp)
            .limit(1);

        logger.info({
            sessionId,
            screenshotArtifactFound: !!screenshotArtifact,
            screenshotArtifactId: screenshotArtifact?.id,
            s3Key: screenshotArtifact?.s3ObjectKey
        }, '[videoThumbnail] Screenshot artifact query result');

        if (screenshotArtifact) {
            // Screenshot archive path - extract first frame from tar.gz
            logger.info({ sessionId, s3Key: screenshotArtifact.s3ObjectKey }, '[videoThumbnail] Downloading screenshot archive from S3');

            const archiveData = await downloadFromS3ForProject(
                session.projectId,
                screenshotArtifact.s3ObjectKey
            );

            if (!archiveData) {
                logger.warn({ sessionId, artifactId: screenshotArtifact.id, s3Key: screenshotArtifact.s3ObjectKey }, '[videoThumbnail] Failed to download screenshot archive from S3');
                return null;
            }

            logger.info({ sessionId, archiveSize: archiveData.length }, '[videoThumbnail] Screenshot archive downloaded, extracting first frame');

            try {
                const thumbnail = await extractThumbnailFromScreenshotArchive(archiveData, options);

                if (thumbnail) {
                    logger.info({
                        sessionId,
                        artifactId: screenshotArtifact.id,
                        thumbnailSize: thumbnail.length
                    }, '[videoThumbnail] Thumbnail extracted from screenshot archive successfully');
                    return thumbnail;
                }
            } catch (err) {
                const errorMessage = err instanceof Error ? err.message : String(err);
                logger.error({ sessionId, error: errorMessage }, '[videoThumbnail] Failed to extract from screenshot archive');
            }
        }

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
        }, '[videoThumbnail] No video or screenshot artifacts found - listing all artifacts');

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

        // First try screenshot archives (new iOS format - most common)
        const screenshotArtifacts = await db
            .select({
                id: recordingArtifacts.id,
                s3ObjectKey: recordingArtifacts.s3ObjectKey,
                startTime: recordingArtifacts.startTime,
                endTime: recordingArtifacts.endTime,
                timestamp: recordingArtifacts.timestamp,
            })
            .from(recordingArtifacts)
            .where(and(
                eq(recordingArtifacts.sessionId, sessionId),
                eq(recordingArtifacts.kind, 'screenshots'),
                eq(recordingArtifacts.status, 'ready')
            ))
            .orderBy(recordingArtifacts.timestamp);

        if (screenshotArtifacts.length > 0) {
            logger.info({
                sessionId,
                targetTimestampMs,
                screenshotArtifactCount: screenshotArtifacts.length,
            }, '[videoThumbnail] getThumbnailAtTimestamp: Found screenshot artifacts');

            // Find the artifact that contains or is closest to target timestamp
            // Each screenshot artifact is a tar.gz containing multiple frames with timestamps in filenames
            let bestArtifact = screenshotArtifacts[0];
            
            for (const artifact of screenshotArtifacts) {
                const artifactStartMs = artifact.startTime || artifact.timestamp || sessionStartMs;
                const artifactEndMs = artifact.endTime || artifactStartMs + 10000; // Assume 10s if no end
                
                // If target is within this artifact's range, use it
                if (targetTimestampMs >= artifactStartMs && targetTimestampMs <= artifactEndMs) {
                    bestArtifact = artifact;
                    break;
                }
                // If target is before this artifact, keep previous best
                if (artifactStartMs > targetTimestampMs) {
                    break;
                }
                bestArtifact = artifact;
            }

            // Download the archive and find the frame closest to target timestamp
            const archiveData = await downloadFromS3ForProject(
                session.projectId,
                bestArtifact.s3ObjectKey
            );

            if (archiveData) {
                const thumbnail = await extractThumbnailAtTimestampFromArchive(
                    archiveData,
                    targetTimestampMs,
                    options
                );
                if (thumbnail) {
                    logger.info({
                        sessionId,
                        targetTimestampMs,
                        thumbnailSize: thumbnail.length,
                    }, '[videoThumbnail] getThumbnailAtTimestamp: Extracted screenshot at timestamp');
                    return thumbnail;
                }
            }
        }

        // Fallback: try video segments (old format)
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
