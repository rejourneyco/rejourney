#!/usr/bin/env node

/**
 * Session Backup Script
 *
 * Archives session artifacts from production S3 (Hetzner) to Cloudflare R2
 * for long-term storage and future ML / data-modeling use.
 *
 * Key design choices:
 *
 * 1. **Canonical backup with archive-friendly screenshots** — Events and
 *    hierarchy are backed up in their canonical runtime format, with one
 *    safe source-side repair for legacy hierarchy objects stored as raw JSON
 *    under a `.json.gz` key. Screenshot artifacts are transformed on the
 *    backup side into real tar.gz archives so R2 downloads open in standard
 *    archive tools.
 *
 * 2. **Tenant-prefix only** — Only artifacts stored under the current
 *    `tenant/{teamId}/project/{projectId}/sessions/{sessionId}/` key
 *    format are backed up. Legacy `sessions/` prefix data is skipped.
 *
 * 3. **Includes retention-deleted sessions** — Sessions whose screenshots
 *    were already deleted by the retention worker are still backed up;
 *    their events and hierarchy remain in S3 and get archived. Missing
 *    screenshots are recorded as source_missing in the manifest.
 *
 * 4. **R2 structure keeps the same key layout:**
 *
 *      backups/tenant/{teamId}/project/{projectId}/sessions/{sessionId}/
 *        ├── manifest.json
 *        ├── events/events_0_xxx.json.gz
 *        ├── hierarchy/123456.json.gz
 *        └── screenshots/123456.tar.gz   (real tar.gz on R2)
 *
 * 5. **All-or-nothing** — ALL artifacts for a session must succeed or the
 *    entire session is rolled back and retried on the next run.
 *
 * 6. **Piggyback size correction** — While processing, the real S3 object
 *    size is written back to recording_artifacts.size_bytes for any
 *    historical rows where the SDK recorded the pre-compression size.
 */

import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';

// =============================================================================
// Configuration
// =============================================================================

const config = {
  databaseUrl: process.env.DATABASE_URL || '',
  sourceEndpoint: process.env.S3_ENDPOINT || '',
  sourceBucket: process.env.S3_BUCKET || '',
  sourceAccessKeyId: process.env.S3_SRC_ACCESS_KEY_ID || process.env.S3_ACCESS_KEY_ID || '',
  sourceSecretAccessKey: process.env.S3_SRC_SECRET_ACCESS_KEY || process.env.S3_SECRET_ACCESS_KEY || '',
  r2Endpoint: process.env.R2_ENDPOINT || '',
  r2Bucket: process.env.R2_BUCKET || '',
  r2AccessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
  r2SecretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  batchSize: Number(process.env.SESSION_BACKUP_BATCH_SIZE || 50),
  batchFetchSize: Number(process.env.SESSION_BACKUP_BATCH_FETCH_SIZE || 200),
  maxParallel: Number(process.env.SESSION_BACKUP_MAX_PARALLEL || 4),
  maxRetries: Number(process.env.SESSION_BACKUP_MAX_RETRIES || 3),
  lockStaleMinutes: Number(process.env.SESSION_BACKUP_LOCK_STALE_MINUTES || 30),
  lockHeartbeatMs: Number(process.env.SESSION_BACKUP_LOCK_HEARTBEAT_MS || 60000),
  repairLegacyHierarchy: process.env.SESSION_BACKUP_REPAIR_LEGACY_HIERARCHY_GZIP !== '0',
  archiveFriendlyScreenshots: process.env.SESSION_BACKUP_ARCHIVE_FRIENDLY_SCREENSHOTS !== '0',
  reprocessBackedUp: ['1', 'true', 'yes'].includes(String(process.env.SESSION_BACKUP_REPROCESS_BACKED_UP || '').toLowerCase()),
};

const requiredVars = [
  ['DATABASE_URL', config.databaseUrl],
  ['S3_ENDPOINT', config.sourceEndpoint],
  ['S3_BUCKET', config.sourceBucket],
  ['S3 access key', config.sourceAccessKeyId],
  ['S3 secret key', config.sourceSecretAccessKey],
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

const SRC_AWS_ENV = {
  AWS_ACCESS_KEY_ID: config.sourceAccessKeyId,
  AWS_SECRET_ACCESS_KEY: config.sourceSecretAccessKey,
};

const R2_AWS_ENV = {
  AWS_ACCESS_KEY_ID: config.r2AccessKeyId,
  AWS_SECRET_ACCESS_KEY: config.r2SecretAccessKey,
};

const RUN_LOCK_NAME = 'global';

const ARTIFACT_CONTENT_TYPE = 'application/gzip';
const MANIFEST_CONTENT_TYPE = 'application/json';

// =============================================================================
// Utility Helpers
// =============================================================================

function log(message) {
  console.log(`[${new Date().toUTCString().replace('GMT', 'UTC')}] ${message}`);
}

function warn(message) {
  console.warn(`  WARN ${message}`);
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function parseRows(text, columns) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split('\t');
      const row = {};
      columns.forEach((column, index) => {
        row[column] = parts[index] ?? '';
      });
      return row;
    });
}

