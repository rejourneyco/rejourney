import { eq, sql } from 'drizzle-orm';
import { db, projects, recordingArtifacts, sessions, sessionMetrics, teams } from '../db/client.js';
import { logger } from '../logger.js';
import { ApiError } from '../middleware/index.js';
import { getRequestIp } from '../utils/requestIp.js';
import { lookupGeoIp } from './recording.js';
import {
    FREE_VIDEO_RETENTION_TIER,
    getVideoRetentionDetailsForTier,
    normalizeVideoRetentionTier,
} from './videoRetention.js';
import { parseSessionStartedAt, parseSessionStartedAtOrNull } from './sessionId.js';

export type IngestSessionMetadata = {
    userId?: string;
    platform?: string;
    deviceModel?: string;
    appVersion?: string;
    osVersion?: string;
    networkType?: string;
    deviceId?: string;
    /** Mobile SDK semver (optional; older clients omit — backward compatible) */
    sdkVersion?: string;
};

const MAX_INGEST_SDK_VERSION_LEN = 50;

/**
 * Normalize optional SDK version from ingest payloads. Returns null if missing/invalid.
 */
export function normalizeIngestSdkVersion(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    const safe = trimmed.slice(0, MAX_INGEST_SDK_VERSION_LEN);
    if (!/^[\w.\-+]+$/.test(safe)) return null;
    return safe;
}

type EnsureIngestSessionOptions = {
    initialStatus?: string;
};

type RepairMissingSessionsOptions = {
    since?: Date;
    limit?: number;
    source?: string;
};

type MissingSessionCandidateRow = {
    sessionId: string;
    projectId: string;
    firstSeenAt: Date | string | null;
    lastSeenAt: Date | string | null;
};

const MATERIALIZE_MISSING_SESSION_MAX_AGE_MS = 6 * 60 * 60 * 1000;

