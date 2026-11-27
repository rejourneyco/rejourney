/**
 * Retention Worker
 *
 * Deletes S3 objects and recording_artifacts rows for sessions whose
 * retention period has expired.
 *
 * Retention expiry is the source of truth for purge eligibility.
 *
 * Default mode (local/dev): long-running loop.
 * Production mode: `--once` for cron-style single-cycle execution.
 */

import { pruneExpiredActivityDays } from '../services/activitySnapshots.js';
import { and, eq, gt, isNotNull, isNull, lt, notExists, or, sql } from 'drizzle-orm';
import { db, pool, projects, retentionDeletionLog, retentionPolicies, sessions } from '../db/client.js';
import { config } from '../config.js';
import { getRedis } from '../db/redis.js';
import { logger } from '../logger.js';
import { pingWorker, type WorkerMetric } from '../services/monitoring.js';
import { hardDeleteProject } from '../services/deletion.js';
import {
    purgeSessionArtifacts,
    repairExpiredSessionArtifactsBatch,
} from '../services/sessionArtifactPurge.js';
import { scrubExpiredSessionIdentitiesBatch } from '../services/sessionIdentityScrub.js';
import { expireVisitorLedgerBatch } from '../services/visitorLedger.js';
import {
    buildRetentionRunOwnerId,
    refreshRetentionRunLock,
    releaseRetentionRunLock,
    tryAcquireRetentionRunLock,
} from '../services/retentionRunLock.js';
import {
    interleaveBatches,
    runBoundedConcurrentBatch,
} from '../services/retentionBatch.js';
import { createHeapPressureGuard } from '../services/heapPressure.js';

const RUN_INTERVAL_MS = 6 * 60 * 60 * 1000;
const BATCH_SIZE = Math.max(1, Math.trunc(config.RETENTION_BATCH_SIZE));
const REPAIR_BATCH_SIZE = Math.max(1, Math.trunc(config.RETENTION_REPAIR_BATCH_SIZE));
const MAX_RUNTIME_MS = Math.max(30_000, Math.trunc(config.RETENTION_MAX_RUNTIME_MS));
const SESSION_CONCURRENCY = Math.max(1, Math.trunc(config.RETENTION_SESSION_CONCURRENCY));
const LOCK_HEARTBEAT_INTERVAL_MS = 30 * 1000;
/**
 * Share of the runtime still left at the start of a round that the expired
 * purge and the repair pass may use. The rest is kept for the identity scrub,
 * the visitor ledger expiry and deleted projects, which used to get whatever
 * the purge left over: a full purge batch followed by one slow scrub batch
 * filled a whole cycle, so identities were scrubbed 100 per run.
 */
const PURGE_BUDGET_SHARE = 0.6;
/** Most identity-scrub batches one round will run before moving on. */
const MAX_SCRUB_BATCHES_PER_ROUND = 10;
const CACHE_SCAN_COUNT = 5_000;

let isRunning = true;

type RetentionRunSummary = {
    runId: string;
    status: 'completed' | 'skipped' | 'failed';
    trigger: string;
    expiredCount: number;
    repairedCount: number;
    repairAttempted: number;
    repairFailed: number;
    identityScrubbedCount: number;
    linkedIdentityRowsScrubbed: number;
    visitorLedgerExpiredCount: number;
    deletedProjectCount: number;
    deletedObjectCount: number;
    deletedBytes: number;
    heatmapCacheKeyCount: number;
    rounds: number;
    durationMs: number;
    purgedSessionsPerMinute: number;
    skippedReason?: string;
    error?: string;
    /** Set when the heap guard ended purge and repair work early this cycle. */
    stoppedForHeapPressure?: boolean;
    /** Purge or repair phases that threw; the cycle is then recorded as failed. */
    failedPhases?: string[];
};

function parseFlag(name: string): boolean {
    return process.argv.includes(name);
}

function parseOption(name: string): string | null {
    const valueArg = process.argv.find((arg) => arg.startsWith(`${name}=`));
    if (!valueArg) return null;
    return valueArg.slice(name.length + 1);
}

function buildTriggerName(baseTrigger: string, suffix: string): string {
    return baseTrigger === 'manual_backfill' ? `manual_backfill_${suffix}` : suffix;
}