function firstNonEmptyLine(text) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean) || '';
}

function isGzipBuffer(buffer) {
  return buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b;
}

function isBinaryFrameBundle(buffer) {
  if (buffer.length < 16) return false;

  const possibleSize = buffer.readUInt32BE(8);
  return (
    buffer[12] === 0xff &&
    buffer[13] === 0xd8 &&
    buffer[14] === 0xff &&
    possibleSize > 0 &&
    possibleSize < buffer.length
  );
}

function parseTarEntries(buffer) {
  const files = [];
  let offset = 0;

  while (offset < buffer.length - 512) {
    const header = buffer.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;

    const nameEnd = header.indexOf(0);
    const name = header.subarray(0, nameEnd > 0 ? Math.min(nameEnd, 100) : 100).toString('utf8').trim();
    const sizeStr = header.subarray(124, 136).toString('utf8').trim();
    const size = parseInt(sizeStr, 8) || 0;
    const typeFlag = header[156];
    const isRegularFile = typeFlag === 0 || typeFlag === 48;

    offset += 512;

    if (isRegularFile && size > 0) {
      files.push({
        name,
        data: Buffer.from(buffer.subarray(offset, offset + size)),
      });
    }

    offset += Math.ceil(size / 512) * 512;
  }

  return files;
}

function parseBinaryFrames(buffer, sessionStartTime) {
  const frames = [];
  let offset = 0;

  while (offset + 12 <= buffer.length) {
    const tsHigh = buffer.readUInt32BE(offset);
    const tsLow = buffer.readUInt32BE(offset + 4);
    const tsOffset = tsHigh * 0x100000000 + tsLow;
    const jpegSize = buffer.readUInt32BE(offset + 8);

    offset += 12;

    if (jpegSize <= 0 || offset + jpegSize > buffer.length) break;
    if (buffer[offset] !== 0xff || buffer[offset + 1] !== 0xd8) break;

    frames.push({
      timestamp: sessionStartTime + tsOffset,
      data: Buffer.from(buffer.subarray(offset, offset + jpegSize)),
    });

    offset += jpegSize;
  }

  return frames;
}

function buildBackedUpFilterClause() {
  if (config.reprocessBackedUp) {
    return '';
  }

  return `
        AND NOT EXISTS (
          SELECT 1 FROM session_backup_log bl
          WHERE bl.session_id = s.id
        )`;
}

async function withRetry(fn, label, options = {}) {
  const shouldRetry = options.shouldRetry || (() => true);
  for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === config.maxRetries || !shouldRetry(err)) throw err;
      const delayMs = 1000 * Math.pow(2, attempt - 1);
      warn(`${label}: attempt ${attempt}/${config.maxRetries} failed (${err.message}), retrying in ${delayMs}ms`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

// =============================================================================
// Shell / Process Helpers
// =============================================================================

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: { ...process.env, ...(options.env || {}) },
      cwd: options.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const stdout = [];
    const stderr = [];

    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      const result = {
        code: code ?? 0,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      };
      if (result.code === 0 || options.allowFailure) {
        resolve(result);
        return;
      }

      const err = new Error(`${command} ${args.join(' ')} failed with code ${result.code}: ${result.stderr || result.stdout}`.trim());
      err.result = result;
      reject(err);
    });
  });
}

async function runSql(query) {
  const result = await runCommand('psql', [config.databaseUrl, '-X', '-A', '-F', '\t', '-t', '-c', query]);
  return result.stdout.trim();
}

// =============================================================================
// Database Setup & Locking
// =============================================================================

