// Runs inside an API pod (see dump-production-session.sh): writes one JSON line per stored
// frame, events artifact and hierarchy snapshot of a session to stdout. Read-only.
import { gunzipSync } from 'node:zlib';
import { and, asc, eq } from 'drizzle-orm';

const sessionId = process.env.MATRIX_SESSION_ID ?? '';
const projectId = process.env.MATRIX_PROJECT_ID ?? '';
const every = Math.max(1, Number(process.env.MATRIX_EVERY_NTH_FRAME ?? 1));
if (!/^session_[A-Za-z0-9_-]{1,56}$/.test(sessionId)) throw new Error('MATRIX_SESSION_ID is missing or invalid');
if (!/^[0-9a-fA-F-]{36}$/.test(projectId)) throw new Error('MATRIX_PROJECT_ID is missing or invalid');

const { dbRead, pool, recordingArtifacts, sessions } = await import('./dist/db/client.js');
const { downloadFromS3ForArtifact } = await import('./dist/db/s3.js');
const { extractFramesFromArchive } = await import('./dist/services/screenshotFrames.js');
const unwrap = data => (data.length > 2 && data[0] === 0x1f && data[1] === 0x8b ? gunzipSync(data) : data);
// Wait for each line: process.exit would otherwise cut a pipe short.
const write = line => new Promise(resolve => process.stdout.write(line + '\n', resolve));

const [session] = await dbRead.select({ id: sessions.id, startedAt: sessions.startedAt }).from(sessions)
  .where(and(eq(sessions.id, sessionId), eq(sessions.projectId, projectId))).limit(1);
if (!session) throw new Error('Session does not exist in the requested project');
const artifacts = await dbRead
  .select({ kind: recordingArtifacts.kind, objectKey: recordingArtifacts.s3ObjectKey, endpointId: recordingArtifacts.endpointId, status: recordingArtifacts.status, startTime: recordingArtifacts.startTime })
  .from(recordingArtifacts).where(eq(recordingArtifacts.sessionId, sessionId))
  .orderBy(asc(recordingArtifacts.startTime), asc(recordingArtifacts.createdAt));
const started = session.startedAt.getTime();
let index = 0;
for (const artifact of artifacts.filter(item => item.status === 'ready')) {
  const data = await downloadFromS3ForArtifact(projectId, artifact.objectKey, artifact.endpointId);
  if (!data) continue;
  if (artifact.kind === 'screenshots') {
    for (const frame of await extractFramesFromArchive(data, started)) {
      if (index++ % every === 0) await write(JSON.stringify({ kind: 'frame', ts: frame.timestamp, off: frame.timestamp - started, b64: Buffer.from(frame.data).toString('base64') }));
    }
  } else if (artifact.kind === 'events') {
    const parsed = JSON.parse(unwrap(data).toString('utf8'));
    await write(JSON.stringify({ kind: 'events', deviceInfo: parsed?.deviceInfo, events: Array.isArray(parsed) ? parsed : parsed?.events }));
  } else if (artifact.kind === 'hierarchy') {
    await write(JSON.stringify({ kind: 'hierarchy', start: artifact.startTime, data: JSON.parse(unwrap(data).toString('utf8')) }));
  }
}
await pool?.end?.().catch(() => {});
process.exit(0);
