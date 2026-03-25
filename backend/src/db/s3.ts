/**
 * Multi-Endpoint S3 Storage Client
 * 
 * Supports multiple storage endpoints with:
 * - Per-project endpoint assignment
 * - Global default endpoint fallback
 * - Endpoint caching with TTL
 * - Shadow copy support for redundancy
 */

import {
    S3Client,
    PutObjectCommand,
    GetObjectCommand,
    DeleteObjectCommand,
    HeadObjectCommand,
    ListObjectsV2Command,
    DeleteObjectsCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { eq, and, isNull, desc } from 'drizzle-orm';
import type { Readable } from 'stream';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { safeDecrypt } from '../services/crypto.js';

// =============================================================================
// Types
// =============================================================================

export interface StorageEndpoint {
    id: string;
    projectId: string | null;
    endpointUrl: string;
    bucket: string;
    region: string | null;
    accessKeyId: string | null;
    keyRef: string | null;
    priority: number;
    active: boolean;
    shadow: boolean;
}

interface CachedEndpoint {
    endpoint: StorageEndpoint;
    expiresAt: number;
}

interface S3ClientEntry {
    client: S3Client;
    publicClient: S3Client;
    bucket: string;
}

function resolveInternalEndpointUrl(endpoint: StorageEndpoint): string {
    if (!config.S3_ENDPOINT) {
        return endpoint.endpointUrl;
    }

    try {
        const parsed = new URL(endpoint.endpointUrl);

        // Local-k8s stores the in-cluster MinIO service name in the database, but
        // our host-run API/upload/worker processes must talk to the host-mapped
        // endpoint from .env instead. Production endpoints never use the plain
        // "minio" hostname, so this stays a local-only compatibility rewrite.
        if (parsed.hostname === 'minio') {
            return config.S3_ENDPOINT;
        }
    } catch {
        return endpoint.endpointUrl;
    }

    return endpoint.endpointUrl;
}

// =============================================================================
// Global Caches
// =============================================================================

// Cache endpoints by projectId (null key = global default)
const endpointCache = new Map<string | null, CachedEndpoint>();

// Cache S3 clients by endpoint ID
const s3ClientPool = new Map<string, S3ClientEntry>();

// =============================================================================
// Endpoint Management
// =============================================================================

/**
 * Get storage endpoint for a project with weighted load balancing
 * Falls back to global default if no project-specific endpoint
 * When multiple endpoints exist, uses weighted random selection based on priority
 */
export async function getEndpointForProject(projectId: string): Promise<StorageEndpoint> {
    // Lazy import to avoid circular dependency
    const { db } = await import('./client.js');
    const { storageEndpoints } = await import('./schema.js');

    // Get all active non-shadow endpoints for this project
    let endpoints = await db
        .select()
        .from(storageEndpoints)
        .where(and(
            eq(storageEndpoints.projectId, projectId),
            eq(storageEndpoints.active, true),
            eq(storageEndpoints.shadow, false)
        ))
        .orderBy(desc(storageEndpoints.priority));

    // If no project-specific endpoints, get global endpoints
    if (endpoints.length === 0) {
        endpoints = await db
            .select()
            .from(storageEndpoints)
            .where(and(
                isNull(storageEndpoints.projectId),
                eq(storageEndpoints.active, true),
                eq(storageEndpoints.shadow, false)
            ))
            .orderBy(desc(storageEndpoints.priority));
    }

    if (endpoints.length === 0) {
        throw new Error('No storage endpoint configured. Populate storage_endpoints and rerun bootstrap.');
    }

    // Single endpoint - no load balancing needed
    if (endpoints.length === 1) {
        return endpoints[0] as StorageEndpoint;
    }

    // Multiple endpoints (k3s) - weighted random for load balancing
    // Artifacts store endpointId at creation, so worker downloads from same endpoint.
    // Self-hosted Docker / dev Docker typically have single endpoint.
    const selected = selectWeightedRandom(endpoints as StorageEndpoint[]);
    return selected;
}

/**
 * Weighted random selection based on priority (k3s multi-endpoint load balancing)
 * Priority 0 = weight 1, Priority 10 = weight 11, etc.
 */
function selectWeightedRandom(endpoints: StorageEndpoint[]): StorageEndpoint {
    const totalWeight = endpoints.reduce((sum, e) => sum + (e.priority + 1), 0);
    let random = Math.random() * totalWeight;

    for (const endpoint of endpoints) {
        random -= (endpoint.priority + 1);
        if (random <= 0) {
            return endpoint;
        }
    }

    return endpoints[0];
}

/**
 * Get storage endpoint by ID (for downloads from specific location)
 */
export async function getEndpointById(endpointId: string): Promise<StorageEndpoint | null> {
    // Check all caches first
    for (const [, cached] of endpointCache) {
        if (cached.endpoint.id === endpointId && cached.expiresAt > Date.now()) {
            return cached.endpoint;
        }
    }

    const { db } = await import('./client.js');
    const { storageEndpoints } = await import('./schema.js');

    const [endpoint] = await db
        .select()
        .from(storageEndpoints)
        .where(eq(storageEndpoints.id, endpointId))
        .limit(1);

    return endpoint as StorageEndpoint | null;
}

/**
 * Get all shadow endpoints for a project (for redundant copies)
 */
export async function getShadowEndpoints(projectId: string): Promise<StorageEndpoint[]> {
    const { db } = await import('./client.js');
    const { storageEndpoints } = await import('./schema.js');

    // Get shadow endpoints (project-specific or global)
    const endpoints = await db
        .select()
        .from(storageEndpoints)
        .where(and(
            eq(storageEndpoints.active, true),
            eq(storageEndpoints.shadow, true)
        ))
        .orderBy(desc(storageEndpoints.priority));

    // Filter to project-specific shadows first, then global
    const projectShadows = endpoints.filter(e => e.projectId === projectId);
    const globalShadows = endpoints.filter(e => e.projectId === null);

    return [...projectShadows, ...globalShadows] as StorageEndpoint[];
}

// =============================================================================
// S3 Client Pool
// =============================================================================

/**
 * Get S3 client for an endpoint (cached)
 */
function getS3ClientForEndpoint(endpoint: StorageEndpoint): S3ClientEntry {
    const existing = s3ClientPool.get(endpoint.id);
    if (existing) {
        return existing;
    }

    const accessKeyId = endpoint.accessKeyId;
    const secretAccessKey = safeDecrypt(endpoint.keyRef);
    const region = endpoint.region || undefined;

    if (!accessKeyId || !secretAccessKey) {
        throw new Error(
            'S3 credentials missing for storage endpoint. Configure accessKeyId and keyRef in the storage_endpoints table.',
        );
    }

    const clientConfig = {
        endpoint: resolveInternalEndpointUrl(endpoint),
        region,
        credentials: {
            accessKeyId,
            secretAccessKey,
        },
        forcePathStyle: true, // Required for MinIO and most S3-compatible
    };

    // Create internal client (for server-side operations)
    const client = new S3Client(clientConfig);

    // Create public client for presigned URLs
    // Replace Docker internal hostnames for local dev
    let publicEndpoint = config.S3_PUBLIC_ENDPOINT || endpoint.endpointUrl;
    if (!config.S3_PUBLIC_ENDPOINT && publicEndpoint.includes('minio:9000')) {
        publicEndpoint = publicEndpoint.replace('minio:9000', 'localhost:9000');
    }

    const publicClient = new S3Client({
        ...clientConfig,
        endpoint: publicEndpoint,
    });

    const entry: S3ClientEntry = {
        client,
        publicClient,
        bucket: endpoint.bucket,
    };

    s3ClientPool.set(endpoint.id, entry);
    return entry;
}

async function streamBodyToBuffer(body: AsyncIterable<Uint8Array>): Promise<Buffer> {
    const chunks: Uint8Array[] = [];
    for await (const chunk of body) {
        chunks.push(chunk);
    }
    return Buffer.concat(chunks);
}

async function putObjectToEndpoint(
    endpoint: StorageEndpoint,
    key: string,
    body: Buffer | string,
    contentType: string,
    metadata?: Record<string, string>
): Promise<void> {
    const { client, bucket } = getS3ClientForEndpoint(endpoint);
    await client.send(
        new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: body,
            ContentType: contentType,
            Metadata: metadata,
        })
    );
}

