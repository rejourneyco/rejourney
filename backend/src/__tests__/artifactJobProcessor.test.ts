import { beforeEach, describe, expect, it, vi } from 'vitest';
import { gzipSync, gunzipSync } from 'zlib';

type ArtifactUploadMock = (
    projectId: string,
    key: string,
    body: Buffer | string,
    contentType?: string,
    metadata?: Record<string, string>,
    endpointId?: string | null,
) => Promise<{ success: boolean; endpointId: string; error?: string }>;
type ProcessFaultArtifactMock = (
    job: unknown,
    session: unknown,
    projectId: string,
    s3ObjectKey: string,
    data: Buffer,
    log: unknown,
) => Promise<void>;
type NormalizeScreenshotArchiveClockFieldsInStorageMock = (params: {
    data: Buffer;
}) => Promise<{
    data: Buffer;
    normalized: boolean;
    normalizedFrameNameCount: number;
    uploadedSizeBytes: number | null;
}>;

vi.mock('drizzle-orm', () => ({
    eq: vi.fn(),
    sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values })),
}));

const {
    downloadFromS3ForArtifactMock,
    ensureHierarchyArtifactCompressedMock,
    getObjectSizeBytesForArtifactMock,
    processAnrsArtifactMock,
    processCrashesArtifactMock,
    processEventsArtifactMock,
    processRecoveredReplayArtifactMock,
    normalizeScreenshotArchiveClockFieldsInStorageMock,
    summarizeEventsArtifactMock,
    uploadToS3ForArtifactMock,
} = vi.hoisted(() => ({
    downloadFromS3ForArtifactMock: vi.fn(async () => Buffer.from('{"ok":true}')),
    ensureHierarchyArtifactCompressedMock: vi.fn(async () => ({
        data: Buffer.from('{"root":{"type":"View"}}'),
        sizeBytes: 256,
    })),
    getObjectSizeBytesForArtifactMock: vi.fn(async () => 128),
    processAnrsArtifactMock: vi.fn<ProcessFaultArtifactMock>(async () => undefined),
    processCrashesArtifactMock: vi.fn<ProcessFaultArtifactMock>(async () => undefined),
    processEventsArtifactMock: vi.fn(async () => undefined),
    processRecoveredReplayArtifactMock: vi.fn(async () => undefined),
    normalizeScreenshotArchiveClockFieldsInStorageMock: vi.fn<NormalizeScreenshotArchiveClockFieldsInStorageMock>(async ({ data }) => ({
        data,
        normalized: false,
        normalizedFrameNameCount: 0,
        uploadedSizeBytes: null,
    })),
    summarizeEventsArtifactMock: vi.fn((data: Buffer) => ({
        endTime: null,
        eventCount: 0,
        sizeBytes: data.length,
        startTime: null,
    })),
    uploadToS3ForArtifactMock: vi.fn<ArtifactUploadMock>(async () => ({ success: true, endpointId: 'endpoint-1' })),
}));

vi.mock('../db/client.js', () => ({
    db: {},
    projects: {},
    recordingArtifacts: {},
    sessionMetrics: {},
    sessions: {},
}));

vi.mock('../db/s3.js', () => ({
    downloadFromS3ForArtifact: downloadFromS3ForArtifactMock,
    getObjectSizeBytesForArtifact: getObjectSizeBytesForArtifactMock,
    uploadToS3ForArtifact: uploadToS3ForArtifactMock,
}));

vi.mock('../services/hierarchyArtifactCompression.js', () => ({
    ensureHierarchyArtifactCompressed: ensureHierarchyArtifactCompressedMock,
}));

vi.mock('../services/ingestEventArtifactProcessor.js', () => ({
    processEventsArtifact: processEventsArtifactMock,
    summarizeEventsArtifact: summarizeEventsArtifactMock,
}));