async function ensureBackupLogTable() {
  await runSql(`
    CREATE TABLE IF NOT EXISTS session_backup_log (
      session_id VARCHAR(64) PRIMARY KEY,
      backed_up_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      r2_key_prefix TEXT NOT NULL,
      artifact_count INT NOT NULL DEFAULT 0,
      total_bytes BIGINT NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS session_backup_log_backed_up_at_idx
      ON session_backup_log(backed_up_at);
    CREATE TABLE IF NOT EXISTS session_backup_run_lock (
      lock_name TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      acquired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

function buildRunOwnerId() {
  return `session-backup:${os.hostname()}:${process.pid}:${Date.now()}`;
}

async function tryAcquireRunLock(ownerId) {
  const result = await runSql(`
    WITH lock_row AS (
      INSERT INTO session_backup_run_lock (lock_name, owner_id, acquired_at, heartbeat_at)
      VALUES (
        ${shellQuote(RUN_LOCK_NAME)},
        ${shellQuote(ownerId)},
        NOW(),
        NOW()
      )
      ON CONFLICT (lock_name) DO UPDATE
      SET owner_id = EXCLUDED.owner_id,
          acquired_at = NOW(),
          heartbeat_at = NOW()
      WHERE session_backup_run_lock.owner_id = EXCLUDED.owner_id
         OR session_backup_run_lock.heartbeat_at < NOW() - (${Number(config.lockStaleMinutes)} * INTERVAL '1 minute')
      RETURNING owner_id
    )
    SELECT owner_id FROM lock_row;
  `);

  return result === ownerId;
}

async function refreshRunLock(ownerId) {
  const result = firstNonEmptyLine(await runSql(`
    UPDATE session_backup_run_lock
    SET heartbeat_at = NOW()
    WHERE lock_name = ${shellQuote(RUN_LOCK_NAME)}
      AND owner_id = ${shellQuote(ownerId)}
    RETURNING owner_id;
  `));

  if (result !== ownerId) {
    throw new Error('session backup run lock lost');
  }
}

async function releaseRunLock(ownerId) {
  await runSql(`
    DELETE FROM session_backup_run_lock
    WHERE lock_name = ${shellQuote(RUN_LOCK_NAME)}
      AND owner_id = ${shellQuote(ownerId)};
  `);
}

// =============================================================================
// Session Queries
// =============================================================================

function orderedSessionsCte() {
  return `
    WITH eligible AS (
      SELECT
        s.id,
        s.project_id,
        p.team_id,
        regexp_replace(COALESCE(p.name, 'unknown-project'), E'[\\\\t\\\\n\\\\r]+', ' ', 'g') AS project_name,
        s.started_at,
        s.started_at::date AS session_date,
        COALESCE(NULLIF(LOWER(s.platform), ''), 'unknown') AS platform,
        FLOOR(EXTRACT(EPOCH FROM s.started_at) * 1000)::bigint AS session_start_ms
      FROM sessions s
      JOIN projects p ON p.id = s.project_id
      WHERE s.status IN ('ready', 'completed')
${buildBackedUpFilterClause()}
        AND p.deleted_at IS NULL
    ),
    ranked AS (
      SELECT
        e.*,
        CASE
          WHEN e.platform IN ('android', 'ios') THEN
            ROW_NUMBER() OVER (PARTITION BY e.platform ORDER BY e.started_at ASC, e.id ASC)
          ELSE NULL
        END AS mobile_rank,
        CASE
          WHEN e.platform NOT IN ('android', 'ios') THEN
            ROW_NUMBER() OVER (ORDER BY e.started_at ASC, e.id ASC)
          ELSE NULL
        END AS other_rank
      FROM eligible e
    )
  `;
}

async function countEligibleSessions() {
  const result = await runSql(`
    SELECT COUNT(*)
    FROM sessions s
    JOIN projects p ON p.id = s.project_id
    WHERE s.status IN ('ready', 'completed')
${buildBackedUpFilterClause()}
      AND p.deleted_at IS NULL;
  `);
  return Number(result || 0);
}

async function fetchCandidateSessions(limit, offset = 0) {
  const rows = await runSql(`
    ${orderedSessionsCte()}
    SELECT
      id,
      project_id,
      team_id,
      project_name,
      session_date::text,
      platform,
      session_start_ms::text,
      started_at::text
    FROM ranked
    ORDER BY
      CASE WHEN platform IN ('android', 'ios') THEN 0 ELSE 1 END,
      CASE WHEN platform IN ('android', 'ios') THEN mobile_rank ELSE other_rank END,
      CASE WHEN platform = 'android' THEN 0 WHEN platform = 'ios' THEN 1 ELSE 0 END,
      started_at ASC,
      id ASC
    LIMIT ${Number(limit)}
    OFFSET ${Number(offset)};
  `);

  return parseRows(rows, [
    'id',
    'projectId',
    'teamId',
    'projectName',
    'sessionDate',
    'platform',
    'sessionStartMs',
    'startedAt',
  ]).map((row) => ({
    id: row.id,
    projectId: row.projectId,
    teamId: row.teamId,
    projectName: row.projectName,
    sessionDate: row.sessionDate,
    platform: row.platform || 'unknown',
    sessionStartMs: Number(row.sessionStartMs || 0),
    startedAt: row.startedAt,
  }));
}

// =============================================================================
// Manifest & Artifacts
// =============================================================================

async function buildManifest(sessionId) {
  const raw = await runSql(`
    SELECT json_build_object(
      'version', '3.0',
      'session', json_build_object(
        'id', s.id,
        'projectId', s.project_id,
        'deviceId', s.device_id,
        'platform', s.platform,
        'appVersion', s.app_version,
        'deviceModel', s.device_model,
        'osVersion', s.os_version,
        'sdkVersion', s.sdk_version,
        'userDisplayId', s.user_display_id,
        'startedAt', s.started_at::text,
        'endedAt', s.ended_at::text,
        'durationSeconds', s.duration_seconds,
        'backgroundTimeSeconds', s.background_time_seconds,
        'status', s.status,
        'retentionTier', s.retention_tier,
        'retentionDays', s.retention_days,
        'isSampledIn', s.is_sampled_in,
        'replayPromoted', s.replay_promoted,
        'replayPromotedReason', s.replay_promoted_reason,
        'replaySegmentCount', s.replay_segment_count,
        'replayStorageBytes', s.replay_storage_bytes,
        'geoCountry', s.geo_country,
        'geoCountryCode', s.geo_country_code,
        'geoCity', s.geo_city,
        'geoRegion', s.geo_region,
        'geoTimezone', s.geo_timezone,
        'metadata', s.metadata
      ),
      'metrics', (
        SELECT json_build_object(
          'totalEvents', m.total_events,
          'errorCount', m.error_count,
          'touchCount', m.touch_count,
          'scrollCount', m.scroll_count,
          'gestureCount', m.gesture_count,
          'inputCount', m.input_count,
          'apiSuccessCount', m.api_success_count,
          'apiErrorCount', m.api_error_count,
          'apiTotalCount', m.api_total_count,
          'apiAvgResponseMs', m.api_avg_response_ms,
          'rageTapCount', m.rage_tap_count,
          'deadTapCount', m.dead_tap_count,
          'screensVisited', m.screens_visited,
          'interactionScore', m.interaction_score,
          'explorationScore', m.exploration_score,
          'uxScore', m.ux_score,
          'customEventCount', m.custom_event_count,
          'crashCount', m.crash_count,
          'anrCount', m.anr_count,
          'appStartupTimeMs', m.app_startup_time_ms,
          'networkType', m.network_type,
          'cellularGeneration', m.cellular_generation,
          'isConstrained', m.is_constrained,
          'isExpensive', m.is_expensive,
          'screenshotSegmentCount', m.screenshot_segment_count,
          'screenshotTotalBytes', m.screenshot_total_bytes,
          'hierarchySnapshotCount', m.hierarchy_snapshot_count
        )
        FROM session_metrics m
        WHERE m.session_id = s.id
      ),
      'artifacts', (
        SELECT COALESCE(json_agg(json_build_object(
          'id', ra.id,
          'kind', ra.kind,
          'sourceKey', ra.s3_object_key,
          'sizeBytes', ra.size_bytes,
          'startTime', ra.start_time,
          'endTime', ra.end_time,
          'frameCount', ra.frame_count
        ) ORDER BY ra.kind, ra.start_time NULLS LAST, ra.created_at ASC), '[]'::json)
        FROM recording_artifacts ra
        WHERE ra.session_id = s.id AND ra.status = 'ready'
      )
    )::text
    FROM sessions s
    WHERE s.id = ${shellQuote(sessionId)};
  `);

  if (!raw) {
    throw new Error(`missing session manifest for ${sessionId}`);
  }

  return JSON.parse(raw);
}

async function fetchArtifacts(sessionId) {
  const raw = await runSql(`
    SELECT
      kind,
      s3_object_key,
      COALESCE(size_bytes, 0)::text,
      COALESCE(start_time, 0)::text,
      COALESCE(end_time, 0)::text,
      COALESCE(frame_count, 0)::text,
      COALESCE(created_at::text, '')
    FROM recording_artifacts
    WHERE session_id = ${shellQuote(sessionId)}
      AND status = 'ready'
      AND s3_object_key LIKE 'tenant/%'
    ORDER BY
      kind,
      start_time NULLS LAST,
      created_at ASC,
      s3_object_key ASC;
  `);

  return parseRows(raw, [
    'kind',
    's3ObjectKey',
    'sizeBytes',
    'startTime',
    'endTime',
    'frameCount',
    'createdAt',
  ]).map((row) => ({
    kind: row.kind,
    s3ObjectKey: row.s3ObjectKey,
    sizeBytes: Number(row.sizeBytes || 0),
    startTime: Number(row.startTime || 0),
    endTime: Number(row.endTime || 0),
    frameCount: Number(row.frameCount || 0),
    createdAt: row.createdAt,
  }));
}

async function insertBackupLog(sessionId, prefix, artifactCount, totalBytes) {
  await runSql(`
    INSERT INTO session_backup_log (session_id, r2_key_prefix, artifact_count, total_bytes)
    VALUES (
      ${shellQuote(sessionId)},
      ${shellQuote(prefix)},
      ${Number(artifactCount)},
      ${Number(totalBytes)}
    )
    ON CONFLICT (session_id) DO NOTHING;
  `);
}

/**
 * Correct size_bytes in recording_artifacts to reflect the real S3 object size.
 * Historical rows have the pre-compression payload size the SDK reported;
 * this piggybacks on the backup download to fix them with zero extra S3 calls.
 */
async function correctArtifactSize(s3ObjectKey, realBytes) {
  await runSql(`
    UPDATE recording_artifacts
    SET size_bytes = ${Number(realBytes)}
    WHERE s3_object_key = ${shellQuote(s3ObjectKey)}
      AND (size_bytes IS NULL OR size_bytes != ${Number(realBytes)});
  `).catch(() => {});
}

// =============================================================================
// S3 / R2 Operations with Integrity Checks
// =============================================================================

async function downloadSourceArtifact(sourceKey, outputPath) {
  await runCommand(
    'aws',
    [
      '--endpoint-url',
      config.sourceEndpoint,
      's3',
      'cp',
      '--only-show-errors',
      `s3://${config.sourceBucket}/${sourceKey}`,
      outputPath,
    ],
    { env: SRC_AWS_ENV },
  );
}

