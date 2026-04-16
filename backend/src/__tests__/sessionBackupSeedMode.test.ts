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

describe('session backup seed mode', () => {
    it('keeps oldest-first pagination and backup eligibility checks in fetchSeedCandidates', () => {
        const script = readWorkspaceFile('../../../scripts/k8s/session-backup.mjs');
        const block = extractFunctionBlock(script, 'fetchSeedCandidates');

        expect(block).toContain('LEFT JOIN session_backup_log bl ON bl.session_id = s.id');
        expect(block).toContain("${buildReadyArtifactStatsJoin('s')}");
        expect(block).toContain('artifact_stats.ready_artifact_count > 0');
        expect(block).toContain("${buildNotFullyBackedUpPredicate('bl', 'artifact_stats.ready_artifact_count')}");
        expect(block).toContain('FROM session_backup_queue q');
        expect(block).toContain('WHERE q.session_id = s.id');
        expect(block).toContain("s.started_at > $2::timestamptz");
        expect(block).toContain("s.started_at = $2::timestamptz AND s.id > $3");
        expect(block).toContain('ORDER BY s.started_at ASC, s.id ASC');
        expect(block).not.toContain('FROM ingest_jobs ij');
        expect(block).not.toContain('FROM session_metrics sm');
    });

    it('claims queued sessions using next_retry_at ordering instead of COALESCE sorting', () => {
        const script = readWorkspaceFile('../../../scripts/k8s/session-backup.mjs');
        const block = extractFunctionBlock(script, 'claimQueueBatch');

        expect(block).toContain('AND q.next_retry_at <= NOW()');
        expect(block).toContain('ORDER BY q.next_retry_at ASC, q.created_at ASC, q.session_id ASC');
        expect(block).toContain('LEFT JOIN session_backup_log bl ON bl.session_id = s.id');
        expect(block).toContain("${buildReadyArtifactStatsJoin('s')}");
        expect(block).toContain("${buildNotFullyBackedUpPredicate('bl', 'artifact_stats.ready_artifact_count')}");
        expect(block).not.toContain('COALESCE(q.next_retry_at, q.created_at)');
    });

    it('deploys a dedicated session-backup-seed cronjob that runs seed-queue every 5 minutes', () => {
        const manifest = readWorkspaceFile('../../../k8s/archive.yaml');

        expect(manifest).toContain('name: session-backup');
        expect(manifest).toContain('schedule: "0 * * * *"');
        expect(manifest).toContain('name: session-backup-seed');
        expect(manifest).toContain('schedule: "*/5 * * * *"');
        expect(manifest).toContain('exec node session-backup.mjs --mode=seed-queue --limit=2000');
        expect(manifest).toContain('name: SESSION_BACKUP_SEED_BATCH_SIZE');
        expect(manifest).toContain('value: "2000"');
    });
});