vi.mock('../services/ingestFaultArtifactProcessors.js', () => ({
    processCrashesArtifact: processCrashesArtifactMock,
    processAnrsArtifact: processAnrsArtifactMock,
}));

vi.mock('../services/ingestReplayArtifactProcessor.js', () => ({
    processRecoveredReplayArtifact: processRecoveredReplayArtifactMock,
}));

vi.mock('../services/screenshotFrames.js', () => ({
    normalizeScreenshotArchiveClockFieldsInStorage: normalizeScreenshotArchiveClockFieldsInStorageMock,
}));

vi.mock('../logger.js', () => ({
    logger: {
        child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
        debug: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
    },
}));

vi.mock('../services/artifactCompletionEffects.js', () => ({
    runArtifactCompletionEffects: vi.fn(async () => ({ replayAvailable: false })),
}));

vi.mock('../services/replayAvailability.js', () => ({
    canOpenReplayFromSessionFields: vi.fn(() => false),
}));

vi.mock('../services/sessionReconciliation.js', () => ({
    reconcileSessionState: vi.fn(async () => undefined),
}));

vi.mock('../services/sessionEventRollupQueue.js', () => ({
    enqueueSessionEventRollupJob: vi.fn(async () => undefined),
}));

vi.mock('../services/sessionEffectsQueue.js', () => ({
    enqueueSessionEffectsJob: vi.fn(async () => undefined),
}));

import { runArtifactProcessorByKind } from '../services/artifactJobProcessor.js';

const baseContext = {
    artifact: { endpointId: 'endpoint-1' },
    job: { artifactId: 'artifact-1', kind: 'events', sessionId: 'session-1' },
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) },
    metrics: { sessionId: 'session-1' },
    projectId: 'project-1',
    s3Key: 'artifacts/key',
    session: { id: 'session-1', projectId: 'project-1', startedAt: new Date('2026-04-07T00:00:00.000Z') },
};

