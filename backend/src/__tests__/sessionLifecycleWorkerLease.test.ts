import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    abandonExpiredPendingArtifactsMock,
    acquireRedisLeaseMock,
    queuePendingSessionEventRollupsMock,
    queueRecoverableArtifactsMock,
    reconcileDueSessionsMock,
    reconcileDueSmartCaptureSessionsMock,
    recoverStalePendingReplayArtifactsMock,
    releaseRedisLeaseMock,
    leaseRenewalControllerRef,
    stopLeaseRenewalMock,
    startRedisLeaseRenewalMock,
} = vi.hoisted(() => ({
    abandonExpiredPendingArtifactsMock: vi.fn(async () => 0),
    acquireRedisLeaseMock: vi.fn(async (): Promise<any> => null),
    queuePendingSessionEventRollupsMock: vi.fn(async () => 0),
    queueRecoverableArtifactsMock: vi.fn(async () => 0),
    reconcileDueSessionsMock: vi.fn(async () => 0),
    reconcileDueSmartCaptureSessionsMock: vi.fn(async () => 0),
    recoverStalePendingReplayArtifactsMock: vi.fn(async () => ({ checked: 0, recovered: 0 })),
    releaseRedisLeaseMock: vi.fn(async () => true),
    leaseRenewalControllerRef: { current: null as AbortController | null },
    stopLeaseRenewalMock: vi.fn(),
    startRedisLeaseRenewalMock: vi.fn(),
}));

vi.mock('../db/redis.js', () => ({
    getRedis: () => ({ name: 'redis' }),
}));

vi.mock('../logger.js', () => ({
    logger: {
        error: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
    },
}));

vi.mock('../services/ingestArtifactLifecycle.js', () => ({
    abandonExpiredPendingArtifacts: abandonExpiredPendingArtifactsMock,
    queueRecoverableArtifacts: queueRecoverableArtifactsMock,
    recoverStalePendingReplayArtifacts: recoverStalePendingReplayArtifactsMock,
}));

vi.mock('../services/sessionEventRollupQueue.js', () => ({
    queuePendingSessionEventRollups: queuePendingSessionEventRollupsMock,
    startSessionEventRollupWorker: vi.fn(() => ({ close: vi.fn() })),
}));

vi.mock('../services/sessionEffectsQueue.js', () => ({
    startSessionEffectsWorker: vi.fn(() => ({ close: vi.fn() })),
}));

vi.mock('../services/sessionReconciliation.js', () => ({
    reconcileDueSessions: reconcileDueSessionsMock,
    reconcileDueSmartCaptureSessions: reconcileDueSmartCaptureSessionsMock,
}));

vi.mock('../services/redisLease.js', () => ({
    acquireRedisLease: acquireRedisLeaseMock,
    releaseRedisLease: releaseRedisLeaseMock,
    startRedisLeaseRenewal: startRedisLeaseRenewalMock,
}));

vi.mock('../worker/workerRuntime.js', () => ({
    startPollingWorker: vi.fn(),
}));

import {
    resolveSessionLifecycleSweepLeaseTtlMs,
    runSessionLifecycleSweep,
} from '../worker/sessionLifecycleWorker.js';

