import { eq, sql } from 'drizzle-orm';
import { db, sessions, deviceUsage } from '../db/client.js';
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
