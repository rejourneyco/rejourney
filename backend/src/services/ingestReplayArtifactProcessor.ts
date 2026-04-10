import { extractFramesFromArchive } from './screenshotFrames.js';

type ReplayArtifactVerificationParams = {
    artifactId?: string | null;
    data: Buffer;
    expectedFrameCount?: number | null;
    job: any;
    log: any;
    sessionStartTime: number;
};

function assertValidHierarchyPayload(data: Buffer): { nodeCount: number; rootType: string } {
    const parsed = JSON.parse(data.toString('utf8'));
    const rootElement = parsed?.rootElement ?? parsed?.root ?? parsed;

    if (!rootElement || typeof rootElement !== 'object' || Array.isArray(rootElement)) {
        throw new Error('Hierarchy artifact missing a valid root element');
    }

    const queue: any[] = [rootElement];
    let nodeCount = 0;
    while (queue.length > 0) {
        const node = queue.shift();
        if (!node || typeof node !== 'object') continue;
        nodeCount += 1;
        if (Array.isArray(node.children)) {
            queue.push(...node.children);
        }
    }

    if (nodeCount === 0) {
        throw new Error('Hierarchy artifact contained zero nodes');
    }

    return {
        nodeCount,
        rootType: typeof rootElement.type === 'string' ? rootElement.type : 'unknown',
    };
}

export async function processRecoveredReplayArtifact(params: ReplayArtifactVerificationParams) {
    const { artifactId, data, expectedFrameCount, job, log, sessionStartTime } = params;

    if (job.kind === 'screenshots') {
        const frames = await extractFramesFromArchive(data, sessionStartTime);
        if (frames.length === 0) {
            throw new Error('Replay screenshot artifact contained no decodable frames');
        }

        if (expectedFrameCount != null && expectedFrameCount > 0 && expectedFrameCount !== frames.length) {
            log.warn({
                artifactId,
                expectedFrameCount,
                extractedFrameCount: frames.length,
                sessionId: job.sessionId,
            }, 'Replay screenshot artifact frame count mismatch');
        }

        log.info({
            artifactId,
            extractedFrameCount: frames.length,
            firstTimestamp: frames[0]?.timestamp ?? null,
            lastTimestamp: frames[frames.length - 1]?.timestamp ?? null,
            sessionId: job.sessionId,
        }, 'Replay screenshot artifact verified');
        return;
    }

    if (job.kind === 'hierarchy') {
        const { nodeCount, rootType } = assertValidHierarchyPayload(data);
        log.info({
            artifactId,
            nodeCount,
            rootType,
            sessionId: job.sessionId,
        }, 'Replay hierarchy artifact verified');
    }
}
