import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    downloadFromS3ForArtifactMock,
    ensureHierarchyArtifactCompressedMock,
    getObjectSizeBytesForArtifactMock,
    processAnrsArtifactMock,
    processCrashesArtifactMock,
    processEventsArtifactMock,
    processRecoveredReplayArtifactMock,
} = vi.hoisted(() => ({
    downloadFromS3ForArtifactMock: vi.fn(async () => Buffer.from('{"ok":true}')),
    ensureHierarchyArtifactCompressedMock: vi.fn(async () => ({ sizeBytes: 256 })),
    getObjectSizeBytesForArtifactMock: vi.fn(async () => 128),
    processAnrsArtifactMock: vi.fn(async () => undefined),
    processCrashesArtifactMock: vi.fn(async () => undefined),
    processEventsArtifactMock: vi.fn(async () => undefined),
    processRecoveredReplayArtifactMock: vi.fn(async () => undefined),
}));

vi.mock('../db/s3.js', () => ({
    downloadFromS3ForArtifact: downloadFromS3ForArtifactMock,
    getObjectSizeBytesForArtifact: getObjectSizeBytesForArtifactMock,
}));

vi.mock('../services/hierarchyArtifactCompression.js', () => ({
    ensureHierarchyArtifactCompressed: ensureHierarchyArtifactCompressedMock,
}));

vi.mock('../services/ingestEventArtifactProcessor.js', () => ({
    processEventsArtifact: processEventsArtifactMock,
}));

vi.mock('../services/ingestFaultArtifactProcessors.js', () => ({
    processCrashesArtifact: processCrashesArtifactMock,
    processAnrsArtifact: processAnrsArtifactMock,
}));

vi.mock('../services/ingestReplayArtifactProcessor.js', () => ({
    processRecoveredReplayArtifact: processRecoveredReplayArtifactMock,
}));

import { runArtifactProcessorByKind } from '../services/artifactJobProcessor.js';

const baseContext = {
    artifact: { endpointId: 'endpoint-1' },
    job: { artifactId: 'artifact-1', kind: 'events', sessionId: 'session-1' },
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) },
    metrics: { sessionId: 'session-1' },
    projectId: 'project-1',
    s3Key: 'artifacts/key',
    session: { id: 'session-1', projectId: 'project-1' },
};

describe('artifactJobProcessor routing', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        getObjectSizeBytesForArtifactMock.mockResolvedValue(128);
        downloadFromS3ForArtifactMock.mockResolvedValue(Buffer.from('{"ok":true}'));
        ensureHierarchyArtifactCompressedMock.mockResolvedValue({ sizeBytes: 256 });
    });

    it('routes events to the event processor only', async () => {
        await runArtifactProcessorByKind('events', { ...baseContext, job: { ...baseContext.job, kind: 'events' } } as any);

        expect(processEventsArtifactMock).toHaveBeenCalledTimes(1);
        expect(processCrashesArtifactMock).not.toHaveBeenCalled();
        expect(processAnrsArtifactMock).not.toHaveBeenCalled();
        expect(processRecoveredReplayArtifactMock).not.toHaveBeenCalled();
    });

    it('routes crashes to the crash processor only', async () => {
        await runArtifactProcessorByKind('crashes', { ...baseContext, job: { ...baseContext.job, kind: 'crashes' } } as any);

        expect(processCrashesArtifactMock).toHaveBeenCalledTimes(1);
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
        expect(processEventsArtifactMock).not.toHaveBeenCalled();
        expect(processCrashesArtifactMock).not.toHaveBeenCalled();
        expect(processAnrsArtifactMock).not.toHaveBeenCalled();
        expect(ensureHierarchyArtifactCompressedMock).not.toHaveBeenCalled();
    });

    it('routes hierarchy to hierarchy repair plus replay processing', async () => {
        await runArtifactProcessorByKind('hierarchy', { ...baseContext, job: { ...baseContext.job, kind: 'hierarchy' } } as any);

        expect(ensureHierarchyArtifactCompressedMock).toHaveBeenCalledTimes(1);
        expect(processRecoveredReplayArtifactMock).toHaveBeenCalledTimes(1);
        expect(processEventsArtifactMock).not.toHaveBeenCalled();
        expect(processCrashesArtifactMock).not.toHaveBeenCalled();
        expect(processAnrsArtifactMock).not.toHaveBeenCalled();
    });
});
