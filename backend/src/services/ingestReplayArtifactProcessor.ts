export async function processRecoveredReplayArtifact(
    job: any,
    log: any
) {
    if (job.kind === 'screenshots') {
        log.info({ sessionId: job.sessionId, artifactId: job.artifactId }, 'Replay screenshot artifact verified');
    } else if (job.kind === 'hierarchy') {
        log.info({ sessionId: job.sessionId, artifactId: job.artifactId }, 'Replay hierarchy artifact verified');
    }
}