async function putObjectStreamToEndpoint(
    endpoint: StorageEndpoint,
    key: string,
    body: Readable,
    contentType: string,
    contentLength?: number,
    metadata?: Record<string, string>
): Promise<void> {
    const { client, bucket } = getS3ClientForEndpoint(endpoint);
    await client.send(
        new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: body,
            ContentType: contentType,
            ...(typeof contentLength === 'number' ? { ContentLength: contentLength } : {}),
            Metadata: metadata,
        })
    );
}

async function headObjectForEndpoint(endpoint: StorageEndpoint, key: string): Promise<number | null> {
    const { client, bucket } = getS3ClientForEndpoint(endpoint);
    const response = await client.send(
        new HeadObjectCommand({
            Bucket: bucket,
            Key: key,
        })
    );

    const len = response.ContentLength;
    return typeof len === 'number' && Number.isFinite(len) ? len : null;
}

// =============================================================================
// S3 Key Generation
// =============================================================================

/**
 * Generate S3 object key for session artifacts
 * Format: tenant/{teamId}/project/{projectId}/sessions/{sessionId}/{kind}/{filename}
 */
export function generateS3Key(
    teamId: string,
    projectId: string,
    sessionId: string,
    kind: string,
    filename: string
): string {
    return `tenant/${teamId}/project/${projectId}/sessions/${sessionId}/${kind}/${filename}`;
}

