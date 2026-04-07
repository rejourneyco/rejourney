/**
 * Retention Worker
 *
 * Default mode (local/dev): long-running loop.
 * Production mode: `--once` for cron-style single-cycle execution.
 */

import { and, eq, isNotNull, isNull, lt } from 'drizzle-orm';
import { db, pool, projects, retentionPolicies, sessions } from '../db/client.js';
import { getRedis } from '../db/redis.js';
import { logger } from '../logger.js';
import { pingWorker } from '../services/monitoring.js';
import { hardDeleteProject } from '../services/deletion.js';
import {
    purgeSessionArtifacts,
    repairExpiredSessionArtifactsBatch,
    sweepLegacySessionsStorage,
} from '../services/sessionArtifactPurge.js';
import { partitionBackedUpSessions } from '../services/sessionBackupGate.js';
import {
    buildRetentionRunOwnerId,
    refreshRetentionRunLock,
    releaseRetentionRunLock,
    tryAcquireRetentionRunLock,
} from '../services/retentionRunLock.js';

const RUN_INTERVAL_MS = 6 * 60 * 60 * 1000;
const BATCH_SIZE = 100;
const LOCK_HEARTBEAT_INTERVAL_MS = 30 * 1000;

let isRunning = true;

type RetentionRunSummary = {
    runId: string;
    status: 'completed' | 'skipped' | 'failed';
    trigger: string;
    expiredCount: number;
    repairedCount: number;
    repairAttempted: number;
    repairFailed: number;
    skippedNotBackedUpCount: number;
    deletedProjectCount: number;
    legacyDeletedObjectCount: number;
    legacyDeletedBytes: number;
    deletedObjectCount: number;
    deletedBytes: number;
    heatmapCacheKeyCount: number;
    rounds: number;
    skippedReason?: string;
    error?: string;
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
            const [next, keys] = await redis.scan(cursor, 'MATCH', 'insights:*heatmap*', 'COUNT', 200);
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

async function processExpiredSessions(runId: string, trigger: string): Promise<{
    processedCount: number;
    failedCount: number;
    skippedNotBackedUpCount: number;
    deletedObjectCount: number;
    deletedBytes: number;
}> {
    let processedCount = 0;
    let failedCount = 0;
    let skippedNotBackedUpCount = 0;
    let deletedObjectCount = 0;
    let deletedBytes = 0;

    const now = new Date();
    const policies = await db
        .select({
            tier: retentionPolicies.tier,
            days: retentionPolicies.retentionDays,
        })
        .from(retentionPolicies);

    for (const tierConfig of policies) {
        const expiryDate = new Date(now.getTime() - tierConfig.days * 24 * 60 * 60 * 1000);

        const expiredSessions = await db
            .select({
                id: sessions.id,
                retentionTier: sessions.retentionTier,
                retentionDays: sessions.retentionDays,
            })
            .from(sessions)
            .innerJoin(projects, eq(sessions.projectId, projects.id))
            .where(
                and(
                    eq(sessions.retentionTier, tierConfig.tier),
                    lt(sessions.startedAt, expiryDate),
                    eq(sessions.recordingDeleted, false),
                    eq(sessions.status, 'ready'),
                    isNull(projects.deletedAt),
                ),
            )
            .limit(BATCH_SIZE);

        const { backedUp, notBackedUp } = await partitionBackedUpSessions(expiredSessions);
        skippedNotBackedUpCount += notBackedUp.length;

        for (const session of backedUp) {
            try {
                let result = await purgeSessionArtifacts(session.id, {
                    runId,
                    trigger,
                    now,
                    retentionTier: session.retentionTier,
                    retentionDays: session.retentionDays,
                });
                if (result.storageMissing) {
                    result = await purgeSessionArtifacts(session.id, {
                        runId,
                        trigger: `${trigger}_retry_missing_storage`,
                        now,
                        allowMissingStorage: true,
                        retentionTier: session.retentionTier,
                        retentionDays: session.retentionDays,
                    });
                }
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
                            now,
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
                        continue;
                    } catch (repairErr) {
                        failedCount++;
                        logger.error(
                            { err: repairErr, sessionId: session.id },
                            'Failed to recover expired session after canonical storage was already missing',
                        );
                        continue;
                    }
                }
                failedCount++;
                logger.error({ err, sessionId: session.id }, 'Failed to process expired session');
            }
        }
    }

    if (processedCount > 0 || failedCount > 0 || skippedNotBackedUpCount > 0) {
        logger.info({
            trigger,
            processedCount,
            failedCount,
            skippedNotBackedUpCount,
            deletedObjectCount,
            deletedBytes,
        }, 'Expired session retention batch complete');
    }

    return {
        processedCount,
        failedCount,
        skippedNotBackedUpCount,
        deletedObjectCount,
        deletedBytes,
    };
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
            skippedNotBackedUpCount: 0,
            deletedProjectCount: 0,
            legacyDeletedObjectCount: 0,
            legacyDeletedBytes: 0,
            deletedObjectCount: 0,
            deletedBytes: 0,
            heatmapCacheKeyCount: 0,
            rounds: 0,
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
        skippedNotBackedUpCount: 0,
        deletedProjectCount: 0,
        legacyDeletedObjectCount: 0,
        legacyDeletedBytes: 0,
        deletedObjectCount: 0,
        deletedBytes: 0,
        heatmapCacheKeyCount: 0,
        rounds: 0,
    };

    try {
        while (true) {
            const expiryTrigger = buildTriggerName(options.trigger, 'retention_expiry');
            const repairTrigger = buildTriggerName(options.trigger, 'retention_repair');

            const expiredResult = await processExpiredSessions(options.runId, expiryTrigger);
            const repairResult = await repairExpiredSessionArtifactsBatch(options.runId, BATCH_SIZE, repairTrigger);
            const deletedProjectCount = await processDeletedProjects();

            summary.rounds += 1;
            summary.expiredCount += expiredResult.processedCount;
            summary.repairedCount += repairResult.repaired;
            summary.repairAttempted += repairResult.attempted;
            summary.repairFailed += repairResult.failed;
            summary.skippedNotBackedUpCount += expiredResult.skippedNotBackedUpCount + repairResult.skippedNotBackedUp;
            summary.deletedProjectCount += deletedProjectCount;
            summary.deletedObjectCount += expiredResult.deletedObjectCount + repairResult.deletedObjectCount;
            summary.deletedBytes += expiredResult.deletedBytes + repairResult.deletedBytes;

            const madeProgress =
                expiredResult.processedCount > 0 ||
                repairResult.repaired > 0 ||
                deletedProjectCount > 0;
            const maybeMoreWork =
                expiredResult.processedCount >= BATCH_SIZE ||
                repairResult.attempted >= BATCH_SIZE ||
                deletedProjectCount >= BATCH_SIZE;

            if (!options.drainBacklog || !madeProgress || !maybeMoreWork) {
                break;
            }
        }

        try {
            const legacySweep = await sweepLegacySessionsStorage(
                options.runId,
                buildTriggerName(options.trigger, 'legacy_sessions_sweep'),
            );
            summary.legacyDeletedObjectCount = legacySweep.deletedObjectCount;
            summary.legacyDeletedBytes = legacySweep.deletedBytes;
            summary.deletedObjectCount += legacySweep.deletedObjectCount;
            summary.deletedBytes += legacySweep.deletedBytes;
        } catch (legacyErr) {
            logger.warn({ err: legacyErr }, 'Legacy bare sessions/ sweep failed');
        }

        if (summary.expiredCount > 0 || summary.repairedCount > 0) {
            summary.heatmapCacheKeyCount = await invalidateHeatmapCaches();
        }

        await writeRetentionHeartbeat(summary);
        await pingWorker(
            'retentionWorker',
            'up',
            `expired=${summary.expiredCount},repaired=${summary.repairedCount},skipped=${summary.skippedNotBackedUpCount},bytes=${summary.deletedBytes}`,
        );

        logger.info(summary, 'Retention cycle completed');
        return summary;
    } catch (err) {
        summary.status = 'failed';
        summary.error = err instanceof Error ? err.message : String(err);
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
const drainBacklog = parseFlag('--drain-backlog');
const trigger = parseOption('--trigger') ?? (runOnce ? 'scheduled' : 'loop');

logger.info({ runOnce, drainBacklog, trigger }, 'Retention worker started');

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
