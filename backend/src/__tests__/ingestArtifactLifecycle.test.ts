import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    and: vi.fn((...args) => ({ args })),
    eq: vi.fn((...args) => ({ args })),
    inArray: vi.fn((...args) => ({ args })),
    isNull: vi.fn((...args) => ({ args })),
    lte: vi.fn((...args) => ({ args })),
    or: vi.fn((...args) => ({ args })),
    sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values })),
    db: {
        select: vi.fn(),
        insert: vi.fn(),
        update: vi.fn(),
    },
    ingestJobs: {
        id: 'ingest_jobs.id',
        artifactId: 'ingest_jobs.artifact_id',
        status: 'ingest_jobs.status',
    } as any,
    recordingArtifacts: {
        id: 'recording_artifacts.id',
        sessionId: 'recording_artifacts.session_id',
        clientUploadId: 'recording_artifacts.client_upload_id',
        status: 'recording_artifacts.status',
    } as any,
    sessions: {
        id: 'sessions.id',
        projectId: 'sessions.project_id',
    } as any,
    markSessionIngestActivity: vi.fn(),
    logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    },
}));

vi.mock('drizzle-orm', () => ({
    and: mocks.and,
    eq: mocks.eq,
    inArray: mocks.inArray,
    isNull: mocks.isNull,
    lte: mocks.lte,
    or: mocks.or,
    sql: mocks.sql,
}));

vi.mock('../db/client.js', () => ({
    db: mocks.db,
    ingestJobs: mocks.ingestJobs,
    recordingArtifacts: mocks.recordingArtifacts,
    sessions: mocks.sessions,
}));

vi.mock('../services/sessionReconciliation.js', () => ({
    markSessionIngestActivity: mocks.markSessionIngestActivity,
}));

vi.mock('../logger.js', () => ({
    logger: mocks.logger,
}));

import {
    markArtifactUploadInterrupted,
    prepareReplayArtifactForUpload,
} from '../services/ingestArtifactLifecycle.js';

function queueJoinedSelectResult(result: any) {
    mocks.db.select.mockImplementationOnce(() => ({
        from: vi.fn(() => ({
            innerJoin: vi.fn(() => ({
                where: vi.fn(() => ({
                    limit: vi.fn(async () => result ? [result] : []),
                })),
            })),
        })),
    }));
}

