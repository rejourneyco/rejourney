import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    addMock,
    closeMock,
    createArtifactBullWorkerMock,
    delMock,
    downloadFromS3ForArtifactMock,
    enqueueSessionEffectsJobMock,
    evalMock,
    existsMock,
    getJobMock,
    insertValuesMock,
    processEventsArtifactMock,
    selectProjectionArgs,
    selectResults,
    setMock,
    updateSetMock,
} = vi.hoisted(() => ({
    addMock: vi.fn(async () => undefined),
    closeMock: vi.fn(async () => undefined),
    createArtifactBullWorkerMock: vi.fn(() => ({ close: closeMock })),
    delMock: vi.fn(async () => 1),
    downloadFromS3ForArtifactMock: vi.fn(async () => Buffer.from('{"events":[]}')),
    enqueueSessionEffectsJobMock: vi.fn(async () => true),
    evalMock: vi.fn(async () => 1),
    existsMock: vi.fn(async () => 0),
    getJobMock: vi.fn(async (): Promise<any> => null),
    insertValuesMock: vi.fn(() => ({ onConflictDoNothing: vi.fn(async () => undefined) })),
    processEventsArtifactMock: vi.fn(async () => undefined),
    selectProjectionArgs: [] as any[],
    selectResults: [] as any[][],
    setMock: vi.fn(async () => 'OK'),
    updateSetMock: vi.fn(() => ({ where: vi.fn(async () => undefined) })),
}));

function selectBuilder(result: any[]) {
    const builder: any = {};
    builder.from = vi.fn(() => builder);
    builder.leftJoin = vi.fn(() => builder);
    builder.where = vi.fn(() => builder);
    builder.orderBy = vi.fn(() => builder);
    builder.groupBy = vi.fn(() => builder);
    builder.limit = vi.fn(async () => result);
    return builder;
}

vi.mock('drizzle-orm', () => ({
    and: vi.fn((...args) => ({ args, op: 'and' })),
    eq: vi.fn((...args) => ({ args, op: 'eq' })),
    isNotNull: vi.fn((arg) => ({ arg, op: 'isNotNull' })),
    isNull: vi.fn((arg) => ({ arg, op: 'isNull' })),
}));

vi.mock('../db/client.js', () => ({
    db: {
        insert: vi.fn(() => ({ values: insertValuesMock })),
        select: vi.fn((projection) => {
            selectProjectionArgs.push(projection);
            return selectBuilder(selectResults.shift() ?? []);
        }),
        update: vi.fn(() => ({ set: updateSetMock })),
    },
    recordingArtifacts: {
        createdAt: 'recording_artifacts.created_at',
        endpointId: 'recording_artifacts.endpoint_id',
        eventRollupProcessedAt: 'recording_artifacts.event_rollup_processed_at',
        eventRollupRequestedAt: 'recording_artifacts.event_rollup_requested_at',
        id: 'recording_artifacts.id',
        kind: 'recording_artifacts.kind',
        s3ObjectKey: 'recording_artifacts.s3_object_key',
        sessionId: 'recording_artifacts.session_id',
        status: 'recording_artifacts.status',
    },
    sessionMetrics: {
        sessionId: 'session_metrics.session_id',
    },
    sessions: {
        anonymousHash: 'sessions.anonymous_hash',
        appVersion: 'sessions.app_version',
        deviceId: 'sessions.device_id',
        deviceModel: 'sessions.device_model',
        events: 'sessions.events',
        id: 'sessions.id',
        osVersion: 'sessions.os_version',
        platform: 'sessions.platform',
        projectId: 'sessions.project_id',
        sdkVersion: 'sessions.sdk_version',
        startedAt: 'sessions.started_at',
        userDisplayId: 'sessions.user_display_id',
    },
}));

vi.mock('../db/redis.js', () => ({
    getRedis: () => ({
        del: delMock,
        eval: evalMock,
        exists: existsMock,
        set: setMock,
    }),
}));

vi.mock('../db/s3.js', () => ({
    downloadFromS3ForArtifact: downloadFromS3ForArtifactMock,
}));

vi.mock('../logger.js', () => {
    const log: any = {
        child: vi.fn(() => log),
        debug: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
    };
    return { logger: log };
});

vi.mock('../services/artifactBullQueue.js', () => ({
    SESSION_EVENT_ROLLUP_QUEUE_NAME: 'rj-session-event-rollup',
    createArtifactBullWorker: createArtifactBullWorkerMock,
    getSessionEventRollupQueue: () => ({
        add: addMock,
        getJob: getJobMock,
    }),
}));

