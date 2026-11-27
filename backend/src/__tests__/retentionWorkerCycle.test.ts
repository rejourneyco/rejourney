/**
 * End-to-end behaviour of one `--once` retention cycle.
 *
 * retentionWorker.ts starts work when it is imported, so each test sets
 * process.argv to a `--once` invocation, stubs process.exit, imports a fresh
 * copy of the module and waits for the exit call. Everything the cycle talks
 * to is mocked; the batch runner and the heap guard are the real ones, with
 * node:v8 supplying the heap numbers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getTableName } from 'drizzle-orm';

const mocks = vi.hoisted(() => ({
    state: {
        policies: (): unknown[] => [],
        expiredSessions: [] as Array<{ id: string; retentionTier: number; retentionDays: number; startedAt: Date }>,
        deletedProjects: [] as unknown[],
        selectedTables: [] as string[],
        heapUsed: 100,
        heapLimit: 1_000,
    },
    db: { select: vi.fn() },
    pool: { end: vi.fn(async () => undefined) },
    redis: {
        set: vi.fn(async () => 'OK'),
        scan: vi.fn(async () => ['0', []]),
        del: vi.fn(async () => 0),
    },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    pingWorker: vi.fn(async () => undefined),
    hardDeleteProject: vi.fn(async () => undefined),
    pruneExpiredActivityDays: vi.fn(async () => undefined),
    purgeSessionArtifacts: vi.fn(),
    repairExpiredSessionArtifactsBatch: vi.fn(),
    scrubExpiredSessionIdentitiesBatch: vi.fn(),
    expireVisitorLedgerBatch: vi.fn(),
    buildRetentionRunOwnerId: vi.fn(() => 'owner_test'),
    tryAcquireRetentionRunLock: vi.fn(),
    refreshRetentionRunLock: vi.fn(async () => undefined),
    releaseRetentionRunLock: vi.fn(async () => undefined),
    getHeapStatistics: vi.fn(),
}));

vi.mock('node:v8', () => ({
    default: { getHeapStatistics: mocks.getHeapStatistics },
    getHeapStatistics: mocks.getHeapStatistics,
}));

vi.mock('../db/client.js', async () => ({
    ...(await vi.importActual<object>('../db/schema.js')),
    db: mocks.db,
    pool: mocks.pool,
}));

vi.mock('../config.js', () => ({
    config: {
        RETENTION_BATCH_SIZE: 100,
        RETENTION_REPAIR_BATCH_SIZE: 100,
        RETENTION_MAX_RUNTIME_MS: 240_000,
        // One session at a time keeps the order of heap checks deterministic.
        RETENTION_SESSION_CONCURRENCY: 1,
    },
}));

vi.mock('../db/redis.js', () => ({ getRedis: () => mocks.redis }));
vi.mock('../logger.js', () => ({ logger: mocks.logger }));
vi.mock('../services/monitoring.js', () => ({ pingWorker: mocks.pingWorker }));
vi.mock('../services/deletion.js', () => ({ hardDeleteProject: mocks.hardDeleteProject }));
vi.mock('../services/activitySnapshots.js', () => ({ pruneExpiredActivityDays: mocks.pruneExpiredActivityDays }));
vi.mock('../services/sessionArtifactPurge.js', () => ({
    purgeSessionArtifacts: mocks.purgeSessionArtifacts,
    repairExpiredSessionArtifactsBatch: mocks.repairExpiredSessionArtifactsBatch,
}));
vi.mock('../services/sessionIdentityScrub.js', () => ({
    scrubExpiredSessionIdentitiesBatch: mocks.scrubExpiredSessionIdentitiesBatch,
}));
vi.mock('../services/visitorLedger.js', () => ({ expireVisitorLedgerBatch: mocks.expireVisitorLedgerBatch }));
vi.mock('../services/retentionRunLock.js', () => ({
    buildRetentionRunOwnerId: mocks.buildRetentionRunOwnerId,
    tryAcquireRetentionRunLock: mocks.tryAcquireRetentionRunLock,
    refreshRetentionRunLock: mocks.refreshRetentionRunLock,
    releaseRetentionRunLock: mocks.releaseRetentionRunLock,
}));

/** A drizzle-style query builder that resolves to rows chosen from the test state. */
function selectChain(fields: Record<string, unknown> | undefined) {
    let tableName = '';
    const chain: any = {
        from: (table: unknown) => {
            tableName = getTableName(table as never);
            mocks.state.selectedTables.push(tableName);
            return chain;
        },
        innerJoin: () => chain,
        where: () => chain,
        orderBy: () => chain,
        limit: () => chain,
        then: (onFulfilled: (rows: unknown[]) => unknown, onRejected: (err: unknown) => unknown) => (
            Promise.resolve()
                .then(() => {
                    if (fields && 'tier' in fields) return mocks.state.policies();
                    if (fields && 'startedAt' in fields) return mocks.state.expiredSessions;
                    if (tableName === 'projects') return mocks.state.deletedProjects;
                    return [];
                })
                .then(onFulfilled, onRejected)
        ),
    };
    return chain;
}