describe('ingestArtifactLifecycle', () => {
    beforeEach(() => {
        vi.clearAllMocks();

        mocks.db.update.mockImplementation((table: unknown) => ({
            set: vi.fn((payload) => ({
                where: vi.fn(async () => ({ table, payload })),
            })),
        }));

        mocks.db.insert.mockImplementation(() => ({
            values: vi.fn((payload) => ({
                returning: vi.fn(async () => [{
                    id: 'artifact_new',
                    status: 'pending',
                    ...payload,
                }]),
            })),
        }));
    });

    it('skips replay upload when the segment is already ready', async () => {
        queueJoinedSelectResult({
            artifact: {
                id: 'artifact_ready',
                status: 'ready',
                kind: 'screenshots',
                clientUploadId: 'seg_session_1_screenshots_1000_na',
            },
            session: {
                id: 'session_1',
                projectId: 'project_1',
            },
        });

        const result = await prepareReplayArtifactForUpload({
            projectId: 'project_1',
            sessionId: 'session_1',
            kind: 'screenshots',
            s3ObjectKey: 'tenant/team/project/session/screenshots/1000.tar.gz',
            endpointId: 'endpoint_1',
            clientUploadId: 'seg_session_1_screenshots_1000_na',
            declaredSizeBytes: 128,
            timestamp: 1000,
            startTime: 1000,
            endTime: null,
            frameCount: 1,
        });

        expect(result.action).toBe('skip');
        expect(result.alreadyCompleted).toBe(true);
        expect(mocks.db.insert).not.toHaveBeenCalled();
        expect(mocks.markSessionIngestActivity).not.toHaveBeenCalled();
    });

    it('reuses an uploaded replay artifact instead of creating a duplicate row', async () => {
        queueJoinedSelectResult({
            artifact: {
                id: 'artifact_uploaded',
                status: 'uploaded',
                kind: 'screenshots',
                clientUploadId: 'seg_session_1_screenshots_1000_na',
            },
            session: {
                id: 'session_1',
                projectId: 'project_1',
            },
        });

        const result = await prepareReplayArtifactForUpload({
            projectId: 'project_1',
            sessionId: 'session_1',
            kind: 'screenshots',
            s3ObjectKey: 'tenant/team/project/session/screenshots/1000.tar.gz',
            endpointId: 'endpoint_1',
            clientUploadId: 'seg_session_1_screenshots_1000_na',
            declaredSizeBytes: 256,
            timestamp: 1000,
            startTime: 1000,
            endTime: null,
            frameCount: 4,
        });

        expect(result.action).toBe('reused');
        expect(mocks.db.insert).not.toHaveBeenCalled();
        expect(mocks.db.update).toHaveBeenCalledWith(mocks.recordingArtifacts);
    });

    it('reopens an abandoned replay artifact for retry and clears upload state', async () => {
        const updateCalls: Array<{ table: unknown; payload: any }> = [];
        mocks.db.update.mockImplementation((table: unknown) => ({
            set: vi.fn((payload) => {
                updateCalls.push({ table, payload });
                return {
                    where: vi.fn(async () => ({ table, payload })),
                };
            }),
        }));

        queueJoinedSelectResult({
            artifact: {
                id: 'artifact_abandoned',
                status: 'abandoned',
                kind: 'hierarchy',
                clientUploadId: 'seg_session_1_hierarchy_1000_na',
                uploadCompletedAt: new Date('2026-03-29T10:00:00Z'),
                readyAt: new Date('2026-03-29T10:00:00Z'),
                verifiedAt: new Date('2026-03-29T10:00:00Z'),
                sizeBytes: 999,
            },
            session: {
                id: 'session_1',
                projectId: 'project_1',
            },
        });

        const result = await prepareReplayArtifactForUpload({
            projectId: 'project_1',
            sessionId: 'session_1',
            kind: 'hierarchy',
            s3ObjectKey: 'tenant/team/project/session/hierarchy/1000.json.gz',
            endpointId: 'endpoint_1',
            clientUploadId: 'seg_session_1_hierarchy_1000_na',
            declaredSizeBytes: 64,
            timestamp: 1000,
            startTime: 1000,
            endTime: null,
            frameCount: 1,
        });

        expect(result.action).toBe('reopened');
        expect(updateCalls).toHaveLength(1);
        expect(updateCalls[0]?.payload).toMatchObject({
            status: 'pending',
            uploadCompletedAt: null,
            readyAt: null,
            verifiedAt: null,
            sizeBytes: null,
        });
    });

    it('marks interrupted uploads abandoned immediately and fails any active job', async () => {
        const updateCalls: Array<{ table: unknown; payload: any }> = [];
        mocks.db.update.mockImplementation((table: unknown) => ({
            set: vi.fn((payload) => {
                updateCalls.push({ table, payload });
                return {
                    where: vi.fn(async () => ({ table, payload })),
                };
            }),
        }));

        queueJoinedSelectResult({
            artifact: {
                id: 'artifact_pending',
                status: 'pending',
                kind: 'screenshots',
                clientUploadId: 'seg_session_1_screenshots_1000_na',
                uploadCompletedAt: null,
            },
            session: {
                id: 'session_1',
                projectId: 'project_1',
            },
        });

        const result = await markArtifactUploadInterrupted({
            artifactId: 'artifact_pending',
            reason: 'relay_upload_aborted',
            errorMsg: 'Error: aborted',
        });

        expect(result).toMatchObject({
            ignored: false,
            sessionId: 'session_1',
            artifactId: 'artifact_pending',
            status: 'abandoned',
        });
        expect(updateCalls).toHaveLength(2);
        expect(updateCalls[0]?.table).toBe(mocks.recordingArtifacts);
        expect(updateCalls[0]?.payload).toMatchObject({
            status: 'abandoned',
        });
        expect(updateCalls[1]?.table).toBe(mocks.ingestJobs);
        expect(updateCalls[1]?.payload).toMatchObject({
            status: 'failed',
            errorMsg: 'Error: aborted',
        });
        expect(mocks.markSessionIngestActivity).toHaveBeenCalledWith(
            'session_1',
            expect.objectContaining({ reopen: true }),
        );
    });
});