async function invalidateHeatmapCaches(): Promise<number> {
    try {
        const redis = getRedis();
        const keysToDelete: string[] = [];
        let cursor = '0';
        do {
            const [next, keys] = await redis.scan(
                cursor,
                'MATCH',
                'insights:*heatmap*',
                'COUNT',
                CACHE_SCAN_COUNT,
            );
            cursor = next;
            keysToDelete.push(...keys);
        } while (cursor !== '0');

        if (keysToDelete.length > 0) {
            await redis.del(...keysToDelete);
        }

        return keysToDelete.length;
    } catch (err) {
        logger.warn({ err }, 'Failed to invalidate heatmap caches after retention cleanup');
        return 0;
    }
}

async function writeRetentionHeartbeat(summary: RetentionRunSummary): Promise<void> {
    try {
        const redis = getRedis();
        const now = new Date().toISOString();
        await redis.set('retentionWorker:last_run', now);
        await redis.set('retentionWorker:last_summary', JSON.stringify({
            ...summary,
            recordedAt: now,
        }));
    } catch (err) {
        logger.warn({ err }, 'Failed to write retention worker heartbeat to Redis');
    }
}


type ExpiredSessionCandidate = {
    id: string;
    retentionTier: number;
    retentionDays: number;
    startedAt: Date;
};

type ExpiredSessionCollectionResult = {
    sessionsToPurge: ExpiredSessionCandidate[];
    reachedProcessingCap: boolean;
};


async function collectExpiredSessionsReadyForPurge(
    tierConfig: { tier: number; days: number },
    expiryDate: Date,
    limit: number,
): Promise<ExpiredSessionCollectionResult> {
    const currentRetentionPeriodExpired = sql`
        ${sessions.startedAt} < NOW() - (${sessions.retentionDays} * INTERVAL '1 day')
    `;

    const sessionsToPurge = await db
        .select({
            id: sessions.id,
            retentionTier: sessions.retentionTier,
            retentionDays: sessions.retentionDays,
            startedAt: sessions.startedAt,
        })
        .from(sessions)
        .innerJoin(projects, eq(sessions.projectId, projects.id))
        .where(
            and(
                eq(sessions.retentionTier, tierConfig.tier),
                lt(sessions.startedAt, expiryDate),
                currentRetentionPeriodExpired,
                eq(sessions.recordingDeleted, false),
                or(
                    eq(sessions.status, 'ready'),
                    eq(sessions.status, 'completed'),
                ),
                isNull(projects.deletedAt),
                notExists(
                    db
                        .select()
                        .from(retentionDeletionLog)
                        .where(
                            and(
                                eq(retentionDeletionLog.sessionId, sessions.id),
                                eq(retentionDeletionLog.status, 'failed'),
                                gt(retentionDeletionLog.startedAt, sql`NOW() - INTERVAL '24 hours'`),
                            ),
                        ),
                ),
            ),
        )
        .orderBy(sessions.startedAt, sessions.id)
        .limit(limit);

    return {
        sessionsToPurge,
        reachedProcessingCap: sessionsToPurge.length >= limit,
    };
}

type ExpiredSessionsResult = {
    processedCount: number;
    attemptedCount: number;
    failedCount: number;
    deletedObjectCount: number;
    deletedBytes: number;
    reachedProcessingCap: boolean;
};

const NO_EXPIRED_SESSIONS_RESULT: ExpiredSessionsResult = {
    processedCount: 0,
    attemptedCount: 0,
    failedCount: 0,
    deletedObjectCount: 0,
    deletedBytes: 0,
    reachedProcessingCap: false,
};

const NO_REPAIR_RESULT = {
    attempted: 0,
    repaired: 0,
    failed: 0,
    deletedObjectCount: 0,
    deletedBytes: 0,
    reachedProcessingCap: false,
};