async function uploadToSource(localPath, destinationKey, contentType) {
  await runCommand(
    'aws',
    [
      '--endpoint-url',
      config.sourceEndpoint,
      's3',
      'cp',
      '--only-show-errors',
      localPath,
      `s3://${config.sourceBucket}/${destinationKey}`,
      '--content-type',
      contentType,
    ],
    { env: SRC_AWS_ENV },
  );
}

async function uploadToR2(localPath, destinationKey, contentType) {
  await runCommand(
    'aws',
    [
      '--endpoint-url',
      config.r2Endpoint,
      's3',
      'cp',
      '--only-show-errors',
      localPath,
      `s3://${config.r2Bucket}/${destinationKey}`,
      '--content-type',
      contentType,
    ],
    { env: R2_AWS_ENV },
  );
}

async function headR2Object(key) {
  const result = await runCommand(
    'aws',
    [
      '--endpoint-url',
      config.r2Endpoint,
      's3api',
      'head-object',
      '--bucket',
      config.r2Bucket,
      '--key',
      key,
    ],
    { env: R2_AWS_ENV },
  );
  return JSON.parse(result.stdout);
}

async function headSourceObject(key) {
  const result = await runCommand(
    'aws',
    [
      '--endpoint-url',
      config.sourceEndpoint,
      's3api',
      'head-object',
      '--bucket',
      config.sourceBucket,
      '--key',
      key,
    ],
    { env: SRC_AWS_ENV },
  );
  return JSON.parse(result.stdout);
}

