/**
 * Screenshot Frames Service
 * 
 * Extracts individual JPEG frames from screenshot archives.
 * Supports both on-demand extraction and Redis caching for performance.
 * 
 * Two archive formats are supported:
 * 
 * iOS (tar.gz): Standard tar archive containing JPEG files named:
 *   {sessionEpoch}_1_{frameTimestamp}.jpeg
 * 
 * Android (binary.gz): Custom binary format where each frame is:
 *   [8-byte BE timestamp offset from session epoch]
 *   [4-byte BE JPEG size]
 *   [N bytes raw JPEG data]
 *   Repeated for each frame, then gzip-compressed.
 * 
 * This service provides:
 * - Frame extraction from both archive formats
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
// Archive Format Detection & Parsing
// ============================================================================

/** JPEG magic bytes: FF D8 FF */
const JPEG_MAGIC = [0xFF, 0xD8, 0xFF];

/**
 * Detect whether a decompressed buffer is a tar archive or Android binary format.
 * 
 * Android binary: starts with 8-byte BE timestamp + 4-byte BE size, then JPEG data.
 * Since timestamps are offsets (usually small numbers), bytes 0-7 will be mostly zeros
 * followed by the JPEG magic at byte 12.
 * 
 * Tar archive: starts with a 512-byte header containing a filename string.
 */
function isAndroidBinaryFormat(buf: Buffer): boolean {
    if (buf.length < 16) return false;
    
    // Read what would be the JPEG size in Android format (bytes 8-11, BE int)
    const possibleSize = buf.readUInt32BE(8);
    
    // Check if we find JPEG magic right after the 12-byte header
    if (buf.length >= 15 && 
        buf[12] === JPEG_MAGIC[0] && 
        buf[13] === JPEG_MAGIC[1] && 
        buf[14] === JPEG_MAGIC[2] &&
        possibleSize > 0 && 
        possibleSize < buf.length) {
        return true;
    }
    
    return false;
}

/**
 * Parse Android's custom binary screenshot format.
 * Format per frame: [8-byte BE timestamp offset][4-byte BE jpeg size][jpeg data]
 * 
 * @param buf - Decompressed binary data
 * @param sessionStartTime - Session start epoch ms, used to convert offsets to absolute timestamps
 */
function parseAndroidBinaryArchive(
    buf: Buffer, 
    sessionStartTime: number
): ExtractedFrame[] {
    const frames: ExtractedFrame[] = [];
    let offset = 0;
    const HEADER_SIZE = 12; // 8 (timestamp) + 4 (size)
    
    while (offset + HEADER_SIZE <= buf.length) {
        // Read 8-byte big-endian timestamp offset (ms from session epoch)
        const tsHigh = buf.readUInt32BE(offset);
        const tsLow = buf.readUInt32BE(offset + 4);
        const tsOffset = tsHigh * 0x100000000 + tsLow;
        
        // Read 4-byte big-endian JPEG size
        const jpegSize = buf.readUInt32BE(offset + 8);
        
        offset += HEADER_SIZE;
        
        // Sanity checks
        if (jpegSize <= 0 || jpegSize > 10 * 1024 * 1024) { // max 10MB per frame
            logger.warn({ jpegSize, offset }, '[screenshotFrames] Android binary: invalid frame size, stopping');
            break;
        }
        if (offset + jpegSize > buf.length) {
            logger.warn({ jpegSize, offset, bufLen: buf.length }, '[screenshotFrames] Android binary: frame extends past buffer, stopping');
            break;
        }
        
        // Verify JPEG magic
        if (buf[offset] !== 0xFF || buf[offset + 1] !== 0xD8) {
            logger.warn({ byte0: buf[offset], byte1: buf[offset + 1], offset }, '[screenshotFrames] Android binary: not JPEG data, stopping');
            break;
        }
        
        const jpegData = Buffer.from(buf.subarray(offset, offset + jpegSize));
        const absoluteTimestamp = sessionStartTime + tsOffset;
        
        frames.push({
            filename: `android_${absoluteTimestamp}.jpeg`,
            timestamp: absoluteTimestamp,
            index: frames.length,
            data: jpegData,
        });
        
        offset += jpegSize;
    }
    
    logger.info({
        frameCount: frames.length,
        bufferSize: buf.length,
        sessionStartTime,
        firstTs: frames[0]?.timestamp,
        lastTs: frames[frames.length - 1]?.timestamp,
    }, '[screenshotFrames] Parsed Android binary archive');
    
    return frames;
}

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
 * Extract all frames from a screenshot archive.
 * 
 * Supports two formats:
 * 1. iOS tar.gz — standard tar with named JPEG files
 * 2. Android binary.gz — custom binary: [8-byte ts offset][4-byte size][jpeg] per frame
 * 
 * Format is auto-detected after gzip decompression.
 * 
 * @param archiveBuffer - Raw archive data (gzipped or already decompressed)
 * @param sessionStartTime - Session start epoch ms (needed for Android format timestamp reconstruction)
 */
export async function extractFramesFromArchive(
    archiveBuffer: Buffer,
    sessionStartTime: number = 0
): Promise<ExtractedFrame[]> {
    try {
        // Check if gzip compressed (magic bytes: 0x1f 0x8b)
        const isGzipped = archiveBuffer.length >= 2 && 
                          archiveBuffer[0] === 0x1f && 
                          archiveBuffer[1] === 0x8b;
        
        // Decompress if needed
        let rawBuffer: Buffer;
        if (isGzipped) {
            logger.debug({ archiveSize: archiveBuffer.length }, '[screenshotFrames] Decompressing gzip archive');
            rawBuffer = gunzipSync(archiveBuffer);
        } else {
            logger.debug({ archiveSize: archiveBuffer.length }, '[screenshotFrames] Archive is already decompressed');
            rawBuffer = archiveBuffer;
        }
        
        // ── Detect format and parse ──────────────────────────────────────
        let frames: ExtractedFrame[];
        
        if (isAndroidBinaryFormat(rawBuffer)) {
            // Android custom binary format
            logger.info({ bufferSize: rawBuffer.length, sessionStartTime }, '[screenshotFrames] Detected Android binary format');
            frames = parseAndroidBinaryArchive(rawBuffer, sessionStartTime);
        } else {
            // Try standard tar parsing (iOS)
            const files = parseTarArchive(rawBuffer);
            
            logger.info({ 
                tarSize: rawBuffer.length, 
                fileCount: files.length,
                fileNames: files.map(f => f.name),
            }, '[screenshotFrames] Parsed tar archive - all filenames');
            
            // If tar produced 0 files but buffer has data, try Android binary as fallback
            if (files.length === 0 && rawBuffer.length > 12) {
                logger.info('[screenshotFrames] Tar produced 0 files, trying Android binary fallback');
                frames = parseAndroidBinaryArchive(rawBuffer, sessionStartTime);
            } else {
                // Standard tar path — filter to JPEG files and extract timestamps
                frames = [];
                
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
                        index: 0,
                        data: file.data,
                    });
                }
            }
        }
        
        // Sort by timestamp and assign indices
        frames.sort((a, b) => a.timestamp - b.timestamp);
        frames.forEach((frame, idx) => {
            frame.index = idx;
        });
        
        logger.info({
            archiveSize: archiveBuffer.length,
            rawSize: rawBuffer.length,
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
        
        // Extract frames (pass sessionStartTime for Android binary format)
        const frames = await extractFramesFromArchive(archiveData, sessionStartTime);
        
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
