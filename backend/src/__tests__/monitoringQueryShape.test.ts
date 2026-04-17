import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const TEST_DIR = dirname(fileURLToPath(import.meta.url));

function readWorkspaceFile(relativePathFromTestFile: string): string {
    return readFileSync(resolve(TEST_DIR, relativePathFromTestFile), 'utf8');
}

describe('monitoring query shape', () => {
    it('uses non-terminal ingest job aggregation instead of full-table count filters', () => {
        const source = readWorkspaceFile('../services/monitoring.ts');

        expect(source).toContain("WHERE status IN ('pending', 'processing', 'dlq', 'failed')");
        expect(source).toContain('GROUP BY status, kind, is_due');
        expect(source).toContain("recording_artifacts_pending_stalled_idx");
        expect(source).not.toContain("COUNT(*) FILTER (WHERE status = 'pending')");
        expect(source).not.toContain("COUNT(*) FILTER (WHERE status = 'processing')");
    });

    it('declares the monitoring-focused indexes in schema', () => {
        const schema = readWorkspaceFile('../db/schema.ts');

        expect(schema).toContain("index('recording_artifacts_created_status_endpoint_idx')");
        expect(schema).toContain("index('recording_artifacts_upload_completed_at_idx')");
        expect(schema).toContain("index('recording_artifacts_pending_stalled_idx')");
        expect(schema).toContain("index('recording_artifacts_session_ready_endpoint_idx')");
        expect(schema).toContain("index('recording_artifacts_failed_recent_idx')");
        expect(schema).toContain("index('ingest_jobs_monitoring_idx')");
    });

    it('keeps postgres exporter queries on pre-aggregated rollups before endpoint joins', () => {
        const exporters = readWorkspaceFile('../../../k8s/exporters.yaml');

        expect(exporters).toContain('rejourney_recording_artifacts_by_status:');
        expect(exporters).toContain('WITH artifact_rollup AS (');
        expect(exporters).toContain('FROM artifact_rollup ar');
        expect(exporters).toContain('rejourney_artifacts_stalled:');
        expect(exporters).toContain('WITH stalled AS (');
        expect(exporters).toContain('rejourney_session_backup_source_buckets_recent:');
        expect(exporters).toContain('WITH recent_backups AS (');
        expect(exporters).toContain('INNER JOIN recent_backups rb ON rb.session_id = ra.session_id');
        expect(exporters).toContain('rejourney_artifacts_failed_recent:');
        expect(exporters).toContain('rejourney_artifacts_upload_latency_recent:');
        expect(exporters).toContain('FROM completed');
    });
});
