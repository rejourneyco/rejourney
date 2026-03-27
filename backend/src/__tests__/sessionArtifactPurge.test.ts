import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    eq: vi.fn((left, right) => ({ left, right })),
    or: vi.fn((...conditions) => ({ conditions })),
    db: {
        select: vi.fn(),
        transaction: vi.fn(),
    },
    ingestJobs: { id: 'ingest_jobs.id', sessionId: 'ingest_jobs.session_id' } as any,
    recordingArtifacts: {
        id: 'recording_artifacts.id',
        sessionId: 'recording_artifacts.session_id',
    } as any,
    sessionMetrics: { sessionId: 'session_metrics.session_id' } as any,
    sessions: { id: 'sessions.id' } as any,
    projects: { id: 'projects.id' } as any,
    mockRedis: {
        del: vi.fn(),
        scan: vi.fn(),
    },
    deletePrefixFromProjectStorage: vi.fn(),
    deletePrefixFromAllConfiguredStorageEndpoints: vi.fn(),
    beginRetentionDeletionLog: vi.fn(),
    finalizeRetentionDeletionLog: vi.fn(),
    logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    },
}));

vi.mock('drizzle-orm', () => ({
    eq: mocks.eq,
    or: mocks.or,
}));

let tx: any;

vi.mock('../db/client.js', () => ({
    db: mocks.db,
    ingestJobs: mocks.ingestJobs,
    recordingArtifacts: mocks.recordingArtifacts,
    sessionMetrics: mocks.sessionMetrics,
    sessions: mocks.sessions,
    projects: mocks.projects,
}));

vi.mock('../db/redis.js', () => ({
    getRedis: () => mocks.mockRedis,
}));

vi.mock('../db/s3.js', () => ({
    deletePrefixFromProjectStorage: mocks.deletePrefixFromProjectStorage,
    deletePrefixFromAllConfiguredStorageEndpoints: mocks.deletePrefixFromAllConfiguredStorageEndpoints,
}));

vi.mock('../services/retentionAudit.js', () => ({
    beginRetentionDeletionLog: mocks.beginRetentionDeletionLog,
    finalizeRetentionDeletionLog: mocks.finalizeRetentionDeletionLog,
}));

vi.mock('../logger.js', () => ({
    logger: mocks.logger,
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

function createSimpleSelectResult(rows: any[]) {
    return {
        from: vi.fn(() => ({
            where: vi.fn(async () => rows),
        })),
    };
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
        ];

        const jobs = [{ id: 'job_1' }];

        mocks.db.select
            .mockImplementationOnce(() => createSessionSelectResult(sessionResult))
            .mockImplementationOnce(() => createSimpleSelectResult(artifacts))
            .mockImplementationOnce(() => createSimpleSelectResult(jobs));

        mocks.db.transaction.mockImplementation(async (callback: (client: any) => Promise<void>) => callback(tx));

        let metricsSetPayload: any = null;
        let sessionsSetPayload: any = null;

        tx = {
            delete: vi.fn((table: unknown) => {
                if (table === mocks.ingestJobs) {
                    return {
                        where: vi.fn(() => ({
                            returning: vi.fn(async () => jobs),
                        })),
                    };
                }

                if (table === mocks.recordingArtifacts) {
                    return {
                        where: vi.fn(() => ({
                            returning: vi.fn(async () => artifacts),
                        })),
                    };
                }

                throw new Error('Unexpected delete table');
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
            get metricsSetPayload() {
                return metricsSetPayload;
            },
            get sessionsSetPayload() {
                return sessionsSetPayload;
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

        mocks.beginRetentionDeletionLog
            .mockResolvedValueOnce('canonical_log')
            .mockResolvedValueOnce('legacy_log');
        mocks.finalizeRetentionDeletionLog.mockResolvedValue(undefined);

        mocks.deletePrefixFromProjectStorage.mockResolvedValue({
            prefix: 'tenant/team_1/project/project_1/sessions/session_1/',
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
        mocks.deletePrefixFromAllConfiguredStorageEndpoints.mockResolvedValue({
            prefix: 'sessions/session_1/',
            deletedObjectCount: 1,
            deletedBytes: 50,
            endpointResults: [],
        });
    });

    it('purges canonical storage, deletes narrow DB rows, and logs legacy cleanup separately', async () => {
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
            deletedArtifactCount: 2,
            deletedJobCount: 1,
            deletedObjectCount: 3,
            deletedBytes: 900,
            plannedArtifactCount: 2,
            plannedArtifactBytes: 425,
            plannedJobCount: 1,
            storageMissing: false,
        });

        expect(mocks.deletePrefixFromProjectStorage).toHaveBeenCalledWith(
            'project_1',
            'tenant/team_1/project/project_1/sessions/session_1/',
            ['endpoint_1', null],
        );
        expect(mocks.deletePrefixFromAllConfiguredStorageEndpoints).toHaveBeenCalledWith('sessions/session_1/');

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
            replayAvailableAt: null,
            replaySegmentCount: 0,
            replayStorageBytes: 0,
            updatedAt: now,
        });

        expect(mocks.beginRetentionDeletionLog).toHaveBeenCalledTimes(2);
        expect(mocks.finalizeRetentionDeletionLog).toHaveBeenCalledWith(
            'canonical_log',
            expect.objectContaining({
                status: 'completed',
                deletedArtifactRowCount: 2,
                deletedIngestJobCount: 1,
                deletedObjectCount: 3,
                deletedBytes: 900,
            }),
        );
        expect(mocks.finalizeRetentionDeletionLog).toHaveBeenCalledWith(
            'legacy_log',
            expect.objectContaining({
                status: 'completed',
                deletedObjectCount: 1,
                deletedBytes: 50,
            }),
        );
    });

    it('fails closed when canonical storage is missing for active artifact rows', async () => {
        mocks.deletePrefixFromProjectStorage.mockResolvedValueOnce({
            prefix: 'tenant/team_1/project/project_1/sessions/session_1/',
            deletedObjectCount: 0,
            deletedBytes: 0,
            endpointResults: [],
        });

        await expect(purgeSessionArtifacts('session_1', {
            runId: 'run_2',
            trigger: 'retention_expiry',
        })).rejects.toThrow('Canonical storage missing for session session_1');

        expect(tx.delete).not.toHaveBeenCalled();
        expect(mocks.deletePrefixFromAllConfiguredStorageEndpoints).not.toHaveBeenCalled();
        expect(mocks.finalizeRetentionDeletionLog).toHaveBeenCalledWith(
            'canonical_log',
            expect.objectContaining({
                status: 'failed',
                storageMissing: true,
            }),
        );
    });

    it('allows repair mode to clean leftover rows even if storage is already gone', async () => {
        mocks.deletePrefixFromProjectStorage.mockResolvedValueOnce({
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
        expect(tx.delete).toHaveBeenCalledTimes(2);
        expect(mocks.finalizeRetentionDeletionLog).toHaveBeenCalledWith(
            'canonical_log',
            expect.objectContaining({
                status: 'completed',
                storageMissing: true,
            }),
        );
    });
});
