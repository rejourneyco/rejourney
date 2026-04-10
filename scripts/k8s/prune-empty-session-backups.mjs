#!/usr/bin/env node

import process from 'node:process';
import { S3Client, DeleteObjectsCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import pg from 'pg';

const config = {
  databaseUrl: process.env.DATABASE_URL || '',
  r2Endpoint: process.env.R2_ENDPOINT || '',
  r2Bucket: process.env.R2_BUCKET || '',
  r2AccessKeyId: process.env.R2_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID || '',
  r2SecretAccessKey: process.env.R2_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY || '',
  maxParallel: Number(process.env.EMPTY_BACKUP_PRUNE_MAX_PARALLEL || 6),
};

const requiredVars = [
  ['DATABASE_URL', config.databaseUrl],
  ['R2_ENDPOINT', config.r2Endpoint],
  ['R2_BUCKET', config.r2Bucket],
  ['R2 access key', config.r2AccessKeyId],
  ['R2 secret key', config.r2SecretAccessKey],
];

for (const [label, value] of requiredVars) {
  if (!value) {
    console.error(`Missing required configuration: ${label}`);
    process.exit(1);
  }
}

const argv = new Set(process.argv.slice(2));
const dryRun = !argv.has('--apply');

function parseOption(name) {
  const match = process.argv.slice(2).find((arg) => arg.startsWith(`${name}=`));
  return match ? match.slice(name.length + 1) : null;
}

const limitArg = parseOption('--limit');
const limit = limitArg ? Number(limitArg) : null;
if (limitArg && (!Number.isFinite(limit) || limit <= 0)) {
  console.error(`Invalid --limit value: ${limitArg}`);
  process.exit(1);
}

function log(message) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

function buildMeaningfulSessionMetricsPredicateSql(metricsAlias) {
  return `
COALESCE(${metricsAlias}.total_events, 0) > 0
                    OR COALESCE(${metricsAlias}.error_count, 0) > 0
                    OR COALESCE(${metricsAlias}.touch_count, 0) > 0
                    OR COALESCE(${metricsAlias}.scroll_count, 0) > 0
                    OR COALESCE(${metricsAlias}.gesture_count, 0) > 0
                    OR COALESCE(${metricsAlias}.input_count, 0) > 0
                    OR COALESCE(${metricsAlias}.api_success_count, 0) > 0
                    OR COALESCE(${metricsAlias}.api_error_count, 0) > 0
                    OR COALESCE(${metricsAlias}.api_total_count, 0) > 0
                    OR COALESCE(${metricsAlias}.rage_tap_count, 0) > 0
                    OR COALESCE(${metricsAlias}.dead_tap_count, 0) > 0
                    OR COALESCE(array_length(${metricsAlias}.screens_visited, 1), 0) > 0
                    OR COALESCE(${metricsAlias}.interaction_score, 0) > 0
                    OR COALESCE(${metricsAlias}.exploration_score, 0) > 0
                    OR COALESCE(${metricsAlias}.ux_score, 0) > 0
                    OR COALESCE(${metricsAlias}.events_size_bytes, 0) > 0
                    OR COALESCE(${metricsAlias}.custom_event_count, 0) > 0
                    OR COALESCE(${metricsAlias}.crash_count, 0) > 0
                    OR COALESCE(${metricsAlias}.anr_count, 0) > 0
                    OR COALESCE(${metricsAlias}.app_startup_time_ms, 0) > 0
                    OR COALESCE(${metricsAlias}.sdk_upload_success_count, 0) > 0
                    OR COALESCE(${metricsAlias}.sdk_upload_failure_count, 0) > 0
                    OR COALESCE(${metricsAlias}.sdk_retry_attempt_count, 0) > 0
                    OR COALESCE(${metricsAlias}.sdk_circuit_breaker_open_count, 0) > 0
                    OR COALESCE(${metricsAlias}.sdk_memory_eviction_count, 0) > 0
                    OR COALESCE(${metricsAlias}.sdk_offline_persist_count, 0) > 0
                    OR COALESCE(${metricsAlias}.sdk_upload_success_rate, 0) > 0
                    OR COALESCE(${metricsAlias}.sdk_avg_upload_duration_ms, 0) > 0
                    OR COALESCE(${metricsAlias}.sdk_total_bytes_uploaded, 0) > 0
                    OR COALESCE(${metricsAlias}.sdk_total_bytes_evicted, 0) > 0
                    OR COALESCE(${metricsAlias}.hierarchy_snapshot_count, 0) > 0
                    OR COALESCE(${metricsAlias}.screenshot_segment_count, 0) > 0
                    OR COALESCE(${metricsAlias}.screenshot_total_bytes, 0) > 0
  `.trim();
}

function buildEmptySessionPredicateSql(sessionAlias = 's') {
  const metricsAlias = 'sm';
  const meaningfulMetricsPredicate = buildMeaningfulSessionMetricsPredicateSql(metricsAlias);

  return `
NOT EXISTS (
                SELECT 1
                FROM recording_artifacts ra
                WHERE ra.session_id = ${sessionAlias}.id
            )
            AND NOT EXISTS (
                SELECT 1
                FROM ingest_jobs ij
                WHERE ij.session_id = ${sessionAlias}.id
            )
            AND COALESCE(${sessionAlias}.replay_available, false) = false
            AND COALESCE(${sessionAlias}.replay_segment_count, 0) = 0
            AND COALESCE(${sessionAlias}.replay_storage_bytes, 0) = 0
            AND (
                CASE
                    WHEN ${sessionAlias}.events IS NULL THEN 0
                    WHEN jsonb_typeof(${sessionAlias}.events) = 'array' THEN jsonb_array_length(${sessionAlias}.events)
                    ELSE 0
                END
            ) = 0
            AND COALESCE(${sessionAlias}.metadata, '{}'::jsonb) = '{}'::jsonb
            AND NOT EXISTS (
                SELECT 1
                FROM session_metrics ${metricsAlias}
                WHERE ${metricsAlias}.session_id = ${sessionAlias}.id
                  AND (
                    ${meaningfulMetricsPredicate}
                  )
            )
  `.trim();
}

const ZERO_OBJECT_RETENTION_LOG_PREDICATE_SQL = `
EXISTS (
            SELECT 1
            FROM retention_deletion_log rdl
            WHERE rdl.session_id = s.id
              AND rdl.scope = 'session_purge'
              AND rdl.status = 'completed'
              AND COALESCE(rdl.planned_artifact_row_count, 0) = 0
              AND COALESCE(rdl.planned_ingest_job_count, 0) = 0
              AND COALESCE(rdl.deleted_artifact_row_count, 0) = 0
              AND COALESCE(rdl.deleted_object_count, 0) = 0
        )
`.trim();

const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: Math.max(2, config.maxParallel + 1),
});