// =============================================================================
// Upload Operations
// =============================================================================

/**
 * Upload data to S3 using project's designated endpoint
 */
export async function uploadToS3(
    projectId: string,
    key: string,
    body: Buffer | string,
    contentType: string = 'application/octet-stream',
    metadata?: Record<string, string>
): Promise<{ success: boolean; endpointId: string; error?: string }> {
    const endpoint = await getEndpointForProject(projectId);

    try {
        await putObjectToEndpoint(endpoint, key, body, contentType, metadata);

        logger.debug({ key, endpointId: endpoint.id }, 'Uploaded to S3');

        // Upload to shadow endpoints (fire-and-forget)
        uploadToShadows(projectId, key, body, contentType, metadata).catch(err => {
            logger.warn({ err, key }, 'Shadow upload failed');
        });

        return { success: true, endpointId: endpoint.id };
    } catch (err) {
        logger.error({ err, key, endpointId: endpoint.id }, 'Failed to upload to S3');
        return { success: false, endpointId: endpoint.id, error: String(err) };
    }
}

/**
 * Upload to all shadow endpoints for redundancy
 */
async function uploadToShadows(
    projectId: string,
    key: string,
    body: Buffer | string,
    contentType: string,
    metadata?: Record<string, string>
): Promise<void> {
    const shadows = await getShadowEndpoints(projectId);

    const uploads = shadows.map(async (endpoint) => {
        try {
            await putObjectToEndpoint(endpoint, key, body, contentType, metadata);
            logger.debug({ key, endpointId: endpoint.id }, 'Shadow upload complete');
        } catch (err) {
            logger.warn({ err, key, endpointId: endpoint.id }, 'Shadow upload failed');
        }
    });

    await Promise.allSettled(uploads);
}

// =============================================================================
// Presigned URL Generation
// =============================================================================

export async function uploadStreamToS3ForArtifact(
    projectId: string,
    key: string,
    body: Readable,
    contentType: string = 'application/octet-stream',
    endpointId?: string | null,
    contentLength?: number,
    metadata?: Record<string, string>
): Promise<{ success: boolean; endpointId: string; error?: string }> {
    try {
        const endpoint = endpointId
            ? (await getEndpointById(endpointId)) || await getEndpointForProject(projectId)
            : await getEndpointForProject(projectId);

        await putObjectStreamToEndpoint(endpoint, key, body, contentType, contentLength, metadata);
        logger.debug({ key, endpointId: endpoint.id }, 'Uploaded artifact stream to S3');

        return { success: true, endpointId: endpoint.id };
    } catch (err) {
        logger.error({ err, key, projectId, endpointId }, 'Failed to upload artifact stream to S3');
        return {
            success: false,
            endpointId: endpointId || 'unknown',
            error: String(err),
        };
    }
}

