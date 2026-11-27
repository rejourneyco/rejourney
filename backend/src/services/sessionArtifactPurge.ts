import { and, eq, exists, inArray, or, sql, type SQL } from 'drizzle-orm';
import {
    db,
    projects,
    recordingArtifacts,
    sessionMetrics,
    sessions,
} from '../db/client.js';
import { getRedis, invalidateSessionEndpointCache, invalidateSessionExistsCache } from '../db/redis.js';
import {
    classifyS3DeletionError,
    deleteObjectsFromStorageEndpoints,
    deletePrefixFromStorageEndpoints,
    resolveRetentionDeletionEndpoints,
    type S3ObjectDeletionResult,
} from '../db/s3.js';
import { logger } from '../logger.js';
import { config } from '../config.js';
import {
    beginRetentionDeletionLog,
    finalizeRetentionDeletionLog,
} from './retentionAudit.js';
import { runBoundedConcurrentBatch } from './retentionBatch.js';

const FRAME_CACHE_PREFIX = 'screenshot_frames:';
const FRAME_CACHE_V2_PREFIX = 'screenshot_frames:v2:';
const SESSION_CORE_CACHE_PREFIX = 'session_core:';
const SESSION_TIMELINE_CACHE_PREFIX = 'session_timeline:';
const SESSION_HIERARCHY_CACHE_PREFIX = 'session_hierarchy:';

/**
 * A session can own millions of recording_artifacts rows (one that kept
 * uploading event batches for 30 days reached 2.2 million). Nothing in the
 * purge path may therefore read or return one row per artifact: totals come
 * from one aggregate, misplaced keys are read one bounded page at a time, and
 * rows are deleted in bounded statements.
 *
 * Reading a session's rows is itself expensive at that size (each pass over
 * the 2.2 million rows took more than 30 seconds), so the aggregate is the
 * only statement that always visits every row. It also counts the misplaced
 * keys, and the page query runs only when that count is not zero.
 */
export const INVALID_ARTIFACT_PAGE_SIZE = 1_000;
export const ARTIFACT_ROW_DELETE_BATCH_SIZE = 5_000;

type InvalidSessionArtifact = {
    artifactId: string;
    kind: string;
    s3ObjectKey: string;
    endpointId: string | null;
};

type InvalidSessionArtifactPage = {
    invalidArtifacts: InvalidSessionArtifact[];
    /** True when more misplaced artifacts exist than this page holds. */
    truncated: boolean;
};

type SessionPurgeContext = {
    sessionId: string;
    projectId: string;
    teamId: string;
    retentionTier: number;
    retentionDays: number;
    recordingDeleted: boolean;
    isReplayExpired: boolean;
    canonicalPrefix: string;
    artifactCount: number;
    artifactBytes: number;
    /** Distinct endpoint ids across the session's artifacts; may contain one null. */
    artifactEndpointIds: (string | null)[];
    /** First page of artifacts stored outside the canonical prefix. */
    invalidArtifacts: InvalidSessionArtifact[];
    invalidArtifactsTruncated: boolean;
};

export interface PurgeSessionArtifactsOptions {
    runId: string;
    trigger: string;
    now?: Date;
    invalidateCaches?: boolean;
    allowMissingStorage?: boolean;
    retentionTier?: number | null;
    retentionDays?: number | null;
    failOnMissingStorage?: boolean;
}

export interface PurgeSessionArtifactsResult {
    sessionId: string;
    projectId: string;
    teamId: string;
    deletedArtifactCount: number;
    deletedObjectCount: number;
    deletedBytes: number;
    plannedArtifactCount: number;
    plannedArtifactBytes: number;
    cacheKeyCount: number;
    storageMissing: boolean;
}

export interface ExpiredSessionArtifactRepairResult {
    attempted: number;
    repaired: number;
    failed: number;
    deletedObjectCount: number;
    deletedBytes: number;
    reachedProcessingCap: boolean;
}

type ExpiredSessionRepairCandidate = {
    sessionId: string;
    retentionTier: number;
    retentionDays: number;
    startedAt: Date;
};

