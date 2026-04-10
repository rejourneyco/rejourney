#!/usr/bin/env node

export const BACKUP_QUALITY_RULE_VERSION = 1;
export const HIGH_QUALITY_MIN_VISUAL_DURATION_MS = 3_000;
export const HIGH_QUALITY_MIN_SCREENSHOT_FRAMES = 3;

const REQUIRED_ARTIFACT_KINDS = ['events', 'hierarchy', 'screenshots'];
const SOFT_REASONS = new Set([
  'too_short',
  'low_frame_count',
]);
const LOW_QUALITY_REASONS = new Set([
  'unknown_screenshot_format',
  'invalid_session_duration',
  'invalid_time_range',
]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeInteger(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Math.max(0, Math.trunc(parsed));
}

function collectKinds(records) {
  if (!Array.isArray(records)) {
    return [];
  }

  const kinds = new Set();
  for (const record of records) {
    if (!isPlainObject(record) || typeof record.kind !== 'string') {
      continue;
    }
    const kind = record.kind.trim();
    if (kind) {
      kinds.add(kind);
    }
  }
  return Array.from(kinds).sort();
}

function computeScreenshotCoverageMs(artifacts) {
  if (!Array.isArray(artifacts)) {
    return { coverageMs: 0, invalidTimeRange: true };
  }

  let minStart = Number.POSITIVE_INFINITY;
  let maxEnd = Number.NEGATIVE_INFINITY;
  let invalidTimeRange = false;

  for (const artifact of artifacts) {
    if (!isPlainObject(artifact) || artifact.kind !== 'screenshots') {
      continue;
    }

    const startTime = Number(artifact.startTime ?? 0);
    const endTime = Number(artifact.endTime ?? 0);
    if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || startTime < 0 || endTime < 0 || endTime < startTime) {
      invalidTimeRange = true;
      continue;
    }
    minStart = Math.min(minStart, startTime);
    maxEnd = Math.max(maxEnd, endTime);
  }

  if (!Number.isFinite(minStart) || !Number.isFinite(maxEnd)) {
    return { coverageMs: 0, invalidTimeRange };
  }

  return {
    coverageMs: Math.max(0, maxEnd - minStart),
    invalidTimeRange,
  };
}

function classifyTier(reasons) {
  if (reasons.length === 0) {
    return 'high_quality';
  }

  if (reasons.every((reason) => SOFT_REASONS.has(reason))) {
    return 'usable';
  }

  if (reasons.some((reason) => LOW_QUALITY_REASONS.has(reason))) {
    return 'low_quality';
  }

  return 'broken';
}

