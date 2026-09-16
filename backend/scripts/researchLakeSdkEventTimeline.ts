/**
 * Write the SDK event timeline for research lake samples that do not have one yet.
 *
 * For every session whose export jobs (interaction and behavioral, V1 and V2)
 * carry no sdk_event_timeline_at and whose source events artifacts still exist,
 * this script builds `sdk_events.jsonl.gz` once and attaches it to each
 * exported lane path, updating manifest.json and quality.json additively.
 *
 * Sessions are processed in purge order (oldest started_at first within each
 * project) so the ones closest to retention expiry are covered first. Projects
 * listed in --projects-first go first; the rest follow ordered by retention.
 *
 * Idempotent and resumable: the per-job sdk_event_timeline_at stamp is written
 * last, so a stopped run simply resumes. Sharded runs partition sessions by a
 * stable hash so several pods can work the same queue.
 *
 * Usage:
 *   node --import tsx scripts/researchLakeSdkEventTimeline.ts \
 *     [--dry-run] [--limit=N] [--project=<uuid>]... [--projects-first=<uuid,uuid>] \
 *     [--shard=i/N] [--session-concurrency=12] [--artifact-concurrency=6] \
 *     [--session=<id>] [--sample-key=<hex>] [--max-runtime-ms=N]
 *
 * Environment fallbacks: JOB_COMPLETION_INDEX / SHARD_COUNT for --shard,
 * STUDY_PROJECT_IDS for --projects-first.
 */

import { pool } from '../src/db/client.js';
import { closeRedis, initRedis } from '../src/db/redis.js';
import { logger } from '../src/logger.js';
import {
    applySdkEventTimelineToExportedSamples,
    type SdkEventTimelineApplyResult,
} from '../src/services/researchLake.js';

function parseOption(name: string): string | null {
    const valueArg = process.argv.find((arg) => arg.startsWith(`${name}=`));
    if (!valueArg) return null;
    return valueArg.slice(name.length + 1);
}

function parseOptionAll(name: string): string[] {
    return process.argv
        .filter((arg) => arg.startsWith(`${name}=`))
        .map((arg) => arg.slice(name.length + 1))
        .filter(Boolean);
}

