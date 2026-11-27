import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    and: vi.fn((...conditions: unknown[]) => ({ and: conditions })),
    eq: vi.fn((left, right) => ({ left, right })),
    exists: vi.fn((query) => ({ exists: query })),
    inArray: vi.fn((column, values) => ({ column, values })),
    sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => strings.reduce(
        (acc, chunk, index) => acc + chunk + (index < values.length ? String(values[index]) : ''),
        '',
    )),
    db: {
        select: vi.fn(),
        execute: vi.fn(),
        transaction: vi.fn(),
    },
    recordingArtifacts: {
        id: 'recording_artifacts.id',
        sessionId: 'recording_artifacts.session_id',
        kind: 'recording_artifacts.kind',
        s3ObjectKey: 'recording_artifacts.s3_object_key',
        endpointId: 'recording_artifacts.endpoint_id',
        sizeBytes: 'recording_artifacts.size_bytes',
        declaredSizeBytes: 'recording_artifacts.declared_size_bytes',
        toString: () => 'recording_artifacts',
    } as any,
    sessionMetrics: { sessionId: 'session_metrics.session_id' } as any,
    sessions: { id: 'sessions.id' } as any,
    projects: { id: 'projects.id' } as any,
    mockRedis: {
        del: vi.fn(),
        scan: vi.fn(),
    },
    resolveRetentionDeletionEndpoints: vi.fn(),
    deletePrefixFromStorageEndpoints: vi.fn(),
    deleteObjectsFromStorageEndpoints: vi.fn(),
    classifyS3DeletionError: vi.fn(() => 'unexpected'),
    beginRetentionDeletionLog: vi.fn(),
    finalizeRetentionDeletionLog: vi.fn(),
    logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    },
}));

vi.mock('drizzle-orm', () => ({
    and: mocks.and,
    eq: mocks.eq,
    exists: mocks.exists,
    inArray: mocks.inArray,
    sql: mocks.sql,
}));

let tx: any;

vi.mock('../db/client.js', () => ({
    db: mocks.db,
    recordingArtifacts: mocks.recordingArtifacts,
    sessionMetrics: mocks.sessionMetrics,
    sessions: mocks.sessions,
    projects: mocks.projects,
}));

vi.mock('../db/redis.js', () => ({
    getRedis: () => mocks.mockRedis,
    invalidateSessionEndpointCache: vi.fn(async () => undefined),
    invalidateSessionExistsCache: vi.fn(async () => undefined),
}));

vi.mock('../db/s3.js', () => ({
    resolveRetentionDeletionEndpoints: mocks.resolveRetentionDeletionEndpoints,
    deletePrefixFromStorageEndpoints: mocks.deletePrefixFromStorageEndpoints,
    deleteObjectsFromStorageEndpoints: mocks.deleteObjectsFromStorageEndpoints,
    classifyS3DeletionError: mocks.classifyS3DeletionError,
}));

vi.mock('../services/retentionAudit.js', () => ({
    beginRetentionDeletionLog: mocks.beginRetentionDeletionLog,
    finalizeRetentionDeletionLog: mocks.finalizeRetentionDeletionLog,
}));

vi.mock('../logger.js', () => ({
    logger: mocks.logger,
}));

vi.mock('../config.js', () => ({
    config: {
        RETENTION_FAIL_ON_MISSING_STORAGE: false,
    },
}));

import { purgeSessionArtifacts } from '../services/sessionArtifactPurge.js';

function createSessionSelectResult(sessionResult: any) {
    return {
        from: vi.fn(() => ({
            innerJoin: vi.fn(() => ({
                where: vi.fn(() => ({
                    limit: vi.fn(async () => [sessionResult]),
                })),
            })),
        })),
    };
}

const CANONICAL_PREFIX = 'tenant/team_1/project/project_1/sessions/session_1/';

type ArtifactFixture = {
    id: string;
    kind: string;
    s3ObjectKey: string;
    endpointId: string | null;
    sizeBytes: number | null;
    declaredSizeBytes: number | null;
};

/**
 * The aggregate the purge reads instead of the artifact rows: one row holding
 * the count, the byte total, the distinct endpoint ids and how many keys sit
 * outside the canonical prefix. Numbers are strings because that is how
 * node-postgres returns bigint.
 */
