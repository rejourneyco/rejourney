import { Router } from 'express';
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { config } from '../config.js';
import {
    anrs,
    crashes,
    dbRead,
    errors,
    issueEvents,
    issues,
    projects,
    recordingArtifacts,
    sessionMetrics,
    sessions,
} from '../db/client.js';
import { downloadRawFromS3ForArtifactStrict, StorageDownloadError } from '../db/s3.js';
import { requireIssueDetectionInternalAuth } from '../middleware/internalServiceAuth.js';
import { ApiError, asyncHandler } from '../middleware/index.js';

const router = Router();

const MAX_CANDIDATE_LIMIT = 2000;
const DEFAULT_CANDIDATE_LIMIT = 2000;
const DEFAULT_CANDIDATE_LOOKBACK_HOURS = 24;
const DEFAULT_CANDIDATE_LOOKBACK = `${DEFAULT_CANDIDATE_LOOKBACK_HOURS}h`;
const DEFAULT_MIN_REPLAY_DURATION_SECONDS = 15;
const MAX_BATCH_SESSION_IDS = 2000;
const DEFAULT_DIGEST_LIMIT_PER_SESSION = 3;
const MAX_DIGEST_LIMIT_PER_SESSION = 10;
const VISUAL_ARTIFACT_KINDS = ['screenshots', 'hierarchy', 'rrweb', 'video'];

type CandidateTimeWindow = {
    lookback: string;
    since: Date | null;
};

function ensureInternalDataApiAllowed() {
    if (config.RJ_API_ROLE === 'ingest') {
        throw ApiError.notFound('Not found');
    }
    if (!config.REJOURNEY_INTERNAL_SERVICE_SECRET) {
        throw ApiError.serviceUnavailable('Internal issue-detection API is not configured');
    }
}

function parseLimit(value: unknown, fallback: number, max: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(Math.max(Math.trunc(parsed), 1), max);
}

function parseNonNegativeNumber(value: unknown, fallback: number): number {
    if (value === undefined || value === null || value === '') return fallback;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(parsed, 0);
}

function parseSessionIds(value: unknown): string[] {
    if (!Array.isArray(value)) {
        throw ApiError.badRequest('sessionIds must be an array of session id strings');
    }
    if (value.length > MAX_BATCH_SESSION_IDS) {
        throw ApiError.badRequest(`sessionIds cannot contain more than ${MAX_BATCH_SESSION_IDS} ids`);
    }

    const seen = new Set<string>();
    const ids: string[] = [];
    for (const raw of value) {
        if (typeof raw !== 'string' || !raw.trim()) {
            throw ApiError.badRequest('sessionIds must contain only non-empty strings');
        }
        const id = raw.trim();
        if (!seen.has(id)) {
            seen.add(id);
            ids.push(id);
        }
    }
    return ids;
}

function parseLookback(value: unknown): CandidateTimeWindow | null {
    if (typeof value !== 'string' || !value.trim()) return null;

    const normalized = value.trim().toLowerCase();
    if (['all', 'all-time', 'all_time', 'lifetime'].includes(normalized)) {
        return { lookback: 'all', since: null };
    }

    const match = normalized.match(/^(\d+)\s*(m|h|d|w)$/);
    if (!match) return null;

    const amount = Number(match[1]);
    if (!Number.isFinite(amount) || amount <= 0) return null;

    const unitToMs: Record<string, number> = {
        m: 60 * 1000,
        h: 60 * 60 * 1000,
        d: 24 * 60 * 60 * 1000,
        w: 7 * 24 * 60 * 60 * 1000,
    };

    return {
        lookback: `${amount}${match[2]}`,
        since: new Date(Date.now() - amount * unitToMs[match[2]]),
    };
}