async function removeR2Prefix(prefix) {
  await runCommand(
    'aws',
    ['--endpoint-url', config.r2Endpoint, 's3', 'rm', `s3://${config.r2Bucket}/${prefix}`, '--recursive'],
    { env: R2_AWS_ENV, allowFailure: true },
  );
}

/**
 * Verify downloaded file is non-empty and return its size.
 *
 * NOTE: We intentionally do NOT compare against recording_artifacts.size_bytes.
 * That column stores the pre-compression payload size reported by the SDK,
 * which differs from the actual S3 object size (gzipped). Small payloads
 * grow under gzip (header overhead), large ones shrink. Comparing would
 * reject every correct download.
 */
async function verifyDownload(filePath, label) {
  const { size } = await stat(filePath);
  if (size === 0) {
    throw new Error(`${label}: downloaded file is empty (0 bytes)`);
  }
  return size;
}

/**
 * Verify that the R2 upload matches the local file size.
 */
async function verifyUpload(r2Key, expectedBytes, label) {
  const head = await headR2Object(r2Key);
  const remoteSize = head.ContentLength;
  if (remoteSize !== expectedBytes) {
    throw new Error(`${label}: size mismatch after upload (expected ${expectedBytes}, R2 has ${remoteSize})`);
  }
}

async function verifySourceUpload(sourceKey, expectedBytes, label) {
  const head = await headSourceObject(sourceKey);
  const remoteSize = head.ContentLength;
  if (remoteSize !== expectedBytes) {
    throw new Error(`${label}: source size mismatch after repair (expected ${expectedBytes}, source has ${remoteSize})`);
  }
}

