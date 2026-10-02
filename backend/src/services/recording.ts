import { and, eq, sql } from 'drizzle-orm';
import { db, sessions } from '../db/client.js';
import { logger } from '../logger.js';
import { setBoundedMapEntry } from '../utils/boundedMap.js';
import { lookupGeoIpFromMmdb } from './geoIpMmdb.js';
import {
    buildClickHouseDeviceUsageDailyRollupRow,
    writeDeviceUsageDailyRollupToClickHouse,
} from './clickhouseProductRollupsSink.js';

/**
 * Update device usage metrics (atomic upsert for scalability)
 * Tracks bytes uploaded, request count, sessions started, and minutes recorded per project per day without storing device identity.
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
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

    try {
        await writeDeviceUsageDailyRollupToClickHouse(buildClickHouseDeviceUsageDailyRollupRow({
            projectId,
            period: today,
            bytesUploaded: updates.bytesUploaded || 0,
            requestCount: updates.requestCount || 0,
            sessionsStarted: updates.sessionsStarted || 0,
            minutesRecorded: updates.minutesRecorded || 0,
            source: 'device_usage_increment',
        }));
    } catch (err) {
        // Non-blocking - usage tracking should not fail uploads
        logger.warn({ err, deviceId, projectId }, 'Failed to update device usage');
    }
}

// Repeated uploads from the same session/IP need no new lookup or write.
// Bound both memory and staleness; changed IPs are processed immediately.
const recentGeoLookups = new Map<string, { ip: string; expiresAt: number }>();
const GEO_LOOKUP_TTL_MS = 5 * 60 * 1000;
const GEO_LOOKUP_MAX_ENTRIES = 10_000;

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

    const previous = recentGeoLookups.get(sessionId);
    if (previous?.ip === normalizedIp && previous.expiresAt > Date.now()) return;
    const lookup = { ip: normalizedIp, expiresAt: Date.now() + 30_000 };
    setBoundedMapEntry(recentGeoLookups, sessionId, lookup, GEO_LOOKUP_MAX_ENTRIES);

    logger.debug({ sessionId }, 'Starting GeoIP lookup');

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
                .where(and(
                    eq(sessions.id, sessionId),
                    sql`ROW(${sessions.geoCity}, ${sessions.geoRegion}, ${sessions.geoCountry}, ${sessions.geoCountryCode}, ${sessions.geoLatitude}, ${sessions.geoLongitude}, ${sessions.geoTimezone})
                        IS DISTINCT FROM ROW(${mmdbGeo.city || null}::text, ${mmdbGeo.region || null}::text, ${countryCode || null}::text, ${countryCode || null}::text, ${mmdbGeo.latitude}::double precision, ${mmdbGeo.longitude}::double precision, ${mmdbGeo.timezone || null}::text)`,
                ));
            lookup.expiresAt = Date.now() + GEO_LOOKUP_TTL_MS;

            logger.debug({
                sessionId,
                ip,
                city: mmdbGeo.city,
                country: countryCode,
                source: 'mmdb',
            }, 'GeoIP lookup succeeded');
            return;
        }

        lookup.expiresAt = Date.now() + 30_000;
        logger.debug({ sessionId }, 'GeoIP MMDB lookup returned null');
    } catch (error) {
        if (recentGeoLookups.get(sessionId) === lookup) recentGeoLookups.delete(sessionId);
        logger.warn({ error, sessionId, ip }, 'GeoIP lookup failed');
    }
}
