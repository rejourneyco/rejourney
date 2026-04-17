import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const TEST_DIR = dirname(fileURLToPath(import.meta.url));

function readWorkspaceFile(relativePathFromTestFile: string): string {
    return readFileSync(resolve(TEST_DIR, relativePathFromTestFile), 'utf8');
}

function extractFunctionBlock(source: string, functionName: string): string {
    const start = source.indexOf(`async function ${functionName}`);
    if (start === -1) {
        throw new Error(`Function not found: ${functionName}`);
    }

    const nextAsync = source.indexOf('\nasync function ', start + 1);
    return source.slice(start, nextAsync === -1 ? source.length : nextAsync);
}

describe('retention backlog drain', () => {
    it('pages past skipped expired sessions until it finds purgeable rows', () => {
        const worker = readWorkspaceFile('../worker/retentionWorker.ts');
        const block = extractFunctionBlock(worker, 'collectExpiredSessionsReadyForPurge');

        expect(block).toContain('while (backedUpSessions.length < limit)');
        expect(block).toContain('.orderBy(sessions.startedAt, sessions.id)');
        expect(block).toContain("eq(sessions.status, 'ready')");
        expect(block).toContain("eq(sessions.status, 'completed')");
        expect(block).toContain('gt(sessions.startedAt, cursor.startedAt)');
        expect(block).toContain('and(eq(sessions.startedAt, cursor.startedAt), gt(sessions.id, cursor.id))');
        expect(block).toContain('reachedProcessingCap: backedUpSessions.length >= limit');
    });

    it('keeps draining retention backlog when a full purgeable batch was collected', () => {
        const worker = readWorkspaceFile('../worker/retentionWorker.ts');
        const block = extractFunctionBlock(worker, 'runRetentionCycle');

        expect(block).toContain('expiredResult.reachedProcessingCap ||');
        expect(block).toContain('repairResult.reachedProcessingCap ||');
        expect(block).not.toContain('expiredResult.processedCount >= BATCH_SIZE');
    });

    it('applies the same paged scan to expired-repair cleanup', () => {
        const purgeSource = readWorkspaceFile('../services/sessionArtifactPurge.ts');
        const block = extractFunctionBlock(purgeSource, 'collectExpiredRepairCandidates');

        expect(block).toContain('while (backedUpSessions.length < limit)');
        expect(block).toContain('.orderBy(sessions.startedAt, sessions.id)');
        expect(block).toContain('gt(sessions.startedAt, cursor.startedAt)');
        expect(block).toContain('reachedProcessingCap: backedUpSessions.length >= limit');
    });
});
