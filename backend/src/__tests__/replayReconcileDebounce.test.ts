import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * End-to-end shape of the replay reconcile debounce: the real artifact job
 * processor feeds the real session-effects enqueue/processor through an
 * in-memory stand-in for the BullMQ queue. reconcileSessionState is replaced by
 * a small model of the two things that matter here: it flips the stored
 * `replay_available` flag once a screenshots artifact is ready, and it counts
 * replay quota behind the same "not counted yet" marker the real
 * incrementProjectSessionReplayIfNeeded uses.
 */

const model = vi.hoisted(() => ({
    session: {
        replayAvailable: false,
        replayRetentionState: 'not_available' as string,
        replayQuotaCountedAt: null as Date | null,
        readyScreenshots: 0,
    },
    reconcileCalls: 0,
    quotaIncrements: 0,
    selectCalls: 0,
    queue: new Map<string, { data: { sessionId: string }; delay: number }>(),
    completionEffects: [] as Array<{ kind: string; replayAvailable: boolean; sessionId: string }>,
}));

function selectBuilder(result: any[]) {
    const builder: any = {};
    builder.from = () => builder;
    builder.where = () => builder;
    builder.limit = async () => result;
    return builder;
}

vi.mock('drizzle-orm', () => ({
    eq: vi.fn(() => ({ op: 'eq' })),
    sql: vi.fn(() => ({ op: 'sql' })),
}));

vi.mock('../db/client.js', () => ({
    db: {
        select: () => {
            model.selectCalls += 1;
            // Each job reads the session row first, then its artifact row.
            if (model.selectCalls % 2 === 1) {
                return selectBuilder([{
                    session: { id: 'session-1', projectId: 'project-1', startedAt: new Date('2026-11-27T12:00:00.000Z') },
                    replayState: {
                        isReplayExpired: false,
                        recordingDeleted: false,
                        replayAvailable: model.session.replayAvailable,
                        replayQuotaBillingExhausted: false,
                        replayRetentionState: model.session.replayRetentionState,
                        smartCaptureStatus: 'not_applicable',
                    },
                }]);
            }
            return selectBuilder([{ id: `artifact-${model.selectCalls / 2}`, status: 'uploaded', endpointId: null, uploadCompletedAt: null, verifiedAt: null }]);
        },
        transaction: async (run: any) => run({
            execute: async () => undefined,
            update: () => ({
                set: (values: any) => ({
                    where: async () => {
                        if (values.status === 'ready') model.session.readyScreenshots += 1;
                    },
                }),
            }),
        }),
    },
    recordingArtifacts: { id: 'recording_artifacts.id' },
    sessions: { id: 'sessions.id' },
}));

vi.mock('../db/s3.js', () => ({ downloadFromS3ForArtifact: vi.fn(async () => Buffer.from('x')) }));

vi.mock('../logger.js', () => {
    const log: any = { child: () => log, debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() };
    return { logger: log };
});

vi.mock('../services/artifactBullQueue.js', () => ({
    SESSION_EFFECTS_QUEUE_NAME: 'rj-session-effects',
    createArtifactBullWorker: vi.fn(),
    getSessionEffectsQueue: () => ({
        getJob: async (jobId: string) => model.queue.get(jobId) ?? null,
        add: async (_name: string, data: { sessionId: string }, options: { jobId: string; delay: number }) => {
            model.queue.set(options.jobId, { data, delay: options.delay });
        },
    }),
}));

vi.mock('../services/artifactCompletionEffects.js', () => ({
    runArtifactCompletionEffects: vi.fn(async (options: any) => {
        model.completionEffects.push(options);
    }),
}));

vi.mock('../services/hierarchyArtifactCompression.js', () => ({ ensureHierarchyArtifactCompressed: vi.fn() }));
vi.mock('../services/ingestEventArtifactProcessor.js', () => ({ summarizeEventsArtifact: vi.fn() }));
vi.mock('../services/ingestFaultArtifactProcessors.js', () => ({ processAnrsArtifact: vi.fn(), processCrashesArtifact: vi.fn() }));
vi.mock('../services/ingestReplayArtifactProcessor.js', () => ({ processRecoveredReplayArtifact: vi.fn(async () => undefined) }));
vi.mock('../services/screenshotFrames.js', () => ({
    normalizeScreenshotArchiveClockFieldsInStorage: vi.fn(async ({ data }: { data: Buffer }) => ({
        data,
        normalized: false,
        normalizedFrameNameCount: 0,
        uploadedSizeBytes: null,
    })),
}));
vi.mock('../services/artifactPayloadClockNormalization.js', () => ({ normalizeArtifactPayloadClockFieldsInStorage: vi.fn() }));
vi.mock('../services/sessionEventRollupQueue.js', () => ({ enqueueSessionEventRollupJob: vi.fn(async () => true) }));