function toDateOrNull(value: unknown): Date | null {
    if (!value) return null;
    const parsed = value instanceof Date ? value : new Date(String(value));
    return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function inferSessionShape(req?: any, metadata?: IngestSessionMetadata) {
    let platform = metadata?.platform || 'unknown';
    let deviceModel = metadata?.deviceModel;
    let osVersion = metadata?.osVersion;

    const userAgent = req?.headers?.['user-agent'];
    if (typeof userAgent === 'string' && !deviceModel) {
        if (userAgent.includes('Darwin') || userAgent.includes('iPhone') || userAgent.includes('iPad')) {
            platform = 'ios';
        } else if (userAgent.includes('Android') || userAgent.includes('okhttp')) {
            platform = 'android';
        }

        const sdkMatch = userAgent.match(/Rejourney-SDK\/[\d.]+ \((\w+); ([^;]+); ([\d.]+)\)/);
        if (sdkMatch) {
            platform = sdkMatch[1]?.toLowerCase() || platform;
            deviceModel = sdkMatch[2] || deviceModel;
            osVersion = sdkMatch[3] || osVersion;
        }
    }

    let userDisplayId: string | null = null;
    let anonymousDisplayId: string | null = null;
    if (metadata?.userId) {
        if (metadata.userId.startsWith('anon_')) {
            anonymousDisplayId = metadata.userId;
        } else {
            userDisplayId = metadata.userId;
        }
    }

    return {
        platform,
        deviceModel: deviceModel || null,
        osVersion: osVersion || null,
        userDisplayId,
        anonymousDisplayId,
    };
}

// ---------------------------------------------------------------------------
// Per-project retention cache (in-process, 30-minute TTL).
//
// A team's retentionTier only changes on plan upgrade/downgrade — for presign
// hot-path purposes, stale data for up to 30 minutes is completely safe; the
// tier determines how long we keep recordings, not whether we accept them.
// ---------------------------------------------------------------------------
type RetentionCacheEntry = { result: Awaited<ReturnType<typeof getVideoRetentionDetailsForTier>>; expiresAt: number };
const _retentionByProject = new Map<string, RetentionCacheEntry>();
const PROJECT_RETENTION_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

async function resolveVideoRetention(projectId: string) {
    const now = Date.now();
    const cached = _retentionByProject.get(projectId);
    if (cached && cached.expiresAt > now) return cached.result;

    let teamRetentionTier = FREE_VIDEO_RETENTION_TIER;
    const [projectInfo] = await db
        .select({ retentionTier: teams.retentionTier })
        .from(projects)
        .innerJoin(teams, eq(projects.teamId, teams.id))
        .where(eq(projects.id, projectId))
        .limit(1);

    if (projectInfo?.retentionTier !== undefined) {
        teamRetentionTier = normalizeVideoRetentionTier(projectInfo.retentionTier);
    }

    const result = await getVideoRetentionDetailsForTier(teamRetentionTier);
    _retentionByProject.set(projectId, { result, expiresAt: now + PROJECT_RETENTION_CACHE_TTL_MS });
    return result;
}

/**
 * Invalidate the per-process retention cache for a project.
 * Call after a team's retention tier changes (plan upgrade/downgrade).
 */
export function invalidateProjectRetentionCache(projectId: string): void {
    _retentionByProject.delete(projectId);
}

function buildMetadataUpdates(existing: any, metadata: IngestSessionMetadata | undefined, req?: any) {
    const inferred = inferSessionShape(req, metadata);
    const updates: Record<string, unknown> = {};

    if (!existing.platform && inferred.platform && inferred.platform !== 'unknown') {
        updates.platform = inferred.platform;
    }
    if (!existing.deviceModel && inferred.deviceModel) {
        updates.deviceModel = inferred.deviceModel;
    }
    if (!existing.osVersion && inferred.osVersion) {
        updates.osVersion = inferred.osVersion;
    }
    if (!existing.appVersion && metadata?.appVersion) {
        updates.appVersion = metadata.appVersion;
    }
    const sdkNorm = normalizeIngestSdkVersion(metadata?.sdkVersion);
    if (sdkNorm && !existing.sdkVersion) {
        updates.sdkVersion = sdkNorm;
    }
    if (!existing.deviceId && metadata?.deviceId) {
        updates.deviceId = metadata.deviceId;
    }
    if (!existing.userDisplayId && inferred.userDisplayId) {
        updates.userDisplayId = inferred.userDisplayId;
    }
    if (!existing.anonymousDisplayId && inferred.anonymousDisplayId) {
        updates.anonymousDisplayId = inferred.anonymousDisplayId;
    }
    if (existing.isSampledIn !== true) {
        updates.isSampledIn = true;
    }
    // Back-fill: if a later request arrives with the observe-only header and the session
    // row was created before the flag was set (e.g. race or older SDK version that sent
    // the header on a retry but not the first request), promote the flag. Never clear it
    // once set — observeOnly is a one-way latch.
    if (!existing.observeOnly && req?.headers?.['x-rj-observe-only'] === '1') {
        updates.observeOnly = true;
    }

    return updates;
}

async function maybeRunGeoLookup(sessionId: string, req?: any) {
    if (!req) return;
    // SDK sends x-rj-no-geo: 1 when collectGeoLocation is false — honour the opt-out
    if (req.headers?.['x-rj-no-geo'] === '1') return;
    const clientIp = getRequestIp(req);
    if (clientIp) {
        lookupGeoIp(sessionId, clientIp).catch(() => { });
    }
}

function assertSessionProjectMatch(session: any, projectId: string, source: string) {
    if (session.projectId === projectId) return;

    logger.warn({
        source,
        sessionId: session.id,
        requestedProjectId: projectId,
        existingProjectId: session.projectId,
    }, 'Session ID already exists under a different project');

    throw ApiError.conflict('Session already exists under a different project', {
        sessionId: session.id,
        requestedProjectId: projectId,
        existingProjectId: session.projectId,
    });
}

export function isSessionIdFresh(sessionId: string, maxAgeMs = MATERIALIZE_MISSING_SESSION_MAX_AGE_MS): boolean {
    const startedAt = parseSessionStartedAtOrNull(sessionId);
    if (!startedAt) {
        return false;
    }
    const ageMs = Date.now() - startedAt.getTime();
    return Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= maxAgeMs;
}

export async function maybeBackfillSessionStartedAt(
    sessionId: string,
    candidateStartedAtMs: number | null | undefined,
    prefetchedSession?: any
): Promise<any | null> {
    const candidateMs = Number(candidateStartedAtMs);
    if (!Number.isFinite(candidateMs) || candidateMs <= 0) {
        return null;
    }

    const candidateStartedAt = new Date(candidateMs);

    // Use the pre-fetched session when available to skip a SELECT round-trip.
    let session = prefetchedSession ?? null;
    if (!session) {
        let [fetched] = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1);
        session = fetched ?? null;
    }
    if (!session) {
        return null;
    }

    if (candidateStartedAt >= session.startedAt) {
        return session;
    }

    await db.update(sessions)
        .set({
            startedAt: candidateStartedAt,
            updatedAt: new Date(),
        })
        .where(eq(sessions.id, sessionId));

    const [updated] = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1);
    return updated ?? null;
}

