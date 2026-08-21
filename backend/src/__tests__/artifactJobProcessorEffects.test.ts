import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    downloadFromS3ForArtifactMock,
    enqueueSessionEventRollupJobMock,
    enqueueSessionEffectsJobMock,
    executeMock,
    limitResults,
    processEventsArtifactMock,
    processRecoveredReplayArtifactMock,
    reconcileSessionStateMock,
    runArtifactCompletionEffectsMock,
    transactionMock,
    txUpdateSetMock,
    updateReturningRows,
} = vi.hoisted(() => {
    const txUpdateSetMock = vi.fn();
    return {
        downloadFromS3ForArtifactMock: vi.fn(async () => Buffer.from('{"events":[]}')),
        enqueueSessionEventRollupJobMock: vi.fn(async () => true),
        enqueueSessionEffectsJobMock: vi.fn(async () => true),
        executeMock: vi.fn(async () => undefined),
        limitResults: [] as any[][],
        processEventsArtifactMock: vi.fn(async () => undefined),
        processRecoveredReplayArtifactMock: vi.fn(async () => undefined),
        reconcileSessionStateMock: vi.fn(async () => ({
            finalized: false,
            replayAvailable: true,
            sessionId: 'session-1',
            status: 'processing',
        })),
        runArtifactCompletionEffectsMock: vi.fn(async () => undefined),
        transactionMock: vi.fn(async (fn: any) => fn({
            execute: vi.fn(async () => undefined),
            update: vi.fn(() => ({
                set: vi.fn((values: any) => {
                    txUpdateSetMock(values);
                    return { where: vi.fn(async () => undefined) };
                }),
            })),
        })),
        txUpdateSetMock,
        updateReturningRows: [] as any[][],
    };
});

const loggerMock = vi.hoisted(() => {
    const log: any = {
        child: vi.fn(() => log),
        debug: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
    };
    return log;
});

function selectBuilder(result: any[]) {
    const builder: any = {};
    builder.from = vi.fn(() => builder);
    builder.leftJoin = vi.fn(() => builder);
    builder.where = vi.fn(() => builder);
    builder.limit = vi.fn(async () => result);
    return builder;
}

vi.mock('drizzle-orm', () => ({
    eq: vi.fn(() => ({ op: 'eq' })),
    sql: vi.fn(() => ({ op: 'sql' })),
}));

vi.mock('../db/client.js', () => ({
    db: {
        execute: executeMock,
        select: vi.fn(() => selectBuilder(limitResults.shift() ?? [])),
        transaction: transactionMock,
        update: vi.fn(() => ({
            set: vi.fn(() => ({
                where: vi.fn(() => ({
                    returning: vi.fn(async () => updateReturningRows.shift() ?? []),
                })),
            })),
        })),
    },
    projects: { id: 'projects.id' },
    recordingArtifacts: {
        id: 'recording_artifacts.id',
        uploadCompletedAt: 'recording_artifacts.upload_completed_at',
    },
    sessionMetrics: { sessionId: 'session_metrics.session_id' },
    sessions: {
        id: 'sessions.id',
        projectId: 'sessions.project_id',
    },
}));

vi.mock('../db/s3.js', () => ({
    downloadFromS3ForArtifact: downloadFromS3ForArtifactMock,
}));

vi.mock('../logger.js', () => ({
    logger: loggerMock,
}));

vi.mock('../services/artifactCompletionEffects.js', () => ({
    runArtifactCompletionEffects: runArtifactCompletionEffectsMock,
}));

vi.mock('../services/hierarchyArtifactCompression.js', () => ({
    ensureHierarchyArtifactCompressed: vi.fn(async () => ({
        data: Buffer.from('{"root":{"type":"View"}}'),
        sizeBytes: 128,
    })),
}));

vi.mock('../services/ingestEventArtifactProcessor.js', () => ({
    processEventsArtifact: processEventsArtifactMock,
    summarizeEventsArtifact: vi.fn((data: Buffer) => ({
        endTime: null,
        eventCount: 0,
        sizeBytes: data.length,
        startTime: null,
    })),
}));

vi.mock('../services/ingestFaultArtifactProcessors.js', () => ({
    processAnrsArtifact: vi.fn(async () => undefined),
    processCrashesArtifact: vi.fn(async () => undefined),
}));

