import { gunzipSync } from 'node:zlib';

import { and, eq, sql } from 'drizzle-orm';

import { db, recordingArtifacts, sessionMetrics, sessions } from '../src/db/client.js';
import { downloadFromS3ForArtifact } from '../src/db/s3.js';
import { logger } from '../src/logger.js';
import {
  computeMobileFrustrationCounts,
  MOBILE_FRUSTRATION_COUNTS_VERSION,
} from '../src/utils/mobileFrustration.js';

function parseMaybeGzippedJson(data: Buffer): any {
  const isGzipped = data.length >= 2 && data[0] === 0x1f && data[1] === 0x8b;
  return JSON.parse((isGzipped ? gunzipSync(data) : data).toString('utf8'));
}

function extractTelemetryEvents(parsedArtifact: any): any[] {
  if (Array.isArray(parsedArtifact)) return parsedArtifact;
  if (Array.isArray(parsedArtifact?.events)) return parsedArtifact.events;
  return [];
}

async function recomputeSession(sessionId: string, projectId: string): Promise<boolean> {
  const artifacts = await db
    .select({
      id: recordingArtifacts.id,
      s3ObjectKey: recordingArtifacts.s3ObjectKey,
      endpointId: recordingArtifacts.endpointId,
    })
    .from(recordingArtifacts)
    .where(and(
      eq(recordingArtifacts.sessionId, sessionId),
      eq(recordingArtifacts.kind, 'events'),
      eq(recordingArtifacts.status, 'ready'),
    ));

  const events: any[] = [];
  for (const artifact of artifacts) {
    const data = await downloadFromS3ForArtifact(projectId, artifact.s3ObjectKey, artifact.endpointId);
    if (!data) {
      logger.warn({ sessionId, artifactId: artifact.id }, 'Skipping mobile frustration recompute: artifact missing from storage');
      return false;
    }
    events.push(...extractTelemetryEvents(parseMaybeGzippedJson(data)));
  }

  const counts = computeMobileFrustrationCounts(events);
  await db
    .update(sessionMetrics)
    .set({
      rageTapCount: counts.rageTapCount,
      deadTapCount: counts.deadTapCount,
      frustrationCountsVersion: MOBILE_FRUSTRATION_COUNTS_VERSION,
    })
    .where(eq(sessionMetrics.sessionId, sessionId));

  logger.info({ sessionId, ...counts, eventCount: events.length }, 'Backfilled canonical mobile frustration counts');
  return true;
}

async function main() {
  const sessionId = process.env.SESSION_ID?.trim();
  const limit = Number.parseInt(process.env.LIMIT ?? '500', 10);
  const where = sessionId
    ? eq(sessions.id, sessionId)
    : and(
      sql`replace(replace(lower(coalesce(${sessions.platform}, '')), '_', '-'), ' ', '-') in ('ios', 'android', 'swift', 'swiftui', 'expo', 'rn', 'react-native', 'reactnative', 'react-native-ios', 'react-native-android', 'mobile', 'native')`,
      sql`coalesce(${sessionMetrics.eventsSizeBytes}, 0) > 0`,
      sql`coalesce(${sessionMetrics.frustrationCountsVersion}, 0) < ${MOBILE_FRUSTRATION_COUNTS_VERSION}`,
    );

  const rows = await db
    .select({
      sessionId: sessions.id,
      projectId: sessions.projectId,
    })
    .from(sessions)
    .innerJoin(sessionMetrics, eq(sessionMetrics.sessionId, sessions.id))
    .where(where)
    .limit(Number.isFinite(limit) && limit > 0 ? limit : 500);

  let repaired = 0;
  for (const row of rows) {
    if (await recomputeSession(row.sessionId, row.projectId)) {
      repaired += 1;
    }
  }

  logger.info({ candidates: rows.length, repaired }, 'Mobile frustration count backfill complete');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error({ err }, 'Mobile frustration count backfill failed');
    process.exit(1);
  });