async function processExpiredSessions(
    runId: string,
    trigger: string,
    deadlineAtMs = Number.POSITIVE_INFINITY,
    shouldStop?: () => boolean,
): Promise<ExpiredSessionsResult> {
    let processedCount = 0;
    let attemptedCount = 0;
    let failedCount = 0;
    let deletedObjectCount = 0;
    let deletedBytes = 0;
    let reachedProcessingCap = false;

    const now = new Date();
    const policies = await db
        .select({
            tier: retentionPolicies.tier,
            days: retentionPolicies.retentionDays,
        })
        .from(retentionPolicies)
        .orderBy(retentionPolicies.tier);

    const tierBatches: ExpiredSessionCandidate[][] = [];
    for (const tierConfig of policies) {
        if (Date.now() >= deadlineAtMs) {
            reachedProcessingCap = true;
            break;
        }

        const expiryDate = new Date(now.getTime() - tierConfig.days * 24 * 60 * 60 * 1000);

        const tierResult = await collectExpiredSessionsReadyForPurge(tierConfig, expiryDate, BATCH_SIZE);
        reachedProcessingCap ||= tierResult.reachedProcessingCap;
        tierBatches.push(tierResult.sessionsToPurge);
    }

    const sessionsToPurge = interleaveBatches(tierBatches);
    const batchResult = await runBoundedConcurrentBatch(
        sessionsToPurge,
        {
            concurrency: SESSION_CONCURRENCY,
            deadlineAtMs,
            shouldStop,
        },
        async (session) => {
            try {
                const result = await purgeSessionArtifacts(session.id, {
                    runId,
                    trigger,
                    retentionTier: session.retentionTier,
                    retentionDays: session.retentionDays,
                });
                processedCount++;
                deletedObjectCount += result.deletedObjectCount;
                deletedBytes += result.deletedBytes;
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                if (message.includes('Canonical storage missing')) {
                    try {
                        const repairResult = await purgeSessionArtifacts(session.id, {
                            runId,
                            trigger: `${trigger}_repair_missing_storage`,
                            allowMissingStorage: true,
                            retentionTier: session.retentionTier,
                            retentionDays: session.retentionDays,
                        });
                        processedCount++;
                        deletedObjectCount += repairResult.deletedObjectCount;
                        deletedBytes += repairResult.deletedBytes;
                        logger.warn(
                            { sessionId: session.id, trigger },
                            'Recovered retention purge via allowMissingStorage after canonical storage was already gone',
                        );
                        return;
                    } catch (repairErr) {
                        failedCount++;
                        logger.error(
                            { err: repairErr, sessionId: session.id },
                            'Failed to recover expired session after canonical storage was already missing',
                        );
                        return;
                    }
                }
                failedCount++;
                logger.error({ err, sessionId: session.id }, 'Failed to process expired session');
            }
        },
    );
    attemptedCount += batchResult.startedCount;
    reachedProcessingCap ||= batchResult.stoppedEarly;

    if (processedCount > 0 || failedCount > 0) {
        logger.info({
            trigger,
            processedCount,
            failedCount,
            deletedObjectCount,
            deletedBytes,
        }, 'Expired session retention batch complete');
    }

    return {
        processedCount,
        attemptedCount,
        failedCount,
        deletedObjectCount,
        deletedBytes,
        reachedProcessingCap,
    };
}

/**
 * Scrubs expired session identities batch after batch while the last batch was
 * full, the cycle deadline has not passed and the per-round cap is not reached.
 * reachedProcessingCap is true when it stopped with work possibly left,
 * including when the deadline had already passed before the first batch.
 */
async function scrubExpiredIdentitiesForRound(
    runId: string,
    trigger: string,
    deadlineAtMs: number,
): Promise<{
    scrubbed: number;
    linkedRowsScrubbed: number;
    reachedProcessingCap: boolean;
    batches: number;
}> {
    let scrubbed = 0;
    let linkedRowsScrubbed = 0;
    let reachedProcessingCap = true;
    let batches = 0;

    while (batches < MAX_SCRUB_BATCHES_PER_ROUND && Date.now() < deadlineAtMs) {
        const batchResult = await scrubExpiredSessionIdentitiesBatch(BATCH_SIZE, { runId, trigger });
        batches += 1;
        scrubbed += batchResult.scrubbed;
        linkedRowsScrubbed += batchResult.linkedRowsScrubbed;
        reachedProcessingCap = batchResult.reachedProcessingCap;
        if (!batchResult.reachedProcessingCap) {
            break;
        }
    }

    return { scrubbed, linkedRowsScrubbed, reachedProcessingCap, batches };
}

async function processDeletedProjects(): Promise<number> {
    let processedCount = 0;

    const deletedProjects = await db
        .select()
        .from(projects)
        .where(isNotNull(projects.deletedAt))
        .limit(BATCH_SIZE);

    for (const project of deletedProjects) {
        try {
            await hardDeleteProject({
                id: project.id,
                teamId: project.teamId,
                name: project.name,
                publicKey: project.publicKey,
            });
            processedCount++;
        } catch (err) {
            logger.error({ err, projectId: project.id }, 'Failed to process deleted project');
        }
    }

    return processedCount;
}