vi.mock('../services/ingestReplayArtifactProcessor.js', () => ({
    processRecoveredReplayArtifact: processRecoveredReplayArtifactMock,
}));

vi.mock('../services/sessionEventRollupQueue.js', () => ({
    enqueueSessionEventRollupJob: enqueueSessionEventRollupJobMock,
}));

vi.mock('../services/sessionEffectsQueue.js', () => ({
    enqueueSessionEffectsJob: enqueueSessionEffectsJobMock,
}));

vi.mock('../services/sessionReconciliation.js', () => ({
    reconcileSessionState: reconcileSessionStateMock,
}));

import { markArtifactFailedAfterExhausted, processArtifactJobFromBullMQ } from '../services/artifactJobProcessor.js';

const sessionResult = {
    metrics: { sessionId: 'session-1' },
    project: { id: 'project-1' },
    session: {
        id: 'session-1',
        projectId: 'project-1',
        startedAt: new Date('2026-06-02T00:00:00.000Z'),
    },
};

function makeJob(kind: string) {
    return {
        attemptsMade: 0,
        data: {
            artifactId: 'artifact-1',
            endpointId: null,
            kind,
            projectId: 'project-1',
            s3ObjectKey: 'artifact.json.gz',
            sessionId: 'session-1',
        },
        id: `artifact-artifact-1`,
    };
}

describe('processArtifactJobFromBullMQ completion effects', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        limitResults.length = 0;
        updateReturningRows.length = 0;
        limitResults.push([sessionResult]);
        limitResults.push([{
            endpointId: null,
            frameCount: null,
            id: 'artifact-1',
            status: 'uploaded',
            uploadCompletedAt: null,
            verifiedAt: null,
        }]);
    });

    it('defers event metrics rollup for event artifacts after marking them ready', async () => {
        await processArtifactJobFromBullMQ(makeJob('events') as any, {
            maxAttempts: 5,
            workerId: 'worker-1',
        });

        expect(processEventsArtifactMock).not.toHaveBeenCalled();
        expect(txUpdateSetMock).toHaveBeenCalledWith(expect.objectContaining({
            eventRollupRequestedAt: expect.any(Date),
            sizeBytes: expect.any(Number),
            status: 'ready',
        }));
        expect(enqueueSessionEventRollupJobMock).toHaveBeenCalledWith('session-1');
        expect(enqueueSessionEffectsJobMock).not.toHaveBeenCalled();
        expect(reconcileSessionStateMock).not.toHaveBeenCalled();
        expect(runArtifactCompletionEffectsMock).not.toHaveBeenCalled();
    });

    it('keeps replay artifacts on the immediate reconcile path', async () => {
        await processArtifactJobFromBullMQ(makeJob('screenshots') as any, {
            maxAttempts: 5,
            workerId: 'worker-1',
        });

        expect(processRecoveredReplayArtifactMock).toHaveBeenCalledTimes(1);
        expect(enqueueSessionEffectsJobMock).not.toHaveBeenCalled();
        expect(reconcileSessionStateMock).toHaveBeenCalledWith('session-1');
        expect(runArtifactCompletionEffectsMock).toHaveBeenCalledWith({
            kind: 'screenshots',
            replayAvailable: true,
            sessionId: 'session-1',
        });
    });

    it('does not let an exhausted retry overwrite an artifact that already became ready', async () => {
        updateReturningRows.push([]);

        await markArtifactFailedAfterExhausted('artifact-1', 'late quota failure');

        expect(reconcileSessionStateMock).not.toHaveBeenCalled();
        expect(loggerMock.warn).toHaveBeenCalledWith(
            expect.objectContaining({
                artifactId: 'artifact-1',
                event: 'artifact.exhausted_ignored',
            }),
            'artifact.exhausted_ignored',
        );
    });

    it('still reconciles replay sessions when a non-ready artifact exhausts retries', async () => {
        updateReturningRows.push([{ kind: 'screenshots', sessionId: 'session-1' }]);

        await markArtifactFailedAfterExhausted('artifact-1', 'decoder failure');

        expect(reconcileSessionStateMock).toHaveBeenCalledWith('session-1');
        expect(loggerMock.warn).toHaveBeenCalledWith(
            expect.objectContaining({
                artifactId: 'artifact-1',
                event: 'artifact.exhausted',
                kind: 'screenshots',
                sessionId: 'session-1',
            }),
            'artifact.exhausted',
        );
    });
});
