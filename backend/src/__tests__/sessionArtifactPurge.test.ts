import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    eq: vi.fn((left, right) => ({ left, right })),
    sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => strings.reduce(
        (acc, chunk, index) => acc + chunk + (index < values.length ? String(values[index]) : ''),
        '',
    )),
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
    deletePrefixFromBackupR2: vi.fn(),
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
    sql: mocks.sql,
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
    deletePrefixFromBackupR2: mocks.deletePrefixFromBackupR2,
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
            {
                id: 'artifact_3',
                kind: 'hierarchy',
                s3ObjectKey: 'tenant/team_1/project/project_1/sessions/session_1/hierarchy/1000.json.gz',
                endpointId: 'endpoint_2',
                sizeBytes: 80,
                declaredSizeBytes: null,
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
        const executedStatements: unknown[] = [];

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
        mocks.deletePrefixFromBackupR2.mockResolvedValue({
            prefix: 'backups/tenant/team_1/project/project_1/sessions/session_1',
            deletedObjectCount: 1,
            deletedBytes: 123,
            endpointResults: [],
        });
    });

    it('purges canonical storage and deletes narrow DB rows', async () => {
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
            deletedJobCount: 1,
            deletedObjectCount: 3,
            deletedBytes: 900,
            plannedArtifactCount: 3,
            plannedArtifactBytes: 505,
            plannedJobCount: 1,
            storageMissing: false,
            deletedBackupObjectCount: 0,
            deletedBackupBytes: 0,
        });

        expect(mocks.deletePrefixFromProjectStorage).toHaveBeenCalledWith(
            'project_1',
            'tenant/team_1/project/project_1/sessions/session_1/',
            ['endpoint_1', null, 'endpoint_2'],
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
            replayAvailableAt: null,
            replaySegmentCount: 0,
            replayStorageBytes: 0,
            updatedAt: now,
        });

        expect(mocks.beginRetentionDeletionLog).toHaveBeenCalledTimes(1);
        expect(mocks.finalizeRetentionDeletionLog).toHaveBeenCalledWith(
            'canonical_log',
            expect.objectContaining({
                status: 'completed',
                deletedArtifactRowCount: 3,
                deletedIngestJobCount: 1,
                deletedObjectCount: 3,
                deletedBytes: 900,
            }),
        );
    });

    it('removes stale backup R2 copies and clears the backup log when requested', async () => {
        const now = new Date('2026-03-27T12:00:00.000Z');

        const result = await purgeSessionArtifacts('session_1', {
            runId: 'run_4',
            trigger: 'retention_expiry',
            now,
            deleteBackupCopy: true,
            deleteBackupLogEntry: true,
            backupKeyPrefix: 'backups/tenant/team_1/project/project_1/sessions/session_1',
        });

        expect(result.deletedBackupObjectCount).toBe(1);
        expect(result.deletedBackupBytes).toBe(123);
        expect(mocks.deletePrefixFromBackupR2).toHaveBeenCalledWith(
            'backups/tenant/team_1/project/project_1/sessions/session_1',
        );
        expect(String(tx.executedStatements[0])).toContain('DELETE FROM session_backup_log');
        expect(mocks.finalizeRetentionDeletionLog).toHaveBeenCalledWith(
            'canonical_log',
            expect.objectContaining({
                status: 'completed',
                details: expect.objectContaining({
                    backupDeletedObjectCount: 1,
                    backupDeletedBytes: 123,
                    backupKeyPrefix: 'backups/tenant/team_1/project/project_1/sessions/session_1',
                }),
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