export function buildCanonicalSessionStoragePrefix(
    teamId: string,
    projectId: string,
    sessionId: string,
): string {
    return `tenant/${teamId}/project/${projectId}/sessions/${sessionId}/`;
}

export function buildDerivedSessionStoragePrefix(sessionId: string): string {
    return `sessions/${sessionId}/`;
}

async function collectExpiredRepairCandidates(limit: number): Promise<{
    sessionsToRepair: ExpiredSessionRepairCandidate[];
    reachedProcessingCap: boolean;
}> {
    const currentRetentionPeriodExpired = sql`
        ${sessions.startedAt} < NOW() - (${sessions.retentionDays} * INTERVAL '1 day')
    `;

    const sessionsToRepair = await db
        .select({
            sessionId: sessions.id,
            retentionTier: sessions.retentionTier,
            retentionDays: sessions.retentionDays,
            startedAt: sessions.startedAt,
        })
        .from(sessions)
        .where(
            and(
                or(
                    eq(sessions.recordingDeleted, true),
                    eq(sessions.isReplayExpired, true),
                ),
                currentRetentionPeriodExpired,
                exists(
                    db
                        .select({ artifactId: recordingArtifacts.id })
                        .from(recordingArtifacts)
                        .where(eq(recordingArtifacts.sessionId, sessions.id)),
                ),
            ),
        )
        .orderBy(sessions.startedAt, sessions.id)
        .limit(limit);

    return {
        sessionsToRepair,
        reachedProcessingCap: sessionsToRepair.length >= limit,
    };
}

async function invalidatePurgedSessionCaches(sessionId: string): Promise<number> {
    try {
        const redis = getRedis();
        const deletedKeyCount = await redis.del(
            `${SESSION_CORE_CACHE_PREFIX}${sessionId}`,
            `${SESSION_TIMELINE_CACHE_PREFIX}${sessionId}`,
            `${SESSION_HIERARCHY_CACHE_PREFIX}${sessionId}`,
            `${FRAME_CACHE_PREFIX}${sessionId}`,
            `${FRAME_CACHE_V2_PREFIX}${sessionId}`,
        );

        // Individual screenshot_frame_data keys already have a hard 10-minute
        // TTL. Scanning the entire Redis keyspace once per expired session made
        // retention O(expired sessions × Redis keys), and cross-region Sentinel
        // failover turned each no-op scan into hundreds of network round trips.
        // The session is marked replay-unavailable before this returns, so those
        // short-lived payload keys are unreachable while they expire naturally.
        return Number(deletedKeyCount);
    } catch (err) {
        logger.warn({ err, sessionId }, 'Failed to invalidate purged session caches');
        return 0;
    }
}

function parseNonNegativeInteger(value: unknown, label: string): number {
    const parsed = typeof value === 'number'
        ? value
        : typeof value === 'string' && value.trim() !== ''
            ? Number(value)
            : Number.NaN;
    if (!Number.isSafeInteger(parsed) || parsed < 0) {
        throw new Error(`Unexpected ${label} from recording_artifacts query: ${String(value)}`);
    }
    return parsed;
}