const DRY_RUN = process.argv.includes('--dry-run');
const LIMIT = Math.max(0, Number(parseOption('--limit') ?? 0) || 0);
const ONLY_PROJECTS = parseOptionAll('--project');
const PROJECTS_FIRST = (parseOption('--projects-first') ?? process.env.STUDY_PROJECT_IDS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
const ONLY_SESSION = parseOption('--session');
const ONLY_SAMPLE_KEY = parseOption('--sample-key');
const SESSION_CONCURRENCY = Math.max(1, Math.min(Number(parseOption('--session-concurrency') ?? 12) || 12, 32));
const ARTIFACT_CONCURRENCY = Math.max(1, Math.min(Number(parseOption('--artifact-concurrency') ?? 6) || 6, 16));
const MAX_RUNTIME_MS = Math.max(0, Number(parseOption('--max-runtime-ms') ?? 0) || 0);
const CANDIDATE_BATCH = 500;

function parseShard(): { index: number; count: number } {
    const explicit = parseOption('--shard');
    if (explicit) {
        const match = /^(\d+)\/(\d+)$/.exec(explicit);
        if (!match) throw new Error(`Invalid --shard value: ${explicit} (expected i/N)`);
        const index = Number(match[1]);
        const count = Number(match[2]);
        if (!(count >= 1) || !(index >= 0) || index >= count) throw new Error(`Invalid --shard value: ${explicit}`);
        return { index, count };
    }
    const count = Number(process.env.SHARD_COUNT ?? 1) || 1;
    const index = Number(process.env.JOB_COMPLETION_INDEX ?? 0) || 0;
    return { index: Math.max(0, Math.min(index, count - 1)), count: Math.max(1, count) };
}

const SHARD = parseShard();

type ProjectRow = { id: string; retention_days: number | string | null };
type CandidateRow = { id: string; started_at: Date };

async function loadProjects(): Promise<ProjectRow[]> {
    const result = await pool.query<ProjectRow>(
        `
        SELECT p.id, COALESCE(rp.retention_days, 7) AS retention_days
        FROM projects p
        INNER JOIN teams t ON t.id = p.team_id
        LEFT JOIN retention_policies rp ON rp.tier = t.retention_tier
        WHERE p.deleted_at IS NULL
          AND (cardinality($1::uuid[]) = 0 OR p.id = ANY($1::uuid[]))
        ORDER BY p.id
        `,
        [ONLY_PROJECTS],
    );
    const firstRank = new Map(PROJECTS_FIRST.map((id, index) => [id, index]));
    return result.rows.sort((a, b) => {
        const aFirst = firstRank.get(a.id);
        const bFirst = firstRank.get(b.id);
        if (aFirst !== undefined || bFirst !== undefined) {
            if (aFirst === undefined) return 1;
            if (bFirst === undefined) return -1;
            return aFirst - bFirst;
        }
        return (Number(a.retention_days) || 7) - (Number(b.retention_days) || 7) || (a.id < b.id ? -1 : 1);
    });
}

async function loadCandidates(projectId: string, cursor: CandidateRow | null): Promise<CandidateRow[]> {
    const result = await pool.query<CandidateRow>(
        `
        SELECT s.id, s.started_at
        FROM sessions s
        WHERE s.project_id = $1
          AND s.recording_deleted = false
          AND s.identity_scrubbed_at IS NULL
          AND s.status IN ('ready', 'completed')
          AND ($2::timestamp IS NULL OR (s.started_at, s.id) > ($2::timestamp, $3::varchar))
          AND abs(hashtext(s.id)) % $4 = $5
          AND EXISTS (
              SELECT 1 FROM research_extraction_jobs j
              WHERE j.session_id = s.id
                AND j.status = 'exported'
                AND j.lake_path IS NOT NULL
                AND j.lake_type IN ('interaction', 'behavioral_outcomes')
                AND j.sdk_event_timeline_at IS NULL
          )
          AND EXISTS (
              SELECT 1 FROM recording_artifacts ra
              WHERE ra.session_id = s.id AND ra.kind = 'events' AND ra.status = 'ready'
          )
        ORDER BY s.started_at, s.id
        LIMIT $6
        `,
        [projectId, cursor?.started_at ?? null, cursor?.id ?? null, SHARD.count, SHARD.index, CANDIDATE_BATCH],
    );
    return result.rows;
}

async function resolveSingleSession(): Promise<string | null> {
    if (ONLY_SESSION) return ONLY_SESSION;
    if (!ONLY_SAMPLE_KEY) return null;
    if (!/^[0-9a-f]{16,64}$/.test(ONLY_SAMPLE_KEY)) throw new Error('Invalid --sample-key');
    const result = await pool.query<{ session_id: string }>(
        `
        SELECT session_id FROM research_extraction_jobs
        WHERE lake_path LIKE $1 AND status = 'exported'
        ORDER BY schema_version DESC LIMIT 1
        `,
        [`%sample_key=${ONLY_SAMPLE_KEY}%`],
    );
    return result.rows[0]?.session_id ?? null;
}

type Totals = {
    sessions: number;
    applied: number;
    skipped: number;
    unavailable: number;
    failed: number;
    lanes: number;
    events: number;
    artifacts: number;
    artifactsMissing: number;
};

const totals: Totals = { sessions: 0, applied: 0, skipped: 0, unavailable: 0, failed: 0, lanes: 0, events: 0, artifacts: 0, artifactsMissing: 0 };
let stopRequested = false;
let throttleUntil = 0;
let activeConcurrency = SESSION_CONCURRENCY;
const startedAt = Date.now();

function isThrottleError(err: unknown): boolean {
    const message = err instanceof Error ? err.message : String(err);
    const code = (err as { name?: string; code?: string } | null)?.name ?? (err as { code?: string } | null)?.code ?? '';
    return /slowdown|throttl|503|ETIMEDOUT|ECONNRESET|TooManyRequests|RequestTimeout/i.test(`${code} ${message}`);
}

function record(result: SdkEventTimelineApplyResult): void {
    totals.sessions += 1;
    totals.lanes += result.lanes;
    if (result.status === 'applied') totals.applied += 1;
    else if (result.status === 'skipped_no_candidates') totals.skipped += 1;
    else totals.unavailable += 1;
    if (result.summary) {
        totals.events += result.summary.sdk_event_count;
        totals.artifacts += result.summary.sdk_event_artifact_count;
        totals.artifactsMissing += result.summary.sdk_event_artifact_missing_count;
    }
}

async function processSession(sessionId: string): Promise<void> {
    for (let attempt = 1; ; attempt += 1) {
        try {
            const result = await applySdkEventTimelineToExportedSamples({
                sessionId,
                dryRun: DRY_RUN,
                artifactConcurrency: ARTIFACT_CONCURRENCY,
            });
            record(result);
            if (activeConcurrency < SESSION_CONCURRENCY && Date.now() > throttleUntil) activeConcurrency += 1;
            return;
        } catch (err) {
            if (isThrottleError(err) && attempt < 4) {
                activeConcurrency = Math.max(1, Math.floor(activeConcurrency / 2));
                throttleUntil = Date.now() + 60_000;
                logger.warn({ sessionId, attempt, activeConcurrency }, 'SDK event timeline: storage pressure, backing off');
                await new Promise((resolve) => setTimeout(resolve, 1_000 * attempt));
                continue;
            }
            totals.sessions += 1;
            totals.failed += 1;
            logger.error({ sessionId, err: err instanceof Error ? err.message : String(err) }, 'SDK event timeline: session failed');
            return;
        }
    }
}

async function runQueue(sessionIds: string[]): Promise<void> {
    let next = 0;
    let inFlight = 0;
    await new Promise<void>((resolve) => {
        const pump = (): void => {
            if (stopRequested && inFlight === 0) { resolve(); return; }
            while (!stopRequested && next < sessionIds.length && inFlight < activeConcurrency) {
                const sessionId = sessionIds[next];
                next += 1;
                inFlight += 1;
                processSession(sessionId).finally(() => {
                    inFlight -= 1;
                    if (next >= sessionIds.length && inFlight === 0) resolve();
                    else pump();
                });
            }
            if (next >= sessionIds.length && inFlight === 0) resolve();
        };
        pump();
    });
}

function logProgress(projectId: string | null, extra: Record<string, unknown> = {}): void {
    const elapsedMin = Math.max(1 / 60, (Date.now() - startedAt) / 60_000);
    logger.info({
        projectId,
        shard: `${SHARD.index}/${SHARD.count}`,
        dryRun: DRY_RUN,
        ...totals,
        sessionsPerMinute: Math.round(totals.sessions / elapsedMin),
        activeConcurrency,
        ...extra,
    }, 'SDK event timeline progress');
}

function runtimeExhausted(): boolean {
    return MAX_RUNTIME_MS > 0 && Date.now() - startedAt >= MAX_RUNTIME_MS;
}

async function main(): Promise<void> {
    process.on('SIGTERM', () => { stopRequested = true; logger.warn('SDK event timeline: SIGTERM received, draining'); });
    process.on('SIGINT', () => { stopRequested = true; });
    // Storage endpoint lookups consult the Redis cache; connect up front with a
    // bound so a slow sentinel handshake cannot stall the first session.
    await Promise.race([initRedis(), new Promise<void>((resolve) => setTimeout(resolve, 15_000))]);

    const single = await resolveSingleSession();
    if (ONLY_SESSION || ONLY_SAMPLE_KEY) {
        if (!single) {
            logger.error({ session: ONLY_SESSION, sampleKey: ONLY_SAMPLE_KEY }, 'SDK event timeline: session not found');
            process.exitCode = 1;
            return;
        }
        const result = await applySdkEventTimelineToExportedSamples({ sessionId: single, dryRun: DRY_RUN, artifactConcurrency: ARTIFACT_CONCURRENCY });
        record(result);
        logger.info({ sessionId: single, ...result }, 'SDK event timeline: single session');
        logProgress(null);
        return;
    }

    const projects = await loadProjects();
    logger.info({ projects: projects.length, first: PROJECTS_FIRST.length, shard: `${SHARD.index}/${SHARD.count}`, dryRun: DRY_RUN, sessionConcurrency: SESSION_CONCURRENCY, artifactConcurrency: ARTIFACT_CONCURRENCY }, 'SDK event timeline: starting');
    let remaining = LIMIT > 0 ? LIMIT : Number.POSITIVE_INFINITY;
    let sinceLog = 0;

    for (const project of projects) {
        if (stopRequested || remaining <= 0 || runtimeExhausted()) break;
        let cursor: CandidateRow | null = null;
        for (;;) {
            if (stopRequested || remaining <= 0 || runtimeExhausted()) break;
            const candidates = await loadCandidates(project.id, cursor);
            if (candidates.length === 0) break;
            cursor = candidates[candidates.length - 1];
            const slice = candidates.slice(0, Math.min(candidates.length, remaining === Number.POSITIVE_INFINITY ? candidates.length : remaining));
            remaining -= slice.length;
            await runQueue(slice.map((row) => row.id));
            sinceLog += slice.length;
            if (sinceLog >= 500) {
                sinceLog = 0;
                logProgress(project.id, { cursorStartedAt: cursor.started_at });
            }
            // In dry-run mode nothing is stamped, so the cursor is the only thing
            // that advances; that is exactly what we want.
            if (candidates.length < CANDIDATE_BATCH) break;
        }
        logProgress(project.id, { projectDone: true });
    }
    logProgress(null, { finished: !stopRequested, runtimeExhausted: runtimeExhausted() });
}

main()
    .catch((err) => {
        logger.error({ err: err instanceof Error ? err.message : String(err) }, 'SDK event timeline: fatal error');
        process.exitCode = 1;
    })
    .finally(async () => {
        await pool.end().catch(() => undefined);
        await Promise.resolve(closeRedis()).catch(() => undefined);
        // Cached clients keep handles open; exit explicitly so the Job pod completes.
        process.exit(process.exitCode ?? 0);
    });
