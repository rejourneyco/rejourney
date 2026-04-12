import { logger } from '../logger.js';
import {
    abandonExpiredPendingArtifacts,
    queueRecoverableArtifacts,
    recoverStalePendingReplayArtifacts,
    requeueStaleProcessingJobs,
} from '../services/ingestArtifactLifecycle.js';
import { reconcileDueSessions } from '../services/sessionReconciliation.js';
import { SESSION_LIFECYCLE_WORKER } from './workerDefinitions.js';
import { startPollingWorker } from './workerRuntime.js';

let lastSessionSweepAt = 0;

export function startSessionLifecycleWorker(): void {
    startPollingWorker({
        heartbeatIntervalMs: SESSION_LIFECYCLE_WORKER.heartbeatIntervalMs,
        onTick: async () => {
            const now = Date.now();
            if (now - lastSessionSweepAt < SESSION_LIFECYCLE_WORKER.sessionSweepIntervalMs) {
                return;
            }
            lastSessionSweepAt = now;

            const recoveredPendingReplay = await recoverStalePendingReplayArtifacts(100);
            const abandoned = await abandonExpiredPendingArtifacts(100);
            const requeued = await requeueStaleProcessingJobs(100);
            const recovered = await queueRecoverableArtifacts(100);
            const reconciled = await reconcileDueSessions(
                SESSION_LIFECYCLE_WORKER.reconcileBatchSize,
                SESSION_LIFECYCLE_WORKER.reconcileMaxBatches,
            );

            if (
                recoveredPendingReplay.checked > 0
                || abandoned > 0
                || requeued > 0
                || recovered > 0
                || reconciled > 0
            ) {
                logger.info({
                    abandoned,
                    requeued,
                    recovered,
                    recoveredPendingReplay: recoveredPendingReplay.recovered,
                    stalePendingReplayChecked: recoveredPendingReplay.checked,
                    reconciled,
                }, 'session.reconcile_sweep');
            }
        },
        pollIntervalMs: SESSION_LIFECYCLE_WORKER.pollIntervalMs,
        startupMessage: 'Session lifecycle worker started',
        workerName: SESSION_LIFECYCLE_WORKER.workerName,
    });
}

startSessionLifecycleWorker();
