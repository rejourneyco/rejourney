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
import { eq, and, isNull, isNotNull, desc, or } from 'drizzle-orm';
import { PassThrough, type Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { safeDecrypt } from '../services/crypto.js';
import { isAbortLikeError } from '../utils/abortLikeError.js';

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
    storageClass: string | null;
}

export interface S3PrefixDeletionEndpointResult {
    endpointId: string;
    endpointUrl: string;
    projectId: string | null;
    shadow: boolean;
    active: boolean;
    prefix: string;
    bucket: string;
    deletedObjectCount: number;
    deletedBytes: number;
    missingPrefix?: boolean;
    listStatus?: 'deleted' | 'empty' | 'missing';
    durationMs?: number;
}

export interface S3PrefixDeletionResult {
    prefix: string;
    deletedObjectCount: number;
    deletedBytes: number;
    endpointResults: S3PrefixDeletionEndpointResult[];
}

export interface S3ObjectDeletionEndpointResult {
    endpointId: string;
    endpointUrl: string;
    projectId: string | null;
    shadow: boolean;
    active: boolean;
    bucket: string;
    deletedObjectCount: number;
    deletedBytes: number;
}

export interface S3ObjectDeletionResult {
    deletedObjectCount: number;
    deletedBytes: number;
    endpointResults: S3ObjectDeletionEndpointResult[];
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

interface ExternalS3DeletionTarget {
    client: S3Client;
    bucket: string;
    endpointId: string;
    endpointUrl: string;
    projectId: string | null;
    shadow: boolean;
    active: boolean;
}

export type ArtifactUploadFailureType = 'aborted' | 'storage';

export type StorageEndpointAddressingMode = 'path-style' | 'virtual-hosted';

export interface NormalizedStorageEndpoint {
    endpointUrl: string;
    forcePathStyle: boolean;
    addressingMode: StorageEndpointAddressingMode;
}

export function normalizeStorageEndpointForS3Client(
    endpointUrl: string,
    bucket: string,
): NormalizedStorageEndpoint {
    try {
        const parsed = new URL(endpointUrl);
        const bucketPrefix = `${bucket}.`;
        if (bucket && parsed.hostname.startsWith(bucketPrefix)) {
            parsed.hostname = parsed.hostname.slice(bucketPrefix.length);
            parsed.pathname = parsed.pathname.replace(/\/+$/, '');
            return {
                endpointUrl: parsed.toString().replace(/\/$/, ''),
                forcePathStyle: false,
                addressingMode: 'virtual-hosted',
            };
        }
    } catch {
        return {
            endpointUrl,
            forcePathStyle: true,
            addressingMode: 'path-style',
        };
    }

    return {
        endpointUrl,
        forcePathStyle: true,
        addressingMode: 'path-style',
    };
}

function isStorageMissingError(err: unknown): boolean {
    const anyErr = err as any;
    const httpStatus = anyErr?.$metadata?.httpStatusCode;
    const code = String(anyErr?.Code ?? anyErr?.code ?? '').toLowerCase();
    const name = String(anyErr?.name ?? '').toLowerCase();
    return (
        httpStatus === 404
        || code === 'nosuchkey'
        || code === 'notfound'
        || name === 'nosuchkey'
        || name === 'notfound'
    );
}

function isStorageForbiddenError(err: unknown): boolean {
    const anyErr = err as any;
    const httpStatus = anyErr?.$metadata?.httpStatusCode;
    const message = err instanceof Error ? err.message : String(err);
    const code = String(anyErr?.Code ?? anyErr?.code ?? '').toLowerCase();
    const name = String(anyErr?.name ?? '').toLowerCase();
    const normalizedMessage = message.toLowerCase();
    return (
        httpStatus === 403
        || code.includes('accessdenied')
        || code.includes('forbidden')
        || name.includes('accessdenied')
        || name.includes('forbidden')
        || normalizedMessage.includes('access denied')
    );
}

export class StorageDownloadError extends Error {
    statusCode: 403 | 404 | 500;