type LifecycleSessionResolution = {
    session: any;
    metrics: any;
    resolution: 'existing' | 'materialized';
} | {
    session: null;
    metrics: null;
    resolution: 'ignored_stale_missing';
};

export async function resolveLifecycleSession(
    projectId: string,
    sessionId: string,
    req?: any,
    metadata?: IngestSessionMetadata
): Promise<LifecycleSessionResolution> {
    let [sessionResult] = await db
        .select({
            session: sessions,
            metrics: sessionMetrics,
        })
        .from(sessions)
        .leftJoin(sessionMetrics, eq(sessions.id, sessionMetrics.sessionId))
        .where(eq(sessions.id, sessionId))
        .limit(1);

    if ((!sessionResult || sessionResult.session.projectId !== projectId) && isSessionIdFresh(sessionId)) {
        const ensured = await ensureIngestSession(projectId, sessionId, req, metadata);

        [sessionResult] = await db
            .select({
                session: sessions,
                metrics: sessionMetrics,
            })
            .from(sessions)
            .leftJoin(sessionMetrics, eq(sessions.id, sessionMetrics.sessionId))
            .where(eq(sessions.id, ensured.session.id))
            .limit(1);

        if (sessionResult && sessionResult.session.projectId === projectId) {
            return {
                session: sessionResult.session,
                metrics: sessionResult.metrics,
                resolution: 'materialized',
            };
        }
    }

    if (!sessionResult || sessionResult.session.projectId !== projectId) {
        return {
            session: null,
            metrics: null,
            resolution: 'ignored_stale_missing',
        };
    }

    return {
        session: sessionResult.session,
        metrics: sessionResult.metrics,
        resolution: 'existing',
    };
}