vi.mock('../services/ingestEventArtifactProcessor.js', () => ({
    processEventsArtifact: processEventsArtifactMock,
}));

vi.mock('../services/sessionEffectsQueue.js', () => ({
    enqueueSessionEffectsJob: enqueueSessionEffectsJobMock,
}));

import {
    buildSessionEventRollupJobId,
    enqueueSessionEventRollupJob,
    processSessionEventRollupBatch,
    processSessionEventRollupJobFromBullMQ,
    queuePendingSessionEventRollups,
    resolveSessionEventRollupBatchSize,
    resolveSessionEventRollupConcurrency,
    resolveSessionEventRollupDelayMs,
    shouldSweepPendingSessionEventRollups,
    startSessionEventRollupWorker,
} from '../services/sessionEventRollupQueue.js';

describe('sessionEventRollupQueue', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        delete process.env.RJ_SESSION_EVENT_ROLLUP_BATCH_SIZE;
        delete process.env.RJ_SESSION_EVENT_ROLLUP_CONCURRENCY;
        delete process.env.RJ_SESSION_EVENT_ROLLUP_DELAY_MS;
        delete process.env.RJ_SESSION_EVENT_ROLLUP_SWEEP_ENABLED;
        selectResults.length = 0;
        selectProjectionArgs.length = 0;
        getJobMock.mockResolvedValue(null);
        existsMock.mockResolvedValue(0);
        setMock.mockResolvedValue('OK');
    });

    it('builds one coalesced job id per session', () => {
        expect(buildSessionEventRollupJobId('session-1', 100_000, 2_000))
            .toBe('session-event-rollup-session-1');
        expect(buildSessionEventRollupJobId('session-1', 102_000, 2_000))
            .toBe('session-event-rollup-session-1');
    });

    it('bounds env values', () => {
        expect(resolveSessionEventRollupDelayMs('50')).toBe(500);
        expect(resolveSessionEventRollupDelayMs('120000')).toBe(60000);
        expect(resolveSessionEventRollupDelayMs('bad')).toBe(60000);
        expect(resolveSessionEventRollupConcurrency('0')).toBe(1);
        expect(resolveSessionEventRollupConcurrency('128')).toBe(64);
        expect(resolveSessionEventRollupConcurrency('bad')).toBe(48);
        expect(resolveSessionEventRollupBatchSize('0')).toBe(1);
        expect(resolveSessionEventRollupBatchSize('1000')).toBe(250);
        expect(resolveSessionEventRollupBatchSize('bad')).toBe(250);
        expect(shouldSweepPendingSessionEventRollups()).toBe(false);
        expect(shouldSweepPendingSessionEventRollups('true')).toBe(true);
        expect(shouldSweepPendingSessionEventRollups('1')).toBe(true);
        expect(shouldSweepPendingSessionEventRollups('off')).toBe(false);
    });

    it('enqueues a delayed session event rollup job', async () => {
        const queued = await enqueueSessionEventRollupJob('session-1', {
            delayMs: 2_000,
            nowMs: 100_000,
        });

        expect(queued).toBe(true);
        expect(addMock).toHaveBeenCalledWith(
            'session-event-rollup',
            { sessionId: 'session-1' },
            {
                delay: 2_000,
                jobId: 'session-event-rollup-session-1',
            },
        );
    });

    it('marks a dirty flag but skips enqueue when a live session job exists', async () => {
        getJobMock.mockResolvedValue({
            getState: vi.fn(async () => 'waiting'),
            remove: vi.fn(async () => undefined),
        });

        const queued = await enqueueSessionEventRollupJob('session-1');

        expect(queued).toBe(false);
        expect(setMock).toHaveBeenCalledWith(
            'dirty:session-event-rollup:session-1',
            '1',
            'PX',
            expect.any(Number),
        );
        expect(addMock).not.toHaveBeenCalled();
    });

    it('processes a bounded batch and marks artifacts rolled up after event processing', async () => {
        selectResults.push([
            { endpointId: 'endpoint-1', id: 'artifact-1', s3ObjectKey: 'artifact-1.json.gz' },
            { endpointId: 'endpoint-1', id: 'artifact-2', s3ObjectKey: 'artifact-2.json.gz' },
        ]);
        selectResults.push([{
            metrics: { sessionId: 'session-1', eventsSizeBytes: 0 },
            session: { id: 'session-1', projectId: 'project-1' },
        }]);

        const result = await processSessionEventRollupBatch('session-1', 1);

        expect(result).toEqual({ hasMore: true, processed: 1 });
        expect(downloadFromS3ForArtifactMock).toHaveBeenCalledWith(
            'project-1',
            'artifact-1.json.gz',
            'endpoint-1',
        );
        expect(processEventsArtifactMock).toHaveBeenCalledWith(
            expect.objectContaining({ artifactId: 'artifact-1', kind: 'events', sessionId: 'session-1' }),
            expect.objectContaining({ id: 'session-1' }),
            expect.objectContaining({ sessionId: 'session-1' }),
            'project-1',
            expect.any(Buffer),
            expect.any(Object),
            { recomputeMobileFrustrationCounts: false },
        );
        expect(updateSetMock).toHaveBeenCalledWith({
            eventRollupProcessedAt: expect.any(Date),
        });
    });

    it('creates session metrics once while refreshing mutable context for every artifact', async () => {
        selectResults.push([
            { endpointId: 'endpoint-1', id: 'artifact-1', s3ObjectKey: 'artifact-1.json.gz' },
            { endpointId: 'endpoint-1', id: 'artifact-2', s3ObjectKey: 'artifact-2.json.gz' },
        ]);
        selectResults.push([{
            metrics: { sessionId: 'session-1', eventsSizeBytes: 0 },
            session: { id: 'session-1', projectId: 'project-1', userDisplayId: null },
        }]);
        selectResults.push([{
            metrics: { sessionId: 'session-1', eventsSizeBytes: 10 },
            session: { id: 'session-1', projectId: 'project-1', userDisplayId: 'user-1' },
        }]);

        const result = await processSessionEventRollupBatch('session-1', 2);

        expect(result).toEqual({ hasMore: false, processed: 2 });
        expect(insertValuesMock).toHaveBeenCalledTimes(1);
        expect(processEventsArtifactMock).toHaveBeenCalledTimes(2);
        const processCalls = processEventsArtifactMock.mock.calls as unknown as any[][];
        expect(processCalls[1]?.[1]).toEqual(
            expect.objectContaining({ userDisplayId: 'user-1' }),
        );
        expect(selectProjectionArgs[1]?.session).not.toHaveProperty('events');
        expect(selectProjectionArgs[1]?.session).toEqual(expect.objectContaining({
            id: 'sessions.id',
            projectId: 'sessions.project_id',
            startedAt: 'sessions.started_at',
        }));
    });

    it('leaves the broad pending rollup sweep disabled unless explicitly enabled', async () => {
        selectResults.push([{ sessionId: 'session-1' }]);
        expect(await queuePendingSessionEventRollups(100)).toBe(0);
        expect(addMock).not.toHaveBeenCalled();

        process.env.RJ_SESSION_EVENT_ROLLUP_SWEEP_ENABLED = 'true';
        expect(await queuePendingSessionEventRollups(100)).toBe(1);
        expect(addMock).toHaveBeenCalledWith(
            'session-event-rollup',
            { sessionId: 'session-1' },
            expect.objectContaining({ delay: 60_000 }),
        );
    });

    it('requeues and sends session effects from the worker processor', async () => {
        process.env.RJ_SESSION_EVENT_ROLLUP_BATCH_SIZE = '1';
        selectResults.push([
            { endpointId: null, id: 'artifact-1', s3ObjectKey: 'artifact-1.json.gz' },
            { endpointId: null, id: 'artifact-2', s3ObjectKey: 'artifact-2.json.gz' },
        ]);
        selectResults.push([{
            metrics: { sessionId: 'session-1', eventsSizeBytes: 0 },
            session: { id: 'session-1', projectId: 'project-1' },
        }]);

        await processSessionEventRollupJobFromBullMQ({
            attemptsMade: 0,
            data: { sessionId: 'session-1' },
            id: 'job-1',
        } as any);

        expect(setMock).toHaveBeenCalled();
        expect(enqueueSessionEffectsJobMock).toHaveBeenCalledWith('session-1');
        expect(addMock).toHaveBeenCalledWith(
            'session-event-rollup',
            { sessionId: 'session-1' },
            expect.objectContaining({ delay: 1_000 }),
        );
        expect(evalMock).toHaveBeenCalled();
    });

    it('starts a BullMQ worker with configured concurrency', () => {
        const worker = startSessionEventRollupWorker();

        expect(createArtifactBullWorkerMock).toHaveBeenCalledWith(
            'rj-session-event-rollup',
            processSessionEventRollupJobFromBullMQ,
            48,
        );
        expect(worker.close).toBe(closeMock);
    });
});
