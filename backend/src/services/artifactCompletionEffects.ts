import { getRedis } from '../db/redis.js';
import { logger } from '../logger.js';
import { invalidateFrameCache, prewarmSessionScreenshotFrames } from './screenshotFrames.js';

const prewarmInFlight = new Set<string>();

export async function invalidateSessionDetailCaches(sessionId: string): Promise<void> {
    try {
        await invalidateFrameCache(sessionId);
        await getRedis().del(
            `session_bootstrap:${sessionId}`,
            `session_core:${sessionId}`,
            `session_timeline:${sessionId}`,
            `session_hierarchy:${sessionId}`,
        );
    } catch (err) {
        logger.warn({ err, sessionId }, 'Failed to invalidate session detail caches after ingest');
    }
}

function maybePrewarmReplayFrames(sessionId: string): void {
    if (prewarmInFlight.has(sessionId)) return;
    prewarmInFlight.add(sessionId);
    prewarmSessionScreenshotFrames(sessionId)
        .then((ok) => {
            if (ok) {
                logger.info({ sessionId }, 'Prewarmed screenshot frames');
            }
        })
        .catch((err) => {
            logger.warn({ err, sessionId }, 'Failed to prewarm screenshot frames');
        })
        .finally(() => {
            prewarmInFlight.delete(sessionId);
        });
}

export async function runArtifactCompletionEffects(options: {
    kind: string | null | undefined;
    replayAvailable: boolean;
    sessionId: string;
}): Promise<void> {
    await invalidateSessionDetailCaches(options.sessionId);

    if (options.kind === 'screenshots' && options.replayAvailable) {
        maybePrewarmReplayFrames(options.sessionId);
    }
}