async function loadSessionArtifactTotals(sessionId: string, canonicalPrefix: string): Promise<{
    artifactCount: number;
    artifactBytes: number;
    artifactEndpointIds: (string | null)[];
    misplacedArtifactCount: number;
}> {
    // One row regardless of how many artifacts the session has, and the one
    // full pass over the session's rows that every purge needs: the endpoint
    // ids have to be known before any storage is deleted.
    const [totals] = await db
        .select({
            artifactCount: sql<number | string>`count(*)`,
            artifactBytes: sql<number | string>`coalesce(sum(coalesce(${recordingArtifacts.sizeBytes}, ${recordingArtifacts.declaredSizeBytes}, 0)), 0)`,
            // DISTINCT keeps a single NULL when some artifacts have no pinned
            // endpoint; resolveRetentionDeletionEndpoints de-duplicates and
            // drops NULLs itself, so this is the same input set as before.
            endpointIds: sql<(string | null)[] | null>`array_agg(distinct ${recordingArtifacts.endpointId})`,
            // starts_with takes the prefix as a plain bound value, so no LIKE
            // pattern is built from tenant, project or session ids.
            misplacedArtifactCount: sql<number | string>`count(*) filter (where not starts_with(${recordingArtifacts.s3ObjectKey}, ${canonicalPrefix}::text))`,
        })
        .from(recordingArtifacts)
        .where(eq(recordingArtifacts.sessionId, sessionId));

    if (!totals) {
        throw new Error(`Artifact totals query returned no row for session ${sessionId}`);
    }
    if (totals.endpointIds !== null && !Array.isArray(totals.endpointIds)) {
        // Guessing here could skip a historical endpoint and strand its objects.
        throw new Error(`Unexpected endpoint id list from recording_artifacts query for session ${sessionId}`);
    }

    return {
        artifactCount: parseNonNegativeInteger(totals.artifactCount, 'artifact count'),
        artifactBytes: parseNonNegativeInteger(totals.artifactBytes, 'artifact byte total'),
        artifactEndpointIds: totals.endpointIds ?? [],
        misplacedArtifactCount: parseNonNegativeInteger(totals.misplacedArtifactCount, 'misplaced artifact count'),
    };
}

/**
 * Reads up to one page of artifacts whose object key is outside the canonical
 * session prefix. Deliberately unordered: ORDER BY id with a LIMIT invites the
 * planner to walk the primary key of the whole table looking for matches.
 * Later pages are reached by deleting the rows of the page just handled.
 */
async function loadInvalidArtifactPage(
    sessionId: string,
    canonicalPrefix: string,
): Promise<InvalidSessionArtifactPage> {
    const rows = await db
        .select({
            artifactId: recordingArtifacts.id,
            kind: recordingArtifacts.kind,
            s3ObjectKey: recordingArtifacts.s3ObjectKey,
            endpointId: recordingArtifacts.endpointId,
        })
        .from(recordingArtifacts)
        .where(
            and(
                eq(recordingArtifacts.sessionId, sessionId),
                sql`NOT starts_with(${recordingArtifacts.s3ObjectKey}, ${canonicalPrefix}::text)`,
            ),
        )
        .limit(INVALID_ARTIFACT_PAGE_SIZE + 1);

    const truncated = rows.length > INVALID_ARTIFACT_PAGE_SIZE;
    return {
        invalidArtifacts: truncated ? rows.slice(0, INVALID_ARTIFACT_PAGE_SIZE) : rows,
        truncated,
    };
}

async function loadSessionPurgeContext(sessionId: string): Promise<SessionPurgeContext> {
    const [sessionResult] = await db
        .select({
            sessionId: sessions.id,
            projectId: sessions.projectId,
            teamId: projects.teamId,
            retentionTier: sessions.retentionTier,
            retentionDays: sessions.retentionDays,
            recordingDeleted: sessions.recordingDeleted,
            isReplayExpired: sessions.isReplayExpired,
        })
        .from(sessions)
        .innerJoin(projects, eq(sessions.projectId, projects.id))
        .where(eq(sessions.id, sessionId))
        .limit(1);

    if (!sessionResult) {
        throw new Error(`Session not found: ${sessionId}`);
    }

    const canonicalPrefix = buildCanonicalSessionStoragePrefix(
        sessionResult.teamId,
        sessionResult.projectId,
        sessionResult.sessionId,
    );
    const {
        misplacedArtifactCount,
        ...totals
    } = await loadSessionArtifactTotals(sessionResult.sessionId, canonicalPrefix);
    // Almost every session has no misplaced keys, and for those the page query
    // would be a second full pass that returns nothing. When there are some,
    // its LIMIT lets it stop as soon as a page is full.
    const invalidPage: InvalidSessionArtifactPage = misplacedArtifactCount > 0
        ? await loadInvalidArtifactPage(sessionResult.sessionId, canonicalPrefix)
        : { invalidArtifacts: [], truncated: false };

    return {
        ...sessionResult,
        canonicalPrefix,
        ...totals,
        invalidArtifacts: invalidPage.invalidArtifacts,
        invalidArtifactsTruncated: invalidPage.truncated,
    };
}