const originalArgv = process.argv;
let exitSpy: ReturnType<typeof vi.spyOn>;
let dateNowSpy: ReturnType<typeof vi.spyOn> | undefined;

/** Cycle start used by the tests that drive the clock by hand. */
const T0 = 1_800_000_000_000;
const MAX_RUNTIME_MS = 240_000;
const clock = { now: T0 };

/**
 * Replaces Date.now with a clock that only moves when a mocked phase moves
 * it, so "this purge took 40 seconds" is exact and the budget arithmetic can
 * be asserted to the millisecond.
 */
function useManualClock(): void {
    clock.now = T0;
    dateNowSpy = vi.spyOn(Date, 'now').mockImplementation(() => clock.now);
}
let signalListenersBefore: { SIGTERM: Function[]; SIGINT: Function[] };

async function runWorkerOnce(extraArgs: string[] = []): Promise<number | undefined> {
    process.argv = ['node', 'retentionWorker.js', '--once', ...extraArgs];
    vi.resetModules();
    await import('../worker/retentionWorker.js');
    await vi.waitFor(() => {
        expect(exitSpy).toHaveBeenCalled();
    }, { timeout: 10_000 });
    return exitSpy.mock.calls[0][0] as number | undefined;
}

function lastSummary(): Record<string, any> {
    const call = mocks.redis.set.mock.calls
        .filter((args: unknown[]) => args[0] === 'retentionWorker:last_summary')
        .at(-1) as unknown[] | undefined;
    if (!call) throw new Error('No retention summary heartbeat was written');
    return JSON.parse(call[1] as string);
}

const SCRUB_WITH_MORE_WORK = {
    attempted: 100,
    scrubbed: 100,
    linkedRowsScrubbed: 2,
    reachedProcessingCap: true,
};

const LEDGER_WITH_MORE_WORK = { deleted: 100, reachedProcessingCap: true };

function session(id: string) {
    return { id, retentionTier: 1, retentionDays: 7, startedAt: new Date('2026-09-01T00:00:00.000Z') };
}

// Every test imports a fresh copy of the worker and the real schema, which can
// take several seconds on a cold or busy machine. A test that timed out would
// leave its cycle running into the next test.
vi.setConfig({ testTimeout: 30_000 });

