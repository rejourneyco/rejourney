import { eq } from 'drizzle-orm';
import { db, projects, sessions, sessionMetrics, teams } from '../db/client.js';
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
};

type EnsureIngestSessionOptions = {
    initialStatus?: string;
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

        [session] = await db.insert(sessions).values({
            id: sessionId,
            projectId,
            status: options?.initialStatus || 'processing',
            platform: inferred.platform,
            deviceModel: inferred.deviceModel,
            osVersion: inferred.osVersion,
            appVersion: metadata?.appVersion,
            userDisplayId: inferred.userDisplayId,
            anonymousDisplayId: inferred.anonymousDisplayId,
            deviceId: metadata?.deviceId || null,
            startedAt: parseSessionStartedAt(sessionId),
            retentionTier: videoRetention.tier,
            retentionDays: videoRetention.days,
            isSampledIn: true,
        }).returning();

        await db.insert(sessionMetrics)
            .values({ sessionId: session.id })
            .onConflictDoNothing();

        created = true;
    } else {
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
    }

    await maybeRunGeoLookup(session.id, req);

    return { session, created };
}