async function runRetentionCycle(options: {
    runId: string;
    trigger: string;
    drainBacklog: boolean;
}): Promise<RetentionRunSummary> {
    const ownerId = buildRetentionRunOwnerId();
    const acquired = await tryAcquireRetentionRunLock(ownerId);

    if (!acquired) {
        const summary: RetentionRunSummary = {
            runId: options.runId,
            status: 'skipped',
            trigger: options.trigger,
            expiredCount: 0,
            repairedCount: 0,
            repairAttempted: 0,
            repairFailed: 0,
            identityScrubbedCount: 0,
            linkedIdentityRowsScrubbed: 0,
            visitorLedgerExpiredCount: 0,
            deletedProjectCount: 0,
            deletedObjectCount: 0,
            deletedBytes: 0,
            heatmapCacheKeyCount: 0,
            rounds: 0,
            durationMs: 0,
            purgedSessionsPerMinute: 0,
            skippedReason: 'lock_held',
        };
        await writeRetentionHeartbeat(summary);
        await pingWorker('retentionWorker', 'up', 'skipped=lock_held');
        return summary;
    }

    let cleanedUp = false;
    const heartbeat = setInterval(() => {
        refreshRetentionRunLock(ownerId).catch((err) => {
            logger.warn({ err }, 'Failed to refresh retention run lock heartbeat');
        });
    }, LOCK_HEARTBEAT_INTERVAL_MS);

    const cleanup = async () => {
        if (cleanedUp) return;
        cleanedUp = true;
        clearInterval(heartbeat);
        await releaseRetentionRunLock(ownerId).catch((err) => {
            logger.warn({ err }, 'Failed to release retention run lock');
        });
    };

    const summary: RetentionRunSummary = {
        runId: options.runId,
        status: 'completed',
        trigger: options.trigger,
        expiredCount: 0,
        repairedCount: 0,
        repairAttempted: 0,
        repairFailed: 0,
        identityScrubbedCount: 0,
        linkedIdentityRowsScrubbed: 0,
        visitorLedgerExpiredCount: 0,
        deletedProjectCount: 0,
        deletedObjectCount: 0,
        deletedBytes: 0,
        heatmapCacheKeyCount: 0,
        rounds: 0,
        durationMs: 0,
        purgedSessionsPerMinute: 0,
    };
    const startedAtMs = Date.now();

    // Backstop against running out of memory. An out-of-memory abort skips
    // every finally block, so the run lock stays held and the phases after the
    // purge never run. Stopping early instead lets the cycle end normally and
    // leaves the unclaimed sessions for the next scheduled run.
    const heapGuard = createHeapPressureGuard({
        onPressure: (reading) => {
            logger.warn({
                runId: options.runId,
                ...reading,
            }, 'Retention cycle is close to the heap limit; finishing in-flight sessions and skipping further purge and repair work this cycle');
        },
    });

    // The identity scrub, visitor ledger expiry and deleted-project processing
    // must run even when purge or repair throws, so those two phases are caught
    // here and the cycle is failed after the end-of-cycle bookkeeping instead.
    const failedPhases: string[] = [];
    const runIsolatedPhase = async <T>(phase: string, fallback: T, run: () => Promise<T>): Promise<T> => {
        try {
            return await run();
        } catch (err) {
            failedPhases.push(phase);
            logger.error({ err, runId: options.runId, phase }, 'Retention phase failed; continuing with the remaining phases');
            return fallback;
        }
    };

    try {
        await pruneExpiredActivityDays();
        const deadlineAtMs = startedAtMs + MAX_RUNTIME_MS;
        while (true) {
            const roundStartedAtMs = Date.now();
            const runtimeMs = roundStartedAtMs - startedAtMs;
            if (runtimeMs >= MAX_RUNTIME_MS) {
                logger.warn({ runId: options.runId, runtimeMs, maxRuntimeMs: MAX_RUNTIME_MS }, 'Retention cycle reached runtime cap');
                break;
            }

            const expiryTrigger = buildTriggerName(options.trigger, 'retention_expiry');
            const repairTrigger = buildTriggerName(options.trigger, 'retention_repair');
            // Purge and repair stop claiming sessions at their share of what is
            // left of the cycle; sessions already in flight still finish. The
            // share is taken from the time remaining now, so a later round of
            // a backlog drain purges again instead of finding the share spent.
            const purgeDeadlineAtMs = roundStartedAtMs + PURGE_BUDGET_SHARE * (deadlineAtMs - roundStartedAtMs);

            const expiredResult = heapGuard.shouldStop()
                ? NO_EXPIRED_SESSIONS_RESULT
                : await runIsolatedPhase(
                    'expired_purge',
                    NO_EXPIRED_SESSIONS_RESULT,
                    () => processExpiredSessions(options.runId, expiryTrigger, purgeDeadlineAtMs, heapGuard.shouldStop),
                );
            // The repair query is a legacy consistency backstop, not the normal
            // retention path. Run it once per cycle; repeating the same mostly-empty
            // scan on every backlog-drain round multiplies database work without
            // improving the regular expiry drain. The explicit manual backfill still
            // loops until all repair candidates are exhausted.
            const shouldRunRepairPass = (
                options.trigger === 'manual_backfill' || summary.rounds === 0
            ) && Date.now() < purgeDeadlineAtMs && !heapGuard.shouldStop();
            const repairResult = shouldRunRepairPass
                ? await runIsolatedPhase(
                    'expired_repair',
                    NO_REPAIR_RESULT,
                    () => repairExpiredSessionArtifactsBatch(
                        options.runId,
                        REPAIR_BATCH_SIZE,
                        repairTrigger,
                        {
                            concurrency: SESSION_CONCURRENCY,
                            deadlineAtMs: purgeDeadlineAtMs,
                            shouldStop: heapGuard.shouldStop,
                        },
                    ),
                )
                : NO_REPAIR_RESULT;
            const identityScrubResult = await scrubExpiredIdentitiesForRound(
                options.runId,
                buildTriggerName(options.trigger, 'identity_scrub'),
                deadlineAtMs,
            );
            // Visitor ledger rows expire on their own sliding window, which is never
            // shorter than the session retention, so this always runs after the scrub.
            const ledgerResult = Date.now() < deadlineAtMs
                ? await expireVisitorLedgerBatch(BATCH_SIZE)
                : {
                    deleted: 0,
                    reachedProcessingCap: true,
                };
            const deletedProjectCount = Date.now() < deadlineAtMs
                ? await processDeletedProjects()
                : 0;

            summary.rounds += 1;
            summary.expiredCount += expiredResult.processedCount;
            summary.repairedCount += repairResult.repaired;
            summary.repairAttempted += repairResult.attempted;
            summary.repairFailed += repairResult.failed;
            summary.identityScrubbedCount += identityScrubResult.scrubbed;
            summary.linkedIdentityRowsScrubbed += identityScrubResult.linkedRowsScrubbed;
            summary.visitorLedgerExpiredCount += ledgerResult.deleted;
            summary.deletedProjectCount += deletedProjectCount;
            summary.deletedObjectCount += expiredResult.deletedObjectCount + repairResult.deletedObjectCount;
            summary.deletedBytes += expiredResult.deletedBytes + repairResult.deletedBytes;

            const madeProgress =
                expiredResult.processedCount > 0 ||
                repairResult.repaired > 0 ||
                identityScrubResult.scrubbed > 0 ||
                ledgerResult.deleted > 0 ||
                deletedProjectCount > 0;
            const maybeMoreWork =
                expiredResult.reachedProcessingCap ||
                repairResult.reachedProcessingCap ||
                identityScrubResult.reachedProcessingCap ||
                ledgerResult.reachedProcessingCap ||
                deletedProjectCount >= BATCH_SIZE;

            if (Date.now() >= deadlineAtMs) {
                logger.warn({
                    runId: options.runId,
                    runtimeMs: Date.now() - startedAtMs,
                    maxRuntimeMs: MAX_RUNTIME_MS,
                }, 'Retention cycle reached runtime cap');
                break;
            }

            if (failedPhases.length > 0 || heapGuard.tripped) {
                // The rest of this round has already run. Another round would
                // only repeat a failing phase or add to a nearly full heap.
                break;
            }

            if (!options.drainBacklog || !madeProgress || !maybeMoreWork) {
                break;
            }
        }

        if (summary.expiredCount > 0 || summary.repairedCount > 0) {
            summary.heatmapCacheKeyCount = await invalidateHeatmapCaches();
        }

        summary.durationMs = Date.now() - startedAtMs;
        const totalPurgedSessions = summary.expiredCount + summary.repairedCount;
        summary.purgedSessionsPerMinute = summary.durationMs > 0
            ? Math.round((totalPurgedSessions / summary.durationMs) * 60_000 * 100) / 100
            : 0;
        if (heapGuard.tripped) {
            summary.stoppedForHeapPressure = true;
        }
        if (failedPhases.length > 0) {
            // Handled by the catch below: heartbeat records "failed", the
            // worker pings down, and the process exits non-zero.
            summary.failedPhases = [...failedPhases];
            throw new Error(`Retention phases failed: ${failedPhases.join(', ')}`);
        }
        await writeRetentionHeartbeat(summary);
        const extraMetrics: WorkerMetric[] = [
            {
                name: 'rejourney_retention_expired_sessions_total',
                help: 'Total expired sessions purged in the current run',
                value: summary.expiredCount,
            },
            {
                name: 'rejourney_retention_repaired_sessions_total',
                help: 'Total expired sessions repaired in the current run',
                value: summary.repairedCount,
            },
            {
                name: 'rejourney_retention_scrubbed_sessions_total',
                help: 'Total expired session identities scrubbed in the current run',
                value: summary.identityScrubbedCount,
            },
            {
                name: 'rejourney_retention_expired_visitor_ledger_total',
                help: 'Total expired pseudonymous visitor ledger rows deleted in the current run',
                value: summary.visitorLedgerExpiredCount,
            },
            {
                name: 'rejourney_retention_deleted_bytes_total',
                help: 'Total bytes deleted in the current run',
                value: summary.deletedBytes,
            },
            {
                name: 'rejourney_retention_cycle_duration_seconds',
                help: 'Duration of the current retention cycle in seconds',
                value: summary.durationMs / 1000,
            },
            {
                name: 'rejourney_retention_purged_sessions_per_minute',
                help: 'Average expired and repaired sessions purged per minute in the current run',
                value: summary.purgedSessionsPerMinute,
            },
        ];

        await pingWorker(
            'retentionWorker',
            'up',
            `expired=${summary.expiredCount},repaired=${summary.repairedCount},scrubbed=${summary.identityScrubbedCount},visitorsExpired=${summary.visitorLedgerExpiredCount},bytes=${summary.deletedBytes},durationMs=${summary.durationMs},purgedPerMinute=${summary.purgedSessionsPerMinute}`,
            undefined,
            extraMetrics,
        );

        logger.info(summary, 'Retention cycle completed');
        return summary;
    } catch (err) {
        summary.status = 'failed';
        summary.error = err instanceof Error ? err.message : String(err);
        summary.durationMs = Date.now() - startedAtMs;
        await writeRetentionHeartbeat(summary);
        await pingWorker('retentionWorker', 'down', summary.error).catch(() => {});
        throw err;
    } finally {
        await cleanup();
    }
}

