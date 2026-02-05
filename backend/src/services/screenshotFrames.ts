/**
 * Screenshot Frames Service
 * 
 * Extracts individual JPEG frames from tar.gz screenshot archives.
 * Supports both on-demand extraction and Redis caching for performance.
 * 
 * Screenshot archives are uploaded by iOS SDK as tar.gz containing:
 * - Multiple JPEG files named by timestamp: {sessionEpoch}_1_{frameTimestamp}.jpeg
 * - Frames are captured at configurable intervals (default 500ms)
 * 
 * This service provides:
 * - Frame extraction from archives
 * - Redis caching of extracted frame metadata (not raw bytes)
 * - Presigned URLs for direct frame access
 * - Frame index for timeline-accurate playback
 */

import { eq, and } from 'drizzle-orm';
import { gunzipSync } from 'zlib';
import { db, recordingArtifacts, sessions } from '../db/client.js';
import { downloadFromS3ForProject, getSignedDownloadUrlForProject, uploadToS3 } from '../db/s3.js';
import { getRedis } from '../db/redis.js';
import { logger } from '../logger.js';

// ============================================================================
// Types
// ============================================================================

export interface ExtractedFrame {
    /** Original filename in archive */
    filename: string;
    /** Frame timestamp in epoch milliseconds */
    timestamp: number;
    /** Frame index within this archive (0-based) */
    index: number;
    /** JPEG data */
    data: Buffer;
}

export interface FrameMetadata {
    /** Frame timestamp in epoch milliseconds */
    timestamp: number;
    /** S3 key for this individual frame (after extraction) */
    s3Key: string;
    /** Frame index within session (0-based, across all archives) */
    globalIndex: number;
    /** Size in bytes */
    sizeBytes: number;
}

export interface ScreenshotSegmentInfo {
    /** Archive artifact ID */
    artifactId: string;
    /** Archive S3 key */
    archiveS3Key: string;
    /** Start time of first frame in this archive */
    startTime: number;
    /** End time of last frame in this archive */
    endTime: number | null;
    /** Number of frames in archive (if known) */
    frameCount: number | null;
}

export interface SessionScreenshotFrames {
    /** Total frames across all archives */
    totalFrames: number;
    /** Session start time for timeline sync */
    sessionStartTime: number;
    /** Array of individual frame metadata with presigned URLs */
    frames: Array<{
        timestamp: number;
        url: string;
        index: number;
    }>;
    /** Whether frames were served from cache */
    cached: boolean;
}

// ============================================================================
// TAR Archive Parsing
// ============================================================================

/**
 * Parse a tar archive buffer and extract all files
 */
function parseTarArchive(tarBuffer: Buffer): Array<{ name: string; data: Buffer }> {
    const files: Array<{ name: string; data: Buffer }> = [];
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
            const data = tarBuffer.subarray(offset, offset + size);
            files.push({ name, data: Buffer.from(data) });
        }
        
        // Move to next header (file data is padded to 512-byte boundary)
        offset += Math.ceil(size / 512) * 512;
    }
    
    return files;
}

/**
 * Extract timestamp from screenshot filename
 * Format: {sessionEpoch}_1_{frameTimestamp}.jpeg
 */
function parseFrameTimestamp(filename: string): number | null {
    // Match pattern: digits_digits_digits.jpeg
    const match = filename.match(/(\d+)_\d+_(\d+)\.jpe?g$/i);
    if (match) {
        return parseInt(match[2], 10);
    }
    // Fallback: just extract any timestamp-like number
    const tsMatch = filename.match(/(\d{13,})\.jpe?g$/i);
    if (tsMatch) {
        return parseInt(tsMatch[1], 10);
    }
    return null;
}

// ============================================================================
// Frame Extraction
// ============================================================================

/**
 * Extract all frames from a screenshot archive
 * 
 * The archive may be:
 * 1. Raw tar (if already decompressed by S3 download helper)
 * 2. Gzip-compressed tar (if downloaded without auto-decompression)
 * 
 * We detect based on gzip magic bytes (0x1f 0x8b).
 */