function createArtifactTotalsSelectResult(artifacts: ArtifactFixture[]) {
    const endpointIds = Array.from(new Set(artifacts.map((artifact) => artifact.endpointId)));
    return {
        from: vi.fn(() => ({
            where: vi.fn(async () => [{
                artifactCount: String(artifacts.length),
                artifactBytes: String(artifacts.reduce(
                    (total, artifact) => total + (artifact.sizeBytes ?? artifact.declaredSizeBytes ?? 0),
                    0,
                )),
                endpointIds: artifacts.length > 0 ? endpointIds : null,
                misplacedArtifactCount: String(artifacts
                    .filter((artifact) => !artifact.s3ObjectKey.startsWith(CANONICAL_PREFIX)).length),
            }]),
        })),
    };
}

/** The bounded read of misplaced artifacts; only issued when the aggregate counted some. */
function createInvalidArtifactSelectResult(artifacts: ArtifactFixture[]) {
    return {
        from: vi.fn(() => ({
            where: vi.fn(() => ({
                limit: vi.fn(async (limit: number) => artifacts
                    .filter((artifact) => !artifact.s3ObjectKey.startsWith(CANONICAL_PREFIX))
                    .slice(0, limit)
                    .map((artifact) => ({
                        artifactId: artifact.id,
                        kind: artifact.kind,
                        s3ObjectKey: artifact.s3ObjectKey,
                        endpointId: artifact.endpointId,
                    }))),
            })),
        })),
    };
}

function mockArtifactQueries(sessionResult: any, artifacts: ArtifactFixture[]) {
    mocks.db.select
        .mockReset()
        .mockImplementationOnce(() => createSessionSelectResult(sessionResult))
        .mockImplementationOnce(() => createArtifactTotalsSelectResult(artifacts))
        .mockImplementationOnce(() => createInvalidArtifactSelectResult(artifacts));

    // Batched row delete: each statement removes at most its LIMIT and reports
    // how many rows went, never the rows themselves.
    let remainingRows = artifacts.length;
    mocks.db.execute.mockReset().mockImplementation(async (statement: unknown) => {
        const text = String(statement);
        const limit = Number(/LIMIT (\d+)/.exec(text)?.[1]);
        if (!text.includes('DELETE FROM recording_artifacts') || !Number.isInteger(limit)) {
            throw new Error(`Unexpected statement: ${text}`);
        }
        const deleted = Math.min(remainingRows, limit);
        remainingRows -= deleted;
        return { rows: [{ deleted }] };
    });
}