/**
 * Runs one DELETE on recording_artifacts as its own committed statement and
 * returns how many rows it removed. The count is taken in SQL so no deleted id
 * ever reaches the worker, and an unreadable count throws instead of reading
 * as zero (which would end the batch loop with rows still present).
 */
async function deleteArtifactRows(where: SQL): Promise<number> {
    const result = await db.execute<{ deleted: number | string }>(sql`
        WITH deleted AS (
            DELETE FROM ${recordingArtifacts}
            WHERE ${where}
            RETURNING 1
        )
        SELECT count(*)::int AS deleted FROM deleted
    `);

    return parseNonNegativeInteger(result?.rows?.[0]?.deleted, 'deleted row count');
}

function deleteArtifactRowBatch(sessionId: string): Promise<number> {
    return deleteArtifactRows(sql`${recordingArtifacts.id} IN (
                SELECT ${recordingArtifacts.id}
                FROM ${recordingArtifacts}
                WHERE ${recordingArtifacts.sessionId} = ${sessionId}
                LIMIT ${ARTIFACT_ROW_DELETE_BATCH_SIZE}
            )`);
}

async function deleteArtifactRowsById(sessionId: string, artifactIds: string[]): Promise<number> {
    if (artifactIds.length === 0) return 0;
    return deleteArtifactRows(
        sql`${recordingArtifacts.sessionId} = ${sessionId} AND ${inArray(recordingArtifacts.id, artifactIds)}`,
    );
}

function addObjectDeletion(total: S3ObjectDeletionResult, page: S3ObjectDeletionResult): void {
    total.deletedObjectCount += page.deletedObjectCount;
    total.deletedBytes += page.deletedBytes;
    // Fold per endpoint so the audit detail stays one entry per endpoint
    // however many pages of misplaced keys were processed.
    for (const pageResult of page.endpointResults) {
        const existing = total.endpointResults.find((result) => (
            result.endpointId === pageResult.endpointId && result.bucket === pageResult.bucket
        ));
        if (existing) {
            existing.deletedObjectCount += pageResult.deletedObjectCount;
            existing.deletedBytes += pageResult.deletedBytes;
        } else {
            total.endpointResults.push({ ...pageResult });
        }
    }
}

function buildEndpointBreakdown(details: {
    endpointId: string;
    endpointUrl: string;
    projectId: string | null;
    shadow: boolean;
    active: boolean;
    bucket: string;
    deletedObjectCount: number;
    deletedBytes: number;
    missingPrefix?: boolean;
    listStatus?: 'deleted' | 'empty' | 'missing';
    durationMs?: number;
}[]): Record<string, unknown>[] {
    return details.map((result) => ({
        endpointId: result.endpointId,
        endpointUrl: result.endpointUrl,
        projectId: result.projectId,
        shadow: result.shadow,
        active: result.active,
        bucket: result.bucket,
        deletedObjectCount: result.deletedObjectCount,
        deletedBytes: result.deletedBytes,
        missingPrefix: result.missingPrefix ?? false,
        listStatus: result.listStatus ?? null,
        durationMs: result.durationMs ?? null,
    }));
}

