import { logger } from '../logger.js';
import { getRedis } from '../db/redis.js';
import {
    abandonExpiredPendingArtifacts,
    queueRecoverableArtifacts,
    recoverStalePendingReplayArtifacts,
} from '../services/ingestArtifactLifecycle.js';
import {
    queuePendingSessionEventRollups,
    startSessionEventRollupWorker,
} from '../services/sessionEventRollupQueue.js';
import { startSessionEffectsWorker } from '../services/sessionEffectsQueue.js';
import { reconcileDueSessions, reconcileDueSmartCaptureSessions } from '../services/sessionReconciliation.js';
import { SESSION_LIFECYCLE_WORKER } from './workerDefinitions.js';
import { startPollingWorker } from './workerRuntime.js';
import {
    acquireRedisLease,
    releaseRedisLease,
    startRedisLeaseRenewal,
    type RedisLease,
    type RedisLeaseRenewal,
} from '../services/redisLease.js';

// requeueStaleProcessingJobs is intentionally omitted — BullMQ handles stalled
// job recovery automatically via stalledInterval / maxStalledCount on the Worker.

let lastSessionSweepAt = 0;
const SESSION_LIFECYCLE_SWEEP_LEASE_KEY = 'lock:session-lifecycle-sweep';

export function resolveSessionLifecycleSweepLeaseTtlMs(
    raw = process.env.RJ_SESSION_LIFECYCLE_SWEEP_LEASE_TTL_MS,
): number {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return 5 * 60_000;
    return Math.max(30_000, Math.min(60 * 60_000, Math.floor(parsed)));
}

export async function runSessionLifecycleSweep(): Promise<boolean> {
    const redis = getRedis();
    let lease: RedisLease | null = null;
    let leaseRenewal: RedisLeaseRenewal | null = null;

    try {
        lease = await acquireRedisLease(
            redis,
            SESSION_LIFECYCLE_SWEEP_LEASE_KEY,
            resolveSessionLifecycleSweepLeaseTtlMs(),
        );
    } catch (err) {
        logger.warn({ err }, 'session.reconcile_sweep_lease_failed');
        return false;
    }

    if (!lease) return false;

    leaseRenewal = startRedisLeaseRenewal(redis, lease, {
        onError: (err) => logger.error({ err }, 'session.reconcile_sweep_lease_renew_failed'),
        onLeaseLost: () => logger.error('session.reconcile_sweep_lease_lost'),
    });

    const shouldStopBeforeStage = (stage: string): boolean => {
        if (!leaseRenewal?.signal.aborted) return false;
        logger.warn({ stage }, 'session.reconcile_sweep_stopped_after_lease_loss');
        return true;
    };

    try {
        if (shouldStopBeforeStage('recover_stale_pending_replay')) return false;
        const recoveredPendingReplay = await recoverStalePendingReplayArtifacts(100);
        if (shouldStopBeforeStage('abandon_expired_pending')) return false;
        const abandoned = await abandonExpiredPendingArtifacts(100);
        if (shouldStopBeforeStage('queue_recoverable_artifacts')) return false;
        const recovered = await queueRecoverableArtifacts(100);
        if (shouldStopBeforeStage('queue_pending_event_rollups')) return false;
        const eventRollupsQueued = await queuePendingSessionEventRollups(100);
        if (shouldStopBeforeStage('reconcile_due_sessions')) return false;
        const reconciled = await reconcileDueSessions(
            SESSION_LIFECYCLE_WORKER.reconcileBatchSize,
            SESSION_LIFECYCLE_WORKER.reconcileMaxBatches,
        );
        if (shouldStopBeforeStage('reconcile_due_smart_capture_sessions')) return false;
        const smartCaptureReconciled = await reconcileDueSmartCaptureSessions();

        if (shouldStopBeforeStage('complete')) return false;

        if (
            recoveredPendingReplay.checked > 0
            || abandoned > 0
            || recovered > 0
            || eventRollupsQueued > 0
            || reconciled > 0
            || smartCaptureReconciled > 0
        ) {
            logger.info({
                abandoned,
                eventRollupsQueued,
                recovered,
                recoveredPendingReplay: recoveredPendingReplay.recovered,
                stalePendingReplayChecked: recoveredPendingReplay.checked,
                reconciled,
                smartCaptureReconciled,
            }, 'session.reconcile_sweep');
        }
        return true;
    } finally {
        leaseRenewal.stop();
        await releaseRedisLease(redis, lease).catch((err) => {
            logger.warn({ err }, 'session.reconcile_sweep_lease_release_failed');
        });
    }
}

export function startSessionLifecycleWorker(): void {
    const sessionEventRollupWorker = startSessionEventRollupWorker();
    const sessionEffectsWorker = startSessionEffectsWorker();

    startPollingWorker({
        heartbeatIntervalMs: SESSION_LIFECYCLE_WORKER.heartbeatIntervalMs,
        onShutdown: async () => {
            await Promise.all([
                sessionEventRollupWorker.close(),
                sessionEffectsWorker.close(),
            ]);
        },
        onTick: async () => {
            const now = Date.now();
            if (now - lastSessionSweepAt < SESSION_LIFECYCLE_WORKER.sessionSweepIntervalMs) {
                return;
            }
            lastSessionSweepAt = now;
            await runSessionLifecycleSweep();
        },
        pollIntervalMs: SESSION_LIFECYCLE_WORKER.pollIntervalMs,
        startupMessage: 'Session lifecycle worker started',
        workerName: SESSION_LIFECYCLE_WORKER.workerName,
    });
}

startSessionLifecycleWorker();