const r2Client = new S3Client({
  endpoint: config.r2Endpoint,
  region: 'auto',
  credentials: {
    accessKeyId: config.r2AccessKeyId,
    secretAccessKey: config.r2SecretAccessKey,
  },
  forcePathStyle: true,
});

function buildCanonicalBackupPrefix(candidate) {
  return `backups/tenant/${candidate.teamId}/project/${candidate.projectId}/sessions/${candidate.sessionId}`;
}

async function fetchCandidates() {
  const emptySessionPredicate = buildEmptySessionPredicateSql('s');
  const limitClause = limit ? 'LIMIT $1' : '';
  const params = limit ? [limit] : [];

  const result = await pool.query(
    `
    SELECT
      s.id AS session_id,
      s.project_id,
      p.team_id,
      s.recording_deleted,
      bl.session_id IS NOT NULL AS has_backup_log,
      bl.r2_key_prefix,
      bl.backed_up_at::text AS backed_up_at,
      ${ZERO_OBJECT_RETENTION_LOG_PREDICATE_SQL} AS has_zero_object_retention_log
    FROM sessions s
    JOIN projects p ON p.id = s.project_id
    LEFT JOIN session_backup_log bl ON bl.session_id = s.id
    WHERE (
      ${emptySessionPredicate}
    )
      AND (
        bl.session_id IS NOT NULL
        OR ${ZERO_OBJECT_RETENTION_LOG_PREDICATE_SQL}
      )
    ORDER BY
      COALESCE(bl.backed_up_at, s.updated_at, s.started_at) ASC,
      s.id ASC
    ${limitClause};
    `,
    params,
  );

  return result.rows.map((row) => ({
    sessionId: row.session_id,
    projectId: row.project_id,
    teamId: row.team_id,
    recordingDeleted: Boolean(row.recording_deleted),
    hasBackupLog: Boolean(row.has_backup_log),
    r2KeyPrefix: row.r2_key_prefix,
    backedUpAt: row.backed_up_at,
    hasZeroObjectRetentionLog: Boolean(row.has_zero_object_retention_log),
  }));
}