export async function purgeSessionArtifacts(
    sessionId: string,
    options: PurgeSessionArtifactsOptions,
): Promise<PurgeSessionArtifactsResult> {
    const now = options.now ?? new Date();
    const invalidateCaches = options.invalidateCaches ?? true;
    const allowMissingStorage = options.allowMissingStorage ?? false;
    const failOnMissingStorage = options.failOnMissingStorage ?? config.RETENTION_FAIL_ON_MISSING_STORAGE;
    const context = await loadSessionPurgeContext(sessionId);
    let finalizedLog = false;
    // Row batches commit one by one, so a failure part-way through has still
    // removed rows; the failed audit entry reports how many.
    let deletedArtifactCount = 0;
    const canonicalPrefix = context.canonicalPrefix;
    const derivedPrefix = buildDerivedSessionStoragePrefix(context.sessionId);
    const plannedArtifactBytes = context.artifactBytes;

    const logId = await beginRetentionDeletionLog({
        runId: options.runId,
        scope: 'session_purge',
        trigger: options.trigger,
        sessionId: context.sessionId,
        projectId: context.projectId,
        teamId: context.teamId,
        storagePrefix: canonicalPrefix,
        plannedArtifactRowCount: context.artifactCount,
        plannedArtifactBytes,
        plannedIngestJobCount: 0,
        details: {
            retentionTier: options.retentionTier ?? context.retentionTier,
            retentionDays: options.retentionDays ?? context.retentionDays,
        },
        startedAt: now,
    });

    // The audit detail lists the first page only; invalidArtifactsTruncated
    // says whether more misplaced artifacts were handled than are listed.
    const invalidArtifacts = context.invalidArtifacts;
    const invalidArtifactsTruncated = context.invalidArtifactsTruncated;

    try {
        // Resolve the project + historical artifact endpoints once, then overlap
        // the independent canonical, derived-cache, and misplaced-key deletes.
        // This preserves the exact deletion set while avoiding repeated endpoint
        // database lookups and serial S3 round trips for every expired session.
        const deletionEndpoints = await resolveRetentionDeletionEndpoints(
            context.projectId,
            context.artifactEndpointIds,
        );
        const [
            deletionResult,
            derivedDeletionResult,
            firstInvalidArtifactDeletion,
        ] = await Promise.all([
            deletePrefixFromStorageEndpoints(
                canonicalPrefix,
                deletionEndpoints,
            ),
            deletePrefixFromStorageEndpoints(
                derivedPrefix,
                deletionEndpoints,
            ),
            invalidArtifacts.length > 0
                ? deleteObjectsFromStorageEndpoints(
                    invalidArtifacts.map((artifact) => artifact.s3ObjectKey),
                    deletionEndpoints,
                )
                : Promise.resolve({
                    deletedObjectCount: 0,
                    deletedBytes: 0,
                    endpointResults: [],
                }),
        ]);
        const invalidArtifactDeletion: S3ObjectDeletionResult = {
            deletedObjectCount: 0,
            deletedBytes: 0,
            endpointResults: [],
        };
        addObjectDeletion(invalidArtifactDeletion, firstInvalidArtifactDeletion);
        let invalidArtifactCount = invalidArtifacts.length;

        const summarizeStorageDeletion = () => {
            const deletedCanonicalObjectCount = deletionResult.deletedObjectCount + invalidArtifactDeletion.deletedObjectCount;
            return {
                deletedStorageObjectCount: deletedCanonicalObjectCount + derivedDeletionResult.deletedObjectCount,
                deletedStorageBytes: deletionResult.deletedBytes
                    + invalidArtifactDeletion.deletedBytes
                    + derivedDeletionResult.deletedBytes,
                storageMissing: context.artifactCount > 0 && deletedCanonicalObjectCount === 0,
            };
        };

        const firstPass = summarizeStorageDeletion();
        if (firstPass.storageMissing && failOnMissingStorage && !allowMissingStorage) {
            await finalizeRetentionDeletionLog(logId, {
                status: 'failed',
                deletedObjectCount: firstPass.deletedStorageObjectCount,
                deletedBytes: firstPass.deletedStorageBytes,
                storageMissing: true,
                errorText: 'Canonical storage scan found no objects for a session that still has recording_artifacts',
                details: {
                    retentionTier: options.retentionTier ?? context.retentionTier,
                    retentionDays: options.retentionDays ?? context.retentionDays,
                    invalidArtifacts,
                    invalidArtifactsTruncated,
                    endpointResults: buildEndpointBreakdown([
                        ...deletionResult.endpointResults,
                        ...derivedDeletionResult.endpointResults,
                        ...invalidArtifactDeletion.endpointResults,
                    ]),
                    errorClass: 'missing_source_prefix',
                    durationMs: Date.now() - now.getTime(),
                },
            });
            finalizedLog = true;
            throw new Error(`Canonical storage missing for session ${sessionId}`);
        }

        // More misplaced artifacts than one page: the prefix deletes above do
        // not cover their objects, so every one of them needs its explicit
        // delete before its row goes. Remove the rows of the page whose
        // objects are already gone, then read the next page, until none is left.
        let handledPage: InvalidSessionArtifactPage = {
            invalidArtifacts,
            truncated: invalidArtifactsTruncated,
        };
        while (handledPage.truncated) {
            const removedRowCount = await deleteArtifactRowsById(
                context.sessionId,
                handledPage.invalidArtifacts.map((artifact) => artifact.artifactId),
            );
            if (removedRowCount === 0) {
                // The same page would come back forever.
                throw new Error(`Misplaced artifact cleanup made no progress for session ${sessionId}`);
            }
            deletedArtifactCount += removedRowCount;

            handledPage = await loadInvalidArtifactPage(context.sessionId, canonicalPrefix);
            if (handledPage.invalidArtifacts.length === 0) {
                break;
            }
            addObjectDeletion(invalidArtifactDeletion, await deleteObjectsFromStorageEndpoints(
                handledPage.invalidArtifacts.map((artifact) => artifact.s3ObjectKey),
                deletionEndpoints,
            ));
            invalidArtifactCount += handledPage.invalidArtifacts.length;
        }

        const {
            deletedStorageObjectCount,
            deletedStorageBytes,
            storageMissing,
        } = summarizeStorageDeletion();

        // Storage is gone; now the rows, a bounded batch per statement. Each
        // statement commits on its own, so a crash here loses nothing: the
        // session keeps its flags unset and stays eligible, and the next run
        // deletes whatever rows are left.
        while (true) {
            const deletedRowCount = await deleteArtifactRowBatch(context.sessionId);
            if (deletedRowCount === 0) {
                break;
            }
            deletedArtifactCount += deletedRowCount;
        }

        await db.transaction(async (tx) => {
            await tx.update(sessionMetrics)
                .set({
                    screenshotSegmentCount: 0,
                    screenshotTotalBytes: 0,
                    hierarchySnapshotCount: 0,
                })
                .where(eq(sessionMetrics.sessionId, context.sessionId));

            await tx.update(sessions)
                .set({
                    recordingDeleted: true,
                    recordingDeletedAt: now,
                    isReplayExpired: true,
                    replayAvailable: false,
                    replayRetentionState: 'not_available',
                    replaySegmentCount: 0,
                    replayStorageBytes: 0,
                    updatedAt: now,
                })
                .where(eq(sessions.id, context.sessionId));
        });

        const cacheKeyCount = invalidateCaches
            ? await invalidatePurgedSessionCaches(context.sessionId)
            : 0;
        if (invalidateCaches) {
            invalidateSessionExistsCache(context.projectId, context.sessionId).catch(() => {});
            invalidateSessionEndpointCache(context.projectId, context.sessionId).catch(() => {});
        }

        await finalizeRetentionDeletionLog(logId, {
            status: 'completed',
            deletedArtifactRowCount: deletedArtifactCount,
            deletedIngestJobCount: 0,
            deletedObjectCount: deletedStorageObjectCount,
            deletedBytes: deletedStorageBytes,
            storageMissing,
            cacheKeyCount,
            details: {
                retentionTier: options.retentionTier ?? context.retentionTier,
                retentionDays: options.retentionDays ?? context.retentionDays,
                invalidArtifacts,
                invalidArtifactsTruncated,
                invalidArtifactDeletedObjectCount: invalidArtifactDeletion.deletedObjectCount,
                invalidArtifactDeletedBytes: invalidArtifactDeletion.deletedBytes,
                derivedStoragePrefix: derivedPrefix,
                derivedDeletedObjectCount: derivedDeletionResult.deletedObjectCount,
                derivedDeletedBytes: derivedDeletionResult.deletedBytes,
                endpointResults: buildEndpointBreakdown([
                    ...deletionResult.endpointResults,
                    ...derivedDeletionResult.endpointResults,
                    ...invalidArtifactDeletion.endpointResults,
                ]),
                durationMs: Date.now() - now.getTime(),
            },
        });
        finalizedLog = true;

        logger.info({
            sessionId: context.sessionId,
            projectId: context.projectId,
            teamId: context.teamId,
            trigger: options.trigger,
            deletedArtifactCount,
            deletedObjectCount: deletedStorageObjectCount,
            deletedBytes: deletedStorageBytes,
            storageMissing,
            invalidArtifactCount,
            derivedDeletedObjectCount: derivedDeletionResult.deletedObjectCount,
        }, 'Purged canonical and derived session artifacts and storage');

        return {
            sessionId: context.sessionId,
            projectId: context.projectId,
            teamId: context.teamId,
            deletedArtifactCount,
            deletedObjectCount: deletedStorageObjectCount,
            deletedBytes: deletedStorageBytes,
            plannedArtifactCount: context.artifactCount,
            plannedArtifactBytes,
            cacheKeyCount,
            storageMissing,
        };
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (!finalizedLog) {
            await finalizeRetentionDeletionLog(logId, {
                status: 'failed',
                deletedArtifactRowCount: deletedArtifactCount,
                errorText: message,
                details: {
                    retentionTier: options.retentionTier ?? context.retentionTier,
                    retentionDays: options.retentionDays ?? context.retentionDays,
                    errorClass: classifyS3DeletionError(err),
                    durationMs: Date.now() - now.getTime(),
                },
            }).catch(() => {});
        }
        throw err;
    }
}

