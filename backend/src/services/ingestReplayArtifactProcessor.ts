import { logger } from '../logger.js';
import { invalidateFrameCache } from './screenshotFrames.js';

export async function processRecoveredReplayArtifact(
    job: any,
    log: any
) {
    if (job.kind === 'screenshots') {
        invalidateFrameCache(job.sessionId).catch(err => {
            logger.warn({ err, sessionId: job.sessionId }, 'Failed to invalidate frame cache during replay artifact processing');
        });
        log.info({ sessionId: job.sessionId, artifactId: job.artifactId }, 'Replay screenshot artifact verified');
    } else if (job.kind === 'hierarchy') {
        log.info({ sessionId: job.sessionId, artifactId: job.artifactId }, 'Replay hierarchy artifact verified');
    }
}
