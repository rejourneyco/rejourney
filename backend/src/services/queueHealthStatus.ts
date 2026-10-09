interface QueueHealthSignals {
    dlqJobs: number;
    pendingJobs: number;
    oldestPendingAge: number | null;
    oldestReplayPendingAge: number | null;
    replayPendingByKind: { screenshots: number; hierarchy: number; rrweb: number };
    stalePendingReplayArtifacts: number;
    oldestStalePendingReplayArtifactAge: number | null;
}

export function resolveQueueHealthStatus(
    signals: QueueHealthSignals,
    staleReplayArtifactCutoffSeconds: number,
): 'healthy' | 'degraded' | 'critical' {
    if (
        signals.dlqJobs > 0
        || (signals.oldestPendingAge ?? 0) > 3600
        || (signals.oldestReplayPendingAge ?? 0) > 900
    ) {
        return 'critical';
    }

    // An unfinished client upload may have no object to process. Keep it visible
    // as a warning; queue failures and stalled accepted work remain critical.
    if (
        signals.pendingJobs > 100
        || (signals.oldestPendingAge ?? 0) > 600
        || Object.values(signals.replayPendingByKind).some((count) => count > 100)
        || signals.stalePendingReplayArtifacts > 50
        || (signals.oldestStalePendingReplayArtifactAge ?? 0) > staleReplayArtifactCutoffSeconds
    ) {
        return 'degraded';
    }
    return 'healthy';
}
