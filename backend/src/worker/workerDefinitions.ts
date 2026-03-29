import type { WorkerName } from '../services/monitoring.js';

export type ArtifactWorkerDefinition = {
    allowedKinds: string[];
    defaultBatchSize: number;
    defaultJobProcessConcurrency: number;
    defaultMaxRunnablePerSession: number;
    kindPriority: string[];
    mode: 'artifact';
    ownedResponsibilities: string[];
    workerName: WorkerName;
};

export type SessionLifecycleWorkerDefinition = {
    heartbeatIntervalMs: number;
    mode: 'lifecycle';
    ownedResponsibilities: string[];
    pollIntervalMs: number;
    reconcileBatchSize: number;
    reconcileMaxBatches: number;
    sessionSweepIntervalMs: number;
    workerName: 'sessionLifecycleWorker';
};

export const INGEST_ARTIFACT_WORKER: ArtifactWorkerDefinition = {
    allowedKinds: ['events', 'crashes', 'anrs'],
    defaultBatchSize: 20,
    defaultJobProcessConcurrency: 4,
    defaultMaxRunnablePerSession: 1,
    kindPriority: ['events', 'crashes', 'anrs', 'screenshots', 'hierarchy'],
    mode: 'artifact',
    ownedResponsibilities: ['artifact-queue-drain', 'event-crash-anr-processing'],
    workerName: 'ingestWorker',
};

export const REPLAY_ARTIFACT_WORKER: ArtifactWorkerDefinition = {
    allowedKinds: ['screenshots', 'hierarchy'],
    defaultBatchSize: 40,
    defaultJobProcessConcurrency: 8,
    defaultMaxRunnablePerSession: 4,
    kindPriority: ['screenshots', 'hierarchy', 'events', 'crashes', 'anrs'],
    mode: 'artifact',
    ownedResponsibilities: ['artifact-queue-drain', 'replay-artifact-processing'],
    workerName: 'replayWorker',
};

export const SESSION_LIFECYCLE_WORKER: SessionLifecycleWorkerDefinition = {
    heartbeatIntervalMs: 60_000,
    mode: 'lifecycle',
    ownedResponsibilities: ['artifact-lifecycle-sweeps', 'session-reconciliation'],
    pollIntervalMs: 500,
    reconcileBatchSize: 500,
    reconcileMaxBatches: 20,
    sessionSweepIntervalMs: 10_000,
    workerName: 'sessionLifecycleWorker',
};