    constructor(message: string, statusCode: 403 | 404 | 500, cause?: unknown) {
        super(message, cause === undefined ? undefined : { cause });
        this.name = 'StorageDownloadError';
        this.statusCode = statusCode;
    }
}

export function classifyS3DeletionError(err: unknown): string {
    const anyErr = err as any;
    const message = err instanceof Error ? err.message : String(err);
    const code = String(anyErr?.Code ?? anyErr?.code ?? '').toLowerCase();
    const name = String(anyErr?.name ?? '').toLowerCase();
    if (isStorageMissingError(err)) return 'missing_source_prefix';
    if (code.includes('authorization') || name.includes('authorization') || message.includes('authorization header is malformed')) {
        return 'endpoint_config_error';
    }
    if (code.includes('accessdenied') || name.includes('accessdenied') || message.includes('AccessDenied')) {
        return 'storage_auth_failed';
    }
    return 'unexpected';
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
        if (parsed.hostname === 'minio' || parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '[::1]') {
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
const endpointByIdCache = new Map<string, CachedEndpoint>();
const sessionEndpointCache = new Map<string, CachedEndpoint>();

// Cache S3 clients by endpoint ID
const s3ClientPool = new Map<string, S3ClientEntry>();


// =============================================================================
// Endpoint Management
// =============================================================================

const ENDPOINT_MEMORY_CACHE_TTL_MS = 10 * 60 * 1000;

function getFreshCachedEndpoint(cache: Map<string, CachedEndpoint>, key: string): StorageEndpoint | null {
    const cached = cache.get(key);
    if (!cached) return null;
    if (cached.expiresAt > Date.now()) return cached.endpoint;
    cache.delete(key);
    return null;
}

function rememberEndpoint(endpoint: StorageEndpoint, projectId?: string | null): void {
    const entry = { endpoint, expiresAt: Date.now() + ENDPOINT_MEMORY_CACHE_TTL_MS };
    endpointByIdCache.set(endpoint.id, entry);
    if (projectId !== undefined) {
        endpointCache.set(projectId, entry);
    }
}

function sessionEndpointMemoryKey(projectId: string, sessionId: string): string {
    return `${projectId}:${sessionId}`;
}

function rememberSessionEndpoint(projectId: string, sessionId: string, endpoint: StorageEndpoint): void {
    const entry = { endpoint, expiresAt: Date.now() + ENDPOINT_MEMORY_CACHE_TTL_MS };
    sessionEndpointCache.set(sessionEndpointMemoryKey(projectId, sessionId), entry);
    endpointByIdCache.set(endpoint.id, entry);
}

/**
 * Get storage endpoint for a project with weighted load balancing.
 * Falls back to global default if no project-specific endpoint.
 * When multiple endpoints exist, uses weighted random selection based on priority.
 *
 * Result is cached in Redis for 10 minutes per projectId — endpoints never
 * change at runtime except during intentional storage reconfiguration, so
 * stale data for up to 10 minutes is completely acceptable.
 */
export async function getEndpointForProject(projectId: string): Promise<StorageEndpoint> {
    // Lazy import to avoid circular dependency
    const { db } = await import('./client.js');
    const { storageEndpoints } = await import('./schema.js');
    const { getEndpointCache, setEndpointCache } = await import('./redis.js');

    const memoryCached = getFreshCachedEndpoint(endpointCache as Map<string, CachedEndpoint>, projectId);
    if (memoryCached) {
        return memoryCached;
    }

    // Fast path: Redis cache hit
    const cached = await getEndpointCache(projectId);
    if (cached) {
        const endpoint = cached as unknown as StorageEndpoint;
        rememberEndpoint(endpoint, projectId);
        return endpoint;
    }

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
        const endpoint = endpoints[0] as StorageEndpoint;
        rememberEndpoint(endpoint, projectId);
        setEndpointCache(projectId, endpoint as unknown as Record<string, unknown>).catch(() => {});
        return endpoint;
    }

    // Multiple endpoints (k3s) - weighted random for load balancing.
    // Artifacts store endpointId at creation, so worker downloads from same endpoint.
    // Self-hosted Docker / dev Docker typically have single endpoint.
    // Note: we cache the selected endpoint so a single project consistently routes
    // to the same endpoint within a 10-minute window — this is intentional and safe
    // because the endpointId is stored on each artifact at creation time.
    const selected = selectWeightedRandom(endpoints as StorageEndpoint[]);
    rememberEndpoint(selected, projectId);
    setEndpointCache(projectId, selected as unknown as Record<string, unknown>).catch(() => {});
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
 * Get the storage endpoint that should be used for a new artifact on a session.
 * If the session already has artifacts, reuses their endpoint so all artifacts
 * for a session land on the same bucket even when multiple active endpoints exist.
 * Falls back to getEndpointForProject when the session has no artifacts yet.
 */
export async function getEndpointForSession(
    sessionId: string,
    projectId: string,
): Promise<StorageEndpoint> {
    const { db } = await import('./client.js');
    const { recordingArtifacts } = await import('./schema.js');
    const {
        getSessionEndpointCache,
        setSessionEndpointCache,
    } = await import('./redis.js');

    const memoryKey = sessionEndpointMemoryKey(projectId, sessionId);
    const memoryCached = getFreshCachedEndpoint(sessionEndpointCache, memoryKey);
    if (memoryCached) {
        return memoryCached;
    }

    const redisCached = await getSessionEndpointCache(projectId, sessionId);
    if (redisCached) {
        const endpoint = redisCached as unknown as StorageEndpoint;
        rememberSessionEndpoint(projectId, sessionId, endpoint);
        return endpoint;
    }

    const [existing] = await db
        .select({ endpointId: recordingArtifacts.endpointId })
        .from(recordingArtifacts)
        .where(and(
            eq(recordingArtifacts.sessionId, sessionId),
            isNotNull(recordingArtifacts.endpointId),
        ))
        .limit(1);

    if (existing?.endpointId) {
        const endpoint = await getEndpointById(existing.endpointId);
        if (endpoint) {
            rememberSessionEndpoint(projectId, sessionId, endpoint);
            setSessionEndpointCache(projectId, sessionId, endpoint as unknown as Record<string, unknown>).catch(() => {});
            return endpoint;
        }
    }

    const endpoint = await getEndpointForProject(projectId);
    rememberSessionEndpoint(projectId, sessionId, endpoint);
    setSessionEndpointCache(projectId, sessionId, endpoint as unknown as Record<string, unknown>).catch(() => {});
    return endpoint;
}

/**
 * Get storage endpoint by ID (for downloads from specific location)
 */
export async function getEndpointById(endpointId: string): Promise<StorageEndpoint | null> {
    const cachedById = getFreshCachedEndpoint(endpointByIdCache, endpointId);
    if (cachedById) {
        return cachedById;
    }

    // Check all caches first
    for (const [, cached] of endpointCache) {
        if (cached.endpoint.id === endpointId && cached.expiresAt > Date.now()) {
            endpointByIdCache.set(endpointId, cached);
            return cached.endpoint;
        }
    }

    const { getEndpointByIdCache, setEndpointByIdCache } = await import('./redis.js');
    const redisCached = await getEndpointByIdCache(endpointId);
    if (redisCached) {
        const endpoint = redisCached as unknown as StorageEndpoint;
        rememberEndpoint(endpoint);
        return endpoint;
    }

    const { db } = await import('./client.js');
    const { storageEndpoints } = await import('./schema.js');

    const [endpoint] = await db
        .select()
        .from(storageEndpoints)
        .where(eq(storageEndpoints.id, endpointId))
        .limit(1);

    if (endpoint) {
        rememberEndpoint(endpoint as StorageEndpoint);
        setEndpointByIdCache(endpointId, endpoint as unknown as Record<string, unknown>).catch(() => {});
    }

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

export async function getConfiguredStorageEndpoints(options: {
    projectId?: string;
    activeOnly?: boolean;
} = {}): Promise<StorageEndpoint[]> {
    const { db } = await import('./client.js');
    const { storageEndpoints } = await import('./schema.js');
    const { projectId, activeOnly = true } = options;

    if (projectId) {
        const rows = await db
            .select()
            .from(storageEndpoints)
            .where(
                activeOnly
                    ? and(
                        or(eq(storageEndpoints.projectId, projectId), isNull(storageEndpoints.projectId)),
                        eq(storageEndpoints.active, true),
                    )
                    : or(eq(storageEndpoints.projectId, projectId), isNull(storageEndpoints.projectId))
            )
            .orderBy(desc(storageEndpoints.priority));

        return rows as StorageEndpoint[];
    }

    const rows = activeOnly
        ? await db
            .select()
            .from(storageEndpoints)
            .where(eq(storageEndpoints.active, true))
            .orderBy(desc(storageEndpoints.priority))
        : await db
            .select()
            .from(storageEndpoints)
            .orderBy(desc(storageEndpoints.priority));

    return rows as StorageEndpoint[];
}

export async function resolveRetentionDeletionEndpoints(
    projectId: string,
    extraEndpointIds: Iterable<string | null | undefined> = []
): Promise<StorageEndpoint[]> {
    const endpointMap = new Map<string, StorageEndpoint>();

    const projectEndpoints = await getConfiguredStorageEndpoints({ projectId, activeOnly: true });
    for (const endpoint of projectEndpoints) {
        endpointMap.set(endpoint.id, endpoint);
    }

    for (const endpointId of extraEndpointIds) {
        if (!endpointId || endpointMap.has(endpointId)) continue;
        const endpoint = await getEndpointById(endpointId);
        if (!endpoint) continue;
        if (endpoint.projectId !== null && endpoint.projectId !== projectId) {
            logger.warn(
                { endpointId, endpointProjectId: endpoint.projectId, projectId },
                'Skipping foreign endpoint during retention deletion resolution',
            );
            continue;
        }
        endpointMap.set(endpoint.id, endpoint);
    }

    return Array.from(endpointMap.values());
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

    const resolvedEndpointUrl = resolveInternalEndpointUrl(endpoint);
    const usesLocalEnvEndpoint = Boolean(config.S3_ENDPOINT && resolvedEndpointUrl !== endpoint.endpointUrl);
    const accessKeyId = usesLocalEnvEndpoint ? config.S3_ACCESS_KEY_ID : endpoint.accessKeyId;
    const secretAccessKey = usesLocalEnvEndpoint ? config.S3_SECRET_ACCESS_KEY : safeDecrypt(endpoint.keyRef);
    const region = (usesLocalEnvEndpoint ? config.S3_REGION : endpoint.region) || undefined;

    if (!accessKeyId || !secretAccessKey) {
        throw new Error(
            'S3 credentials missing for storage endpoint. Configure accessKeyId and keyRef in the storage_endpoints table.',
        );
    }

    const internalEndpoint = normalizeStorageEndpointForS3Client(
        resolvedEndpointUrl,
        endpoint.bucket,
    );
    const clientConfig = {
        endpoint: internalEndpoint.endpointUrl,
        region,
        credentials: {
            accessKeyId,
            secretAccessKey,
        },
        forcePathStyle: internalEndpoint.forcePathStyle,
    };

    // Create internal client (for server-side operations)
    const client = new S3Client(clientConfig);

    // Create public client for presigned URLs
    // Replace Docker internal hostnames for local dev
    let publicEndpoint = config.S3_PUBLIC_ENDPOINT || endpoint.endpointUrl;
    if (!config.S3_PUBLIC_ENDPOINT && publicEndpoint.includes('minio:9000')) {
        publicEndpoint = publicEndpoint.replace('minio:9000', 'localhost:9000');
    }
    const normalizedPublicEndpoint = normalizeStorageEndpointForS3Client(publicEndpoint, endpoint.bucket);

    const publicClient = new S3Client({
        ...clientConfig,
        endpoint: normalizedPublicEndpoint.endpointUrl,
        forcePathStyle: normalizedPublicEndpoint.forcePathStyle,
    });

    const entry: S3ClientEntry = {
        client,
        publicClient,
        bucket: endpoint.bucket,
    };

    s3ClientPool.set(endpoint.id, entry);
    return entry;
}

function ensureSafeObjectKey(key: string): string {
    const normalizedKey = key.trim();
    if (!normalizedKey) {
        throw new Error('Refusing to delete an empty storage object key');
    }
    if (normalizedKey === '/' || normalizedKey === '.') {
        throw new Error(`Unsafe storage object key: ${key}`);
    }
    return normalizedKey;
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
            ...(endpoint.storageClass ? { StorageClass: endpoint.storageClass as any } : {}),
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
    const controller = new AbortController();
    const uploadBody = new PassThrough();
    const command = new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: uploadBody,
        ContentType: contentType,
        ...(typeof contentLength === 'number' ? { ContentLength: contentLength } : {}),
        Metadata: metadata,
        ...(endpoint.storageClass ? { StorageClass: endpoint.storageClass as any } : {}),
    });

    try {
        await Promise.all([
            client.send(command, { abortSignal: controller.signal }),
            pipeline(body, uploadBody),
        ]);
    } catch (err) {
        controller.abort();
        uploadBody.destroy(err instanceof Error ? err : undefined);
        if (typeof (body as Readable).destroy === 'function' && !(body as Readable).destroyed) {
            (body as Readable).destroy(err instanceof Error ? err : undefined);
        }
        throw err;
    }
}

function classifyArtifactUploadFailure(err: unknown): ArtifactUploadFailureType {
    if (isAbortLikeError(err)) {
        return 'aborted';
    }

    return 'storage';
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
): Promise<{ success: boolean; endpointId: string; error?: string; errorType?: ArtifactUploadFailureType }> {
    try {
        const endpoint = endpointId
            ? (await getEndpointById(endpointId)) || await getEndpointForProject(projectId)
            : await getEndpointForProject(projectId);

        await putObjectStreamToEndpoint(endpoint, key, body, contentType, contentLength, metadata);
        logger.debug({ key, endpointId: endpoint.id }, 'Uploaded artifact stream to S3');

        return { success: true, endpointId: endpoint.id };
    } catch (err) {
        const errorType = classifyArtifactUploadFailure(err);
        logger.error({ err, errorType, key, projectId, endpointId }, 'Failed to upload artifact stream to S3');
        return {
            success: false,
            endpointId: endpointId || 'unknown',
            error: String(err),
            errorType,
        };
    }
}

export async function uploadBytesToS3ForArtifact(
    artifactId: string,
    body: Buffer,
    contentType: string = 'application/octet-stream',
): Promise<{ success: boolean; endpointId: string; error?: string }> {
    try {
        const { db } = await import('./client.js');
        const { recordingArtifacts, sessions } = await import('./schema.js');

        const [row] = await db.select({
            artifact: recordingArtifacts,
            projectId: sessions.projectId,
        })
            .from(recordingArtifacts)
            .innerJoin(sessions, eq(recordingArtifacts.sessionId, sessions.id))
            .where(eq(recordingArtifacts.id, artifactId))
            .limit(1);

        if (!row) {
            return {
                success: false,
                endpointId: 'unknown',
                error: `Artifact ${artifactId} not found`,
            };
        }

        return uploadToS3ForArtifact(
            row.projectId,
            row.artifact.s3ObjectKey,
            body,
            contentType,
            {
                artifact_id: row.artifact.id,
                session_id: row.artifact.sessionId,
                kind: row.artifact.kind,
            },
            row.artifact.endpointId,
        );
    } catch (err) {
        logger.error({ err, artifactId }, 'Failed to upload buffered artifact bytes to S3');
        return {
            success: false,
            endpointId: 'unknown',
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
 * Download raw data from S3 and preserve the failure class for callers that need
 * distinct missing/forbidden/server-error responses.
 */
export async function downloadRawFromS3Strict(
    endpointId: string,
    key: string
): Promise<Buffer> {
    const endpoint = await getEndpointById(endpointId);
    if (!endpoint) {
        throw new StorageDownloadError('Storage endpoint not found', 500);
    }

    const { client, bucket } = getS3ClientForEndpoint(endpoint);

    try {
        const response = await client.send(new GetObjectCommand({
            Bucket: bucket,
            Key: key,
        }));

        if (!response.Body) {
            throw new StorageDownloadError('Storage object body is empty', 404);
        }
        return streamBodyToBuffer(response.Body as AsyncIterable<Uint8Array>);
    } catch (err) {
        if (err instanceof StorageDownloadError) throw err;
        if (isStorageMissingError(err)) {
            logger.debug({ err, key, endpointId }, 'Storage object not found during strict download');
            throw new StorageDownloadError('Storage object not found', 404, err);
        }
        if (isStorageForbiddenError(err)) {
            logger.warn({ err, key, endpointId }, 'Storage object forbidden during strict download');
            throw new StorageDownloadError('Storage object access forbidden', 403, err);
        }
        logger.error({ err, key, endpointId }, 'Failed to download from S3');
        throw new StorageDownloadError('Storage download failed', 500, err);
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

export async function downloadRawFromS3ForProjectStrict(
    projectId: string,
    key: string
): Promise<Buffer> {
    const endpoint = await getEndpointForProject(projectId);
    return downloadRawFromS3Strict(endpoint.id, key);
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

export async function downloadRawFromS3ForArtifactStrict(
    projectId: string,
    key: string,
    endpointId: string | null | undefined
): Promise<Buffer> {
    if (endpointId) {
        const endpoint = await getEndpointById(endpointId);
        if (endpoint) {
            return downloadRawFromS3Strict(endpoint.id, key);
        }
    }
    return downloadRawFromS3ForProjectStrict(projectId, key);
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
 * Deletes recursively under tenant/{teamId}/project/{projectId}/ on all known
 * endpoints — including historical/inactive ones passed via extraEndpointIds.
 */
export async function deleteProjectAssets(
    projectId: string,
    teamId: string,
    extraEndpointIds: Iterable<string | null | undefined> = [],
): Promise<void> {
    const prefix = `tenant/${teamId}/project/${projectId}/`;
    await deletePrefixFromProjectStorage(projectId, prefix, extraEndpointIds);
}

function ensureSafePrefix(prefix: string): string {
    const normalized = prefix.trim();
    if (!normalized) {
        throw new Error('S3 prefix must not be empty');
    }
    if (normalized === '/' || normalized === '.') {
        throw new Error(`Refusing unsafe S3 prefix: ${normalized}`);
    }
    return normalized;
}

async function deletePrefixFromEndpoint(
    endpoint: StorageEndpoint,
    prefix: string
): Promise<S3PrefixDeletionEndpointResult> {
    const normalizedPrefix = ensureSafePrefix(prefix);
    const { client, bucket } = getS3ClientForEndpoint(endpoint);
    return deletePrefixWithClient({
        client,
        bucket,
        endpointId: endpoint.id,
        endpointUrl: endpoint.endpointUrl,
        projectId: endpoint.projectId,
        shadow: endpoint.shadow,
        active: endpoint.active,
    }, normalizedPrefix);
}

async function deletePrefixWithClient(
    target: ExternalS3DeletionTarget,
    prefix: string,
): Promise<S3PrefixDeletionEndpointResult> {
    const normalizedPrefix = ensureSafePrefix(prefix);
    const startedAt = Date.now();
    let continuationToken: string | undefined;
    let deletedObjectCount = 0;
    let deletedBytes = 0;
    let sawContents = false;

    do {
        let listResponse;
        try {
            listResponse = await target.client.send(new ListObjectsV2Command({
                Bucket: target.bucket,
                Prefix: normalizedPrefix,
                ContinuationToken: continuationToken,
            }));
        } catch (err) {
            if (isStorageMissingError(err)) {
                return {
                    endpointId: target.endpointId,
                    endpointUrl: target.endpointUrl,
                    projectId: target.projectId,
                    shadow: target.shadow,
                    active: target.active,
                    prefix: normalizedPrefix,
                    bucket: target.bucket,
                    deletedObjectCount,
                    deletedBytes,
                    missingPrefix: true,
                    listStatus: 'missing',
                    durationMs: Date.now() - startedAt,
                };
            }
            throw err;
        }

        const contents = listResponse.Contents ?? [];
        if (contents.length === 0) {
            break;
        }
        sawContents = true;

        const objectsToDelete = contents
            .filter((obj) => obj.Key)
            .map((obj) => ({ Key: obj.Key as string }));

        deletedObjectCount += objectsToDelete.length;
        deletedBytes += contents.reduce((total, obj) => total + Number(obj.Size ?? 0), 0);

        if (objectsToDelete.length > 0) {
            const deleteResponse = await target.client.send(new DeleteObjectsCommand({
                Bucket: target.bucket,
                Delete: {
                    Objects: objectsToDelete,
                    Quiet: true,
                },
            }));
            const deleteErrors = deleteResponse.Errors ?? [];
            if (deleteErrors.length > 0) {
                const sample = deleteErrors[0];
                throw new Error(
                    `Failed to delete ${deleteErrors.length} object(s) from ${target.bucket} for prefix ${normalizedPrefix}; sample key=${sample?.Key ?? 'unknown'} code=${sample?.Code ?? 'unknown'}`,
                );
            }
        }

        continuationToken = listResponse.NextContinuationToken;
    } while (continuationToken);

    return {
        endpointId: target.endpointId,
        endpointUrl: target.endpointUrl,
        projectId: target.projectId,
        shadow: target.shadow,
        active: target.active,
        prefix: normalizedPrefix,
        bucket: target.bucket,
        deletedObjectCount,
        deletedBytes,
        missingPrefix: false,
        listStatus: sawContents ? 'deleted' : 'empty',
        durationMs: Date.now() - startedAt,
    };
}

async function deleteObjectsWithClient(
    target: ExternalS3DeletionTarget,
    objectKeys: Iterable<string>,
): Promise<S3ObjectDeletionEndpointResult> {
    const normalizedKeys = Array.from(new Set(Array.from(objectKeys, ensureSafeObjectKey)));
    if (normalizedKeys.length === 0) {
        return {
            endpointId: target.endpointId,
            endpointUrl: target.endpointUrl,
            projectId: target.projectId,
            shadow: target.shadow,
            active: target.active,
            bucket: target.bucket,
            deletedObjectCount: 0,
            deletedBytes: 0,
        };
    }

    const existingKeys: string[] = [];
    let deletedBytes = 0;

    for (const key of normalizedKeys) {
        try {
            const response = await target.client.send(new HeadObjectCommand({
                Bucket: target.bucket,
                Key: key,
            }));
            existingKeys.push(key);
            deletedBytes += Number(response.ContentLength ?? 0);
        } catch (err: any) {
            const httpStatus = err?.$metadata?.httpStatusCode;
            const code = String(err?.Code ?? err?.code ?? '').toLowerCase();
            const name = String(err?.name ?? '').toLowerCase();
            if (
                httpStatus === 404
                || code === 'nosuchkey'
                || code === 'notfound'
                || name === 'nosuchkey'
                || name === 'notfound'
            ) {
                continue;
            }
            throw err;
        }
    }

    for (let i = 0; i < existingKeys.length; i += 1000) {
        const batch = existingKeys.slice(i, i + 1000);
        if (batch.length === 0) continue;

        const deleteResponse = await target.client.send(new DeleteObjectsCommand({
            Bucket: target.bucket,
            Delete: {
                Objects: batch.map((Key) => ({ Key })),
                Quiet: true,
            },
        }));
        const deleteErrors = deleteResponse.Errors ?? [];
        if (deleteErrors.length > 0) {
            const sample = deleteErrors[0];
            throw new Error(
                `Failed to delete ${deleteErrors.length} object(s) from ${target.bucket}; sample key=${sample?.Key ?? 'unknown'} code=${sample?.Code ?? 'unknown'}`,
            );
        }
    }

    return {
        endpointId: target.endpointId,
        endpointUrl: target.endpointUrl,
        projectId: target.projectId,
        shadow: target.shadow,
        active: target.active,
        bucket: target.bucket,
        deletedObjectCount: existingKeys.length,
        deletedBytes,
    };
}

export async function deletePrefixFromStorageEndpoints(
    prefix: string,
    endpoints: Iterable<StorageEndpoint>
): Promise<S3PrefixDeletionResult> {
    const normalizedPrefix = ensureSafePrefix(prefix);
    const dedupedEndpoints = new Map<string, StorageEndpoint>();
    for (const endpoint of endpoints) {
        dedupedEndpoints.set(endpoint.id, endpoint);
    }

    const endpointResults: S3PrefixDeletionEndpointResult[] = [];
    const endpointList = Array.from(dedupedEndpoints.values());
    const concurrency = Math.max(1, Math.min(config.RETENTION_S3_CONCURRENCY, endpointList.length || 1));
    let nextIndex = 0;

    async function worker(): Promise<void> {
        while (nextIndex < endpointList.length) {
            const endpoint = endpointList[nextIndex++];
            const result = await deletePrefixFromEndpoint(endpoint, normalizedPrefix);
            endpointResults.push(result);
        }
    }

    await Promise.all(Array.from({ length: concurrency }, () => worker()));

    return {
        prefix: normalizedPrefix,
        deletedObjectCount: endpointResults.reduce((total, result) => total + result.deletedObjectCount, 0),
        deletedBytes: endpointResults.reduce((total, result) => total + result.deletedBytes, 0),
        endpointResults,
    };
}

export async function deleteObjectsFromStorageEndpoints(
    objectKeys: Iterable<string>,
    endpoints: Iterable<StorageEndpoint>,
): Promise<S3ObjectDeletionResult> {
    const normalizedKeys = Array.from(new Set(Array.from(objectKeys, ensureSafeObjectKey)));
    if (normalizedKeys.length === 0) {
        return {
            deletedObjectCount: 0,
            deletedBytes: 0,
            endpointResults: [],
        };
    }

    const dedupedEndpoints = new Map<string, StorageEndpoint>();
    for (const endpoint of endpoints) {
        dedupedEndpoints.set(endpoint.id, endpoint);
    }

    const endpointResults: S3ObjectDeletionEndpointResult[] = [];
    for (const endpoint of dedupedEndpoints.values()) {
        const { client, bucket } = getS3ClientForEndpoint(endpoint);
        endpointResults.push(await deleteObjectsWithClient({
            client,
            bucket,
            endpointId: endpoint.id,
            endpointUrl: endpoint.endpointUrl,
            projectId: endpoint.projectId,
            shadow: endpoint.shadow,
            active: endpoint.active,
        }, normalizedKeys));
    }

    return {
        deletedObjectCount: endpointResults.reduce((total, result) => total + result.deletedObjectCount, 0),
        deletedBytes: endpointResults.reduce((total, result) => total + result.deletedBytes, 0),
        endpointResults,
    };
}

export async function deletePrefixFromProjectStorage(
    projectId: string,
    prefix: string,
    extraEndpointIds: Iterable<string | null | undefined> = []
): Promise<S3PrefixDeletionResult> {
    const endpoints = await resolveRetentionDeletionEndpoints(projectId, extraEndpointIds);
    return deletePrefixFromStorageEndpoints(prefix, endpoints);
}

export async function deleteObjectsFromProjectStorage(
    projectId: string,
    objectKeys: Iterable<string>,
    extraEndpointIds: Iterable<string | null | undefined> = [],
): Promise<S3ObjectDeletionResult> {
    const endpoints = await resolveRetentionDeletionEndpoints(projectId, extraEndpointIds);
    return deleteObjectsFromStorageEndpoints(objectKeys, endpoints);
}

export async function deletePrefixFromAllConfiguredStorageEndpoints(
    prefix: string
): Promise<S3PrefixDeletionResult> {
    const endpoints = await getConfiguredStorageEndpoints({ activeOnly: false });
    return deletePrefixFromStorageEndpoints(prefix, endpoints);
}


/**
 * Delete all objects under a specific S3 prefix for a given project.
 * Uses the project's default endpoint and any shadow endpoints.
 */
export async function deletePrefixFromS3ForProject(
    projectId: string,
    prefix: string
): Promise<void> {
    await deletePrefixFromProjectStorage(projectId, prefix);
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
        // Query a global endpoint directly — avoids passing a fake UUID to getEndpointForProject
        const { db } = await import('./client.js');
        const { storageEndpoints } = await import('./schema.js');
        const [globalEndpoint] = await db
            .select()
            .from(storageEndpoints)
            .where(and(
                isNull(storageEndpoints.projectId),
                eq(storageEndpoints.active, true),
                eq(storageEndpoints.shadow, false),
            ))
            .orderBy(desc(storageEndpoints.priority))
            .limit(1);

        if (!globalEndpoint) return false;

        const { client, bucket } = getS3ClientForEndpoint(globalEndpoint);

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
