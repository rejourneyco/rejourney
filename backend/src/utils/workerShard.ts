/**
 * Identity of one pod inside an Indexed Kubernetes Job.
 *
 * Indexed Jobs expose the pod's completion index through the
 * batch.kubernetes.io/job-completion-index annotation, which the manifests map
 * to JOB_COMPLETION_INDEX; SHARD_COUNT is the Job's parallelism. Outside an
 * Indexed Job (single-pod CronJobs, local runs) both default to a single shard,
 * so every guard keyed on the primary shard behaves as before.
 */
import os from 'node:os';

function parseNonNegativeInt(value: string | undefined, fallback: number): number {
    if (value === undefined || value === '') return fallback;
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

export function jobCompletionIndex(): number {
    return parseNonNegativeInt(process.env.JOB_COMPLETION_INDEX, 0);
}

export function shardCount(): number {
    return Math.max(1, parseNonNegativeInt(process.env.SHARD_COUNT, 1));
}

/** The pod that runs once-per-tick maintenance and single-owner exports. */
export function isPrimaryShard(): boolean {
    return jobCompletionIndex() === 0;
}

/** Stable per-index label for metrics grouping; never the pod name, which is unique per Job. */
export function workerInstanceLabel(): string {
    return String(jobCompletionIndex());
}

/** Identifies which pod claimed a job row; informational, never a lock. */
export function claimOwner(): string {
    return os.hostname().slice(0, 64);
}