/**
 * Get signed URL for downloading from specific endpoint
 */
export async function getSignedDownloadUrl(
    endpointId: string,
    key: string,
    expiresInSeconds: number = 3600
): Promise<string | null> {
    try {
        const endpoint = await getEndpointById(endpointId);
        if (!endpoint) {
            logger.error({ endpointId }, 'Endpoint not found for download URL');
            return null;
        }

        const { publicClient, bucket } = getS3ClientForEndpoint(endpoint);

        const command = new GetObjectCommand({
            Bucket: bucket,
            Key: key,
        });

        const url = await getSignedUrl(publicClient, command, {
            expiresIn: expiresInSeconds,
        });

        return url;
    } catch (err) {
        logger.error({ err, key, endpointId }, 'Failed to generate signed download URL');
        return null;
    }
}

/**
 * Get signed download URL using project's default endpoint
 * (for legacy artifact keys without stored endpointId)
 */
export async function getSignedDownloadUrlForProject(
    projectId: string,
    key: string,
    expiresInSeconds: number = 3600
): Promise<string | null> {
    try {
        const endpoint = await getEndpointForProject(projectId);
        return getSignedDownloadUrl(endpoint.id, key, expiresInSeconds);
    } catch (err) {
        logger.error({ err, key, projectId }, 'Failed to get download URL for project');
        return null;
    }
}

// =============================================================================
// Download Operations
// =============================================================================

/**
 * Download data from S3 using specific endpoint
 */
export async function downloadFromS3(
    endpointId: string,
    key: string
): Promise<Buffer | null> {
    const buffer = await downloadRawFromS3(endpointId, key);
    if (!buffer) {
        return null;
    }

    // Decompress if gzipped
    if (key.endsWith('.gz')) {
        const zlib = await import('zlib');
        return new Promise((resolve) => {
            zlib.gunzip(buffer, (err, result) => {
                if (err) {
                    // Not actually gzipped - return raw
                    logger.warn({ err, key }, 'Failed to decompress, returning raw data');
                    resolve(buffer);
                } else {
                    resolve(result);
                }
            });
        });
    }

    return buffer;
}

/**
 * Download raw data from S3 without automatic decompression.
 */
export async function downloadRawFromS3(
    endpointId: string,
    key: string
): Promise<Buffer | null> {
    const endpoint = await getEndpointById(endpointId);
    if (!endpoint) {
        logger.error({ endpointId }, 'Endpoint not found for download');
        return null;
    }

    const { client, bucket } = getS3ClientForEndpoint(endpoint);

    try {
        const command = new GetObjectCommand({
            Bucket: bucket,
            Key: key,
        });

        const response = await client.send(command);

        if (!response.Body) {
            return null;
        }
        return streamBodyToBuffer(response.Body as AsyncIterable<Uint8Array>);
    } catch (err) {
        logger.error({ err, key, endpointId }, 'Failed to download from S3');
        return null;
    }
}

/**
 * Download from project's default endpoint
 */
export async function downloadFromS3ForProject(
    projectId: string,
    key: string
): Promise<Buffer | null> {
    const endpoint = await getEndpointForProject(projectId);
    return downloadFromS3(endpoint.id, key);
}

/**
 * Download from specific endpoint (when artifact has endpointId) or project default.
 * Use for ingest worker: artifacts store endpointId at upload so worker downloads from
 * the same endpoint (enables k3s load balancing across multiple S3 endpoints).
 */
export async function downloadFromS3ForArtifact(
    projectId: string,
    key: string,
    endpointId: string | null | undefined
): Promise<Buffer | null> {
    if (endpointId) {
        const endpoint = await getEndpointById(endpointId);
        if (endpoint) {
            return downloadFromS3(endpoint.id, key);
        }
    }
    return downloadFromS3ForProject(projectId, key);
}

export async function downloadRawFromS3ForProject(
    projectId: string,
    key: string
): Promise<Buffer | null> {
    const endpoint = await getEndpointForProject(projectId);
    return downloadRawFromS3(endpoint.id, key);
}