describe('retention worker cycle', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        signalListenersBefore = {
            SIGTERM: process.listeners('SIGTERM'),
            SIGINT: process.listeners('SIGINT'),
        };
        exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

        mocks.state.policies = () => [{ tier: 1, days: 7 }];
        mocks.state.expiredSessions = [session('s1'), session('s2'), session('s3')];
        mocks.state.deletedProjects = [];
        mocks.state.selectedTables = [];
        mocks.state.heapUsed = 100;
        mocks.state.heapLimit = 1_000;

        mocks.db.select.mockImplementation(selectChain);
        mocks.getHeapStatistics.mockImplementation(() => ({
            used_heap_size: mocks.state.heapUsed,
            heap_size_limit: mocks.state.heapLimit,
        }));
        mocks.tryAcquireRetentionRunLock.mockResolvedValue(true);
        mocks.purgeSessionArtifacts.mockImplementation(async (sessionId: string) => ({
            sessionId,
            deletedObjectCount: 2,
            deletedBytes: 20,
        }));
        mocks.repairExpiredSessionArtifactsBatch.mockResolvedValue({
            attempted: 0,
            repaired: 0,
            failed: 0,
            deletedObjectCount: 0,
            deletedBytes: 0,
            reachedProcessingCap: false,
        });
        // mockReset also drops any unconsumed "once" results from an earlier test.
        mocks.scrubExpiredSessionIdentitiesBatch.mockReset().mockResolvedValue({
            attempted: 4,
            scrubbed: 4,
            linkedRowsScrubbed: 1,
            reachedProcessingCap: false,
        });
        mocks.expireVisitorLedgerBatch.mockReset().mockResolvedValue({ deleted: 0, reachedProcessingCap: false });
    });

    afterEach(() => {
        process.argv = originalArgv;
        exitSpy.mockRestore();
        dateNowSpy?.mockRestore();
        dateNowSpy = undefined;
        // Each import of the worker registers its own signal handlers.
        for (const signal of ['SIGTERM', 'SIGINT'] as const) {
            for (const listener of process.listeners(signal)) {
                if (!signalListenersBefore[signal].includes(listener)) {
                    process.removeListener(signal, listener as (...args: any[]) => void);
                }
            }
        }
    });

    it('completes a normal cycle, releases the lock and exits 0', async () => {
        const exitCode = await runWorkerOnce();

        expect(exitCode).toBe(0);
        expect(mocks.purgeSessionArtifacts.mock.calls.map(([sessionId]) => sessionId)).toEqual(['s1', 's2', 's3']);
        expect(mocks.repairExpiredSessionArtifactsBatch).toHaveBeenCalledTimes(1);
        expect(mocks.scrubExpiredSessionIdentitiesBatch).toHaveBeenCalledTimes(1);
        expect(mocks.expireVisitorLedgerBatch).toHaveBeenCalledTimes(1);

        const summary = lastSummary();
        expect(summary).toMatchObject({
            status: 'completed',
            expiredCount: 3,
            identityScrubbedCount: 4,
            deletedObjectCount: 6,
            rounds: 1,
        });
        expect(summary.stoppedForHeapPressure).toBeUndefined();
        expect(summary.failedPhases).toBeUndefined();
        expect(mocks.pingWorker).toHaveBeenCalledWith('retentionWorker', 'up', expect.any(String), undefined, expect.any(Array));
        expect(mocks.tryAcquireRetentionRunLock).toHaveBeenCalledWith('owner_test');
        expect(mocks.releaseRetentionRunLock).toHaveBeenCalledWith('owner_test');
        expect(mocks.pool.end).toHaveBeenCalledTimes(1);
    });

    it('still scrubs identities when the purge phase throws, then fails the cycle naming the phase', async () => {
        mocks.state.policies = () => {
            throw new Error('retention_policies query failed');
        };

        const exitCode = await runWorkerOnce();

        // The phases after the purge all ran in the same round.
        expect(mocks.purgeSessionArtifacts).not.toHaveBeenCalled();
        expect(mocks.repairExpiredSessionArtifactsBatch).toHaveBeenCalledTimes(1);
        expect(mocks.scrubExpiredSessionIdentitiesBatch).toHaveBeenCalledTimes(1);
        expect(mocks.scrubExpiredSessionIdentitiesBatch).toHaveBeenCalledWith(100, {
            runId: expect.stringMatching(/^retention:\d+$/),
            trigger: 'identity_scrub',
        });
        expect(mocks.expireVisitorLedgerBatch).toHaveBeenCalledTimes(1);
        expect(mocks.state.selectedTables).toContain('projects');

        expect(mocks.logger.error).toHaveBeenCalledWith(
            expect.objectContaining({
                phase: 'expired_purge',
                err: expect.objectContaining({ message: 'retention_policies query failed' }),
            }),
            expect.any(String),
        );

        // The cycle is recorded as failed, with the scrub's work still counted.
        const summary = lastSummary();
        expect(summary).toMatchObject({
            status: 'failed',
            error: 'Retention phases failed: expired_purge',
            failedPhases: ['expired_purge'],
            identityScrubbedCount: 4,
            linkedIdentityRowsScrubbed: 1,
            rounds: 1,
        });
        expect(mocks.pingWorker).toHaveBeenCalledTimes(1);
        expect(mocks.pingWorker).toHaveBeenCalledWith('retentionWorker', 'down', 'Retention phases failed: expired_purge');
        expect(mocks.releaseRetentionRunLock).toHaveBeenCalledWith('owner_test');
        expect(mocks.logger.error).toHaveBeenCalledWith(
            expect.objectContaining({
                err: expect.objectContaining({ message: 'Retention phases failed: expired_purge' }),
            }),
            'Retention worker fatal error',
        );
        expect(exitCode).toBe(1);
    });

    it('still scrubs identities when the repair phase throws, and keeps the purge results', async () => {
        mocks.repairExpiredSessionArtifactsBatch.mockRejectedValue(new Error('repair candidates query failed'));

        const exitCode = await runWorkerOnce();

        expect(mocks.purgeSessionArtifacts).toHaveBeenCalledTimes(3);
        expect(mocks.scrubExpiredSessionIdentitiesBatch).toHaveBeenCalledTimes(1);
        expect(mocks.expireVisitorLedgerBatch).toHaveBeenCalledTimes(1);
        expect(mocks.logger.error).toHaveBeenCalledWith(
            expect.objectContaining({ phase: 'expired_repair' }),
            expect.any(String),
        );
        expect(lastSummary()).toMatchObject({
            status: 'failed',
            error: 'Retention phases failed: expired_repair',
            expiredCount: 3,
            identityScrubbedCount: 4,
        });
        expect(mocks.pingWorker).toHaveBeenCalledWith('retentionWorker', 'down', 'Retention phases failed: expired_repair');
        expect(mocks.releaseRetentionRunLock).toHaveBeenCalledWith('owner_test');
        expect(exitCode).toBe(1);
    });

    it('names every failed phase when purge and repair both throw', async () => {
        mocks.state.policies = () => {
            throw new Error('retention_policies query failed');
        };
        mocks.repairExpiredSessionArtifactsBatch.mockRejectedValue(new Error('repair candidates query failed'));

        const exitCode = await runWorkerOnce();

        expect(mocks.scrubExpiredSessionIdentitiesBatch).toHaveBeenCalledTimes(1);
        expect(lastSummary()).toMatchObject({
            status: 'failed',
            error: 'Retention phases failed: expired_purge, expired_repair',
            failedPhases: ['expired_purge', 'expired_repair'],
        });
        expect(exitCode).toBe(1);
    });

    it('stops after the round in which a phase failed, even when draining a backlog', async () => {
        mocks.state.policies = () => {
            throw new Error('retention_policies query failed');
        };
        // Progress plus "maybe more work" would normally start another round.
        // Only the first three calls say so, so a regression shows up as four
        // rounds instead of a loop that runs until the runtime cap.
        for (let call = 0; call < 3; call += 1) {
            mocks.expireVisitorLedgerBatch.mockResolvedValueOnce(LEDGER_WITH_MORE_WORK);
        }

        const exitCode = await runWorkerOnce(['--drain-backlog']);

        expect(mocks.scrubExpiredSessionIdentitiesBatch).toHaveBeenCalledTimes(1);
        expect(mocks.expireVisitorLedgerBatch).toHaveBeenCalledTimes(1);
        expect(lastSummary()).toMatchObject({
            status: 'failed',
            rounds: 1,
            identityScrubbedCount: 4,
            visitorLedgerExpiredCount: 100,
        });
        expect(exitCode).toBe(1);
    });

    it('ends the cycle as completed and releases the lock when the heap guard trips mid-batch', async () => {
        mocks.purgeSessionArtifacts.mockImplementation(async (sessionId: string) => {
            if (sessionId === 's2') {
                // The heap fills up while the second session is being purged.
                mocks.state.heapUsed = 900;
            }
            return { sessionId, deletedObjectCount: 2, deletedBytes: 20 };
        });

        const exitCode = await runWorkerOnce();

        // s2 was in flight and finished; s3 was never claimed and stays for the next run.
        expect(mocks.purgeSessionArtifacts.mock.calls.map(([sessionId]) => sessionId)).toEqual(['s1', 's2']);
        expect(mocks.repairExpiredSessionArtifactsBatch).not.toHaveBeenCalled();
        // The phases after purge and repair still ran.
        expect(mocks.scrubExpiredSessionIdentitiesBatch).toHaveBeenCalledTimes(1);
        expect(mocks.expireVisitorLedgerBatch).toHaveBeenCalledTimes(1);

        expect(mocks.logger.warn).toHaveBeenCalledTimes(1);
        expect(mocks.logger.warn).toHaveBeenCalledWith(
            {
                runId: expect.stringMatching(/^retention:\d+$/),
                usedHeapBytes: 900,
                heapLimitBytes: 1_000,
                ratio: 0.9,
                threshold: 0.75,
            },
            expect.stringContaining('heap limit'),
        );

        const summary = lastSummary();
        expect(summary).toMatchObject({
            status: 'completed',
            expiredCount: 2,
            identityScrubbedCount: 4,
            stoppedForHeapPressure: true,
            rounds: 1,
        });
        expect(summary.error).toBeUndefined();
        expect(mocks.pingWorker).toHaveBeenCalledTimes(1);
        expect(mocks.pingWorker).toHaveBeenCalledWith('retentionWorker', 'up', expect.any(String), undefined, expect.any(Array));
        expect(mocks.releaseRetentionRunLock).toHaveBeenCalledTimes(1);
        expect(mocks.releaseRetentionRunLock).toHaveBeenCalledWith('owner_test');
        expect(exitCode).toBe(0);
    });

    it('does not start another round after the heap guard trips while draining a backlog', async () => {
        mocks.purgeSessionArtifacts.mockImplementation(async (sessionId: string) => {
            mocks.state.heapUsed = 900;
            return { sessionId, deletedObjectCount: 2, deletedBytes: 20 };
        });
        for (let call = 0; call < 3; call += 1) {
            mocks.expireVisitorLedgerBatch.mockResolvedValueOnce(LEDGER_WITH_MORE_WORK);
        }

        const exitCode = await runWorkerOnce(['--drain-backlog']);

        expect(mocks.purgeSessionArtifacts).toHaveBeenCalledTimes(1);
        expect(mocks.scrubExpiredSessionIdentitiesBatch).toHaveBeenCalledTimes(1);
        expect(mocks.expireVisitorLedgerBatch).toHaveBeenCalledTimes(1);
        expect(lastSummary()).toMatchObject({ status: 'completed', rounds: 1, stoppedForHeapPressure: true });
        expect(exitCode).toBe(0);
    });

    it('skips purge and repair but still scrubs when the heap is already over the threshold', async () => {
        mocks.state.heapUsed = 800;

        const exitCode = await runWorkerOnce();

        expect(mocks.purgeSessionArtifacts).not.toHaveBeenCalled();
        expect(mocks.repairExpiredSessionArtifactsBatch).not.toHaveBeenCalled();
        expect(mocks.scrubExpiredSessionIdentitiesBatch).toHaveBeenCalledTimes(1);
        expect(lastSummary()).toMatchObject({ status: 'completed', expiredCount: 0, stoppedForHeapPressure: true });
        expect(mocks.releaseRetentionRunLock).toHaveBeenCalledWith('owner_test');
        expect(exitCode).toBe(0);
    });

    it('gives purge and repair 60% of the cycle and leaves the rest to the scrub', async () => {
        useManualClock();
        mocks.state.expiredSessions = Array.from({ length: 10 }, (_, index) => session(`s${index + 1}`));
        mocks.purgeSessionArtifacts.mockImplementation(async (sessionId: string) => {
            clock.now += 20_000;
            return { sessionId, deletedObjectCount: 1, deletedBytes: 10 };
        });

        const exitCode = await runWorkerOnce();

        // Claims at 0, 20, … 140 s: eight sessions. At 160 s the 144 s share is
        // spent, so the last two wait for the next run.
        expect(mocks.purgeSessionArtifacts).toHaveBeenCalledTimes(8);
        // The repair pass gets the same deadline, not the end of the cycle.
        expect(mocks.repairExpiredSessionArtifactsBatch).not.toHaveBeenCalled();
        expect(mocks.scrubExpiredSessionIdentitiesBatch).toHaveBeenCalledTimes(1);
        expect(lastSummary()).toMatchObject({ status: 'completed', expiredCount: 8, identityScrubbedCount: 4 });
        expect(exitCode).toBe(0);
    });

    it('hands the repair pass the purge deadline when the purge finishes early', async () => {
        useManualClock();
        mocks.purgeSessionArtifacts.mockImplementation(async (sessionId: string) => {
            clock.now += 10_000;
            return { sessionId, deletedObjectCount: 1, deletedBytes: 10 };
        });

        const exitCode = await runWorkerOnce();

        expect(mocks.purgeSessionArtifacts).toHaveBeenCalledTimes(3);
        expect(mocks.repairExpiredSessionArtifactsBatch).toHaveBeenCalledTimes(1);
        const repairOptions = mocks.repairExpiredSessionArtifactsBatch.mock.calls[0][3];
        expect(repairOptions.deadlineAtMs).toBe(T0 + 0.6 * MAX_RUNTIME_MS);
        expect(repairOptions.deadlineAtMs).toBeLessThan(T0 + MAX_RUNTIME_MS);
        expect(exitCode).toBe(0);
    });

    it('still scrubs when the purge uses up its whole share, and scrubs until the cycle deadline', async () => {
        useManualClock();
        mocks.state.expiredSessions = Array.from({ length: 10 }, (_, index) => session(`s${index + 1}`));
        mocks.purgeSessionArtifacts.mockImplementation(async (sessionId: string) => {
            clock.now += 40_000;
            return { sessionId, deletedObjectCount: 1, deletedBytes: 10 };
        });
        // The scrub always has more to do; each batch takes 30 s.
        mocks.scrubExpiredSessionIdentitiesBatch.mockImplementation(async () => {
            clock.now += 30_000;
            return SCRUB_WITH_MORE_WORK;
        });

        const exitCode = await runWorkerOnce();

        // Claims at 0, 40, 80 and 120 s; at 160 s the 144 s purge share is spent
        // and the other six sessions stay for the next run. Without the share
        // the purge would have claimed six and left the scrub nothing.
        expect(mocks.purgeSessionArtifacts.mock.calls.map(([sessionId]) => sessionId)).toEqual(['s1', 's2', 's3', 's4']);
        expect(mocks.repairExpiredSessionArtifactsBatch).not.toHaveBeenCalled();

        // Scrub batches start at 160, 190 and 220 s; at 250 s the cycle deadline
        // has passed, so the loop ends with work left.
        expect(mocks.scrubExpiredSessionIdentitiesBatch).toHaveBeenCalledTimes(3);
        for (const call of mocks.scrubExpiredSessionIdentitiesBatch.mock.calls) {
            expect(call).toEqual([100, { runId: expect.stringMatching(/^retention:\d+$/), trigger: 'identity_scrub' }]);
        }
        // Past the deadline the later steps are skipped, as before.
        expect(mocks.expireVisitorLedgerBatch).not.toHaveBeenCalled();

        expect(lastSummary()).toMatchObject({
            status: 'completed',
            expiredCount: 4,
            identityScrubbedCount: 300,
            linkedIdentityRowsScrubbed: 6,
            rounds: 1,
            durationMs: 250_000,
        });
        expect(mocks.releaseRetentionRunLock).toHaveBeenCalledWith('owner_test');
        expect(exitCode).toBe(0);
    });

    it('caps the scrub at ten batches per round and sums their counts', async () => {
        mocks.scrubExpiredSessionIdentitiesBatch.mockResolvedValue(SCRUB_WITH_MORE_WORK);

        const exitCode = await runWorkerOnce();

        expect(mocks.scrubExpiredSessionIdentitiesBatch).toHaveBeenCalledTimes(10);
        // The ledger expiry and deleted projects still follow the scrub loop.
        expect(mocks.expireVisitorLedgerBatch).toHaveBeenCalledTimes(1);
        expect(mocks.scrubExpiredSessionIdentitiesBatch.mock.invocationCallOrder.at(-1))
            .toBeLessThan(mocks.expireVisitorLedgerBatch.mock.invocationCallOrder[0]);
        expect(mocks.state.selectedTables).toContain('projects');
        expect(lastSummary()).toMatchObject({
            status: 'completed',
            identityScrubbedCount: 1_000,
            linkedIdentityRowsScrubbed: 20,
            rounds: 1,
        });
        expect(exitCode).toBe(0);
    });

    it('stops the scrub loop at the first batch that is not full', async () => {
        mocks.scrubExpiredSessionIdentitiesBatch
            .mockResolvedValueOnce(SCRUB_WITH_MORE_WORK)
            .mockResolvedValueOnce(SCRUB_WITH_MORE_WORK)
            .mockResolvedValueOnce({ attempted: 37, scrubbed: 37, linkedRowsScrubbed: 1, reachedProcessingCap: false });

        const exitCode = await runWorkerOnce();

        expect(mocks.scrubExpiredSessionIdentitiesBatch).toHaveBeenCalledTimes(3);
        expect(lastSummary()).toMatchObject({
            status: 'completed',
            identityScrubbedCount: 237,
            linkedIdentityRowsScrubbed: 5,
        });
        expect(exitCode).toBe(0);
    });

    it('starts another round for a scrub backlog when draining, with a fresh batch cap', async () => {
        // 10 full batches in the first round, 2 more and a partial one in the second.
        for (let call = 0; call < 12; call += 1) {
            mocks.scrubExpiredSessionIdentitiesBatch.mockResolvedValueOnce(SCRUB_WITH_MORE_WORK);
        }
        mocks.state.expiredSessions = [];

        const exitCode = await runWorkerOnce(['--drain-backlog']);

        expect(mocks.scrubExpiredSessionIdentitiesBatch).toHaveBeenCalledTimes(13);
        expect(lastSummary()).toMatchObject({
            status: 'completed',
            rounds: 2,
            identityScrubbedCount: 1_204,
        });
        expect(exitCode).toBe(0);
    });

    it('recomputes the purge share from the time left in each round of a backlog drain', async () => {
        useManualClock();
        mocks.state.expiredSessions = Array.from({ length: 10 }, (_, index) => session(`s${index + 1}`));
        mocks.purgeSessionArtifacts.mockImplementation(async (sessionId: string) => {
            // 40 s per session in the first round, 20 s in the second.
            clock.now += mocks.purgeSessionArtifacts.mock.calls.length <= 4 ? 40_000 : 20_000;
            return { sessionId, deletedObjectCount: 1, deletedBytes: 10 };
        });

        const exitCode = await runWorkerOnce(['--drain-backlog']);

        // Round 1: share ends at 144 s; four claims (0, 40, 80, 120 s) end at 160 s.
        // Round 2 starts at 160 s with 80 s left, so its share ends at 208 s:
        // three claims (160, 180, 200 s) end at 220 s. A share fixed at 144 s
        // would allow none in round 2; the whole remainder would allow four.
        // Round 3 starts at 220 s with 20 s left, so its share ends at 232 s:
        // one claim, ending at 240 s, the cycle deadline.
        const purgeOrder = mocks.purgeSessionArtifacts.mock.invocationCallOrder;
        const scrubOrder = mocks.scrubExpiredSessionIdentitiesBatch.mock.invocationCallOrder;
        expect(purgeOrder).toHaveLength(8);
        // The scrub ran after rounds 1 and 2; by the end of round 3 the deadline had passed.
        expect(scrubOrder).toHaveLength(2);
        const purgesBefore = (order: number) => purgeOrder.filter((purge) => purge < order).length;
        expect(purgesBefore(scrubOrder[0])).toBe(4);
        expect(purgesBefore(scrubOrder[1])).toBe(7);
        expect(lastSummary()).toMatchObject({
            status: 'completed',
            expiredCount: 8,
            identityScrubbedCount: 8,
            rounds: 3,
            durationMs: 240_000,
        });
        expect(exitCode).toBe(0);
    });

    it('skips the scrub only when the cycle deadline has already passed', async () => {
        useManualClock();
        mocks.purgeSessionArtifacts.mockImplementation(async (sessionId: string) => {
            // One session that runs past the end of the whole cycle.
            clock.now += 300_000;
            return { sessionId, deletedObjectCount: 1, deletedBytes: 10 };
        });

        const exitCode = await runWorkerOnce();

        expect(mocks.purgeSessionArtifacts).toHaveBeenCalledTimes(1);
        expect(mocks.scrubExpiredSessionIdentitiesBatch).not.toHaveBeenCalled();
        expect(lastSummary()).toMatchObject({ status: 'completed', expiredCount: 1, identityScrubbedCount: 0 });
        expect(exitCode).toBe(0);
    });

    it('fails the cycle when a later scrub batch throws', async () => {
        mocks.scrubExpiredSessionIdentitiesBatch
            .mockResolvedValueOnce(SCRUB_WITH_MORE_WORK)
            .mockRejectedValueOnce(new Error('scrub transaction failed'));

        const exitCode = await runWorkerOnce();

        expect(mocks.scrubExpiredSessionIdentitiesBatch).toHaveBeenCalledTimes(2);
        expect(mocks.expireVisitorLedgerBatch).not.toHaveBeenCalled();
        expect(lastSummary()).toMatchObject({ status: 'failed', error: 'scrub transaction failed' });
        expect(mocks.pingWorker).toHaveBeenCalledWith('retentionWorker', 'down', 'scrub transaction failed');
        expect(mocks.releaseRetentionRunLock).toHaveBeenCalledWith('owner_test');
        expect(exitCode).toBe(1);
    });

    it('keeps failing the cycle straight away when the identity scrub itself throws', async () => {
        mocks.scrubExpiredSessionIdentitiesBatch.mockRejectedValue(new Error('scrub transaction failed'));

        const exitCode = await runWorkerOnce();

        expect(mocks.expireVisitorLedgerBatch).not.toHaveBeenCalled();
        expect(lastSummary()).toMatchObject({ status: 'failed', error: 'scrub transaction failed' });
        expect(mocks.pingWorker).toHaveBeenCalledWith('retentionWorker', 'down', 'scrub transaction failed');
        expect(mocks.releaseRetentionRunLock).toHaveBeenCalledWith('owner_test');
        expect(exitCode).toBe(1);
    });

    it('exits 0 without doing any work when another run holds the lock', async () => {
        mocks.tryAcquireRetentionRunLock.mockResolvedValue(false);

        const exitCode = await runWorkerOnce();

        expect(mocks.purgeSessionArtifacts).not.toHaveBeenCalled();
        expect(mocks.scrubExpiredSessionIdentitiesBatch).not.toHaveBeenCalled();
        expect(mocks.releaseRetentionRunLock).not.toHaveBeenCalled();
        expect(lastSummary()).toMatchObject({ status: 'skipped', skippedReason: 'lock_held' });
        expect(exitCode).toBe(0);
    });
});
