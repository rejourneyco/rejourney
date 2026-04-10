#!/usr/bin/env node

import process from 'node:process';
import { DeleteObjectsCommand, GetObjectCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import pg from 'pg';
import { evaluateBackupQuality } from './backup-quality.mjs';

const config = {
  databaseUrl: process.env.DATABASE_URL || '',
  r2Endpoint: process.env.R2_ENDPOINT || '',
  r2Bucket: process.env.R2_BUCKET || '',
  r2AccessKeyId: process.env.R2_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID || '',
  r2SecretAccessKey: process.env.R2_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY || '',
  maxParallel: Number(process.env.SESSION_BACKUP_RECONCILE_MAX_PARALLEL || 12),
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

function parseOption(name) {
  const match = process.argv.slice(2).find((arg) => arg.startsWith(`${name}=`));
  return match ? match.slice(name.length + 1) : null;
}

const mode = parseOption('--mode') || 'zero-artifact';
const apply = process.argv.includes('--apply');
const limitArg = parseOption('--limit');
const limit = limitArg ? Number(limitArg) : null;

if (!['zero-artifact', 'audit-mismatch', 'backfill-quality'].includes(mode)) {
  console.error(`Unsupported --mode: ${mode}`);
  process.exit(1);
}

if (apply && !['zero-artifact', 'backfill-quality'].includes(mode)) {
  console.error('--apply is currently supported only with --mode=zero-artifact or --mode=backfill-quality');
  process.exit(1);
}

if (limitArg && (!Number.isFinite(limit) || limit <= 0)) {
  console.error(`Invalid --limit value: ${limitArg}`);
  process.exit(1);
}

function log(message) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

function chunk(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
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

function buildLimitClause() {
  return limit ? 'LIMIT $1' : '';
}

function buildParams() {
  return limit ? [limit] : [];
}

async function fetchZeroArtifactCandidates() {
  const result = await pool.query(
    `
    SELECT
      session_id,
      r2_key_prefix,
      artifact_count,
      planned_artifact_count,
      backed_up_at::text AS backed_up_at
    FROM session_backup_log
    WHERE artifact_count = 0
    ORDER BY backed_up_at ASC, session_id ASC
    ${buildLimitClause()};
    `,
    buildParams(),
  );

  return result.rows.map((row) => ({
    sessionId: row.session_id,
    r2KeyPrefix: row.r2_key_prefix,
    artifactCount: Number(row.artifact_count || 0),
    plannedArtifactCount: Number(row.planned_artifact_count || 0),
    backedUpAt: row.backed_up_at,
  }));
}

async function fetchMismatchAuditCandidates() {
  const result = await pool.query(
    `
    SELECT
      session_id,
      r2_key_prefix,
      artifact_count,
      planned_artifact_count,
      backed_up_at::text AS backed_up_at
    FROM session_backup_log
    WHERE artifact_count > 0
    ORDER BY backed_up_at ASC, session_id ASC
    ${buildLimitClause()};
    `,
    buildParams(),
  );

  return result.rows.map((row) => ({
    sessionId: row.session_id,
    r2KeyPrefix: row.r2_key_prefix,
    artifactCount: Number(row.artifact_count || 0),
    plannedArtifactCount: Number(row.planned_artifact_count || 0),
    backedUpAt: row.backed_up_at,
  }));
}

async function fetchBackfillQualityCandidates() {
  const result = await pool.query(
    `
    SELECT
      session_id,
      r2_key_prefix,
      artifact_count,
      planned_artifact_count,
      backed_up_at::text AS backed_up_at
    FROM session_backup_log
    WHERE r2_key_prefix IS NOT NULL
    ORDER BY backed_up_at ASC, session_id ASC
    ${buildLimitClause()};
    `,
    buildParams(),
  );

  return result.rows.map((row) => ({
    sessionId: row.session_id,
    r2KeyPrefix: row.r2_key_prefix,
    artifactCount: Number(row.artifact_count || 0),
    plannedArtifactCount: Number(row.planned_artifact_count || 0),
    backedUpAt: row.backed_up_at,
  }));
}

async function scanPrefix(prefix, { collectKeys = false } = {}) {
  if (!prefix) {
    throw new Error('Missing r2_key_prefix');
  }

  let continuationToken;
  let totalObjectCount = 0;
  let artifactObjectCount = 0;
  let manifestCount = 0;
  let totalBytes = 0;
  const keys = [];
  const manifestKey = `${prefix}/manifest.json`;

  do {
    const response = await r2Client.send(new ListObjectsV2Command({
      Bucket: config.r2Bucket,
      Prefix: prefix,
      ContinuationToken: continuationToken,
    }));

    const contents = response.Contents || [];
    for (const object of contents) {
      const key = object.Key || '';
      totalObjectCount += 1;
      totalBytes += Number(object.Size || 0);
      if (key === manifestKey) {
        manifestCount += 1;
      } else {
        artifactObjectCount += 1;
      }
      if (collectKeys && key) {
        keys.push(key);
      }
    }

    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken);

  return {
    prefix,
    keys,
    totalObjectCount,
    artifactObjectCount,
    manifestCount,
    totalBytes,
  };
}

function isNotFound(error) {
  const msg = String(error?.message || '').toLowerCase();
  const name = String(error?.name || '').toLowerCase();
  const code = String(error?.Code || error?.code || '').toLowerCase();
  const httpStatus = error?.$metadata?.httpStatusCode;
  return (
    httpStatus === 404
    || msg.includes('not found')
    || msg.includes('nosuchkey')
    || name === 'nosuchkey'
    || name === 'notfound'
    || code === 'nosuchkey'
    || code === 'notfound'
  );
}

async function readBodyAsString(body) {
  if (!body) {
    return '';
  }
  if (typeof body.transformToString === 'function') {
    return body.transformToString('utf8');
  }

  const chunks = [];
  for await (const chunk of body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function fetchManifest(prefix) {
  const manifestKey = `${prefix}/manifest.json`;
  try {
    const response = await r2Client.send(new GetObjectCommand({
      Bucket: config.r2Bucket,
      Key: manifestKey,
    }));
    const raw = await readBodyAsString(response.Body);
    let manifest = null;
    try {
      manifest = JSON.parse(raw);
    } catch {
      manifest = null;
    }
    return {
      manifestPresent: true,
      manifest,
    };
  } catch (error) {
    if (isNotFound(error)) {
      return {
        manifestPresent: false,
        manifest: null,
      };
    }
    throw error;
  }
}

async function deleteKeys(keys) {
  for (const batch of chunk(keys, 1000)) {
    if (!batch.length) {
      continue;
    }

    const response = await r2Client.send(new DeleteObjectsCommand({
      Bucket: config.r2Bucket,
      Delete: {
        Objects: batch.map((Key) => ({ Key })),
      },
    }));

    if ((response.Errors || []).length > 0) {
      const firstError = response.Errors[0];
      throw new Error(`R2 delete failed: ${firstError.Key || 'unknown key'} ${firstError.Message || ''}`.trim());
    }
  }
}

async function deleteBackupLogRow(sessionId) {
  const result = await pool.query(
    'DELETE FROM session_backup_log WHERE session_id = $1',
    [sessionId],
  );
  return result.rowCount || 0;
}

async function updateQualityColumns(sessionId, quality) {
  await pool.query(
    `
    UPDATE session_backup_log
    SET
      high_quality = $2,
      quality_tier = $3,
      quality_reason = $4::jsonb,
      quality_checked_at = $5::timestamptz,
      quality_rule_version = $6,
      actual_r2_artifact_count = $7,
      actual_r2_object_count = $8,
      manifest_present = $9
    WHERE session_id = $1
    `,
    [
      sessionId,
      quality.highQuality,
      quality.qualityTier,
      JSON.stringify(quality.qualityReason),
      new Date().toISOString(),
      quality.qualityRuleVersion,
      quality.actualR2ArtifactCount,
      quality.actualR2ObjectCount,
      quality.manifestPresent,
    ],
  );
}

async function processZeroArtifactCandidate(candidate) {
  const scan = await scanPrefix(candidate.r2KeyPrefix, { collectKeys: apply });
  let deletedBackupLogRows = 0;

  if (apply) {
    await deleteKeys(scan.keys);
    deletedBackupLogRows = await deleteBackupLogRow(candidate.sessionId);
  }

  return {
    sessionId: candidate.sessionId,
    prefix: candidate.r2KeyPrefix,
    backedUpAt: candidate.backedUpAt,
    artifactCount: candidate.artifactCount,
    plannedArtifactCount: candidate.plannedArtifactCount,
    deletedBackupLogRows,
    ...scan,
  };
}

async function processMismatchCandidate(candidate) {
  const scan = await scanPrefix(candidate.r2KeyPrefix);
  const plannedCopiedMismatch = candidate.plannedArtifactCount !== candidate.artifactCount;
  const copiedR2Mismatch = candidate.artifactCount !== scan.artifactObjectCount;
  const plannedR2Mismatch = candidate.plannedArtifactCount !== scan.artifactObjectCount;
  return {
    sessionId: candidate.sessionId,
    prefix: candidate.r2KeyPrefix,
    backedUpAt: candidate.backedUpAt,
    artifactCount: candidate.artifactCount,
    plannedArtifactCount: candidate.plannedArtifactCount,
    mismatch: plannedCopiedMismatch || copiedR2Mismatch || plannedR2Mismatch,
    plannedCopiedMismatch,
    copiedR2Mismatch,
    plannedR2Mismatch,
    ...scan,
  };
}

async function processBackfillQualityCandidate(candidate) {
  const scan = await scanPrefix(candidate.r2KeyPrefix);
  const manifestResult = await fetchManifest(candidate.r2KeyPrefix);
  const quality = evaluateBackupQuality({
    manifest: manifestResult.manifest,
    plannedArtifactCount: candidate.plannedArtifactCount,
    artifactCount: candidate.artifactCount,
    actualR2ArtifactCount: scan.artifactObjectCount,
    actualR2ObjectCount: scan.totalObjectCount,
    manifestPresent: manifestResult.manifestPresent && scan.manifestCount === 1,
  });

  if (apply) {
    await updateQualityColumns(candidate.sessionId, quality);
  }

  return {
    sessionId: candidate.sessionId,
    prefix: candidate.r2KeyPrefix,
    backedUpAt: candidate.backedUpAt,
    artifactCount: candidate.artifactCount,
    plannedArtifactCount: candidate.plannedArtifactCount,
    ...scan,
    ...quality,
  };
}

function summarizeFailures(results) {
  return results
    .filter((result) => !result.ok)
    .slice(0, 20)
    .map((result) => ({
      sessionId: result.sessionId,
      prefix: result.prefix,
      error: result.error,
    }));
}

async function runZeroArtifactMode() {
  const candidates = await fetchZeroArtifactCandidates();
  log(`Starting session_backup_log zero-artifact reconciliation (${apply ? 'apply' : 'dry-run'})`);
  log(`Found ${candidates.length} zero-artifact backup rows`);

  const results = await runPool(candidates, config.maxParallel, async (candidate, index) => {
    try {
      const result = {
        ok: true,
        ...await processZeroArtifactCandidate(candidate),
      };
      if ((index + 1) % 250 === 0 || index === candidates.length - 1) {
        log(`Progress: ${index + 1}/${candidates.length}`);
      }
      return result;
    } catch (error) {
      return {
        ok: false,
        sessionId: candidate.sessionId,
        prefix: candidate.r2KeyPrefix,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  const successes = results.filter((result) => result.ok);
  const failures = results.filter((result) => !result.ok);
  const totalObjects = successes.reduce((sum, result) => sum + result.totalObjectCount, 0);
  const totalBytes = successes.reduce((sum, result) => sum + result.totalBytes, 0);
  const deletedRows = successes.reduce((sum, result) => sum + result.deletedBackupLogRows, 0);

  log(
    `${apply ? 'Apply summary' : 'Dry-run summary'}: `
      + `${successes.length}/${results.length} rows scanned, `
      + `${totalObjects} R2 objects, `
      + `${Math.round(totalBytes / 1024)} KB, `
      + `${apply ? `${deletedRows} backup log rows removed` : `${successes.length} backup log rows would be removed`}`,
  );

  console.log(JSON.stringify({
    mode,
    apply,
    sample: successes.slice(0, 10).map((result) => ({
      sessionId: result.sessionId,
      prefix: result.prefix,
      totalObjectCount: result.totalObjectCount,
      artifactObjectCount: result.artifactObjectCount,
      manifestCount: result.manifestCount,
      totalBytes: result.totalBytes,
      deletedBackupLogRows: result.deletedBackupLogRows,
    })),
    failures: summarizeFailures(results),
  }, null, 2));

  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

async function runMismatchAuditMode() {
  const candidates = await fetchMismatchAuditCandidates();
  log('Starting session_backup_log vs R2 mismatch audit');
  log(`Found ${candidates.length} backup rows with artifact_count > 0`);

  const results = await runPool(candidates, config.maxParallel, async (candidate, index) => {
    try {
      const result = {
        ok: true,
        ...await processMismatchCandidate(candidate),
      };
      if ((index + 1) % 250 === 0 || index === candidates.length - 1) {
        log(`Progress: ${index + 1}/${candidates.length}`);
      }
      return result;
    } catch (error) {
      return {
        ok: false,
        sessionId: candidate.sessionId,
        prefix: candidate.r2KeyPrefix,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  const successes = results.filter((result) => result.ok);
  const failures = results.filter((result) => !result.ok);
  const mismatches = successes.filter((result) => result.mismatch);
  const plannedCopiedMismatches = successes.filter((result) => result.plannedCopiedMismatch).length;
  const copiedR2Mismatches = successes.filter((result) => result.copiedR2Mismatch).length;
  const plannedR2Mismatches = successes.filter((result) => result.plannedR2Mismatch).length;
  const manifestMissing = successes.filter((result) => result.manifestCount === 0);

  log(
    `Audit summary: ${successes.length}/${results.length} rows scanned, `
      + `${mismatches.length} three-way mismatches, `
      + `${plannedCopiedMismatches} planned-vs-copied, `
      + `${copiedR2Mismatches} copied-vs-R2, `
      + `${plannedR2Mismatches} planned-vs-R2, `
      + `${manifestMissing.length} prefixes missing manifest.json`,
  );

  console.log(JSON.stringify({
    mode,
    scanned: successes.length,
    mismatches: mismatches.length,
    plannedCopiedMismatches,
    copiedR2Mismatches,
    plannedR2Mismatches,
    manifestMissing: manifestMissing.length,
    sampleMismatches: mismatches.slice(0, 20).map((result) => ({
      sessionId: result.sessionId,
      prefix: result.prefix,
      artifactCount: result.artifactCount,
      plannedArtifactCount: result.plannedArtifactCount,
      plannedCopiedMismatch: result.plannedCopiedMismatch,
      copiedR2Mismatch: result.copiedR2Mismatch,
      plannedR2Mismatch: result.plannedR2Mismatch,
      artifactObjectCount: result.artifactObjectCount,
      manifestCount: result.manifestCount,
      totalObjectCount: result.totalObjectCount,
      totalBytes: result.totalBytes,
    })),
    failures: summarizeFailures(results),
  }, null, 2));

  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

async function runBackfillQualityMode() {
  const candidates = await fetchBackfillQualityCandidates();
  log(`Starting session_backup_log quality backfill (${apply ? 'apply' : 'dry-run'})`);
  log(`Found ${candidates.length} current backup-log rows to classify`);

  const results = await runPool(candidates, config.maxParallel, async (candidate, index) => {
    try {
      const result = {
        ok: true,
        ...await processBackfillQualityCandidate(candidate),
      };
      if ((index + 1) % 250 === 0 || index === candidates.length - 1) {
        log(`Progress: ${index + 1}/${candidates.length}`);
      }
      return result;
    } catch (error) {
      return {
        ok: false,
        sessionId: candidate.sessionId,
        prefix: candidate.r2KeyPrefix,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  const successes = results.filter((result) => result.ok);
  const failures = results.filter((result) => !result.ok);
  const highQuality = successes.filter((result) => result.highQuality).length;
  const lowQuality = successes.filter((result) => result.qualityTier === 'low_quality').length;
  const usable = successes.filter((result) => result.qualityTier === 'usable').length;
  const broken = successes.filter((result) => result.qualityTier === 'broken').length;

  log(
    `${apply ? 'Apply summary' : 'Dry-run summary'}: `
      + `${successes.length}/${results.length} rows classified, `
      + `${highQuality} high_quality, `
      + `${usable} usable, `
      + `${lowQuality} low_quality, `
      + `${broken} broken`,
  );

  console.log(JSON.stringify({
    mode,
    apply,
    scanned: successes.length,
    highQuality,
    usable,
    lowQuality,
    broken,
    sampleNonHighQuality: successes
      .filter((result) => !result.highQuality)
      .slice(0, 20)
      .map((result) => ({
        sessionId: result.sessionId,
        prefix: result.prefix,
        qualityTier: result.qualityTier,
        reasons: result.qualityReason.reasons,
        plannedArtifactCount: result.plannedArtifactCount,
        artifactCount: result.artifactCount,
        actualR2ArtifactCount: result.actualR2ArtifactCount,
        actualR2ObjectCount: result.actualR2ObjectCount,
      })),
    failures: summarizeFailures(results),
  }, null, 2));

  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

async function main() {
  if (mode === 'zero-artifact') {
    await runZeroArtifactMode();
    return;
  }

  if (mode === 'audit-mismatch') {
    await runMismatchAuditMode();
    return;
  }

  await runBackfillQualityMode();
}

main()
  .catch((error) => {
    console.error(error.stack || error.message || String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => {});
  });