export async function ensureIngestSession(
    projectId: string,
    sessionId: string,
    req?: any,
    metadata?: IngestSessionMetadata,
    options?: EnsureIngestSessionOptions,
    prefetchedSession?: any
): Promise<{ session: any; created: boolean }> {
    // Use the caller's already-fetched session row to skip a DB round-trip.
    // Only trust it if the projectId matches — guards against stale data bugs.
    let session: any = (prefetchedSession?.id === sessionId && prefetchedSession?.projectId === projectId)
        ? prefetchedSession
        : null;

    if (!session) {
        let [fetched] = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1);
        session = fetched ?? null;
    }

    let created = false;

    if (!session) {
        const inferred = inferSessionShape(req, metadata);
        const videoRetention = await resolveVideoRetention(projectId);
        const initialSdkVersion = normalizeIngestSdkVersion(metadata?.sdkVersion);

        const inserted = await db.insert(sessions).values({
            id: sessionId,
            projectId,
            status: options?.initialStatus || 'processing',
            platform: inferred.platform,
            deviceModel: inferred.deviceModel,
            osVersion: inferred.osVersion,
            appVersion: metadata?.appVersion,
            ...(initialSdkVersion ? { sdkVersion: initialSdkVersion } : {}),
            userDisplayId: inferred.userDisplayId,
            anonymousDisplayId: inferred.anonymousDisplayId,
            deviceId: metadata?.deviceId || null,
            startedAt: parseSessionStartedAt(sessionId),
            retentionTier: videoRetention.tier,
            retentionDays: videoRetention.days,
            isSampledIn: true,
            // Older SDK versions that predate this header default to false (normal recording).
            observeOnly: req?.headers?.['x-rj-observe-only'] === '1',
        }).onConflictDoNothing().returning({ id: sessions.id });

        created = inserted.length > 0;
        [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1);

        if (!session) {
            throw ApiError.internal('Failed to materialize session for ingest');
        }

        assertSessionProjectMatch(session, projectId, 'ensureIngestSession');

        if (!created) {
            logger.info({ sessionId, projectId }, 'Reused concurrently materialized session row');
        }
    } else {
        assertSessionProjectMatch(session, projectId, 'ensureIngestSession');
    }

    const updates = buildMetadataUpdates(session, metadata, req);
    if (Object.keys(updates).length > 0) {
        await db.update(sessions)
            .set(updates)
            .where(eq(sessions.id, sessionId));
        [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1);
    }

    // Only INSERT session_metrics when we just created the session. For existing
    // sessions the row is guaranteed to be there already — skipping saves one
    // round-trip on every repeat presign call (the hot path).
    if (created) {
        try {
            await db.insert(sessionMetrics)
                .values({ sessionId })
                .onConflictDoNothing();
        } catch (err) {
            logger.warn({ err, sessionId, projectId }, 'Failed to ensure session_metrics row');
        }
    }

    await maybeRunGeoLookup(session.id, req);

    return { session, created };
}

export async function repairMissingSessionsFromIngestJobs(
    options: RepairMissingSessionsOptions = {}
): Promise<{ scanned: number; repaired: number }> {
    const since = options.since ?? new Date(Date.now() - (7 * 24 * 60 * 60 * 1000));
    const limit = Math.max(1, Math.min(options.limit ?? 100, 1000));
    const result = await db.execute(sql`
        select
            ra.session_id as "sessionId",
            ra.project_id::text as "projectId",
            min(ra.created_at) as "firstSeenAt",
            max(ra.created_at) as "lastSeenAt"
        from ${recordingArtifacts} ra
        left join ${sessions} s on s.id = ra.session_id
        where ra.session_id is not null
          and s.id is null
          and ra.created_at >= ${since}
        group by ra.session_id, ra.project_id
        order by max(ra.created_at) desc, ra.session_id desc
        limit ${limit}
    `);

    const rows = ((result as any).rows as MissingSessionCandidateRow[] | undefined) ?? [];
    let repaired = 0;

    for (const row of rows) {
        try {
            const repairedSession = await ensureIngestSession(
                row.projectId,
                row.sessionId,
                undefined,
                undefined,
                { initialStatus: 'processing' },
            );
            if (repairedSession.session) {
                repaired += 1;
            }
        } catch (err) {
            logger.warn({
                err,
                source: options.source ?? 'repairMissingSessionsFromIngestJobs',
                sessionId: row.sessionId,
                projectId: row.projectId,
                firstSeenAt: toDateOrNull(row.firstSeenAt)?.toISOString() ?? null,
                lastSeenAt: toDateOrNull(row.lastSeenAt)?.toISOString() ?? null,
            }, 'Failed to repair missing ingest session');
        }
    }

    if (rows.length > 0) {
        logger.info({
            source: options.source ?? 'repairMissingSessionsFromIngestJobs',
            since: since.toISOString(),
            scanned: rows.length,
            repaired,
        }, 'Repaired missing sessions from ingest jobs');
    }

    return {
        scanned: rows.length,
        repaired,
    };
}
