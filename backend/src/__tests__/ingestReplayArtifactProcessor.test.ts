import { beforeEach, describe, expect, it, vi } from 'vitest';

const { extractFramesFromArchiveMock } = vi.hoisted(() => ({
    extractFramesFromArchiveMock: vi.fn(),
}));

vi.mock('../services/screenshotFrames.js', () => ({
    extractFramesFromArchive: extractFramesFromArchiveMock,
}));

import { processRecoveredReplayArtifact } from '../services/ingestReplayArtifactProcessor.js';

describe('ingestReplayArtifactProcessor', () => {
    const log = {
        info: vi.fn(),
        warn: vi.fn(),
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('rejects screenshot artifacts with no decodable frames', async () => {
        extractFramesFromArchiveMock.mockResolvedValueOnce([]);

        await expect(processRecoveredReplayArtifact({
            artifactId: 'artifact-1',
            data: Buffer.from('bad-data'),
            expectedFrameCount: 2,
            job: { kind: 'screenshots', sessionId: 'session-1' },
            log,
            sessionStartTime: 1_771_045_973_773,
        })).rejects.toThrow('Replay screenshot artifact contained no decodable frames');
    });

    it('verifies screenshot artifacts and warns on frame-count mismatch', async () => {
        extractFramesFromArchiveMock.mockResolvedValueOnce([
            { timestamp: 1000, index: 0, filename: 'frame-1.jpeg', data: Buffer.from([1]) },
        ]);

        await processRecoveredReplayArtifact({
            artifactId: 'artifact-1',
            data: Buffer.from('ok'),
            expectedFrameCount: 3,
            job: { kind: 'screenshots', sessionId: 'session-1' },
            log,
            sessionStartTime: 1_771_045_973_773,
        });

        expect(log.warn).toHaveBeenCalledTimes(1);
        expect(log.info).toHaveBeenCalledTimes(1);
    });

    it('verifies hierarchy artifacts with a valid root tree', async () => {
        await processRecoveredReplayArtifact({
            artifactId: 'artifact-2',
            data: Buffer.from(JSON.stringify({
                root: {
                    type: 'RootView',
                    children: [{ type: 'Text' }],
                },
            })),
            job: { kind: 'hierarchy', sessionId: 'session-1' },
            log,
            sessionStartTime: 1_771_045_973_773,
        });

        expect(log.info).toHaveBeenCalledTimes(1);
    });

    it('rejects hierarchy artifacts without a valid root object', async () => {
        await expect(processRecoveredReplayArtifact({
            artifactId: 'artifact-2',
            data: Buffer.from(JSON.stringify([])),
            job: { kind: 'hierarchy', sessionId: 'session-1' },
            log,
            sessionStartTime: 1_771_045_973_773,
        })).rejects.toThrow('Hierarchy artifact missing a valid root element');
    });
});