async function inspectOrDeleteR2Prefix(prefix, apply) {
  let continuationToken;
  let objectCount = 0;
  let totalBytes = 0;

  do {
    const listResp = await r2Client.send(new ListObjectsV2Command({
      Bucket: config.r2Bucket,
      Prefix: prefix,
      ContinuationToken: continuationToken,
    }));

    const contents = listResp.Contents || [];
    objectCount += contents.length;
    totalBytes += contents.reduce((sum, object) => sum + Number(object.Size || 0), 0);

    if (apply && contents.length > 0) {
      await r2Client.send(new DeleteObjectsCommand({
        Bucket: config.r2Bucket,
        Delete: {
          Objects: contents
            .map((object) => object.Key)
            .filter(Boolean)
            .map((Key) => ({ Key })),
        },
      }));
    }

    continuationToken = listResp.IsTruncated ? listResp.NextContinuationToken : undefined;
  } while (continuationToken);

  return { objectCount, totalBytes };
}

async function deleteBackupLogRow(sessionId, apply) {
  if (!apply) {
    return 0;
  }

  const result = await pool.query(
    'DELETE FROM session_backup_log WHERE session_id = $1',
    [sessionId],
  );

  return result.rowCount || 0;
}

async function runPool(items, workerCount, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const actualWorkers = Math.max(1, Math.min(workerCount, items.length || 1));

  async function next() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) {
        return;
      }
      results[index] = await worker(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: actualWorkers }, () => next()));
  return results;
}

async function processCandidate(candidate, index) {
  const prefix = candidate.r2KeyPrefix || buildCanonicalBackupPrefix(candidate);
  const r2 = await inspectOrDeleteR2Prefix(prefix, !dryRun);
  const deletedBackupLogRows = await deleteBackupLogRow(candidate.sessionId, !dryRun);

  return {
    sessionId: candidate.sessionId,
    index,
    prefix,
    objectCount: r2.objectCount,
    totalBytes: r2.totalBytes,
    deletedBackupLogRows,
    recordingDeleted: candidate.recordingDeleted,
    hasBackupLog: candidate.hasBackupLog,
    hasZeroObjectRetentionLog: candidate.hasZeroObjectRetentionLog,
  };
}

async function main() {
  log(`Starting empty-session backup prune (${dryRun ? 'dry-run' : 'apply'})`);
  const candidates = await fetchCandidates();

  const alreadyDeleted = candidates.filter((candidate) => candidate.recordingDeleted).length;
  const withBackupLog = candidates.filter((candidate) => candidate.hasBackupLog).length;
  const fromRetentionLog = candidates.filter((candidate) => candidate.hasZeroObjectRetentionLog).length;

  log(
    `Found ${candidates.length} candidate sessions `
    + `(${alreadyDeleted} already recording_deleted, ${withBackupLog} with backup log, ${fromRetentionLog} in zero-object retention log)`,
  );

  if (!candidates.length) {
    return;
  }

  const results = await runPool(candidates, config.maxParallel, async (candidate, index) => {
    let result;
    try {
      result = {
        ok: true,
        ...await processCandidate(candidate, index),
      };
    } catch (error) {
      result = {
        ok: false,
        sessionId: candidate.sessionId,
        index,
        prefix: candidate.r2KeyPrefix || buildCanonicalBackupPrefix(candidate),
        error: error instanceof Error ? error.message : String(error),
      };
    }
    if ((index + 1) % 100 === 0 || index === candidates.length - 1) {
      log(`Progress: ${index + 1}/${candidates.length}`);
    }
    return result;
  });

  const failures = results.filter((result) => !result.ok);
  const successes = results.filter((result) => result.ok);
  const totalObjects = successes.reduce((sum, result) => sum + result.objectCount, 0);
  const totalBytes = successes.reduce((sum, result) => sum + result.totalBytes, 0);
  const totalBackupLogRows = successes.reduce((sum, result) => sum + result.deletedBackupLogRows, 0);

  log(
    `${dryRun ? 'Dry-run summary' : 'Apply summary'}: `
    + `${successes.length}/${results.length} sessions succeeded, `
    + `${totalObjects} R2 objects, `
    + `${Math.round(totalBytes / 1024)} KB, `
    + `${dryRun ? `${withBackupLog} backup log rows would be removed` : `${totalBackupLogRows} backup log rows removed`}`,
  );

  const samples = successes
    .filter((result) => result.objectCount > 0 || result.deletedBackupLogRows > 0 || dryRun)
    .slice(0, 10)
    .map((result) => ({
      sessionId: result.sessionId,
      prefix: result.prefix,
      objectCount: result.objectCount,
      totalBytes: result.totalBytes,
      deletedBackupLogRows: result.deletedBackupLogRows,
    }));

  if (samples.length > 0) {
    console.log(JSON.stringify({ dryRun, samples }, null, 2));
  }

  if (failures.length > 0) {
    console.log(JSON.stringify({
      dryRun,
      failures: failures.slice(0, 20).map((result) => ({
        sessionId: result.sessionId,
        prefix: result.prefix,
        error: result.error,
      })),
    }, null, 2));
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(error.stack || error.message || String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => {});
  });