describe('session lifecycle sweep lease', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        acquireRedisLeaseMock.mockResolvedValue(null);
        recoverStalePendingReplayArtifactsMock.mockResolvedValue({ checked: 0, recovered: 0 });
        abandonExpiredPendingArtifactsMock.mockResolvedValue(0);
        leaseRenewalControllerRef.current = null;
        startRedisLeaseRenewalMock.mockImplementation(() => {
            const controller = new AbortController();
            leaseRenewalControllerRef.current = controller;
            return {
                signal: controller.signal,
                stop: stopLeaseRenewalMock,
            };
        });
    });

    it('bounds the configured sweep lease TTL', () => {
        expect(resolveSessionLifecycleSweepLeaseTtlMs('bad')).toBe(5 * 60_000);
        expect(resolveSessionLifecycleSweepLeaseTtlMs('1')).toBe(30_000);
        expect(resolveSessionLifecycleSweepLeaseTtlMs(String(2 * 60 * 60_000))).toBe(60 * 60_000);
    });

    it('skips maintenance queries when another replica owns the sweep lease', async () => {
        await expect(runSessionLifecycleSweep()).resolves.toBe(false);

        expect(recoverStalePendingReplayArtifactsMock).not.toHaveBeenCalled();
        expect(queueRecoverableArtifactsMock).not.toHaveBeenCalled();
        expect(reconcileDueSessionsMock).not.toHaveBeenCalled();
        expect(releaseRedisLeaseMock).not.toHaveBeenCalled();
    });

    it('runs one complete sweep and token-safely releases the lease', async () => {
        const lease = { key: 'lock:session-lifecycle-sweep', token: 'owner-a', ttlMs: 300_000 };
        acquireRedisLeaseMock.mockResolvedValue(lease);

        await expect(runSessionLifecycleSweep()).resolves.toBe(true);

        expect(recoverStalePendingReplayArtifactsMock).toHaveBeenCalledWith(100);
        expect(abandonExpiredPendingArtifactsMock).toHaveBeenCalledWith(100);
        expect(queueRecoverableArtifactsMock).toHaveBeenCalledWith(100);
        expect(queuePendingSessionEventRollupsMock).toHaveBeenCalledWith(100);
        expect(reconcileDueSessionsMock).toHaveBeenCalled();
        expect(reconcileDueSmartCaptureSessionsMock).toHaveBeenCalled();
        expect(startRedisLeaseRenewalMock).toHaveBeenCalledWith(
            expect.any(Object),
            lease,
            expect.any(Object),
        );
        expect(stopLeaseRenewalMock).toHaveBeenCalledTimes(1);
        expect(releaseRedisLeaseMock).toHaveBeenCalledWith(expect.any(Object), lease);
    });

    it('stops before the next maintenance stage when ownership is replaced mid-run', async () => {
        const lease = { key: 'lock:session-lifecycle-sweep', token: 'owner-a', ttlMs: 300_000 };
        acquireRedisLeaseMock.mockResolvedValue(lease);
        let finishCurrentStage: ((result: { checked: number; recovered: number }) => void) | undefined;
        recoverStalePendingReplayArtifactsMock.mockImplementationOnce(() => new Promise((resolve) => {
            finishCurrentStage = resolve;
        }));

        const sweep = runSessionLifecycleSweep();
        await vi.waitFor(() => {
            expect(recoverStalePendingReplayArtifactsMock).toHaveBeenCalledTimes(1);
        });

        leaseRenewalControllerRef.current?.abort();
        finishCurrentStage?.({ checked: 1, recovered: 1 });

        await expect(sweep).resolves.toBe(false);
        expect(abandonExpiredPendingArtifactsMock).not.toHaveBeenCalled();
        expect(queueRecoverableArtifactsMock).not.toHaveBeenCalled();
        expect(reconcileDueSessionsMock).not.toHaveBeenCalled();
        expect(stopLeaseRenewalMock).toHaveBeenCalledTimes(1);
        expect(releaseRedisLeaseMock).toHaveBeenCalledWith(expect.any(Object), lease);
    });

    it('releases the lease when a sweep operation fails', async () => {
        const lease = { key: 'lock:session-lifecycle-sweep', token: 'owner-a', ttlMs: 300_000 };
        acquireRedisLeaseMock.mockResolvedValue(lease);
        abandonExpiredPendingArtifactsMock.mockRejectedValue(new Error('database unavailable'));

        await expect(runSessionLifecycleSweep()).rejects.toThrow('database unavailable');
        expect(releaseRedisLeaseMock).toHaveBeenCalledWith(expect.any(Object), lease);
    });
});
