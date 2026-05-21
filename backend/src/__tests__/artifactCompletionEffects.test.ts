import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    delMock,
    invalidateFrameCacheMock,
    prewarmSessionScreenshotFramesMock,
} = vi.hoisted(() => ({
    delMock: vi.fn(async () => 3),
    invalidateFrameCacheMock: vi.fn(async () => undefined),
    prewarmSessionScreenshotFramesMock: vi.fn(async () => true),
}));

vi.mock('../db/redis.js', () => ({
    getRedis: () => ({
        del: delMock,
    }),
}));

vi.mock('../services/screenshotFrames.js', () => ({
    invalidateFrameCache: invalidateFrameCacheMock,
    prewarmSessionScreenshotFrames: prewarmSessionScreenshotFramesMock,
}));

import { runArtifactCompletionEffects } from '../services/artifactCompletionEffects.js';

describe('artifactCompletionEffects', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('invalidates caches and prewarms after a replay screenshot becomes available', async () => {
        await runArtifactCompletionEffects({
            kind: 'screenshots',
            replayAvailable: true,
            sessionId: 'session-123',
        });

        expect(invalidateFrameCacheMock).toHaveBeenCalledWith('session-123');
        expect(delMock).toHaveBeenCalledWith(
            'session_bootstrap:session-123',
            'session_core:session-123',
            'session_timeline:session-123',
            'session_hierarchy:session-123',
            'v5:session_bootstrap:session-123',
            'v5:session_core:session-123',
            'v5:session_core_lite:session-123',
            'v5:session_timeline:session-123',
            'v5:session_hierarchy:session-123',
            'v5:session_replay_manifest:session-123:proxy',
            'v5:session_replay_manifest:session-123:signed',
            'v5:session_replay_manifest:session-123:none',
            'v5:session_frames:session-123:proxy',
            'v5:session_frames:session-123:signed',
            'v5:session_frames:session-123:none',
        );
        expect(prewarmSessionScreenshotFramesMock).toHaveBeenCalledWith('session-123');
    });

    it('does not trigger replay prewarm for non-replay artifacts', async () => {
        await runArtifactCompletionEffects({
            kind: 'events',
            replayAvailable: false,
            sessionId: 'session-456',
        });

        expect(invalidateFrameCacheMock).toHaveBeenCalledWith('session-456');
        expect(prewarmSessionScreenshotFramesMock).not.toHaveBeenCalled();
    });
});