export async function extractFramesFromArchive(
    archiveBuffer: Buffer
): Promise<ExtractedFrame[]> {
    try {
        // Check if gzip compressed (magic bytes: 0x1f 0x8b)
        const isGzipped = archiveBuffer.length >= 2 && 
                          archiveBuffer[0] === 0x1f && 
                          archiveBuffer[1] === 0x8b;
        
        // Decompress if needed, otherwise use as-is (already tar)
        let tarBuffer: Buffer;
        if (isGzipped) {
            logger.debug({ archiveSize: archiveBuffer.length }, '[screenshotFrames] Decompressing gzip archive');
            tarBuffer = gunzipSync(archiveBuffer);
        } else {
            logger.debug({ archiveSize: archiveBuffer.length }, '[screenshotFrames] Archive is already decompressed tar');
            tarBuffer = archiveBuffer;
        }
        
        // Parse tar
        const files = parseTarArchive(tarBuffer);
        
        logger.info({ 
            tarSize: tarBuffer.length, 
            fileCount: files.length,
            fileNames: files.map(f => f.name),
        }, '[screenshotFrames] Parsed tar archive - all filenames');
        
        // Filter to JPEG files and extract timestamps
        const frames: ExtractedFrame[] = [];
        
        for (const file of files) {
            if (!file.name.endsWith('.jpg') && !file.name.endsWith('.jpeg')) {
                continue;
            }
            
            const timestamp = parseFrameTimestamp(file.name);
            if (timestamp === null) {
                logger.warn({ filename: file.name }, '[screenshotFrames] Could not parse timestamp from filename');
                continue;
            }
            
            frames.push({
                filename: file.name,
                timestamp,
                index: 0, // Will be set after sorting
                data: file.data,
            });
        }
        
        // Sort by timestamp and assign indices
        frames.sort((a, b) => a.timestamp - b.timestamp);
        frames.forEach((frame, idx) => {
            frame.index = idx;
        });
        
        logger.info({
            archiveSize: archiveBuffer.length,
            tarSize: tarBuffer.length,
            frameCount: frames.length,
            firstTimestamp: frames[0]?.timestamp,
            lastTimestamp: frames[frames.length - 1]?.timestamp,
        }, '[screenshotFrames] Extracted frames from archive');
        
        return frames;
    } catch (err) {
        const error = err as Error;
        logger.error({ error: error.message, stack: error.stack }, '[screenshotFrames] Failed to extract frames from archive');
        return [];
    }
}

// ============================================================================
// Redis Caching
// ============================================================================

const FRAME_CACHE_PREFIX = 'screenshot_frames:';
const FRAME_CACHE_TTL = 3600; // 1 hour

interface CachedFrameIndex {
    sessionId: string;
    totalFrames: number;
    sessionStartTime: number;
    frames: Array<{
        timestamp: number;
        s3Key: string;
        index: number;
        sizeBytes: number;
    }>;
    extractedAt: number;
}

/**
 * Get cached frame index for a session
 */
async function getCachedFrameIndex(sessionId: string): Promise<CachedFrameIndex | null> {
    try {
        const redis = getRedis();
        const cached = await redis.get(`${FRAME_CACHE_PREFIX}${sessionId}`);
        if (cached) {
            return JSON.parse(cached);
        }
    } catch (err) {
        logger.warn({ err, sessionId }, '[screenshotFrames] Failed to get cached frame index');
    }
    return null;
}

/**
 * Cache frame index for a session
 */
async function cacheFrameIndex(sessionId: string, index: CachedFrameIndex): Promise<void> {
    try {
        const redis = getRedis();
        await redis.setex(
            `${FRAME_CACHE_PREFIX}${sessionId}`,
            FRAME_CACHE_TTL,
            JSON.stringify(index)
        );
    } catch (err) {
        logger.warn({ err, sessionId }, '[screenshotFrames] Failed to cache frame index');
    }
}

/**
 * Invalidate cached frame index for a session
 */