function parseCandidateTimeWindow(input: { lookback?: unknown; since?: unknown }): CandidateTimeWindow {
    if (typeof input.since === 'string' && input.since.trim()) {
        const normalizedSince = input.since.trim().toLowerCase();
        if (['all', 'all-time', 'all_time', 'lifetime'].includes(normalizedSince)) {
            return { lookback: 'all', since: null };
        }

        const parsed = new Date(input.since);
        if (Number.isFinite(parsed.getTime())) {
            return { lookback: 'custom', since: parsed };
        }
    }

    return parseLookback(input.lookback) ?? parseLookback(DEFAULT_CANDIDATE_LOOKBACK)!;
}

function toIso(value: Date | string | null | undefined): string | null {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function serializeCrash(row: typeof crashes.$inferSelect) {
    return {
        ...row,
        timestamp: toIso(row.timestamp),
        createdAt: toIso(row.createdAt),
        updatedAt: toIso(row.updatedAt),
    };
}

function serializeAnr(row: typeof anrs.$inferSelect) {
    return {
        ...row,
        timestamp: toIso(row.timestamp),
        createdAt: toIso(row.createdAt),
        updatedAt: toIso(row.updatedAt),
    };
}

function serializeError(row: typeof errors.$inferSelect) {
    return {
        ...row,
        timestamp: toIso(row.timestamp),
        createdAt: toIso(row.createdAt),
        updatedAt: toIso(row.updatedAt),
    };
}

function serializeIssue(row: typeof issues.$inferSelect) {
    return {
        ...row,
        eventCount: Number(row.eventCount ?? 0),
        firstSeen: toIso(row.firstSeen),
        lastSeen: toIso(row.lastSeen),
        createdAt: toIso(row.createdAt),
        updatedAt: toIso(row.updatedAt),
    };
}

function serializeIssueEvent(row: typeof issueEvents.$inferSelect) {
    return {
        ...row,
        timestamp: toIso(row.timestamp),
        createdAt: toIso(row.createdAt),
    };
}

router.use((_req, _res, next) => {
    try {
        ensureInternalDataApiAllowed();
        next();
    } catch (error) {
        next(error);
    }
});

router.use(requireIssueDetectionInternalAuth);

router.get('/projects', asyncHandler(async (_req, res) => {
    const rows = await dbRead
        .select({
            id: projects.id,
            teamId: projects.teamId,
            name: projects.name,
            platform: projects.platform,
            bundleId: projects.bundleId,
            packageName: projects.packageName,
            webDomain: projects.webDomain,
            webAllowedDomains: projects.webAllowedDomains,
            recordingEnabled: projects.recordingEnabled,
            rejourneyEnabled: projects.rejourneyEnabled,
            createdAt: projects.createdAt,
            updatedAt: projects.updatedAt,
        })
        .from(projects)
        .where(and(
            eq(projects.rejourneyEnabled, true),
            eq(projects.recordingEnabled, true),
            sql`${projects.deletedAt} is null`,
        ))
        .orderBy(desc(projects.createdAt));

    res.json({
        projects: rows.map((project) => ({
            ...project,
            createdAt: toIso(project.createdAt),
            updatedAt: toIso(project.updatedAt),
        })),
    });
}));

router.get('/projects/:projectId/candidate-sessions', asyncHandler(async (req, res) => {
    const projectId = req.params.projectId;
    const limit = parseLimit(req.query.limit, DEFAULT_CANDIDATE_LIMIT, MAX_CANDIDATE_LIMIT);
    const minReplayDurationSeconds = parseNonNegativeNumber(
        req.query.minReplayDurationSeconds ?? req.query.minDurationSeconds,
        DEFAULT_MIN_REPLAY_DURATION_SECONDS,
    );
    const timeWindow = parseCandidateTimeWindow({
        lookback: req.query.lookback,
        since: req.query.since,
    });

    const replayStartTime = sql<number | null>`min(${recordingArtifacts.startTime})`;
    const replayEndTime = sql<number | null>`max(${recordingArtifacts.endTime})`;
    const replayDurationSeconds = sql<number>`
        (
            case
                when min(${recordingArtifacts.startTime}) is not null
                 and max(${recordingArtifacts.endTime}) is not null
                then greatest(max(${recordingArtifacts.endTime}) - min(${recordingArtifacts.startTime}), 0)::double precision / 1000.0
                else coalesce(${sessions.durationSeconds}, 0)::double precision
            end
        )
    `;

    const conditions = [
        eq(sessions.projectId, projectId),
        eq(sessions.replayAvailable, true),
        eq(sessions.recordingDeleted, false),
        eq(sessions.isReplayExpired, false),
        sql`coalesce(${sessions.replayRetentionState}, 'saved') = 'saved'`,
        sql`${sessions.smartCaptureStatus} <> 'discarded'`,
    ];
    if (timeWindow.since) conditions.push(gte(sessions.startedAt, timeWindow.since));

    const rows = await dbRead
        .select({
            id: sessions.id,
            projectId: sessions.projectId,
            startedAt: sessions.startedAt,
            endedAt: sessions.endedAt,
            durationSeconds: sessions.durationSeconds,
            platform: sessions.platform,
            appVersion: sessions.appVersion,
            deviceModel: sessions.deviceModel,
            osVersion: sessions.osVersion,
            userDisplayId: sessions.userDisplayId,
            anonymousHash: sessions.anonymousHash,
            replayAvailable: sessions.replayAvailable,
            smartCaptureStatus: sessions.smartCaptureStatus,
            totalEvents: sessionMetrics.totalEvents,
            errorCount: sessionMetrics.errorCount,
            crashCount: sessionMetrics.crashCount,
            anrCount: sessionMetrics.anrCount,
            apiErrorCount: sessionMetrics.apiErrorCount,
            rageTapCount: sessionMetrics.rageTapCount,
            deadTapCount: sessionMetrics.deadTapCount,
            touchCount: sessionMetrics.touchCount,
            scrollCount: sessionMetrics.scrollCount,
            screenshotSegmentCount: sessionMetrics.screenshotSegmentCount,
            hierarchySnapshotCount: sessionMetrics.hierarchySnapshotCount,
            readyVisualArtifactCount: sql<number>`count(distinct ${recordingArtifacts.id})`,
            replayStartTime,
            replayEndTime,
            replayDurationSeconds,
            replayRangeComplete: sql<boolean>`bool_and(${recordingArtifacts.startTime} is not null and ${recordingArtifacts.endTime} is not null)`,
        })
        .from(sessions)
        .leftJoin(sessionMetrics, eq(sessionMetrics.sessionId, sessions.id))
        .innerJoin(recordingArtifacts, and(
            eq(recordingArtifacts.sessionId, sessions.id),
            eq(recordingArtifacts.status, 'ready'),
            inArray(recordingArtifacts.kind, VISUAL_ARTIFACT_KINDS),
        ))
        .where(and(...conditions))
        .groupBy(
            sessions.id,
            sessionMetrics.id,
        )
        .having(sql`${replayDurationSeconds} >= ${minReplayDurationSeconds}`)
        .orderBy(desc(sessions.startedAt), sessions.id)
        .limit(limit);

    res.json({
        projectId,
        lookback: timeWindow.lookback,
        since: timeWindow.since?.toISOString() ?? null,
        limit,
        minReplayDurationSeconds,
        sessions: rows.map((row) => ({
            id: row.id,
            projectId: row.projectId,
            startedAt: toIso(row.startedAt),
            endedAt: toIso(row.endedAt),
            durationSeconds: row.durationSeconds,
            platform: row.platform,
            appVersion: row.appVersion,
            deviceModel: row.deviceModel,
            osVersion: row.osVersion,
            userDisplayId: row.userDisplayId,
            anonymousHash: row.anonymousHash,
            replayAvailable: row.replayAvailable,
            smartCaptureStatus: row.smartCaptureStatus,
            readyVisualArtifactCount: Number(row.readyVisualArtifactCount ?? 0),
            replayStartTime: row.replayStartTime ?? null,
            replayEndTime: row.replayEndTime ?? null,
            replayDurationSeconds: Number(row.replayDurationSeconds ?? 0),
            replayRangeComplete: Boolean(row.replayRangeComplete),
            metrics: {
                totalEvents: row.totalEvents ?? 0,
                errorCount: row.errorCount ?? 0,
                crashCount: row.crashCount ?? 0,
                anrCount: row.anrCount ?? 0,
                apiErrorCount: row.apiErrorCount ?? 0,
                rageTapCount: row.rageTapCount ?? 0,
                deadTapCount: row.deadTapCount ?? 0,
                touchCount: row.touchCount ?? 0,
                scrollCount: row.scrollCount ?? 0,
                screenshotSegmentCount: row.screenshotSegmentCount ?? 0,
                hierarchySnapshotCount: row.hierarchySnapshotCount ?? 0,
            },
        })),
    });
}));

router.post(/^\/metrics:batch$/, asyncHandler(async (req, res) => {
    const sessionIds = parseSessionIds(req.body?.sessionIds);
    if (sessionIds.length === 0) {
        res.json({ metrics: {} });
        return;
    }

    const replayStartTime = sql<number | null>`min(${recordingArtifacts.startTime})`;
    const replayEndTime = sql<number | null>`max(${recordingArtifacts.endTime})`;
    const replayDurationSeconds = sql<number>`
        (
            case
                when min(${recordingArtifacts.startTime}) is not null
                 and max(${recordingArtifacts.endTime}) is not null
                then greatest(max(${recordingArtifacts.endTime}) - min(${recordingArtifacts.startTime}), 0)::double precision / 1000.0
                else coalesce(${sessions.durationSeconds}, 0)::double precision
            end
        )
    `;

    const rows = await dbRead
        .select({
            sessionId: sessions.id,
            durationSeconds: sessions.durationSeconds,
            startedAt: sessions.startedAt,
            endedAt: sessions.endedAt,
            totalEvents: sessionMetrics.totalEvents,
            errorCount: sessionMetrics.errorCount,
            crashCount: sessionMetrics.crashCount,
            anrCount: sessionMetrics.anrCount,
            apiErrorCount: sessionMetrics.apiErrorCount,
            rageTapCount: sessionMetrics.rageTapCount,
            deadTapCount: sessionMetrics.deadTapCount,
            touchCount: sessionMetrics.touchCount,
            scrollCount: sessionMetrics.scrollCount,
            screenshotSegmentCount: sessionMetrics.screenshotSegmentCount,
            hierarchySnapshotCount: sessionMetrics.hierarchySnapshotCount,
            readyVisualArtifactCount: sql<number>`count(distinct ${recordingArtifacts.id})`,
            replayStartTime,
            replayEndTime,
            replayDurationSeconds,
        })
        .from(sessions)
        .leftJoin(sessionMetrics, eq(sessionMetrics.sessionId, sessions.id))
        .leftJoin(recordingArtifacts, and(
            eq(recordingArtifacts.sessionId, sessions.id),
            eq(recordingArtifacts.status, 'ready'),
            inArray(recordingArtifacts.kind, VISUAL_ARTIFACT_KINDS),
        ))
        .where(inArray(sessions.id, sessionIds))
        .groupBy(sessions.id, sessionMetrics.id);

    const metrics: Record<string, unknown> = {};
    for (const row of rows) {
        metrics[row.sessionId] = {
            durationSeconds: row.durationSeconds,
            startedAt: toIso(row.startedAt),
            endedAt: toIso(row.endedAt),
            readyVisualArtifactCount: Number(row.readyVisualArtifactCount ?? 0),
            replayStartTime: row.replayStartTime ?? null,
            replayEndTime: row.replayEndTime ?? null,
            replayDurationSeconds: Number(row.replayDurationSeconds ?? 0),
            totalEvents: row.totalEvents ?? 0,
            errorCount: row.errorCount ?? 0,
            crashCount: row.crashCount ?? 0,
            anrCount: row.anrCount ?? 0,
            apiErrorCount: row.apiErrorCount ?? 0,
            rageTapCount: row.rageTapCount ?? 0,
            deadTapCount: row.deadTapCount ?? 0,
            touchCount: row.touchCount ?? 0,
            scrollCount: row.scrollCount ?? 0,
            screenshotSegmentCount: row.screenshotSegmentCount ?? 0,
            hierarchySnapshotCount: row.hierarchySnapshotCount ?? 0,
        };
    }

    res.json({ metrics });
}));

router.post(/^\/digest:batch$/, asyncHandler(async (req, res) => {
    const sessionIds = parseSessionIds(req.body?.sessionIds);
    const limitPerSession = parseLimit(
        req.body?.limitPerSession,
        DEFAULT_DIGEST_LIMIT_PER_SESSION,
        MAX_DIGEST_LIMIT_PER_SESSION,
    );
    if (sessionIds.length === 0) {
        res.json({ errors: [], crashes: [] });
        return;
    }

    const sessionIdArraySql = sql`ARRAY[${sql.join(sessionIds.map((sessionId) => sql`${sessionId}`), sql`, `)}]::text[]`;

    const [errorResult, crashResult] = await Promise.all([
        dbRead.execute(sql`
            with requested(session_id) as (
                select unnest(${sessionIdArraySql})
            ),
            ranked as (
                select
                    e.*,
                    row_number() over (
                        partition by e.session_id
                        order by e.timestamp desc, e.created_at desc, e.id
                    ) as rn
                from ${errors} e
                inner join requested r on r.session_id = e.session_id
            )
            select
                id::text as id,
                session_id as "sessionId",
                project_id::text as "projectId",
                timestamp,
                error_type as "errorType",
                error_name as "errorName",
                message,
                stack,
                screen_name as "screenName",
                component_name as "componentName",
                device_model as "deviceModel",
                os_version as "osVersion",
                app_version as "appVersion",
                fingerprint,
                occurrence_count as "occurrenceCount",
                status,
                created_at as "createdAt",
                updated_at as "updatedAt"
            from ranked
            where rn <= ${limitPerSession}
            order by "sessionId", timestamp desc, "createdAt" desc
        `),
        dbRead.execute(sql`
            with requested(session_id) as (
                select unnest(${sessionIdArraySql})
            ),
            ranked as (
                select
                    c.*,
                    row_number() over (
                        partition by c.session_id
                        order by c.timestamp desc, c.created_at desc, c.id
                    ) as rn
                from ${crashes} c
                inner join requested r on r.session_id = c.session_id
            )
            select
                id::text as id,
                session_id as "sessionId",
                project_id::text as "projectId",
                timestamp,
                exception_name as "exceptionName",
                reason,
                stack_trace as "stackTrace",
                fingerprint,
                device_metadata as "deviceMetadata",
                status,
                occurrence_count as "occurrenceCount",
                created_at as "createdAt",
                updated_at as "updatedAt"
            from ranked
            where rn <= ${limitPerSession}
            order by "sessionId", timestamp desc, "createdAt" desc
        `),
    ]);

    const errorRows = ((errorResult as unknown as { rows?: Array<typeof errors.$inferSelect> }).rows ?? []);
    const crashRows = ((crashResult as unknown as { rows?: Array<typeof crashes.$inferSelect> }).rows ?? []);

    res.json({
        errors: errorRows.map(serializeError),
        crashes: crashRows.map(serializeCrash),
    });
}));

router.get('/crashes/:id', asyncHandler(async (req, res) => {
    const [row] = await dbRead
        .select()
        .from(crashes)
        .where(eq(crashes.id, req.params.id))
        .limit(1);

    if (!row) throw ApiError.notFound('Crash not found');
    res.json(serializeCrash(row));
}));

router.get('/anrs/:id', asyncHandler(async (req, res) => {
    const [row] = await dbRead
        .select()
        .from(anrs)
        .where(eq(anrs.id, req.params.id))
        .limit(1);

    if (!row) throw ApiError.notFound('ANR not found');
    res.json(serializeAnr(row));
}));

router.get('/errors/:id', asyncHandler(async (req, res) => {
    const [row] = await dbRead
        .select()
        .from(errors)
        .where(eq(errors.id, req.params.id))
        .limit(1);

    if (!row) throw ApiError.notFound('Error not found');
    res.json(serializeError(row));
}));

router.get('/issues/:id', asyncHandler(async (req, res) => {
    const [row] = await dbRead
        .select()
        .from(issues)
        .where(eq(issues.id, req.params.id))
        .limit(1);

    if (!row) throw ApiError.notFound('Issue not found');
    res.json(serializeIssue(row));
}));

router.get('/issue-events/:id', asyncHandler(async (req, res) => {
    const [row] = await dbRead
        .select()
        .from(issueEvents)
        .where(eq(issueEvents.id, req.params.id))
        .limit(1);

    if (!row) throw ApiError.notFound('Issue event not found');
    res.json(serializeIssueEvent(row));
}));

router.get('/sessions/:sessionId/feature-record', asyncHandler(async (req, res) => {
    const sessionId = req.params.sessionId;
    const [row] = await dbRead
        .select({
            session: sessions,
            metrics: sessionMetrics,
            projectName: projects.name,
            projectTeamId: projects.teamId,
        })
        .from(sessions)
        .innerJoin(projects, eq(projects.id, sessions.projectId))
        .leftJoin(sessionMetrics, eq(sessionMetrics.sessionId, sessions.id))
        .where(eq(sessions.id, sessionId))
        .limit(1);

    if (!row) throw ApiError.notFound('Session not found');

    const [sessionCrashes, sessionAnrs, sessionErrors, artifacts] = await Promise.all([
        dbRead.select().from(crashes).where(eq(crashes.sessionId, sessionId)).limit(50),
        dbRead.select().from(anrs).where(eq(anrs.sessionId, sessionId)).limit(50),
        dbRead.select().from(errors).where(eq(errors.sessionId, sessionId)).limit(50),
        dbRead
            .select({
                id: recordingArtifacts.id,
                sessionId: recordingArtifacts.sessionId,
                kind: recordingArtifacts.kind,
                status: recordingArtifacts.status,
                sizeBytes: recordingArtifacts.sizeBytes,
                declaredSizeBytes: recordingArtifacts.declaredSizeBytes,
                readyAt: recordingArtifacts.readyAt,
                uploadCompletedAt: recordingArtifacts.uploadCompletedAt,
                timestamp: recordingArtifacts.timestamp,
                startTime: recordingArtifacts.startTime,
                endTime: recordingArtifacts.endTime,
                frameCount: recordingArtifacts.frameCount,
                createdAt: recordingArtifacts.createdAt,
            })
            .from(recordingArtifacts)
            .where(and(eq(recordingArtifacts.sessionId, sessionId), eq(recordingArtifacts.status, 'ready')))
            .orderBy(recordingArtifacts.createdAt)
            .limit(200),
    ]);

    res.json({
        session: {
            ...row.session,
            startedAt: toIso(row.session.startedAt),
            endedAt: toIso(row.session.endedAt),
            explicitEndedAt: toIso(row.session.explicitEndedAt),
            finalizedAt: toIso(row.session.finalizedAt),
            lastIngestActivityAt: toIso(row.session.lastIngestActivityAt),
            createdAt: toIso(row.session.createdAt),
            updatedAt: toIso(row.session.updatedAt),
        },
        project: {
            id: row.session.projectId,
            name: row.projectName,
            teamId: row.projectTeamId,
        },
        metrics: row.metrics ?? null,
        crashes: sessionCrashes.map((item) => ({ ...item, timestamp: toIso(item.timestamp), createdAt: toIso(item.createdAt), updatedAt: toIso(item.updatedAt) })),
        anrs: sessionAnrs.map((item) => ({ ...item, timestamp: toIso(item.timestamp), createdAt: toIso(item.createdAt), updatedAt: toIso(item.updatedAt) })),
        errors: sessionErrors.map((item) => ({ ...item, timestamp: toIso(item.timestamp), createdAt: toIso(item.createdAt), updatedAt: toIso(item.updatedAt) })),
        artifacts: artifacts.map((artifact) => ({
            ...artifact,
            readyAt: toIso(artifact.readyAt),
            uploadCompletedAt: toIso(artifact.uploadCompletedAt),
            createdAt: toIso(artifact.createdAt),
            bytesUrl: `/api/internal/issue-detection/artifacts/${artifact.id}/bytes`,
        })),
    });
}));

router.get('/sessions/:sessionId/artifacts', asyncHandler(async (req, res) => {
    const sessionId = req.params.sessionId;
    const kind = typeof req.query.kind === 'string' && req.query.kind.trim() ? req.query.kind.trim() : null;

    const conditions = [eq(recordingArtifacts.sessionId, sessionId), eq(recordingArtifacts.status, 'ready')];
    if (kind) conditions.push(eq(recordingArtifacts.kind, kind));

    const rows = await dbRead
        .select({
            id: recordingArtifacts.id,
            sessionId: recordingArtifacts.sessionId,
            kind: recordingArtifacts.kind,
            status: recordingArtifacts.status,
            sizeBytes: recordingArtifacts.sizeBytes,
            declaredSizeBytes: recordingArtifacts.declaredSizeBytes,
            readyAt: recordingArtifacts.readyAt,
            uploadCompletedAt: recordingArtifacts.uploadCompletedAt,
            timestamp: recordingArtifacts.timestamp,
            startTime: recordingArtifacts.startTime,
            endTime: recordingArtifacts.endTime,
            frameCount: recordingArtifacts.frameCount,
            createdAt: recordingArtifacts.createdAt,
        })
        .from(recordingArtifacts)
        .where(and(...conditions))
        .orderBy(recordingArtifacts.createdAt);

    res.json({
        sessionId,
        artifacts: rows.map((artifact) => ({
            ...artifact,
            readyAt: toIso(artifact.readyAt),
            uploadCompletedAt: toIso(artifact.uploadCompletedAt),
            createdAt: toIso(artifact.createdAt),
            bytesUrl: `/api/internal/issue-detection/artifacts/${artifact.id}/bytes`,
        })),
    });
}));

router.get('/artifacts/:artifactId/bytes', asyncHandler(async (req, res) => {
    const artifactId = req.params.artifactId;
    const [row] = await dbRead
        .select({
            artifact: recordingArtifacts,
            projectId: sessions.projectId,
        })
        .from(recordingArtifacts)
        .innerJoin(sessions, eq(sessions.id, recordingArtifacts.sessionId))
        .where(and(eq(recordingArtifacts.id, artifactId), eq(recordingArtifacts.status, 'ready')))
        .limit(1);

    if (!row) throw ApiError.notFound('Artifact not found');

    let data: Buffer;
    try {
        data = await downloadRawFromS3ForArtifactStrict(row.projectId, row.artifact.s3ObjectKey, row.artifact.endpointId);
    } catch (error) {
        if (error instanceof StorageDownloadError) {
            if (error.statusCode === 404) throw ApiError.notFound('Artifact bytes not found');
            if (error.statusCode === 403) throw ApiError.forbidden('Artifact bytes forbidden');
            throw ApiError.internal('Artifact bytes could not be fetched');
        }
        throw error;
    }

    res.setHeader('Content-Type', row.artifact.s3ObjectKey.endsWith('.gz') ? 'application/gzip' : 'application/octet-stream');
    res.setHeader('Content-Length', String(data.length));
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.send(data);
}));

export default router;