export async function downloadRawFromS3ForArtifact(
    projectId: string,
    key: string,
    endpointId: string | null | undefined
): Promise<Buffer | null> {
    if (endpointId) {
        const endpoint = await getEndpointById(endpointId);
        if (endpoint) {
            return downloadRawFromS3(endpoint.id, key);
        }
    }
    return downloadRawFromS3ForProject(projectId, key);
}

/**
 * Get object size in bytes without downloading.
 * Useful for debugging storage usage (e.g., total replay size).
 */
export async function getObjectSizeBytesForProject(
    projectId: string,
    key: string
): Promise<number | null> {
    try {
        const endpoint = await getEndpointForProject(projectId);
        return await headObjectForEndpoint(endpoint, key);
    } catch (err) {
        logger.debug({ err, projectId, key }, 'Failed to HEAD object size');
        return null;
    }
}

export async function getObjectSizeBytesForArtifact(
    projectId: string,
    key: string,
    endpointId: string | null | undefined
): Promise<number | null> {
    try {
        if (endpointId) {
            const endpoint = await getEndpointById(endpointId);
            if (endpoint) {
                return await headObjectForEndpoint(endpoint, key);
            }
        }

        return await getObjectSizeBytesForProject(projectId, key);
    } catch (err) {
        logger.debug({ err, projectId, key, endpointId }, 'Failed to HEAD object size for artifact');
        return null;
    }
}

export async function uploadToS3ForArtifact(
    projectId: string,
    key: string,
    body: Buffer | string,
    contentType: string = 'application/octet-stream',
    metadata?: Record<string, string>,
    endpointId?: string | null
): Promise<{ success: boolean; endpointId: string; error?: string }> {
    try {
        const endpoint = endpointId
            ? (await getEndpointById(endpointId)) || await getEndpointForProject(projectId)
            : await getEndpointForProject(projectId);

        await putObjectToEndpoint(endpoint, key, body, contentType, metadata);
        logger.debug({ key, endpointId: endpoint.id }, 'Uploaded artifact to S3');

        uploadToShadows(projectId, key, body, contentType, metadata).catch(err => {
            logger.warn({ err, key }, 'Shadow upload failed');
        });

        return { success: true, endpointId: endpoint.id };
    } catch (err) {
        logger.error({ err, key, projectId, endpointId }, 'Failed to upload artifact to S3');
        return {
            success: false,
            endpointId: endpointId || 'unknown',
            error: String(err),
        };
    }
}

// =============================================================================
// Delete Operations
// =============================================================================

/**
 * Delete object from specific endpoint
 */
export async function deleteFromS3(
    endpointId: string,
    key: string
): Promise<boolean> {
    const endpoint = await getEndpointById(endpointId);
    if (!endpoint) {
        logger.error({ endpointId }, 'Endpoint not found for delete');
        return false;
    }

    const { client, bucket } = getS3ClientForEndpoint(endpoint);

    try {
        await client.send(
            new DeleteObjectCommand({
                Bucket: bucket,
                Key: key,
            })
        );

        logger.debug({ key, endpointId }, 'Deleted from S3');
        return true;
    } catch (err) {
        logger.error({ err, key, endpointId }, 'Failed to delete from S3');
        return false;
    }
}

/**
 * Delete from project's default endpoint
 */
export async function deleteFromS3ForProject(
    projectId: string,
    key: string
): Promise<boolean> {
    const endpoint = await getEndpointForProject(projectId);
    return deleteFromS3(endpoint.id, key);
}

/**
 * Delete all assets for a project (GDPR compliance)
 * Deletes recursively under tenant/{teamId}/project/{projectId}/
 */
export async function deleteProjectAssets(
    projectId: string,
    teamId: string
): Promise<void> {
    const prefix = `tenant/${teamId}/project/${projectId}/`;
    await deletePrefixFromS3ForProject(projectId, prefix);
}

/**
 * Delete all objects under a specific S3 prefix for a given project.
 * Uses the project's default endpoint and any shadow endpoints.
 */