async function runLoop(trigger: string, drainBacklog: boolean): Promise<void> {
    while (isRunning) {
        const runId = `retention:${Date.now()}`;
        try {
            await runRetentionCycle({ runId, trigger, drainBacklog });
        } catch (err) {
            logger.error({ err, runId }, 'Retention worker cycle failed');
        }

        await new Promise((resolve) => setTimeout(resolve, RUN_INTERVAL_MS));
    }
}

async function shutdown(signal: string) {
    logger.info({ signal }, 'Retention worker shutting down...');
    isRunning = false;

    await pool.end();
    process.exit(0);
}

process.on('SIGTERM', () => {
    shutdown('SIGTERM').catch((err) => {
        logger.error({ err }, 'Failed to shut down retention worker on SIGTERM');
        process.exit(1);
    });
});

process.on('SIGINT', () => {
    shutdown('SIGINT').catch((err) => {
        logger.error({ err }, 'Failed to shut down retention worker on SIGINT');
        process.exit(1);
    });
});

const runOnce = parseFlag('--once');
const trigger = parseOption('--trigger') ?? (runOnce ? 'scheduled' : 'loop');
const requestedDrainBacklog = parseFlag('--drain-backlog');
const drainBacklog = requestedDrainBacklog;

logger.info({
    runOnce,
    drainBacklog,
    requestedDrainBacklog,
    trigger,
    batchSize: BATCH_SIZE,
    repairBatchSize: REPAIR_BATCH_SIZE,
    maxRuntimeMs: MAX_RUNTIME_MS,
    sessionConcurrency: SESSION_CONCURRENCY,
}, 'Retention worker started');

if (runOnce) {
    const runId = `retention:${Date.now()}`;
    runRetentionCycle({ runId, trigger, drainBacklog })
        .then(async () => {
            await pool.end();
            process.exit(0);
        })
        .catch(async (err) => {
            logger.error({ err }, 'Retention worker fatal error');
            await pool.end().catch(() => {});
            process.exit(1);
        });
} else {
    runLoop(trigger, drainBacklog)
        .catch(async (err) => {
            logger.error({ err }, 'Retention worker fatal error');
            await pool.end().catch(() => {});
            process.exit(1);
        });
}

export { runRetentionCycle, invalidateHeatmapCaches, processExpiredSessions };