export async function invalidateFrameCache(sessionId: string): Promise<void> {
    try {
        const redis = getRedis();
        await redis.del(`${FRAME_CACHE_PREFIX}${sessionId}`);
    } catch (err) {
        logger.warn({ err, sessionId }, '[screenshotFrames] Failed to invalidate frame cache');
    }
}

// ============================================================================
// Main API
// ============================================================================

/**
 * Get screenshot segments for a session (the raw archives)
 */
export async function getScreenshotSegments(sessionId: string): Promise<ScreenshotSegmentInfo[]> {
    const artifacts = await db
        .select({
            id: recordingArtifacts.id,
            s3ObjectKey: recordingArtifacts.s3ObjectKey,
            startTime: recordingArtifacts.startTime,
            endTime: recordingArtifacts.endTime,
            frameCount: recordingArtifacts.frameCount,
        })
        .from(recordingArtifacts)
        .where(and(
            eq(recordingArtifacts.sessionId, sessionId),
            eq(recordingArtifacts.kind, 'screenshots'),
            eq(recordingArtifacts.status, 'ready')
        ))
        .orderBy(recordingArtifacts.startTime);
    
    return artifacts.map(a => ({
        artifactId: a.id,
        archiveS3Key: a.s3ObjectKey,
        startTime: a.startTime || 0,
        endTime: a.endTime,
        frameCount: a.frameCount,
    }));
}

/**
 * Get all screenshot frames for a session with presigned URLs
 * 
 * Strategy:
 * 1. Check Redis cache for extracted frame index
 * 2. If not cached, download archives and extract frame metadata
 * 3. Store extracted frames as individual S3 objects for direct access
 * 4. Return presigned URLs for each frame
 * 
 * For performance, we extract frames lazily and cache the index.
 * Individual frame bytes are stored in S3 under sessions/{sessionId}/frames/{timestamp}.jpg
 */