export function evaluateBackupQuality({
  manifest,
  plannedArtifactCount,
  artifactCount,
  actualR2ArtifactCount,
  actualR2ObjectCount,
  manifestPresent,
}) {
  const reasons = new Set();
  const session = isPlainObject(manifest?.session) ? manifest.session : null;
  const artifacts = Array.isArray(manifest?.artifacts) ? manifest.artifacts.filter(isPlainObject) : [];
  const backupArtifacts = Array.isArray(manifest?.backupArtifacts) ? manifest.backupArtifacts.filter(isPlainObject) : [];
  const artifactKinds = collectKinds(artifacts);
  const backupArtifactKinds = collectKinds(backupArtifacts);
  const plannedCount = normalizeInteger(plannedArtifactCount);
  const copiedCount = normalizeInteger(artifactCount);
  const r2ArtifactCount = normalizeInteger(actualR2ArtifactCount);
  const r2ObjectCount = normalizeInteger(actualR2ObjectCount);
  const manifestArtifactCount = artifacts.length;
  const backupArtifactCount = backupArtifacts.length;
  const screenshotBackupArtifacts = backupArtifacts.filter((artifact) => artifact.kind === 'screenshots');
  const hierarchyBackupArtifacts = backupArtifacts.filter((artifact) => artifact.kind === 'hierarchy');
  const totalScreenshotFrames = screenshotBackupArtifacts.reduce(
    (sum, artifact) => sum + normalizeInteger(artifact.frameCount),
    0,
  );
  const { coverageMs, invalidTimeRange } = computeScreenshotCoverageMs(artifacts);
  const sessionDurationSeconds = session == null || session.durationSeconds == null
    ? null
    : Number(session.durationSeconds);

  if (!manifestPresent) {
    reasons.add('missing_manifest');
  }
  if (!isPlainObject(manifest)) {
    reasons.add('malformed_manifest');
  }
  if (manifest != null && manifest.version !== '3.0') {
    reasons.add('malformed_manifest');
  }
  if (!session) {
    reasons.add('missing_session');
  }

  for (const kind of REQUIRED_ARTIFACT_KINDS) {
    if (!artifactKinds.includes(kind)) {
      reasons.add(`missing_${kind}`);
    }
  }

  if (plannedCount <= 0 || copiedCount <= 0 || r2ArtifactCount <= 0) {
    reasons.add('count_mismatch');
  }
  if (plannedCount !== copiedCount) {
    reasons.add('planned_vs_copied_mismatch');
  }
  if (copiedCount !== r2ArtifactCount || plannedCount !== r2ArtifactCount) {
    reasons.add('r2_artifact_count_mismatch');
  }
  if (manifestArtifactCount !== copiedCount) {
    reasons.add('manifest_artifact_count_mismatch');
  }
  if (backupArtifactCount !== copiedCount) {
    reasons.add('backup_artifact_count_mismatch');
  }
  if (r2ObjectCount < r2ArtifactCount || (manifestPresent && r2ObjectCount < r2ArtifactCount + 1)) {
    reasons.add('broken_backup_prefix');
  }

  if (backupArtifacts.some((artifact) => artifact.status !== 'copied')) {
    reasons.add('source_missing');
  }
  if (hierarchyBackupArtifacts.some((artifact) => artifact.repairStatus === 'skipped_invalid_payload')) {
    reasons.add('invalid_hierarchy_payload');
  }

  const weirdScreenshotFormats = screenshotBackupArtifacts
    .map((artifact) => artifact.backupFormat)
    .filter((format) => typeof format === 'string')
    .filter((format) => (
      format === 'passthrough_unknown_screenshot_format'
      || format === 'passthrough_invalid_binary_bundle'
      || format === 'mirrored_source'
    ));
  if (weirdScreenshotFormats.length > 0) {
    reasons.add('unknown_screenshot_format');
  }

  if (invalidTimeRange) {
    reasons.add('invalid_time_range');
  }
  if (artifactKinds.includes('screenshots') && coverageMs < HIGH_QUALITY_MIN_VISUAL_DURATION_MS) {
    reasons.add('too_short');
  }
  if (artifactKinds.includes('screenshots') && totalScreenshotFrames < HIGH_QUALITY_MIN_SCREENSHOT_FRAMES) {
    reasons.add('low_frame_count');
  }
  if (sessionDurationSeconds != null && (!Number.isFinite(sessionDurationSeconds) || sessionDurationSeconds < 0)) {
    reasons.add('invalid_session_duration');
  }

  const orderedReasons = Array.from(reasons).sort();
  const qualityTier = classifyTier(orderedReasons);

  return {
    highQuality: orderedReasons.length === 0,
    qualityTier,
    qualityRuleVersion: BACKUP_QUALITY_RULE_VERSION,
    manifestPresent: Boolean(manifestPresent),
    actualR2ArtifactCount: r2ArtifactCount,
    actualR2ObjectCount: r2ObjectCount,
    qualityReason: {
      reasons: orderedReasons,
      artifactKinds,
      backupArtifactKinds,
      plannedArtifactCount: plannedCount,
      artifactCount: copiedCount,
      actualR2ArtifactCount: r2ArtifactCount,
      actualR2ObjectCount: r2ObjectCount,
      manifestArtifactCount,
      backupArtifactCount,
      manifestPresent: Boolean(manifestPresent),
      coverageMs,
      totalScreenshotFrames,
      weirdScreenshotFormats,
    },
  };
}
