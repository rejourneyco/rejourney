import { eq, sql } from 'drizzle-orm';
import { db, sessions, sessionMetrics, deviceUsage, projects, teams } from '../db/client.js';
import { logger } from '../logger.js';
import { lookupGeoIpFromMmdb } from './geoIpMmdb.js';

/**
 * Update device usage metrics (atomic upsert for scalability)
 * Tracks bytes uploaded, request count, sessions started, minutes recorded per device per project per day.
 */
export async function updateDeviceUsage(
    deviceId: string | null,
    projectId: string,
    updates: {
        bytesUploaded?: number;
        requestCount?: number;
        sessionsStarted?: number;
        minutesRecorded?: number;
    }
): Promise<void> {
    if (!deviceId) return;

    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

    try {
        await db.insert(deviceUsage)
            .values({
                deviceId,
                projectId,
                period: today,
                bytesUploaded: BigInt(updates.bytesUploaded || 0),
                requestCount: updates.requestCount || 0,
                sessionsStarted: updates.sessionsStarted || 0,
                minutesRecorded: updates.minutesRecorded || 0,
            })
            .onConflictDoUpdate({
                target: [deviceUsage.deviceId, deviceUsage.projectId, deviceUsage.period],
                set: {
                    bytesUploaded: updates.bytesUploaded
                        ? sql`${deviceUsage.bytesUploaded} + ${updates.bytesUploaded}`
                        : deviceUsage.bytesUploaded,
                    requestCount: updates.requestCount
                        ? sql`${deviceUsage.requestCount} + ${updates.requestCount}`
                        : deviceUsage.requestCount,
                    sessionsStarted: updates.sessionsStarted
                        ? sql`${deviceUsage.sessionsStarted} + ${updates.sessionsStarted}`
                        : deviceUsage.sessionsStarted,
                    minutesRecorded: updates.minutesRecorded
                        ? sql`${deviceUsage.minutesRecorded} + ${updates.minutesRecorded}`
                        : deviceUsage.minutesRecorded,
                },
            });
    } catch (err) {
        // Non-blocking - usage tracking should not fail uploads
        logger.warn({ err, deviceId, projectId }, 'Failed to update device usage');
    }
}

/**
 * GeoIP lookup using local MMDB.
 */
export async function lookupGeoIp(sessionId: string, ip: string): Promise<void> {
    if (!ip) return;

    // Normalize IPv6-mapped IPv4 addresses (e.g., ::ffff:192.168.1.1 -> 192.168.1.1)
    let normalizedIp = ip.trim();
    if (normalizedIp.startsWith('::ffff:')) {
        normalizedIp = normalizedIp.slice(7);
    }

    // Skip private/local IPs early
    const privatePatterns = [
        /^127\./,           // localhost
        /^10\./,            // Class A private
        /^172\.(1[6-9]|2[0-9]|3[01])\./,  // Class B private
        /^192\.168\./,      // Class C private
        /^::1$/,            // IPv6 localhost
        /^fe80:/i,          // IPv6 link-local
        /^fc00:/i,          // IPv6 unique local
        /^fd/i,             // IPv6 unique local
    ];

    const isPrivate = privatePatterns.some(pattern => pattern.test(normalizedIp));
    if (isPrivate) {
        logger.debug({ sessionId, ip: normalizedIp }, 'Skipping GeoIP for private/local IP');
        return;
    }

    logger.info({ sessionId, ip: normalizedIp }, 'Starting GeoIP lookup');

    try {
        const mmdbGeo = await lookupGeoIpFromMmdb(normalizedIp);
        if (mmdbGeo) {
            // Keep existing normalization behavior for disputed/miscategorized regions.
            const countryCode = mmdbGeo.countryCode === 'IL' ? 'PS/IL' : mmdbGeo.countryCode;

            await db.update(sessions)
                .set({
                    geoCity: mmdbGeo.city || null,
                    geoRegion: mmdbGeo.region || null,
                    geoCountry: countryCode || null,
                    geoCountryCode: countryCode || null,
                    geoLatitude: mmdbGeo.latitude,
                    geoLongitude: mmdbGeo.longitude,
                    geoTimezone: mmdbGeo.timezone || null,
                })
                .where(eq(sessions.id, sessionId));

            logger.debug({
                sessionId,
                ip,
                city: mmdbGeo.city,
                country: countryCode,
                source: 'mmdb',
            }, 'GeoIP lookup succeeded');
            return;
        }

        logger.info({ sessionId, ip: normalizedIp }, 'GeoIP MMDB lookup returned null');
    } catch (error) {
        logger.warn({ error, sessionId, ip }, 'GeoIP lookup failed');
    }
}



/**
 * Ensure a session exists (Lazy Create pattern)
 * Now accepts optional metadata for richer session creation
 */