/**
 * Returns true if the error looks like a 404 / NoSuchKey from the source.
 */
function isSourceNotFound(error) {
  const msg = (error.message || '').toLowerCase();
  return msg.includes('not found') || msg.includes('nosuchkey') || msg.includes('404') || msg.includes('does not exist');
}

async function maybeRepairLegacyHierarchyArtifact(tempPath, artifact, artifactLabel) {
  const currentBuffer = await readFile(tempPath);

  if (
    !config.repairLegacyHierarchy ||
    artifact.kind !== 'hierarchy' ||
    !artifact.s3ObjectKey.endsWith('.json.gz')
  ) {
    return { status: 'unchanged', sizeBytes: currentBuffer.length };
  }

  if (isGzipBuffer(currentBuffer)) {
    return { status: 'already_gzipped', sizeBytes: currentBuffer.length };
  }

  try {
    JSON.parse(currentBuffer.toString('utf8'));
  } catch {
    warn(`${artifactLabel}: hierarchy object ends with .json.gz but raw bytes are not valid JSON; backing up unchanged`);
    return { status: 'skipped_invalid_payload', sizeBytes: currentBuffer.length };
  }

  const repairedBuffer = gzipSync(currentBuffer, { level: 9 });
  await writeFile(tempPath, repairedBuffer);

  await withRetry(async () => {
    await uploadToSource(tempPath, artifact.s3ObjectKey, ARTIFACT_CONTENT_TYPE);
    await verifySourceUpload(artifact.s3ObjectKey, repairedBuffer.length, artifactLabel);
  }, `repair ${artifactLabel}`);

  log(`Normalized legacy hierarchy artifact in source S3: ${artifactLabel}`);
  return { status: 'recompressed_raw_json', sizeBytes: repairedBuffer.length };
}

async function createTarGzFromFrames(tempPath, frames, artifactLabel) {
  const framesDir = await mkdtemp(path.join(os.tmpdir(), 'session-backup-frames-'));

  try {
    const filenames = [];

    for (let index = 0; index < frames.length; index += 1) {
      const frame = frames[index];
      const filename = `frame_${String(index).padStart(4, '0')}_${frame.timestamp}.jpg`;
      await writeFile(path.join(framesDir, filename), frame.data);
      filenames.push(filename);
    }

    if (filenames.length === 0) {
      throw new Error(`${artifactLabel}: screenshot bundle contained no extractable frames`);
    }

    await runCommand('tar', ['-czf', tempPath, '-C', framesDir, ...filenames]);

    const { size } = await stat(tempPath);
    if (size === 0) {
      throw new Error(`${artifactLabel}: repacked tar.gz is empty`);
    }

    return size;
  } finally {
    await rm(framesDir, { recursive: true, force: true });
  }
}