describe('artifactJobProcessor routing', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        getObjectSizeBytesForArtifactMock.mockResolvedValue(128);
        downloadFromS3ForArtifactMock.mockResolvedValue(Buffer.from('{"ok":true}'));
        ensureHierarchyArtifactCompressedMock.mockResolvedValue({
            data: Buffer.from('{"root":{"type":"View"}}'),
            sizeBytes: 256,
        });
        normalizeScreenshotArchiveClockFieldsInStorageMock.mockImplementation(async ({ data }: { data: Buffer }) => ({
            data,
            normalized: false,
            normalizedFrameNameCount: 0,
            uploadedSizeBytes: null,
        }));
        uploadToS3ForArtifactMock.mockResolvedValue({ success: true, endpointId: 'endpoint-1' });
    });

    it('summarizes events without running the heavy event processor', async () => {
        await runArtifactProcessorByKind('events', { ...baseContext, job: { ...baseContext.job, kind: 'events' } } as any);

        expect(summarizeEventsArtifactMock).toHaveBeenCalledTimes(1);
        expect(processEventsArtifactMock).not.toHaveBeenCalled();
        expect(processCrashesArtifactMock).not.toHaveBeenCalled();
        expect(processAnrsArtifactMock).not.toHaveBeenCalled();
        expect(processRecoveredReplayArtifactMock).not.toHaveBeenCalled();
    });

    it('routes crashes to the crash processor only', async () => {
        await runArtifactProcessorByKind('crashes', { ...baseContext, job: { ...baseContext.job, kind: 'crashes' } } as any);

        expect(processCrashesArtifactMock).toHaveBeenCalledTimes(1);
        expect((processCrashesArtifactMock.mock.calls as unknown as any[][])[0]?.[6]).toEqual({ ok: true });
        expect(processEventsArtifactMock).not.toHaveBeenCalled();
        expect(processAnrsArtifactMock).not.toHaveBeenCalled();
        expect(processRecoveredReplayArtifactMock).not.toHaveBeenCalled();
    });

    it('routes anrs to the anr processor only', async () => {
        await runArtifactProcessorByKind('anrs', { ...baseContext, job: { ...baseContext.job, kind: 'anrs' } } as any);

        expect(processAnrsArtifactMock).toHaveBeenCalledTimes(1);
        expect(processEventsArtifactMock).not.toHaveBeenCalled();
        expect(processCrashesArtifactMock).not.toHaveBeenCalled();
        expect(processRecoveredReplayArtifactMock).not.toHaveBeenCalled();
    });

    it('routes screenshots to the replay processor only', async () => {
        await runArtifactProcessorByKind('screenshots', { ...baseContext, job: { ...baseContext.job, kind: 'screenshots' } } as any);

        expect(processRecoveredReplayArtifactMock).toHaveBeenCalledTimes(1);
        expect(normalizeScreenshotArchiveClockFieldsInStorageMock).toHaveBeenCalledTimes(1);
        expect(processEventsArtifactMock).not.toHaveBeenCalled();
        expect(processCrashesArtifactMock).not.toHaveBeenCalled();
        expect(processAnrsArtifactMock).not.toHaveBeenCalled();
        expect(ensureHierarchyArtifactCompressedMock).not.toHaveBeenCalled();
    });

    it('routes hierarchy to hierarchy repair plus replay processing', async () => {
        await runArtifactProcessorByKind('hierarchy', { ...baseContext, job: { ...baseContext.job, kind: 'hierarchy' } } as any);

        expect(ensureHierarchyArtifactCompressedMock).toHaveBeenCalledTimes(1);
        expect(downloadFromS3ForArtifactMock).not.toHaveBeenCalled();
        expect(processRecoveredReplayArtifactMock).toHaveBeenCalledWith(expect.objectContaining({
            parsedPayload: { root: { type: 'View' } },
        }));
        expect(processEventsArtifactMock).not.toHaveBeenCalled();
        expect(processCrashesArtifactMock).not.toHaveBeenCalled();
        expect(processAnrsArtifactMock).not.toHaveBeenCalled();
    });

    it('uses normalized screenshot archive data before replay verification', async () => {
        const rawData = Buffer.from('raw-screenshot-archive');
        const normalizedData = Buffer.from('normalized-screenshot-archive');
        downloadFromS3ForArtifactMock.mockResolvedValue(rawData);
        normalizeScreenshotArchiveClockFieldsInStorageMock.mockResolvedValue({
            data: normalizedData,
            normalized: true,
            normalizedFrameNameCount: 2,
            uploadedSizeBytes: 123,
        });

        const result = await runArtifactProcessorByKind('screenshots', {
            ...baseContext,
            job: { ...baseContext.job, kind: 'screenshots' },
            s3Key: 'artifacts/screenshots.tar.gz',
        } as any);

        expect(normalizeScreenshotArchiveClockFieldsInStorageMock).toHaveBeenCalledTimes(1);
        expect(processRecoveredReplayArtifactMock).toHaveBeenCalledWith(expect.objectContaining({
            data: normalizedData,
        }));
        expect(result.sizeBytes).toBe(123);
    });

    it('validates gzipped rrweb artifacts before marking them ready', async () => {
        downloadFromS3ForArtifactMock.mockResolvedValue(gzipSync(JSON.stringify({
            format: 'rrweb',
            events: [{ type: 2, timestamp: 1_771_000_000_000 }],
        })));

        await runArtifactProcessorByKind('rrweb', {
            ...baseContext,
            job: { ...baseContext.job, kind: 'rrweb' },
            s3Key: 'artifacts/1771000000000.rrweb.json.gz',
        } as any);

        expect(downloadFromS3ForArtifactMock).toHaveBeenCalledTimes(1);
        expect(processRecoveredReplayArtifactMock).not.toHaveBeenCalled();
    });

    it('normalizes future-skewed rrweb payloads in S3 before validation', async () => {
        const serverStartedAtMs = Date.UTC(2026, 5, 12, 18, 0, 0, 0);
        const rawStartedAtMs = Date.UTC(2026, 5, 27, 12, 15, 14, 606);
        downloadFromS3ForArtifactMock.mockResolvedValue(Buffer.from(JSON.stringify({
            format: 'rrweb',
            events: [{ type: 2, timestamp: rawStartedAtMs + 500 }],
        }), 'utf8'));

        await runArtifactProcessorByKind('rrweb', {
            ...baseContext,
            job: { ...baseContext.job, kind: 'rrweb' },
            session: {
                ...baseContext.session,
                startedAt: new Date(serverStartedAtMs),
                metadata: {
                    ingestClock: {
                        ruleVersion: 'future-client-clock-v1',
                        clamped: true,
                        rawSessionStartedAtMs: rawStartedAtMs,
                        normalizedStartedAtMs: serverStartedAtMs,
                        serverObservedAtMs: serverStartedAtMs,
                        futureSkewMs: rawStartedAtMs - serverStartedAtMs,
                        maxFutureSkewMs: 600_000,
                    },
                },
            },
            s3Key: 'artifacts/1782562514606.rrweb.json.gz',
        } as any);

        expect(uploadToS3ForArtifactMock).toHaveBeenCalledTimes(1);
        const [, , uploadedBody] = uploadToS3ForArtifactMock.mock.calls[0];
        const rewritten = JSON.parse(gunzipSync(uploadedBody as Buffer).toString('utf8'));
        expect(rewritten.events[0].timestamp).toBe(serverStartedAtMs + 500);
    });

    it('normalizes future-skewed crash artifact payloads before crash processing', async () => {
        const serverStartedAtMs = Date.UTC(2026, 5, 12, 18, 0, 0, 0);
        const rawStartedAtMs = Date.UTC(2026, 5, 27, 12, 15, 14, 606);
        downloadFromS3ForArtifactMock.mockResolvedValue(Buffer.from(JSON.stringify({
            crashes: [{ timestamp: rawStartedAtMs + 500, exceptionName: 'Boom' }],
        }), 'utf8'));

        await runArtifactProcessorByKind('crashes', {
            ...baseContext,
            job: { ...baseContext.job, kind: 'crashes' },
            session: {
                ...baseContext.session,
                startedAt: new Date(serverStartedAtMs),
                metadata: {
                    ingestClock: {
                        ruleVersion: 'future-client-clock-v1',
                        clamped: true,
                        rawSessionStartedAtMs: rawStartedAtMs,
                        normalizedStartedAtMs: serverStartedAtMs,
                        serverObservedAtMs: serverStartedAtMs,
                        futureSkewMs: rawStartedAtMs - serverStartedAtMs,
                        maxFutureSkewMs: 600_000,
                    },
                },
            },
            s3Key: 'artifacts/crashes_1.json.gz',
        } as any);

        expect(uploadToS3ForArtifactMock).toHaveBeenCalledTimes(1);
        expect(processCrashesArtifactMock).toHaveBeenCalledTimes(1);
        const normalizedData = processCrashesArtifactMock.mock.calls[0][4] as Buffer;
        const parsed = JSON.parse(normalizedData.toString('utf8'));
        expect(parsed.crashes[0].timestamp).toBe(serverStartedAtMs + 500);
    });

    it('rejects malformed rrweb artifacts', async () => {
        downloadFromS3ForArtifactMock.mockResolvedValue(gzipSync(JSON.stringify({
            format: 'rrweb',
            events: [],
        })));

        await expect(runArtifactProcessorByKind('rrweb', {
            ...baseContext,
            job: { ...baseContext.job, kind: 'rrweb' },
            s3Key: 'artifacts/1771000000000.rrweb.json.gz',
        } as any)).rejects.toThrow('rrweb artifact payload must contain at least one event');
    });
});
