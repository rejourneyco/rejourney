import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readWorkspaceFile(relativePathFromTestFile: string): string {
    return readFileSync(new URL(relativePathFromTestFile, import.meta.url), 'utf8');
}

function extractFunctionBlock(source: string, functionName: string): string {
    const start = source.indexOf(`async function ${functionName}`);
    if (start === -1) {
        throw new Error(`Function not found: ${functionName}`);
    }

    const nextAsync = source.indexOf('\nasync function ', start + 1);
    return source.slice(start, nextAsync === -1 ? source.length : nextAsync);
}

describe('session backup seed mode', () => {
    it('keeps oldest-first pagination and backup eligibility checks in fetchSeedCandidates', () => {
        const script = readWorkspaceFile('../../../scripts/k8s/session-backup.mjs');
        const block = extractFunctionBlock(script, 'fetchSeedCandidates');

        expect(block).toContain("const emptySessionPredicate = buildEmptySessionPredicateSql('s');");
        expect(block).toContain("const readyArtifactCount = buildReadyArtifactCountSql('s');");
        expect(block).toContain("${buildBackedUpFilterClause('s')}");
        expect(block).toContain("AND ${readyArtifactCount} > 0");
        expect(block).toContain('AND NOT (');
        expect(block).toContain('FROM session_backup_queue q');
        expect(block).toContain('WHERE q.session_id = s.id');
        expect(block).toContain("s.started_at > $2::timestamptz");
        expect(block).toContain("s.started_at = $2::timestamptz AND s.id > $3");
        expect(block).toContain('ORDER BY s.started_at ASC, s.id ASC');
    });

    it('deploys a dedicated session-backup-seed cronjob that runs seed-queue every 5 minutes', () => {
        const manifest = readWorkspaceFile('../../../k8s/archive.yaml');

        expect(manifest).toContain('name: session-backup');
        expect(manifest).toContain('schedule: "0 * * * *"');
        expect(manifest).toContain('name: session-backup-seed');
        expect(manifest).toContain('schedule: "*/5 * * * *"');
        expect(manifest).toContain('exec node session-backup.mjs --mode=seed-queue --limit=1000');
        expect(manifest).toContain('name: SESSION_BACKUP_SEED_BATCH_SIZE');
        expect(manifest).toContain('value: "1000"');
    });
});