export async function ensureIngestSession(
    projectId: string,
    sessionId: string,
    req?: any,
    metadata?: {
        userId?: string;
        platform?: string;
        deviceModel?: string;
        appVersion?: string;
        osVersion?: string;
        networkType?: string;
        deviceId?: string;  // Device ID from upload token for anonymous name generation
        isSampledIn?: boolean;  // SDK's sampling decision for server-side enforcement
    }
): Promise<{ session: any | null; created: boolean }> {
    let [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1);
    let created = false;

    if (!session) {
        logger.warn({ sessionId, projectId, metadata }, 'Lazy creating missing session');

        // Extract timestamp from session ID if possible (format: session_TIMESTAMP_UUID)
        // This ensures the session start time reflects the actual recording start, not the upload time
        let startedAt = new Date();
        const parts = sessionId.split('_');
        if (parts.length >= 3 && parts[0] === 'session') {
            const ts = parseInt(parts[1], 10);
            if (!isNaN(ts) && ts > 0) {
                startedAt = new Date(ts);
            }
        }

        // Extract device info from User-Agent if available
        let platform = metadata?.platform || 'unknown';
        let deviceModel = metadata?.deviceModel;
        let osVersion = metadata?.osVersion;
        const appVersion = metadata?.appVersion;

        if (req?.headers?.['user-agent'] && !deviceModel) {
            const ua = req.headers['user-agent'];
            // Parse iOS User-Agent: "YourApp/1.0 CFNetwork/1331.0.7 Darwin/21.1.0"
            // Parse SDK User-Agent: "Rejourney-SDK/1.0.0 (iOS; iPhone12,1; 15.0)"
            if (ua.includes('Darwin') || ua.includes('iPhone') || ua.includes('iPad')) {
                platform = 'ios';
            } else if (ua.includes('Android') || ua.includes('okhttp')) {
                platform = 'android';
            }

            // Try to extract device model from SDK User-Agent
            const sdkMatch = ua.match(/Rejourney-SDK\/[\d.]+ \((\w+); ([^;]+); ([\d.]+)\)/);
            if (sdkMatch) {
                platform = sdkMatch[1].toLowerCase();
                deviceModel = sdkMatch[2];
                osVersion = sdkMatch[3];
            }
        }

        // Extract user/anonymous IDs from metadata
        // If userId starts with "anon_", treat it as anonymousDisplayId, otherwise as userDisplayId
        let userDisplayId: string | null = null;
        let anonymousDisplayId: string | null = null;

        if (metadata?.userId) {
            if (metadata.userId.startsWith('anon_')) {
                anonymousDisplayId = metadata.userId;
            } else {
                userDisplayId = metadata.userId;
            }
        }

        // Get the project and team to inherit the team's retention tier
        let teamRetentionTier = 0; // default 0 implies using the global/plan defaults
        const [projectInfo] = await db
            .select({ retentionTier: teams.retentionTier })
            .from(projects)
            .innerJoin(teams, eq(projects.teamId, teams.id))
            .where(eq(projects.id, projectId))
            .limit(1);

        if (projectInfo && projectInfo.retentionTier !== undefined) {
            teamRetentionTier = projectInfo.retentionTier;
        }

        [session] = await db.insert(sessions).values({
            id: sessionId,
            projectId,
            status: 'processing',
            platform,
            deviceModel,
            osVersion,
            appVersion,
            userDisplayId,
            anonymousDisplayId,
            deviceId: metadata?.deviceId || null,  // Set deviceId on session creation for funny anonymous names
            startedAt,
            retentionTier: teamRetentionTier,
            isSampledIn: metadata?.isSampledIn ?? true,  // Default to true for backward compatibility
        }).returning();

        // Initialize metrics
        await db.insert(sessionMetrics).values({ sessionId: session.id });
        created = true;
    }

    // Run GeoIP if provided (and if we grabbed/created a session)
    if (session && req) {
        // IP extraction with support for various proxy headers
        // Priority: Cloudflare > X-Forwarded-For > X-Real-IP > socket
        let clientIp = '';

        // Cloudflare puts the real client IP in CF-Connecting-IP
        const cfConnectingIp = req.headers['cf-connecting-ip'];
        const xForwardedFor = req.headers['x-forwarded-for'];
        const xRealIp = req.headers['x-real-ip'];

        if (cfConnectingIp) {
            clientIp = Array.isArray(cfConnectingIp) ? cfConnectingIp[0] : cfConnectingIp;
        } else if (xForwardedFor) {
            // X-Forwarded-For can have multiple IPs, first is the client
            const ips = (Array.isArray(xForwardedFor) ? xForwardedFor[0] : xForwardedFor)
                .split(',')
                .map((ip: string) => ip.trim());
            clientIp = ips[0];
        } else if (xRealIp) {
            clientIp = Array.isArray(xRealIp) ? xRealIp[0] : xRealIp;
        } else {
            clientIp = req.socket?.remoteAddress || req.ip || '';
        }

        logger.debug({
            sessionId: session.id,
            clientIp,
            cfConnectingIp: cfConnectingIp || 'not set',
            xForwardedFor: xForwardedFor || 'not set',
            xRealIp: xRealIp || 'not set',
            socketRemoteAddress: req.socket?.remoteAddress || 'not set'
        }, 'IP extraction for GeoIP');

        if (clientIp) {
            lookupGeoIp(session.id, clientIp).catch(() => { });
        }
    }

    return { session, created };
}