async function maybeTransformScreenshotForBackup(tempPath, artifact, artifactLabel, sessionStartTime) {
  const currentBuffer = await readFile(tempPath);

  if (!config.archiveFriendlyScreenshots || artifact.kind !== 'screenshots') {
    return {
      backupFormat: 'mirrored_source',
      sizeBytes: currentBuffer.length,
      frameCount: artifact.frameCount || 0,
    };
  }

  const rawBuffer = isGzipBuffer(currentBuffer) ? gunzipSync(currentBuffer) : currentBuffer;
  const tarEntries = parseTarEntries(rawBuffer).filter((entry) => /\.jpe?g$/i.test(entry.name));

  if (tarEntries.length > 0) {
    if (isGzipBuffer(currentBuffer)) {
      return {
        backupFormat: 'already_archive_friendly_tar_gzip',
        sizeBytes: currentBuffer.length,
        frameCount: tarEntries.length,
      };
    }

    const repackedTarGz = gzipSync(rawBuffer, { level: 9 });
    await writeFile(tempPath, repackedTarGz);
    return {
      backupFormat: 'tar_gzip_from_raw_tar',
      sizeBytes: repackedTarGz.length,
      frameCount: tarEntries.length,
    };
  }

  if (!isBinaryFrameBundle(rawBuffer)) {
    warn(`${artifactLabel}: screenshot payload is not a recognized tar or binary frame bundle; backing up unchanged`);
    return {
      backupFormat: 'passthrough_unknown_screenshot_format',
      sizeBytes: currentBuffer.length,
      frameCount: artifact.frameCount || 0,
    };
  }

  const frames = parseBinaryFrames(rawBuffer, sessionStartTime);
  if (frames.length === 0) {
    warn(`${artifactLabel}: screenshot bundle looked binary but no frames could be extracted; backing up unchanged`);
    return {
      backupFormat: 'passthrough_invalid_binary_bundle',
      sizeBytes: currentBuffer.length,
      frameCount: artifact.frameCount || 0,
    };
  }

  const repackedSize = await createTarGzFromFrames(tempPath, frames, artifactLabel);
  return {
    backupFormat: 'tar_gzip_repacked_from_binary_bundle',
    sizeBytes: repackedSize,
    frameCount: frames.length,
  };
}

// =============================================================================
// Session Processing — canonical backup with archive-friendly screenshots
// =============================================================================

function buildBackupPrefix(session) {
  return `backups/tenant/${session.teamId}/project/${session.projectId}/sessions/${session.id}`;
}

