/**
 * ingestQueue — artifact job utility helpers
 *
 * The Postgres-backed poll queue (ingest_jobs table) has been replaced by
 * BullMQ (see artifactBullQueue.ts).  This file retains only the pure utility
 * functions that are unit-tested and have no DB dependencies.
 *
 * @deprecated The Postgres poll functions (selectRunnableArtifactJobs,
 * markArtifactJobProcessing, etc.) have been removed.  Use artifactBullQueue.ts
 * for enqueueing and BullMQ Worker for consuming.
 */

// ─── Kind priority helpers ────────────────────────────────────────────────────

type JobWithKindAndDate = {
    kind?: string | null;
    createdAt?: Date | string | null;
    [key: string]: unknown;
};

export function getArtifactKindPriority(
    config: { kindPriority: Map<string, number> },
    kind: string | null | undefined,
): number {
    if (!kind) return config.kindPriority.size + 1;
    return config.kindPriority.get(kind) ?? (config.kindPriority.size + 1);
}

export function sortArtifactJobsByPriority<T extends JobWithKindAndDate>(
    jobs: T[],
    config: { kindPriority: Map<string, number> },
): T[] {
    return [...jobs].sort((left, right) => {
        const priorityDelta =
            getArtifactKindPriority(config, left.kind) -
            getArtifactKindPriority(config, right.kind);
        if (priorityDelta !== 0) return priorityDelta;
        return new Date(left.createdAt as any).getTime() - new Date(right.createdAt as any).getTime();
    });
}

// ─── Per-session concurrency limiter ─────────────────────────────────────────

export function applyPerSessionRunnableLimit<T extends { sessionId?: string | null; id?: string }>(
    jobs: T[],
    maxRunnablePerSession: number,
): T[] {
    const perSessionCounts = new Map<string, number>();

    return jobs.filter((job) => {
        const key = job.sessionId || `job:${job.id}`;
        const currentCount = perSessionCounts.get(key) ?? 0;
        if (currentCount >= maxRunnablePerSession) return false;
        perSessionCounts.set(key, currentCount + 1);
        return true;
    });
}