vi.mock('../services/sessionReconciliation.js', () => ({
    reconcileSessionState: vi.fn(async (sessionId: string) => {
        model.reconcileCalls += 1;
        if (model.session.readyScreenshots > 0) {
            model.session.replayAvailable = true;
            model.session.replayRetentionState = 'saved';
            // Mirrors incrementProjectSessionReplayIfNeeded: the conditional
            // "replay_quota_counted_at IS NULL" update gates the usage increment.
            if (model.session.replayQuotaCountedAt === null) {
                model.session.replayQuotaCountedAt = new Date();
                model.quotaIncrements += 1;
            }
        }
        return {
            sessionId,
            replayAvailable: model.session.replayAvailable,
            replayRetentionState: model.session.replayRetentionState,
            finalized: false,
            status: 'processing',
        };
    }),
}));

import { processArtifactJobFromBullMQ } from '../services/artifactJobProcessor.js';
import { processSessionEffectsJobFromBullMQ } from '../services/sessionEffectsQueue.js';

let artifactSeq = 0;
async function processScreenshotArtifact() {
    artifactSeq += 1;
    await processArtifactJobFromBullMQ({
        attemptsMade: 0,
        id: `artifact-job-${artifactSeq}`,
        data: {
            artifactId: `artifact-${artifactSeq}`,
            endpointId: null,
            kind: 'screenshots',
            projectId: 'project-1',
            s3ObjectKey: `screens/${artifactSeq}.tar.gz`,
            sessionId: 'session-1',
        },
    } as any, { maxAttempts: 5, workerId: 'replay-worker-1' });
}

async function drainSessionEffectsQueue() {
    const jobs = [...model.queue.entries()];
    model.queue.clear();
    for (const [id, job] of jobs) {
        await processSessionEffectsJobFromBullMQ({ attemptsMade: 0, data: job.data, id } as any);
    }
    return jobs.length;
}

describe('replay reconcile debounce', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        // 12:00:01 sits just inside a 15 s bucket, so twelve artifacts 1 s apart share it.
        vi.setSystemTime(new Date('2026-11-27T12:00:01.000Z'));
        model.session = { replayAvailable: false, replayRetentionState: 'not_available', replayQuotaCountedAt: null, readyScreenshots: 0 };
        model.reconcileCalls = 0;
        model.quotaIncrements = 0;
        model.selectCalls = 0;
        model.queue.clear();
        model.completionEffects.length = 0;
        artifactSeq = 0;
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('reconciles an established replay session once for N artifacts in one bucket', async () => {
        model.session = {
            replayAvailable: true,
            replayRetentionState: 'saved',
            replayQuotaCountedAt: new Date('2026-11-27T11:59:00.000Z'),
            readyScreenshots: 3,
        };

        for (let index = 0; index < 12; index += 1) {
            await processScreenshotArtifact();
            vi.advanceTimersByTime(1_000);
        }

        // No reconcile ran in the replay worker; one delayed job is waiting.
        expect(model.reconcileCalls).toBe(0);
        expect(model.queue.size).toBe(1);
        expect([...model.queue.values()][0]).toEqual({ data: { sessionId: 'session-1' }, delay: 15_000 });
        // Every artifact still dropped the cached replay manifests immediately.
        expect(model.completionEffects).toHaveLength(12);
        expect(model.completionEffects.every((effect) => effect.kind === 'screenshots' && effect.replayAvailable)).toBe(true);

        expect(await drainSessionEffectsQueue()).toBe(1);

        expect(model.reconcileCalls).toBe(1);
        expect(model.quotaIncrements).toBe(0);
        expect(model.completionEffects.at(-1)).toEqual({ kind: 'events', replayAvailable: true, sessionId: 'session-1' });
    });

    it('counts replay quota exactly once for a new session: first artifact immediately, the rest coalesced', async () => {
        for (let index = 0; index < 12; index += 1) {
            await processScreenshotArtifact();
            vi.advanceTimersByTime(1_000);
        }

        // The first screenshot made replay available right away (no added delay)...
        expect(model.reconcileCalls).toBe(1);
        expect(model.quotaIncrements).toBe(1);
        expect(model.completionEffects[0]).toEqual({ kind: 'screenshots', replayAvailable: true, sessionId: 'session-1' });
        // ...and the other eleven share one queued reconcile.
        expect(model.queue.size).toBe(1);

        expect(await drainSessionEffectsQueue()).toBe(1);

        expect(model.reconcileCalls).toBe(2);
        expect(model.quotaIncrements).toBe(1);
    });

    it('schedules one further reconcile per later bucket while uploads continue', async () => {
        model.session = { replayAvailable: true, replayRetentionState: 'saved', replayQuotaCountedAt: new Date(), readyScreenshots: 1 };

        // 40 artifacts, one every 1.5 s = 60 s of uploads across four 15 s buckets.
        for (let index = 0; index < 40; index += 1) {
            await processScreenshotArtifact();
            vi.advanceTimersByTime(1_500);
        }

        expect(model.reconcileCalls).toBe(0);
        expect(model.queue.size).toBe(4);
        expect(await drainSessionEffectsQueue()).toBe(4);
        expect(model.reconcileCalls).toBe(4);
        expect(model.quotaIncrements).toBe(0);
    });
});
