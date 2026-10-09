import { describe, expect, it } from 'vitest';
import { resolveQueueHealthStatus } from '../services/queueHealthStatus.js';

const normal = {
    dlqJobs: 0,
    pendingJobs: 0,
    oldestPendingAge: null,
    oldestReplayPendingAge: null,
    replayPendingByKind: { screenshots: 0, hierarchy: 0, rrweb: 0 },
    stalePendingReplayArtifacts: 0,
    oldestStalePendingReplayArtifactAge: null,
};

describe('queue health status', () => {
    it('reports normal processing as healthy', () => {
        expect(resolveQueueHealthStatus(normal, 600)).toBe('healthy');
    });

    it('warns about historical unfinished uploads without reporting an outage', () => {
        expect(resolveQueueHealthStatus({
            ...normal,
            stalePendingReplayArtifacts: 80829,
            oldestStalePendingReplayArtifactAge: 3370260,
        }, 600)).toBe('degraded');
    });

    it.each([
        { dlqJobs: 1 },
        { oldestPendingAge: 3601 },
        { oldestReplayPendingAge: 901 },
    ])('keeps failed or stalled accepted jobs critical: %j', (failure) => {
        expect(resolveQueueHealthStatus({ ...normal, ...failure }, 600)).toBe('critical');
    });
});