export async function deletePrefixFromS3ForProject(
    projectId: string,
    prefix: string
): Promise<void> {
    const endpoint = await getEndpointForProject(projectId);
    const { client, bucket } = getS3ClientForEndpoint(endpoint);

    // Also get all shadow endpoints to clean them up too
    const shadows = await getShadowEndpoints(projectId);

    // Function to delete from a specific client/bucket
    const deleteFromBucket = async (s3Client: S3Client, bucketName: string) => {
        let continuationToken: string | undefined;

        do {
            // List objects (v2 for pagination)
            const listCommand = new ListObjectsV2Command({
                Bucket: bucketName,
                Prefix: prefix,
                ContinuationToken: continuationToken,
            });

            const listResponse = await s3Client.send(listCommand);

            if (!listResponse.Contents || listResponse.Contents.length === 0) {
                break;
            }

            // Delete in batches (max 1000 per request)
            const objectsToDelete = listResponse.Contents
                .map((obj) => ({ Key: obj.Key }))
                .filter((obj) => obj.Key !== undefined);

            if (objectsToDelete.length > 0) {
                await s3Client.send(
                    new DeleteObjectsCommand({
                        Bucket: bucketName,
                        Delete: {
                            Objects: objectsToDelete as { Key: string }[],
                            Quiet: true,
                        },
                    })
                );
                logger.info({ projectId, prefix, count: objectsToDelete.length }, 'Deleted batch of S3 assets');
            }

            continuationToken = listResponse.NextContinuationToken;
        } while (continuationToken);
    };

    try {
        // Delete from primary
        await deleteFromBucket(client, bucket);
        logger.info({ projectId, endpoint: endpoint.id, prefix }, 'Primary project assets deleted');

        // Delete from shadows
        for (const shadow of shadows) {
            const { client: shadowClient, bucket: shadowBucket } = getS3ClientForEndpoint(shadow);
            try {
                await deleteFromBucket(shadowClient, shadowBucket);
                logger.info({ projectId, endpoint: shadow.id, prefix }, 'Shadow project assets deleted');
            } catch (err) {
                logger.error({ err, projectId, endpoint: shadow.id, prefix }, 'Failed to delete shadow assets');
            }
        }
    } catch (err) {
        logger.error({ err, projectId, prefix }, 'Failed to delete project assets by prefix');
        throw err;
    }
}

// =============================================================================
// Utility Operations
// =============================================================================

/**
 * Check if object exists at specific endpoint
 */
export async function objectExists(
    endpointId: string,
    key: string
): Promise<boolean> {
    const endpoint = await getEndpointById(endpointId);
    if (!endpoint) return false;

    const { client, bucket } = getS3ClientForEndpoint(endpoint);

    try {
        await client.send(
            new HeadObjectCommand({
                Bucket: bucket,
                Key: key,
            })
        );
        return true;
    } catch {
        return false;
    }
}

/**
 * Get object metadata
 */
export async function getObjectMetadata(
    endpointId: string,
    key: string
): Promise<{ size: number; contentType?: string; lastModified?: Date } | null> {
    const endpoint = await getEndpointById(endpointId);
    if (!endpoint) return null;

    const { client, bucket } = getS3ClientForEndpoint(endpoint);

    try {
        const response = await client.send(
            new HeadObjectCommand({
                Bucket: bucket,
                Key: key,
            })
        );

        return {
            size: response.ContentLength || 0,
            contentType: response.ContentType,
            lastModified: response.LastModified,
        };
    } catch {
        return null;
    }
}

/**
 * Clear endpoint caches (useful for testing)
 */
export function clearEndpointCaches(): void {
    endpointCache.clear();
    s3ClientPool.clear();
}

/**
 * Check S3 connection health
 * Attempts to list objects (or head bucket) on the default endpoint
 */
export async function checkS3Connection(): Promise<boolean> {
    try {
        // Get the default endpoint (uses global config)
        const endpoint = await getEndpointForProject('health-check');
        const { client, bucket } = getS3ClientForEndpoint(endpoint);

        // Try to list objects with max 1 (lightweight health check)
        await client.send(new ListObjectsV2Command({
            Bucket: bucket,
            MaxKeys: 1,
        }));

        return true;
    } catch (error) {
        logger.warn({ error }, 'S3 health check failed');
        return false;
    }
}
