import { promisify } from 'node:util';
import { gzipSync, gunzip } from 'node:zlib';
import {
    downloadRawFromS3ForArtifact,
    uploadToS3ForArtifact,
} from '../db/s3.js';
import { logger } from '../logger.js';

const gunzipAsync = promisify(gunzip);

export interface HierarchyArtifactNormalizationResult {
    repaired: boolean;
    normalizedBuffer: Buffer;
    contentType: 'application/gzip';
    reason: 'not_target' | 'already_gzipped' | 'recompressed_raw_json' | 'invalid_raw_payload';
}

export interface EnsureHierarchyArtifactCompressedResult {
    data: Buffer | null;
    repaired: boolean;
    sizeBytes: number | null;
    reason: HierarchyArtifactNormalizationResult['reason'];
}

export function isGzipBuffer(buffer: Buffer | Uint8Array): boolean {
    return buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b;
}

export function normalizeHierarchyArtifactBuffer(
    s3Key: string,
    buffer: Buffer
): HierarchyArtifactNormalizationResult {
    if (!s3Key.endsWith('.json.gz')) {
        return {
            repaired: false,
            normalizedBuffer: buffer,
            contentType: 'application/gzip',
            reason: 'not_target',
        };
    }

    if (isGzipBuffer(buffer)) {
        return {
            repaired: false,
            normalizedBuffer: buffer,
            contentType: 'application/gzip',
            reason: 'already_gzipped',
        };
    }

    try {
        JSON.parse(buffer.toString('utf8'));
    } catch {
        return {
            repaired: false,
            normalizedBuffer: buffer,
            contentType: 'application/gzip',
            reason: 'invalid_raw_payload',
        };
    }

    return {
        repaired: true,
        normalizedBuffer: gzipSync(buffer, { level: 9 }),
        contentType: 'application/gzip',
        reason: 'recompressed_raw_json',
    };
}

/**
 * Match downloadFromS3ForArtifact's logical payload while reusing the raw bytes
 * already fetched for compression repair. This avoids a second full S3 GET for
 * every hierarchy artifact.
 */
export async function decodeHierarchyArtifactBuffer(s3Key: string, buffer: Buffer): Promise<Buffer> {
    if (!s3Key.endsWith('.gz') || !isGzipBuffer(buffer)) return buffer;

    try {
        return await gunzipAsync(buffer);
    } catch {
        // Preserve the existing download helper's compatibility behavior for
        // mislabeled/corrupt gzip objects; validation will reject invalid JSON.
        return buffer;
    }
}

export async function ensureHierarchyArtifactCompressed(params: {
    projectId: string;
    s3Key: string;
    endpointId?: string | null;
    artifactId?: string;
    sessionId?: string;
}): Promise<EnsureHierarchyArtifactCompressedResult> {
    const { projectId, s3Key, endpointId, artifactId, sessionId } = params;

    const rawBuffer = await downloadRawFromS3ForArtifact(projectId, s3Key, endpointId);
    if (!rawBuffer) {
        return {
            data: null,
            repaired: false,
            sizeBytes: null,
            reason: 'not_target',
        };
    }

    const normalized = normalizeHierarchyArtifactBuffer(s3Key, rawBuffer);
    if (!normalized.repaired) {
        if (normalized.reason === 'invalid_raw_payload') {
            logger.warn({
                artifactId,
                sessionId,
                s3Key,
            }, 'Hierarchy artifact looks mislabeled but raw bytes are not valid JSON; leaving object unchanged');
        }

        return {
            data: await decodeHierarchyArtifactBuffer(s3Key, rawBuffer),
            repaired: false,
            sizeBytes: rawBuffer.length,
            reason: normalized.reason,
        };
    }

    const uploadResult = await uploadToS3ForArtifact(
        projectId,
        s3Key,
        normalized.normalizedBuffer,
        normalized.contentType,
        undefined,
        endpointId
    );

    if (!uploadResult.success) {
        throw new Error(uploadResult.error || `Failed to normalize hierarchy artifact ${s3Key}`);
    }

    const sizeBytes = normalized.normalizedBuffer.length;

    logger.info({
        artifactId,
        sessionId,
        s3Key,
        endpointId: uploadResult.endpointId,
        sizeBytes,
    }, 'Normalized raw hierarchy JSON artifact to gzip in S3');

    return {
        data: rawBuffer,
        repaired: true,
        sizeBytes,
        reason: normalized.reason,
    };
}