export async function repairExpiredSessionArtifactsBatch(
    runId: string,
    limit = 100,
    trigger = 'retention_repair',
    options: {
        concurrency?: number;
        deadlineAtMs?: number;
        now?: () => number;
        /** Checked before each session is claimed, like the deadline. */
        shouldStop?: () => boolean;
    } = {},
): Promise<ExpiredSessionArtifactRepairResult> {
    const {
        sessionsToRepair,
        reachedProcessingCap,
    } = await collectExpiredRepairCandidates(limit);

    let repaired = 0;
    let failed = 0;
    let deletedObjectCount = 0;
    let deletedBytes = 0;

    const batchResult = await runBoundedConcurrentBatch(
        sessionsToRepair,
        {
            concurrency: options.concurrency ?? 1,
            deadlineAtMs: options.deadlineAtMs,
            now: options.now,
            shouldStop: options.shouldStop,
        },
        async (session) => {
            try {
                const result = await purgeSessionArtifacts(session.sessionId, {
                    runId,
                    trigger,
                    allowMissingStorage: true,
                    retentionTier: session.retentionTier,
                    retentionDays: session.retentionDays,
                });
                repaired++;
                deletedObjectCount += result.deletedObjectCount;
                deletedBytes += result.deletedBytes;
            } catch (err) {
                failed++;
                logger.error({ err, sessionId: session.sessionId }, 'Failed to repair expired session artifacts');
            }
        },
    );

    if (repaired > 0 || failed > 0) {
        logger.info({
            trigger,
            attempted: batchResult.startedCount,
            repaired,
            failed,
            deletedObjectCount,
            deletedBytes,
        }, 'Processed expired sessions with leftover artifacts');
    }

    return {
        attempted: batchResult.startedCount,
        repaired,
        failed,
        deletedObjectCount,
        deletedBytes,
        reachedProcessingCap: reachedProcessingCap || batchResult.stoppedEarly,
    };
}

export async function backfillExpiredSessionArtifacts(
    batchSize = 100,
    runId = `retention-backfill:${Date.now()}`,
): Promise<number> {
    let totalRepaired = 0;

    while (true) {
        const result = await repairExpiredSessionArtifactsBatch(runId, batchSize, 'manual_backfill');
        totalRepaired += result.repaired;

        if (result.attempted === 0 || result.repaired === 0) {
            return totalRepaired;
        }
    }
}
