import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { and, asc, eq } from 'drizzle-orm';
import jpegModule from 'jpeg-js';

const sessionId = process.env.MATRIX_SESSION_ID ?? '';
const projectId = process.env.MATRIX_PROJECT_ID ?? '';

if (!/^session_[A-Za-z0-9_-]{1,56}$/.test(sessionId)) {
  throw new Error('MATRIX_SESSION_ID is missing or invalid');
}
if (!/^[0-9a-fA-F-]{36}$/.test(projectId)) {
  throw new Error('MATRIX_PROJECT_ID is missing or invalid');
}

const { dbRead, pool, recordingArtifacts, sessions } = await import('./dist/db/client.js');
const { downloadFromS3ForArtifact } = await import('./dist/db/s3.js');
const { extractFramesFromArchive } = await import('./dist/services/screenshotFrames.js');
const jpeg = jpegModule.default ?? jpegModule;

function unwrapGzip(data, objectKey) {
  // downloadFromS3ForArtifact already decompresses objects whose keys end in
  // .gz. Keep the magic-byte check so the auditor also accepts raw downloads.
  const isGzip = data.length > 2 && data[0] === 0x1f && data[1] === 0x8b;
  return isGzip ? gunzipSync(data) : data;
}

function parseJsonArtifact(data, objectKey) {
  return JSON.parse(unwrapGzip(data, objectKey).toString('utf8'));
}

function artifactEvents(parsed) {
  if (Array.isArray(parsed)) return parsed;
  return Array.isArray(parsed?.events) ? parsed.events : [];
}

function eventTimestamp(event) {
  const value = Number(event?.timestamp ?? event?.time ?? event?.ts);
  return Number.isFinite(value) ? value : null;
}

function eventLabel(event) {
  return String(event?.name ?? event?.event ?? event?.type ?? 'unknown');
}

function summarizeJpeg(data) {
  const decoded = jpeg.decode(data, {
    formatAsRGBA: true,
    tolerantDecoding: true,
    useTArray: true,
  });
  if (!decoded?.data || !decoded.width || !decoded.height) {
    throw new Error('JPEG decoder returned an empty frame');
  }

  let count = 0;
  let sum = 0;
  let sumSquares = 0;
  let darkPixels = 0;
  const pixelStride = 16;
  for (let pixel = 0; pixel < decoded.width * decoded.height; pixel += pixelStride) {
    const index = pixel * 4;
    const luminance =
      decoded.data[index] * 0.2126 +
      decoded.data[index + 1] * 0.7152 +
      decoded.data[index + 2] * 0.0722;
    count += 1;
    sum += luminance;
    sumSquares += luminance * luminance;
    if (luminance < 8) darkPixels += 1;
  }

  const mean = sum / count;
  const variance = Math.max(0, sumSquares / count - mean * mean);
  return {
    width: decoded.width,
    height: decoded.height,
    meanLuminance: mean,
    luminanceStdDev: Math.sqrt(variance),
    darkPixelRatio: darkPixels / count,
  };
}