async function processSession(session) {
  const prefix = buildBackupPrefix(session);
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'session-backup-'));

  const backupArtifacts = [];

  try {
    const artifacts = await fetchArtifacts(session.id);
    const manifest = await buildManifest(session.id);
    let totalBytes = 0;
    let missingOnSource = 0;

    for (let i = 0; i < artifacts.length; i++) {
      const artifact = artifacts[i];
      const tempPath = path.join(tempDir, `artifact-${i}`);
      const backupKey = `backups/${artifact.s3ObjectKey}`;
      const artifactLabel = `${session.id}/${artifact.kind}[${i}]`;

      try {
        let sourceSize;
        let backupSize;
        let repairStatus = 'unchanged';
        let backupFormat = 'mirrored_source';
        let backupFrameCount = artifact.frameCount;
        await withRetry(
          async () => {
            await downloadSourceArtifact(artifact.s3ObjectKey, tempPath);
            sourceSize = await verifyDownload(tempPath, artifactLabel);
          },
          `download ${artifactLabel}`,
          { shouldRetry: (error) => !isSourceNotFound(error) },
        );

        const repairResult = await maybeRepairLegacyHierarchyArtifact(tempPath, artifact, artifactLabel);
        sourceSize = repairResult.sizeBytes;
        repairStatus = repairResult.status;

        if (artifact.sizeBytes !== sourceSize) {
          await correctArtifactSize(artifact.s3ObjectKey, sourceSize);
        }

        const backupTransform = await maybeTransformScreenshotForBackup(
          tempPath,
          artifact,
          artifactLabel,
          session.sessionStartMs,
        );
        backupSize = backupTransform.sizeBytes;
        backupFormat = backupTransform.backupFormat;
        backupFrameCount = backupTransform.frameCount;

        await withRetry(async () => {
          await uploadToR2(tempPath, backupKey, ARTIFACT_CONTENT_TYPE);
          await verifyUpload(backupKey, backupSize, artifactLabel);
        }, `upload ${artifactLabel}`);

        await unlink(tempPath).catch(() => {});

        backupArtifacts.push({
          kind: artifact.kind,
          sourceKey: artifact.s3ObjectKey,
          backupKey,
          repairStatus,
          backupFormat,
          sourceSizeBytes: sourceSize,
          sizeBytes: backupSize,
          frameCount: backupFrameCount,
          status: 'copied',
        });
        totalBytes += backupSize;
      } catch (error) {
        await unlink(tempPath).catch(() => {});

        if (isSourceNotFound(error)) {
          missingOnSource += 1;
          warn(`${artifactLabel}: source not found, skipping (${error.message})`);
          backupArtifacts.push({
            kind: artifact.kind,
            sourceKey: artifact.s3ObjectKey,
            backupKey,
            repairStatus: 'source_missing',
            backupFormat: 'source_missing',
            sourceSizeBytes: artifact.sizeBytes,
            sizeBytes: artifact.sizeBytes,
            frameCount: artifact.frameCount,
            status: 'source_missing',
          });
          continue;
        }

        throw new Error(`artifact ${artifactLabel} failed after ${config.maxRetries} attempts: ${error.message}`);
      }
    }

    const copiedCount = backupArtifacts.filter((a) => a.status === 'copied').length;

    manifest.exportedAt = new Date().toISOString();
    manifest.backupArtifacts = backupArtifacts;

    const manifestPath = path.join(tempDir, 'manifest.json');
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    await uploadToR2(manifestPath, `${prefix}/manifest.json`, MANIFEST_CONTENT_TYPE);
    await insertBackupLog(session.id, prefix, copiedCount, totalBytes);

    return {
      ok: true,
      sessionId: session.id,
      artifactCount: copiedCount,
      missingOnSource,
      totalBytes,
    };
  } catch (error) {
    await removeR2Prefix(prefix);
    return {
      ok: false,
      sessionId: session.id,
      reason: error.message,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

// =============================================================================
// Parallel Worker Pool
// =============================================================================

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

// =============================================================================
// Main
// =============================================================================

async function main() {
  log('Starting session backup (legacy hierarchy gzip repair + archive-friendly screenshot repack)');
  if (config.reprocessBackedUp) {
    warn('SESSION_BACKUP_REPROCESS_BACKED_UP is enabled; this run will revisit sessions that were already backed up');
  }
  await ensureBackupLogTable();
  const ownerId = buildRunOwnerId();
  const acquired = await tryAcquireRunLock(ownerId);
  if (!acquired) {
    log('Another session backup run is already active; skipping this run');
    return;
  }

  let cleanedUp = false;
  const heartbeat = setInterval(() => {
    refreshRunLock(ownerId).catch((error) => {
      warn(`Failed to refresh run lock: ${error.message}`);
    });
  }, config.lockHeartbeatMs);
  heartbeat.unref();

  const cleanup = async () => {
    if (cleanedUp) return;
    cleanedUp = true;
    clearInterval(heartbeat);
    await releaseRunLock(ownerId);
  };

  const handleSignal = (signal) => {
    warn(`Received ${signal}; releasing run lock before exit`);
    cleanup()
      .catch((error) => warn(`Failed to release run lock during ${signal}: ${error.message}`))
      .finally(() => process.exit(signal === 'SIGINT' ? 130 : 143));
  };

  process.once('SIGTERM', () => handleSignal('SIGTERM'));
  process.once('SIGINT', () => handleSignal('SIGINT'));

  try {
    const totalEligible = await countEligibleSessions();
    log(`Found ${totalEligible} sessions to back up (parallelism: ${config.maxParallel}, retries: ${config.maxRetries})`);
    if (!totalEligible) {
      return;
    }

    let backedUp = 0;
    let errors = 0;
    let totalBytes = 0;
    const failedThisRun = new Set();

    while (backedUp < totalEligible) {
      const batch = [];
      let offset = 0;

      while (batch.length < config.batchSize) {
        const candidates = await fetchCandidateSessions(config.batchFetchSize, offset);
        if (!candidates.length) {
          break;
        }

        for (const session of candidates) {
          if (failedThisRun.has(session.id)) {
            continue;
          }
          batch.push(session);
          if (batch.length >= config.batchSize) {
            break;
          }
        }

        offset += candidates.length;
        if (candidates.length < config.batchFetchSize) {
          break;
        }
      }

      if (!batch.length) {
        break;
      }

      const results = await runPool(batch, config.maxParallel, processSession);
      for (const result of results) {
        if (result.ok) {
          backedUp += 1;
          totalBytes += result.totalBytes;
          const missingNote = result.missingOnSource > 0 ? `, ${result.missingOnSource} missing on source` : '';
          console.log(`  OK ${result.sessionId}: ${result.artifactCount} artifacts, ~${Math.round(result.totalBytes / 1024)} KB${missingNote}`);
        } else {
          errors += 1;
          failedThisRun.add(result.sessionId);
          warn(`${result.sessionId}: ${result.reason}`);
        }
      }

      await refreshRunLock(ownerId);
      log(`Progress: ${backedUp}/${totalEligible} backed up, ${errors} failed this run`);
    }

    log(`Session backup complete: ${backedUp} sessions backed up, ${errors} failed this run, ~${Math.round(totalBytes / 1024 / 1024)} MB total`);
  } finally {
    await cleanup();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
