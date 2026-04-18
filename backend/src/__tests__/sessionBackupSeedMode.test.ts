import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const TEST_DIR = dirname(fileURLToPath(import.meta.url));

function readWorkspaceFile(relativePathFromTestFile: string): string {
    return readFileSync(resolve(TEST_DIR, relativePathFromTestFile), 'utf8');
}

function extractFunctionBlock(source: string, functionName: string): string {
    const asyncStart = source.indexOf(`async function ${functionName}`);
    const syncStart = source.indexOf(`function ${functionName}`);
    const start = asyncStart === -1 ? syncStart : asyncStart;
    if (start === -1) {
        throw new Error(`Function not found: ${functionName}`);
    }

    const nextAsync = source.indexOf('\nasync function ', start + 1);
    const nextSync = source.indexOf('\nfunction ', start + 1);
    const nextCandidates = [nextAsync, nextSync].filter((index) => index !== -1);
    const nextStart = nextCandidates.length > 0 ? Math.min(...nextCandidates) : -1;
    return source.slice(start, nextStart === -1 ? source.length : nextStart);
}

describe('session backup seed mode', () => {
    it('uses retention-aware priority ordering in fetchSeedCandidates', () => {
        const script = readWorkspaceFile('../../../scripts/k8s/session-backup.mjs');
        const block = extractFunctionBlock(script, 'fetchSeedCandidates');

        expect(block).toContain('LEFT JOIN session_backup_log bl ON bl.session_id = s.id');
        expect(block).toContain("${buildReadyArtifactStatsJoin('s')}");
        expect(block).toContain("${buildBackupEligibilityPredicate('s')}");
        expect(block).toContain("${buildNotFullyBackedUpPredicate('bl', 'artifact_stats.ready_artifact_count')}");
        expect(block).toContain('FROM session_backup_queue q');
        expect(block).toContain('WHERE q.session_id = s.id');
        expect(block).toContain("s.started_at > $2::timestamptz");
        expect(block).toContain("s.started_at = $2::timestamptz AND s.id > $3");
        expect(block).toContain("${buildRetentionPriorityOrderBy({ sessionAlias: 's', sessionIdExpr: 's.id' })}");
        expect(block).not.toContain('FROM ingest_jobs ij');
        expect(block).not.toContain('FROM session_metrics sm');
    });

    it('claims queued sessions with retention-aware priority after retry eligibility', () => {
        const script = readWorkspaceFile('../../../scripts/k8s/session-backup.mjs');
        const block = extractFunctionBlock(script, 'claimQueueBatch');

        expect(block).toContain('AND q.next_retry_at <= NOW()');
        expect(block).toContain("${buildRetentionPriorityOrderBy({ sessionAlias: 's', queueAlias: 'q', sessionIdExpr: 'q.session_id' })}");
        expect(block).toContain('LEFT JOIN session_backup_log bl ON bl.session_id = s.id');
        expect(block).toContain("${buildReadyArtifactStatsJoin('s')}");
        expect(block).toContain("${buildBackupEligibilityPredicate('s')}");
        expect(block).toContain("${buildNotFullyBackedUpPredicate('bl', 'artifact_stats.ready_artifact_count')}");
        expect(block).not.toContain('COALESCE(q.next_retry_at, q.created_at)');
    });

    it('deploys a dedicated session-backup-seed cronjob that runs seed-queue every 5 minutes', () => {
        const manifest = readWorkspaceFile('../../../k8s/archive.yaml');
        const seedBlockStart = manifest.indexOf('name: session-backup-seed');
        const seedBlockEnd = manifest.indexOf('\n---', seedBlockStart);
        const seedBlock = manifest.slice(seedBlockStart, seedBlockEnd === -1 ? manifest.length : seedBlockEnd);

        expect(manifest).toContain('name: session-backup');
        expect(manifest).toContain('schedule: "*/10 * * * *"');
        expect(manifest).toContain('name: SESSION_BACKUP_MAX_PARALLEL');
        expect(manifest).toContain('value: "8"');
        expect(manifest).toContain('name: SESSION_BACKUP_ARTIFACT_PARALLEL');
        expect(manifest).toContain('value: "4"');
        expect(manifest).toContain('name: SESSION_BACKUP_REQUEST_TIMEOUT_MS');
        expect(manifest).toContain('value: "60000"');
        expect(manifest).toContain('name: session-backup-seed');
        expect(manifest).toContain('schedule: "*/5 * * * *"');
        expect(manifest).toContain('exec node session-backup.mjs --mode=seed-queue --limit=2000');
        expect(manifest).toContain('name: SESSION_BACKUP_SEED_BATCH_SIZE');
        expect(manifest).toContain('value: "2000"');
        expect(seedBlock).toContain('suspend: false');
    });

    it('uses explicit request timeouts and disables SDK stream retries for storage calls', () => {
        const script = readWorkspaceFile('../../../scripts/k8s/session-backup.mjs');

        expect(script).toContain('requestTimeoutMs: Number(process.env.SESSION_BACKUP_REQUEST_TIMEOUT_MS || 300000)');
        expect(script).toContain('slowdownRetryBaseMs: Number(process.env.SESSION_BACKUP_SLOWDOWN_RETRY_BASE_MS || 5000)');
        expect(script).toContain('sourceMissingTerminalAttempt: Number(process.env.SESSION_BACKUP_SOURCE_MISSING_TERMINAL_ATTEMPT || 5)');
        expect(script).toContain('maxAttempts: 1');
        expect(script).toContain("msg.includes('reduce your concurrent request rate')");
        expect(script).toContain('controller.abort(timeoutError)');
    });

    it('parks repeated stale source-missing sessions instead of retrying them forever', () => {
        const script = readWorkspaceFile('../../../scripts/k8s/session-backup.mjs');

        expect(script).toContain("status = 'source_missing'");
        expect(script).toContain('missingWithoutUploadCompleted === missingOnSource');
        expect(script).toContain('[terminal-source-missing]');
        expect(script).toContain('marked source_missing after attempt');
    });

    it('defines retention-aware priority bands for expired and near-expiry sessions', () => {
        const script = readWorkspaceFile('../../../scripts/k8s/session-backup.mjs');
        const block = extractFunctionBlock(script, 'buildRetentionPriorityOrderBy');

        expect(block).toContain("WHEN ${expiryExpr} <= NOW() THEN 0");
        expect(block).toContain("WHEN ${expiryExpr} <= NOW() + INTERVAL '1 day' THEN 1");
        expect(block).toContain("${queueAlias}.next_retry_at ASC");
        expect(block).toContain("${sessionAlias}.started_at ASC");
    });

    it('defines observe-only aware backup eligibility bands', () => {
        const script = readWorkspaceFile('../../../scripts/k8s/session-backup.mjs');
        const block = extractFunctionBlock(script, 'buildBackupEligibilityPredicate');

        expect(block).toContain('COALESCE(${sessionAlias}.observe_only, false) = true');
        expect(block).toContain('${statsAlias}.ready_events_count > 0');
        expect(block).toContain('${statsAlias}.ready_hierarchy_count > 0');
        expect(block).toContain('${statsAlias}.ready_screenshots_count = 0');
        expect(block).toContain('COALESCE(${sessionAlias}.observe_only, false) = false');
        expect(block).toContain('${statsAlias}.ready_screenshots_count > 0');
    });
});