async function mapWithConcurrency(items, limit, mapper) {
  const output = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      output[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return output;
}

const [session] = await dbRead
  .select({
    id: sessions.id,
    projectId: sessions.projectId,
    startedAt: sessions.startedAt,
    endedAt: sessions.endedAt,
    status: sessions.status,
    events: sessions.events,
  })
  .from(sessions)
  .where(and(eq(sessions.id, sessionId), eq(sessions.projectId, projectId)))
  .limit(1);

if (!session) throw new Error('Session does not exist in the requested project');

const artifacts = await dbRead
  .select({
    kind: recordingArtifacts.kind,
    clientUploadId: recordingArtifacts.clientUploadId,
    objectKey: recordingArtifacts.s3ObjectKey,
    endpointId: recordingArtifacts.endpointId,
    declaredSizeBytes: recordingArtifacts.declaredSizeBytes,
    startTime: recordingArtifacts.startTime,
    endTime: recordingArtifacts.endTime,
    frameCount: recordingArtifacts.frameCount,
    sizeBytes: recordingArtifacts.sizeBytes,
    status: recordingArtifacts.status,
    createdAt: recordingArtifacts.createdAt,
  })
  .from(recordingArtifacts)
  .where(eq(recordingArtifacts.sessionId, sessionId))
  .orderBy(asc(recordingArtifacts.startTime), asc(recordingArtifacts.createdAt));

const retryFamily = clientUploadId =>
  String(clientUploadId ?? '').replace(/_[0-9a-f]{8}$/i, '');
const readyArtifacts = artifacts.filter(artifact => artifact.status === 'ready');
const readyRetryFamilies = new Set(
  readyArtifacts
    .map(artifact => retryFamily(artifact.clientUploadId))
    .filter(Boolean),
);
const supersededArtifacts = artifacts.filter(artifact =>
  artifact.status !== 'ready'
  && Boolean(retryFamily(artifact.clientUploadId))
  && readyRetryFamilies.has(retryFamily(artifact.clientUploadId)),
);
const unmatchedArtifacts = artifacts.filter(artifact =>
  artifact.status !== 'ready'
  && !readyRetryFamilies.has(retryFamily(artifact.clientUploadId)),
);

const downloaded = await mapWithConcurrency(readyArtifacts, 6, async artifact => ({
  artifact,
  data: await downloadFromS3ForArtifact(projectId, artifact.objectKey, artifact.endpointId),
}));

const missingObjects = downloaded
  .filter(item => !item.data)
  .map(item => item.artifact.objectKey);
if (missingObjects.length > 0) {
  throw new Error(`Unable to download ${missingObjects.length} artifact object(s)`);
}

const forbiddenStrings = [
  'matrix-public-query',
  'matrix tester',
  '4242 4242 4242 4242',
  'quarterly plan upgrade notes',
  'premium_test_9f41',
];
// The matrix intentionally sends this value through identify(), so its presence
// in an event payload proves identity telemetry works. It must never be exposed
// by a captured view hierarchy, where it represents visible user data.
const hierarchyOnlyForbiddenStrings = ['user_abc123'];
const auditedStrings = [...forbiddenStrings, ...hierarchyOnlyForbiddenStrings];
const privacyHits = Object.fromEntries(auditedStrings.map(value => [value, []]));
const allEvents = [];
const eventArtifactDeviceInfo = [];
const hierarchyTimestamps = [];
const frames = [];

for (const item of downloaded) {
  const { artifact, data } = item;
  if (artifact.kind === 'events' || artifact.kind === 'hierarchy') {
    const raw = unwrapGzip(data, artifact.objectKey).toString('utf8');
    const lowered = raw.toLowerCase();
    const stringsForKind = artifact.kind === 'hierarchy'
      ? auditedStrings
      : forbiddenStrings;
    for (const value of stringsForKind) {
      if (lowered.includes(value)) privacyHits[value].push(artifact.kind);
    }
    const parsed = JSON.parse(raw);
    if (artifact.kind === 'events') {
      allEvents.push(...artifactEvents(parsed));
      const info = parsed?.deviceInfo && typeof parsed.deviceInfo === 'object'
        ? parsed.deviceInfo
        : {};
      eventArtifactDeviceInfo.push({
        appVersion: info.appVersion ?? null,
        sdkVersion: info.sdkVersion ?? null,
        platform: info.platform ?? null,
        osVersionPresent: Boolean(info.osVersion || info.systemVersion),
        modelPresent: Boolean(info.model),
        batteryLevelPresent: info.batteryLevelPercent !== null
          && info.batteryLevelPercent !== undefined,
        batteryState: info.batteryState ?? null,
        lowPowerModePresent: typeof info.lowPowerModeEnabled === 'boolean',
        thermalState: info.thermalState ?? null,
        memoryPressure: info.memoryPressure ?? null,
        fontScaleBucket: info.fontScaleBucket ?? null,
        uiStyle: info.uiStyle ?? null,
        layoutDirection: info.layoutDirection ?? null,
        orientation: info.orientation ?? null,
        displayMaxRefreshRateHz: info.displayMaxRefreshRateHz ?? null,
      });
    } else {
      hierarchyTimestamps.push(
        Number(artifact.startTime ?? parsed?.timestamp ?? parsed?.capturedAt),
      );
    }
  }

  if (artifact.kind === 'screenshots') {
    const extracted = await extractFramesFromArchive(
      data,
      session.startedAt.getTime(),
    );
    frames.push(...extracted);
  }
}

const pauseMarkers = (Array.isArray(session.events) ? session.events : [])
  .filter(event => ['sdk_paused', 'sdk_resumed'].includes(String(event?.name).toLowerCase()))
  .map(event => {
    let payload = event?.payload;
    if (typeof payload === 'string') {
      try {
        payload = JSON.parse(payload);
      } catch {
        payload = null;
      }
    }
    return {
      name: String(event.name).toLowerCase(),
      timestamp: Number(event.timestamp),
      pauseId: payload?.pauseId ?? null,
    };
  })
  .filter(event => Number.isFinite(event.timestamp))
  .sort((left, right) => left.timestamp - right.timestamp);

const pausePairs = [];
for (const paused of pauseMarkers.filter(marker => marker.name === 'sdk_paused')) {
  const resumed = pauseMarkers.find(
    marker => marker.name === 'sdk_resumed' && marker.timestamp >= paused.timestamp,
  );
  if (resumed) pausePairs.push({ paused, resumed });
}

const eventTimestamps = allEvents
  .map(eventTimestamp)
  .filter(timestamp => timestamp !== null);
const frameTimestamps = frames.map(frame => frame.timestamp);
const gapLeaks = pausePairs.map(({ paused, resumed }) => ({
  pauseIdMatches: paused.pauseId === resumed.pauseId,
  durationMs: resumed.timestamp - paused.timestamp,
  eventCount: eventTimestamps.filter(
    timestamp => timestamp > paused.timestamp && timestamp < resumed.timestamp,
  ).length,
  hierarchyCount: hierarchyTimestamps.filter(
    timestamp => timestamp > paused.timestamp && timestamp < resumed.timestamp,
  ).length,
  frameCount: frameTimestamps.filter(
    timestamp => timestamp > paused.timestamp && timestamp < resumed.timestamp,
  ).length,
}));

const frameSummaries = frames.map(frame => ({
  timestamp: frame.timestamp,
  hash: createHash('sha256').update(frame.data).digest('hex'),
  bytes: frame.data.length,
  ...summarizeJpeg(frame.data),
}));
const dimensions = [...new Set(frameSummaries.map(frame => `${frame.width}x${frame.height}`))];
const uniqueFrameCount = new Set(frameSummaries.map(frame => frame.hash)).size;
const duplicateGroups = Object.values(
  frameSummaries.reduce((groups, frame) => {
    (groups[frame.hash] ??= []).push(frame.timestamp);
    return groups;
  }, {}),
).filter(timestamps => timestamps.length > 1);
const consecutiveDuplicateCount = frameSummaries.reduce(
  (count, frame, index) =>
    count + (index > 0 && frame.hash === frameSummaries[index - 1].hash ? 1 : 0),
  0,
);
const nonMonotonicFrameCount = frameTimestamps.reduce(
  (count, timestamp, index) =>
    count + (index > 0 && timestamp <= frameTimestamps[index - 1] ? 1 : 0),
  0,
);
const blankCandidates = frameSummaries.filter(
  frame => frame.meanLuminance < 5 || frame.luminanceStdDev < 3 || frame.darkPixelRatio > 0.99,
);

const eventCounts = {};
for (const event of allEvents) {
  const label = eventLabel(event);
  eventCounts[label] = (eventCounts[label] ?? 0) + 1;
}

const report = {
  session: {
    id: session.id,
    status: session.status,
    startedAt: session.startedAt.toISOString(),
    endedAt: session.endedAt?.toISOString() ?? null,
  },
  artifacts: {
    total: artifacts.length,
    ready: readyArtifacts.length,
    supersededReservations: supersededArtifacts.map(artifact => ({
      kind: artifact.kind,
      clientUploadId: artifact.clientUploadId,
      declaredSizeBytes: artifact.declaredSizeBytes,
      status: artifact.status,
    })),
    unmatchedNonReady: unmatchedArtifacts.map(artifact => ({
      kind: artifact.kind,
      clientUploadId: artifact.clientUploadId,
      declaredSizeBytes: artifact.declaredSizeBytes,
      status: artifact.status,
    })),
    downloaded: downloaded.length - missingObjects.length,
    declaredBytes: artifacts.reduce((sum, artifact) => sum + Number(artifact.sizeBytes ?? 0), 0),
    byKind: Object.fromEntries(
      [...new Set(artifacts.map(artifact => artifact.kind))].map(kind => [
        kind,
        artifacts.filter(artifact => artifact.kind === kind).length,
      ]),
    ),
  },
  events: {
    decoded: allEvents.length,
    timestamped: eventTimestamps.length,
    firstTimestamp: Math.min(...eventTimestamps),
    lastTimestamp: Math.max(...eventTimestamps),
    topLabels: Object.entries(eventCounts)
      .sort((left, right) => right[1] - left[1])
      .slice(0, 20),
    diagnostics: allEvents
      .filter(event => ['anr', 'crash', 'error'].includes(eventLabel(event).toLowerCase()))
      .map(event => event),
    artifactDeviceInfo: [
      ...new Map(
        eventArtifactDeviceInfo.map(info => [JSON.stringify(info), info]),
      ).values(),
    ],
  },
  pause: {
    markers: pauseMarkers,
    gaps: gapLeaks,
  },
  privacy: {
    forbiddenStringsPresent: Object.fromEntries(
      Object.entries(privacyHits).filter(([, kinds]) => kinds.length > 0),
    ),
  },
  frames: {
    decoded: frameSummaries.length,
    unique: uniqueFrameCount,
    duplicateGroups,
    consecutiveDuplicateCount,
    nonMonotonicTimestampCount: nonMonotonicFrameCount,
    dimensions,
    firstTimestamp: Math.min(...frameTimestamps),
    lastTimestamp: Math.max(...frameTimestamps),
    bytes: {
      min: Math.min(...frameSummaries.map(frame => frame.bytes)),
      max: Math.max(...frameSummaries.map(frame => frame.bytes)),
    },
    meanLuminance: {
      min: Math.min(...frameSummaries.map(frame => frame.meanLuminance)),
      max: Math.max(...frameSummaries.map(frame => frame.meanLuminance)),
    },
    luminanceStdDev: {
      min: Math.min(...frameSummaries.map(frame => frame.luminanceStdDev)),
      max: Math.max(...frameSummaries.map(frame => frame.luminanceStdDev)),
    },
    blankCandidates: blankCandidates.map(frame => frame.timestamp),
  },
  assertions: {
    allArtifactsReadyOrSuperseded: unmatchedArtifacts.length === 0,
    allArtifactsDownloaded: missingObjects.length === 0,
    noForbiddenPlaintext: Object.values(privacyHits).every(kinds => kinds.length === 0),
    pauseIdsMatch: gapLeaks.every(gap => gap.pauseIdMatches),
    pauseGapHasNoEvents: gapLeaks.every(gap => gap.eventCount === 0),
    pauseGapHasNoHierarchy: gapLeaks.every(gap => gap.hierarchyCount === 0),
    pauseGapHasNoFrames: gapLeaks.every(gap => gap.frameCount === 0),
    allFramesDecode: frameSummaries.length === frameTimestamps.length,
    noConsecutiveDuplicateFrames: consecutiveDuplicateCount === 0,
    monotonicFrameTimestamps: nonMonotonicFrameCount === 0,
    uniformFrameDimensions: dimensions.length === 1,
    noBlankFrames: blankCandidates.length === 0,
  },
};

console.log(JSON.stringify(report, null, 2));
await pool.end();
process.exit(Object.values(report.assertions).every(Boolean) ? 0 : 1);