export async function getSessionScreenshotFrames(
    sessionId: string,
    options?: {
        /** Skip cache lookup */
        skipCache?: boolean;
        /** Max frames to return (for pagination) */
        limit?: number;
        /** Offset for pagination */
        offset?: number;
    }
): Promise<SessionScreenshotFrames | null> {
    const { skipCache = false, limit, offset = 0 } = options || {};
    
    // Get session info
    const [session] = await db
        .select({
            projectId: sessions.projectId,
            startedAt: sessions.startedAt,
        })
        .from(sessions)
        .where(eq(sessions.id, sessionId))
        .limit(1);
    
    if (!session) {
        logger.warn({ sessionId }, '[screenshotFrames] Session not found');
        return null;
    }
    
    const sessionStartTime = session.startedAt.getTime();
    
    // Check cache first
    if (!skipCache) {
        const cached = await getCachedFrameIndex(sessionId);
        if (cached) {
            // Generate presigned URLs for cached frame keys
            let framesToReturn = cached.frames;
            if (offset > 0) {
                framesToReturn = framesToReturn.slice(offset);
            }
            if (limit) {
                framesToReturn = framesToReturn.slice(0, limit);
            }
            
            const framesWithUrls = await Promise.all(
                framesToReturn.map(async (f) => {
                    const url = await getSignedDownloadUrlForProject(session.projectId, f.s3Key);
                    return {
                        timestamp: f.timestamp,
                        url: url || '',
                        index: f.index,
                    };
                })
            );
            
            return {
                totalFrames: cached.totalFrames,
                sessionStartTime: cached.sessionStartTime,
                frames: framesWithUrls.filter(f => f.url),
                cached: true,
            };
        }
    }
    
    // Get screenshot archive artifacts
    const segments = await getScreenshotSegments(sessionId);
    
    if (segments.length === 0) {
        logger.info({ sessionId }, '[screenshotFrames] No screenshot segments found');
        return null;
    }
    
    // Extract frames from all archives
    const allFrames: Array<{
        timestamp: number;
        s3Key: string;
        index: number;
        sizeBytes: number;
    }> = [];
    
    let globalIndex = 0;
    
    for (const segment of segments) {
        // Download archive
        const archiveData = await downloadFromS3ForProject(session.projectId, segment.archiveS3Key);
        if (!archiveData) {
            logger.warn({ sessionId, s3Key: segment.archiveS3Key }, '[screenshotFrames] Failed to download archive');
            continue;
        }
        
        // Extract frames
        const frames = await extractFramesFromArchive(archiveData);
        
        // Upload individual frames to S3 for direct access
        for (const frame of frames) {
            const frameS3Key = `sessions/${sessionId}/frames/${frame.timestamp}.jpg`;
            
            // Upload frame to S3
            const uploadResult = await uploadToS3(
                session.projectId,
                frameS3Key,
                frame.data,
                'image/jpeg'
            );
            
            if (uploadResult.success) {
                allFrames.push({
                    timestamp: frame.timestamp,
                    s3Key: frameS3Key,
                    index: globalIndex,
                    sizeBytes: frame.data.length,
                });
                globalIndex++;
            }
        }
    }
    
    if (allFrames.length === 0) {
        logger.warn({ sessionId }, '[screenshotFrames] No frames extracted from archives');
        return null;
    }
    
    // Sort all frames by timestamp
    allFrames.sort((a, b) => a.timestamp - b.timestamp);
    allFrames.forEach((f, idx) => {
        f.index = idx;
    });
    
    // Cache the frame index
    const cacheEntry: CachedFrameIndex = {
        sessionId,
        totalFrames: allFrames.length,
        sessionStartTime,
        frames: allFrames,
        extractedAt: Date.now(),
    };
    await cacheFrameIndex(sessionId, cacheEntry);
    
    // Apply pagination
    let framesToReturn = allFrames;
    if (offset > 0) {
        framesToReturn = framesToReturn.slice(offset);
    }
    if (limit) {
        framesToReturn = framesToReturn.slice(0, limit);
    }
    
    // Generate presigned URLs
    const framesWithUrls = await Promise.all(
        framesToReturn.map(async (f) => {
            const url = await getSignedDownloadUrlForProject(session.projectId, f.s3Key);
            return {
                timestamp: f.timestamp,
                url: url || '',
                index: f.index,
            };
        })
    );
    
    logger.info({
        sessionId,
        totalFrames: allFrames.length,
        returnedFrames: framesWithUrls.length,
    }, '[screenshotFrames] Extracted and cached session frames');
    
    return {
        totalFrames: allFrames.length,
        sessionStartTime,
        frames: framesWithUrls.filter(f => f.url),
        cached: false,
    };
}

/**
 * Get a single frame at a specific timestamp
 * Useful for seeking to specific points
 */
export async function getFrameAtTimestamp(
    sessionId: string,
    targetTimestampMs: number
): Promise<{ url: string; timestamp: number } | null> {
    const framesResult = await getSessionScreenshotFrames(sessionId);
    if (!framesResult || framesResult.frames.length === 0) {
        return null;
    }
    
    // Find closest frame to target timestamp
    let closestFrame = framesResult.frames[0];
    let minDiff = Math.abs(closestFrame.timestamp - targetTimestampMs);
    
    for (const frame of framesResult.frames) {
        const diff = Math.abs(frame.timestamp - targetTimestampMs);
        if (diff < minDiff) {
            minDiff = diff;
            closestFrame = frame;
        }
        // Stop if we've passed the target (frames are sorted)
        if (frame.timestamp > targetTimestampMs) {
            break;
        }
    }
    
    return {
        url: closestFrame.url,
        timestamp: closestFrame.timestamp,
    };
}

/**
 * Get frame count without extracting all frames
 * Uses cached info or archive metadata
 */
export async function getScreenshotFrameCount(sessionId: string): Promise<number> {
    // Check cache
    const cached = await getCachedFrameIndex(sessionId);
    if (cached) {
        return cached.totalFrames;
    }
    
    // Sum frame counts from artifacts
    const segments = await getScreenshotSegments(sessionId);
    let total = 0;
    for (const seg of segments) {
        total += seg.frameCount || 0;
    }
    
    return total;
}
