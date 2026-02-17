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
        // Simple fallback for Self-Hosted: If no database record exists,
        // use the .env variables to create a "virtual" endpoint.
        if (config.SELF_HOSTED_MODE && config.S3_ENDPOINT && config.S3_BUCKET) {
            return {
                id: 'env-fallback',
                projectId: null,
                endpointUrl: config.S3_ENDPOINT,
                bucket: config.S3_BUCKET,
                region: config.S3_REGION,
                accessKeyId: config.S3_ACCESS_KEY_ID || null,
                keyRef: config.S3_SECRET_ACCESS_KEY || null,
                priority: 100,
                active: true,
                shadow: false,
            } as StorageEndpoint;
        }

        throw new Error('No storage endpoint configured. Populate storage_endpoints table or run db:seed.');
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
 * Handles 'env-fallback' for self-hosted when no storage_endpoints rows exist.
 */
export async function getEndpointById(endpointId: string): Promise<StorageEndpoint | null> {
    // env-fallback is a virtual endpoint (self-hosted .env fallback)
    if (endpointId === 'env-fallback' && config.SELF_HOSTED_MODE && config.S3_ENDPOINT && config.S3_BUCKET) {
        return {
            id: 'env-fallback',
            projectId: null,
            endpointUrl: config.S3_ENDPOINT,
            bucket: config.S3_BUCKET,
            region: config.S3_REGION,
            accessKeyId: config.S3_ACCESS_KEY_ID || null,
            keyRef: config.S3_SECRET_ACCESS_KEY || null,
            priority: 100,
            active: true,
            shadow: false,
        } as StorageEndpoint;
    }

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

    // Resolve credentials
    // For Self-Hosted: prefer stored, fall back to process.env (simpler)
    // For Production: enforce stored in database (schema relies on this)
    const accessKeyId = config.SELF_HOSTED_MODE
        ? (endpoint.accessKeyId || config.S3_ACCESS_KEY_ID)
        : endpoint.accessKeyId;

    const secretAccessKey = config.SELF_HOSTED_MODE
        ? (safeDecrypt(endpoint.keyRef) || config.S3_SECRET_ACCESS_KEY)
        : safeDecrypt(endpoint.keyRef);

    const region = (config.SELF_HOSTED_MODE
        ? (endpoint.region || config.S3_REGION)
        : endpoint.region) || undefined;

    // Validate S3 credentials are available
    if (!accessKeyId || !secretAccessKey) {
        const mode = config.SELF_HOSTED_MODE ? 'Self-Hosted' : 'Production';
        throw new Error(
            `S3 credentials missing for ${mode}. ` +
            (config.SELF_HOSTED_MODE
                ? 'Set S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY in .env.'
                : 'Configure accessKeyId and keyRef in the storage_endpoints table.')
        );
    }

    const clientConfig = {
        endpoint: endpoint.endpointUrl,
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
    const { client, bucket } = getS3ClientForEndpoint(endpoint);

    try {
        await client.send(
            new PutObjectCommand({
                Bucket: bucket,
                Key: key,
                Body: body,
                ContentType: contentType,
                Metadata: metadata,
            })
        );

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
        const { client, bucket } = getS3ClientForEndpoint(endpoint);
        try {
            await client.send(
                new PutObjectCommand({
                    Bucket: bucket,
                    Key: key,
                    Body: body,
                    ContentType: contentType,
                    Metadata: metadata,
                })
            );
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

/**
 * Get signed URL for uploading to project's endpoint
 */
export async function getSignedUploadUrl(
    projectId: string,
    key: string,
    contentType: string,
    expiresInSeconds: number = 3600,
    contentEncoding?: string
): Promise<{ url: string; endpointId: string } | null> {
    try {
        const endpoint = await getEndpointForProject(projectId);
        const { publicClient, bucket } = getS3ClientForEndpoint(endpoint);

        const command = new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            ContentType: contentType,
            ...(contentEncoding ? { ContentEncoding: contentEncoding } : {}),
        });

        const url = await getSignedUrl(publicClient, command, {
            expiresIn: expiresInSeconds,
        });

        return { url, endpointId: endpoint.id };
    } catch (err) {
        logger.error({ err, key }, 'Failed to generate signed upload URL');
        return null;
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

        // Convert stream to buffer
        const chunks: Uint8Array[] = [];
        for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
            chunks.push(chunk);
        }
        const buffer = Buffer.concat(chunks);

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
        const { client, bucket } = getS3ClientForEndpoint(endpoint);

        const response = await client.send(
            new HeadObjectCommand({
                Bucket: bucket,
                Key: key,
            })
        );

        const len = response.ContentLength;
        return typeof len === 'number' && Number.isFinite(len) ? len : null;
    } catch (err) {
        logger.debug({ err, projectId, key }, 'Failed to HEAD object size');
        return null;
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
                logger.info({ projectId, count: objectsToDelete.length }, 'Deleted batch of S3 assets');
            }

            continuationToken = listResponse.NextContinuationToken;
        } while (continuationToken);
    };

    try {
        // Delete from primary
        await deleteFromBucket(client, bucket);
        logger.info({ projectId, endpoint: endpoint.id }, 'Primary project assets deleted');

        // Delete from shadows
        for (const shadow of shadows) {
            const { client: shadowClient, bucket: shadowBucket } = getS3ClientForEndpoint(shadow);
            try {
                await deleteFromBucket(shadowClient, shadowBucket);
                logger.info({ projectId, endpoint: shadow.id }, 'Shadow project assets deleted');
            } catch (err) {
                logger.error({ err, projectId, endpoint: shadow.id }, 'Failed to delete shadow assets');
            }
        }
    } catch (err) {
        logger.error({ err, projectId }, 'Failed to delete project assets');
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