describe('sessionArtifactPurge', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.beginRetentionDeletionLog.mockReset();
        mocks.finalizeRetentionDeletionLog.mockReset();

        const sessionResult = {
            sessionId: 'session_1',
            projectId: 'project_1',
            teamId: 'team_1',
            retentionTier: 2,
            retentionDays: 30,
            recordingDeleted: false,
            isReplayExpired: false,
        };

        const artifacts = [
            {
                id: 'artifact_1',
                kind: 'events',
                s3ObjectKey: 'tenant/team_1/project/project_1/sessions/session_1/events/events_1.json.gz',
                endpointId: 'endpoint_1',
                sizeBytes: 125,
                declaredSizeBytes: null,
            },
            {
                id: 'artifact_2',
                kind: 'screenshots',
                s3ObjectKey: 'tenant/team_1/project/project_1/sessions/session_1/screenshots/shot_1.tar.gz',
                endpointId: null,
                sizeBytes: 300,
                declaredSizeBytes: 280,
            },
            {
                id: 'artifact_3',
                kind: 'hierarchy',
                s3ObjectKey: 'tenant/team_1/project/project_1/sessions/session_1/hierarchy/1000.json.gz',
                endpointId: 'endpoint_2',
                sizeBytes: 80,
                declaredSizeBytes: null,
            },
        ];

        mockArtifactQueries(sessionResult, artifacts);

        mocks.db.transaction.mockImplementation(async (callback: (client: any) => Promise<void>) => callback(tx));

        let metricsSetPayload: any = null;
        let sessionsSetPayload: any = null;
        const executedStatements: unknown[] = [];

        tx = {
            // Artifact rows are no longer deleted inside the flag transaction.
            delete: vi.fn(() => {
                throw new Error('Unexpected delete inside the flag transaction');
            }),
            update: vi.fn((table: unknown) => {
                if (table === mocks.sessionMetrics) {
                    return {
                        set: vi.fn((payload) => {
                            metricsSetPayload = payload;
                            return { where: vi.fn(async () => undefined) };
                        }),
                    };
                }

                if (table === mocks.sessions) {
                    return {
                        set: vi.fn((payload) => {
                            sessionsSetPayload = payload;
                            return { where: vi.fn(async () => undefined) };
                        }),
                    };
                }

                throw new Error('Unexpected update table');
            }),
            execute: vi.fn(async (statement: unknown) => {
                executedStatements.push(statement);
                return undefined;
            }),
            get metricsSetPayload() {
                return metricsSetPayload;
            },
            get sessionsSetPayload() {
                return sessionsSetPayload;
            },
            get executedStatements() {
                return executedStatements;
            },
        };

        mocks.mockRedis.del.mockResolvedValue(1);
        mocks.mockRedis.scan.mockResolvedValueOnce([
            '0',
            [
                'screenshot_frame_data:session_1:100',
                'screenshot_frame_data:session_1:200',
            ],
        ]);

        mocks.beginRetentionDeletionLog.mockResolvedValueOnce('canonical_log');
        mocks.finalizeRetentionDeletionLog.mockResolvedValue(undefined);

        const deletionEndpoints = [
            { id: 'endpoint_1' },
            { id: 'endpoint_2' },
        ];
        mocks.resolveRetentionDeletionEndpoints.mockResolvedValue(deletionEndpoints);
        mocks.deletePrefixFromStorageEndpoints.mockImplementation(async (
            prefix: string,
        ) => prefix === 'sessions/session_1/'
            ? {
                prefix,
                deletedObjectCount: 2,
                deletedBytes: 240,
                endpointResults: [
                    {
                        endpointId: 'endpoint_1',
                        endpointUrl: 'https://storage-1.local',
                        projectId: 'project_1',
                        shadow: false,
                        active: true,
                        deletedObjectCount: 2,
                        deletedBytes: 240,
                    },
                ],
            }
            : {
                prefix,
                deletedObjectCount: 3,
                deletedBytes: 900,
                endpointResults: [
                    {
                        endpointId: 'endpoint_1',
                        endpointUrl: 'https://storage-1.local',
                        projectId: 'project_1',
                        shadow: false,
                        active: true,
                        deletedObjectCount: 3,
                        deletedBytes: 900,
                    },
                ],
            });

        mocks.deleteObjectsFromStorageEndpoints.mockResolvedValue({
            deletedObjectCount: 0,
            deletedBytes: 0,
            endpointResults: [],
        });
    });

    it('purges canonical and derived storage and deletes narrow DB rows', async () => {
        const now = new Date('2026-03-27T12:00:00.000Z');

        const result = await purgeSessionArtifacts('session_1', {
            runId: 'run_1',
            trigger: 'retention_expiry',
            now,
        });

        expect(result).toMatchObject({
            sessionId: 'session_1',
            projectId: 'project_1',
            teamId: 'team_1',
            deletedArtifactCount: 3,
            deletedObjectCount: 5,
            deletedBytes: 1140,
            plannedArtifactCount: 3,
            plannedArtifactBytes: 505,
            storageMissing: false,
        });

        // Session row plus one aggregate; with no misplaced keys there is no
        // second pass over the session's artifacts.
        expect(mocks.db.select).toHaveBeenCalledTimes(2);
        // One batch removes the three rows, the next finds none and ends the loop.
        expect(mocks.db.execute).toHaveBeenCalledTimes(2);
        expect(String(mocks.db.execute.mock.calls[0][0])).toContain('LIMIT 5000');
        expect(String(mocks.db.execute.mock.calls[0][0])).toContain('recording_artifacts.session_id = session_1');
        expect(tx.delete).not.toHaveBeenCalled();
        // Storage first, then rows, then the session flags.
        const lastStorageCall = Math.max(...mocks.deletePrefixFromStorageEndpoints.mock.invocationCallOrder);
        const rowDeleteCalls = mocks.db.execute.mock.invocationCallOrder;
        const flagTransactionCall = mocks.db.transaction.mock.invocationCallOrder[0];
        expect(lastStorageCall).toBeLessThan(Math.min(...rowDeleteCalls));
        expect(Math.max(...rowDeleteCalls)).toBeLessThan(flagTransactionCall);

        expect(mocks.resolveRetentionDeletionEndpoints).toHaveBeenCalledTimes(1);
        expect(mocks.resolveRetentionDeletionEndpoints).toHaveBeenCalledWith(
            'project_1',
            ['endpoint_1', null, 'endpoint_2'],
        );
        expect(mocks.deletePrefixFromStorageEndpoints).toHaveBeenCalledWith(
            'tenant/team_1/project/project_1/sessions/session_1/',
            expect.arrayContaining([
                expect.objectContaining({ id: 'endpoint_1' }),
                expect.objectContaining({ id: 'endpoint_2' }),
            ]),
        );
        expect(mocks.deletePrefixFromStorageEndpoints).toHaveBeenCalledWith(
            'sessions/session_1/',
            expect.arrayContaining([
                expect.objectContaining({ id: 'endpoint_1' }),
                expect.objectContaining({ id: 'endpoint_2' }),
            ]),
        );

        expect(tx.metricsSetPayload).toMatchObject({
            screenshotSegmentCount: 0,
            screenshotTotalBytes: 0,
            hierarchySnapshotCount: 0,
        });
        expect(tx.sessionsSetPayload).toMatchObject({
            recordingDeleted: true,
            recordingDeletedAt: now,
            isReplayExpired: true,
            replayAvailable: false,
            replayRetentionState: 'not_available',
            replaySegmentCount: 0,
            replayStorageBytes: 0,
            updatedAt: now,
        });
        expect(mocks.mockRedis.del).toHaveBeenCalledWith(
            'session_core:session_1',
            'session_timeline:session_1',
            'session_hierarchy:session_1',
            'screenshot_frames:session_1',
            'screenshot_frames:v2:session_1',
        );
        expect(mocks.mockRedis.scan).not.toHaveBeenCalled();

        expect(mocks.beginRetentionDeletionLog).toHaveBeenCalledTimes(1);
        expect(mocks.beginRetentionDeletionLog).toHaveBeenCalledWith(expect.objectContaining({
            scope: 'session_purge',
            sessionId: 'session_1',
            storagePrefix: CANONICAL_PREFIX,
            plannedArtifactRowCount: 3,
            plannedArtifactBytes: 505,
        }));
        expect(mocks.finalizeRetentionDeletionLog).toHaveBeenCalledWith(
            'canonical_log',
            expect.objectContaining({
                status: 'completed',
                deletedArtifactRowCount: 3,
                deletedIngestJobCount: 0,
                deletedObjectCount: 5,
                deletedBytes: 1140,
                details: expect.objectContaining({
                    invalidArtifacts: [],
                    invalidArtifactsTruncated: false,
                    derivedStoragePrefix: 'sessions/session_1/',
                    derivedDeletedObjectCount: 2,
                    derivedDeletedBytes: 240,
                }),
            }),
        );
    });


    it('treats already-missing canonical storage as completed cleanup by default', async () => {
        mocks.deletePrefixFromStorageEndpoints.mockResolvedValueOnce({
            prefix: 'tenant/team_1/project/project_1/sessions/session_1/',
            deletedObjectCount: 0,
            deletedBytes: 0,
            endpointResults: [],
        });

        const result = await purgeSessionArtifacts('session_1', {
            runId: 'run_2',
            trigger: 'retention_expiry',
        });

        expect(result.storageMissing).toBe(true);
        expect(result.deletedArtifactCount).toBe(3);
        expect(mocks.db.execute).toHaveBeenCalledTimes(2);
        expect(mocks.db.transaction).toHaveBeenCalledTimes(1);
        expect(mocks.finalizeRetentionDeletionLog).toHaveBeenCalledWith(
            'canonical_log',
            expect.objectContaining({
                status: 'completed',
                storageMissing: true,
            }),
        );
    });

    it('can still fail closed on missing storage when explicitly requested', async () => {
        mocks.deletePrefixFromStorageEndpoints.mockResolvedValueOnce({
            prefix: 'tenant/team_1/project/project_1/sessions/session_1/',
            deletedObjectCount: 0,
            deletedBytes: 0,
            endpointResults: [],
        });

        await expect(purgeSessionArtifacts('session_1', {
            runId: 'run_2b',
            trigger: 'retention_expiry',
            failOnMissingStorage: true,
        })).rejects.toThrow('Canonical storage missing for session session_1');

        // Failing closed leaves the rows and the session flags untouched.
        expect(mocks.db.execute).not.toHaveBeenCalled();
        expect(mocks.db.transaction).not.toHaveBeenCalled();
        expect(mocks.finalizeRetentionDeletionLog).toHaveBeenCalledWith(
            'canonical_log',
            expect.objectContaining({
                status: 'failed',
                storageMissing: true,
            }),
        );
    });

    it('allows repair mode to clean leftover rows even if storage is already gone', async () => {
        mocks.deletePrefixFromStorageEndpoints.mockResolvedValueOnce({
            prefix: 'tenant/team_1/project/project_1/sessions/session_1/',
            deletedObjectCount: 0,
            deletedBytes: 0,
            endpointResults: [],
        });

        const result = await purgeSessionArtifacts('session_1', {
            runId: 'run_3',
            trigger: 'retention_repair',
            allowMissingStorage: true,
        });

        expect(result.storageMissing).toBe(true);
        expect(result.deletedArtifactCount).toBe(3);
        expect(mocks.db.execute).toHaveBeenCalledTimes(2);
        expect(mocks.db.transaction).toHaveBeenCalledTimes(1);
        expect(mocks.finalizeRetentionDeletionLog).toHaveBeenCalledWith(
            'canonical_log',
            expect.objectContaining({
                status: 'completed',
                storageMissing: true,
            }),
        );
    });

    it('deletes non-canonical artifact keys explicitly instead of failing forever', async () => {
        const nonCanonicalArtifact = {
            id: 'artifact_rogue',
            kind: 'events',
            s3ObjectKey: 'tenant/team_1/project/project_1/misplaced/session_1/events.json.gz',
            endpointId: 'endpoint_9',
            sizeBytes: 55,
            declaredSizeBytes: null,
        };

        mockArtifactQueries({
            sessionId: 'session_1',
            projectId: 'project_1',
            teamId: 'team_1',
            retentionTier: 2,
            retentionDays: 30,
            recordingDeleted: false,
            isReplayExpired: false,
        }, [nonCanonicalArtifact]);

        mocks.deletePrefixFromStorageEndpoints.mockResolvedValueOnce({
            prefix: 'tenant/team_1/project/project_1/sessions/session_1/',
            deletedObjectCount: 0,
            deletedBytes: 0,
            endpointResults: [],
        });
        mocks.deleteObjectsFromStorageEndpoints.mockResolvedValueOnce({
            deletedObjectCount: 1,
            deletedBytes: 55,
            endpointResults: [
                {
                    endpointId: 'endpoint_9',
                    endpointUrl: 'https://storage-9.local',
                    projectId: 'project_1',
                    shadow: false,
                    active: true,
                    bucket: 'rogue-bucket',
                    deletedObjectCount: 1,
                    deletedBytes: 55,
                },
            ],
        });

        const result = await purgeSessionArtifacts('session_1', {
            runId: 'run_5',
            trigger: 'retention_expiry',
        });

        expect(result.deletedObjectCount).toBe(3);
        expect(result.deletedBytes).toBe(295);
        expect(result.deletedArtifactCount).toBe(1);
        // The aggregate counted a misplaced key, so the page query ran too.
        expect(mocks.db.select).toHaveBeenCalledTimes(3);
        expect(mocks.resolveRetentionDeletionEndpoints).toHaveBeenCalledWith('project_1', ['endpoint_9']);
        expect(mocks.deleteObjectsFromStorageEndpoints).toHaveBeenCalledWith(
            ['tenant/team_1/project/project_1/misplaced/session_1/events.json.gz'],
            expect.any(Array),
        );
        expect(mocks.finalizeRetentionDeletionLog).toHaveBeenCalledWith(
            'canonical_log',
            expect.objectContaining({
                status: 'completed',
                details: expect.objectContaining({
                    invalidArtifacts: [{
                        artifactId: 'artifact_rogue',
                        kind: 'events',
                        s3ObjectKey: 'tenant/team_1/project/project_1/misplaced/session_1/events.json.gz',
                        endpointId: 'endpoint_9',
                    }],
                    invalidArtifactsTruncated: false,
                    invalidArtifactDeletedObjectCount: 1,
                }),
            }),
        );
    });
});
