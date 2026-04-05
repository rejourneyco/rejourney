import { eq, sql } from 'drizzle-orm';
import { db, ingestJobs, projects, sessions, sessionMetrics, teams } from '../db/client.js';
import { logger } from '../logger.js';
import { ApiError } from '../middleware/index.js';
import { getRequestIp } from '../utils/requestIp.js';
import { lookupGeoIp } from './recording.js';
import {
    FREE_VIDEO_RETENTION_TIER,
    getVideoRetentionDetailsForTier,
    normalizeVideoRetentionTier,
} from './videoRetention.js';

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

function parseSessionStartedAt(sessionId: string): Date {
    const parts = sessionId.split('_');
    if (parts.length >= 3 && parts[0] === 'session') {
        const ts = Number.parseInt(parts[1] || '', 10);
        if (Number.isFinite(ts) && ts > 0) {
            return new Date(ts);
        }
    }
    return new Date();
}

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

async function resolveVideoRetention(projectId: string) {
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

    return getVideoRetentionDetailsForTier(teamRetentionTier);
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

    return updates;
}

async function maybeRunGeoLookup(sessionId: string, req?: any) {
    if (!req) return;
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
    const startedAt = parseSessionStartedAt(sessionId);
    const ageMs = Date.now() - startedAt.getTime();
    return Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= maxAgeMs;
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
    options?: EnsureIngestSessionOptions
): Promise<{ session: any; created: boolean }> {
    let [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1);
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

    await db.insert(sessionMetrics)
        .values({ sessionId })
        .onConflictDoNothing();

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
            ij.session_id as "sessionId",
            ij.project_id::text as "projectId",
            min(ij.created_at) as "firstSeenAt",
            max(ij.created_at) as "lastSeenAt"
        from ${ingestJobs} ij
        left join ${sessions} s on s.id = ij.session_id
        where ij.session_id is not null
          and s.id is null
          and ij.created_at >= ${since}
        group by ij.session_id, ij.project_id
        order by max(ij.created_at) desc, ij.session_id desc
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
