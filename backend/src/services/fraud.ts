/**
 * Fraud Detection Service
 * 
 * Basic heuristics for detecting abuse and assigning device trust scores.
 * Updates the device_trust_scores table with calculated scores.
 */

import { eq, and, sql } from 'drizzle-orm';
import { db, deviceTrustScores, abuseSignals, sessions } from '../db/client.js';
import { logger } from '../logger.js';

// Known cloud provider IP ranges (simplified list for common providers)
const CLOUD_IP_RANGES = [
    // AWS
    { prefix: '3.', name: 'AWS' },
    { prefix: '13.', name: 'AWS' },
    { prefix: '18.', name: 'AWS' },
    { prefix: '34.', name: 'AWS' },
    { prefix: '35.', name: 'AWS' },
    { prefix: '52.', name: 'AWS' },
    { prefix: '54.', name: 'AWS' },
    // Google Cloud
    { prefix: '35.', name: 'GCP' },
    { prefix: '34.', name: 'GCP' },
    // Azure
    { prefix: '40.', name: 'Azure' },
    { prefix: '52.', name: 'Azure' },
    { prefix: '104.', name: 'Azure' },
    // DigitalOcean
    { prefix: '104.131.', name: 'DigitalOcean' },
    { prefix: '138.68.', name: 'DigitalOcean' },
    { prefix: '159.65.', name: 'DigitalOcean' },
];

export interface TrustFlags {
    timing_anomaly?: boolean;
    entropy_low?: boolean;
    replay_detected?: boolean;
    cloud_ip?: boolean;
    rapid_geo_change?: boolean;
}

export interface SignalDetails {
    type: 'timing_anomaly' | 'entropy_low' | 'replay_detected' | 'cloud_ip' | 'rapid_geo_change';
    severity: 'low' | 'medium' | 'high' | 'critical';
    metadata?: Record<string, unknown>;
}

/**
 * Check if an IP address is from a known cloud provider
 */
export function isCloudIp(ip: string): { isCloud: boolean; provider?: string } {
    if (!ip) return { isCloud: false };

    for (const range of CLOUD_IP_RANGES) {
        if (ip.startsWith(range.prefix)) {
            return { isCloud: true, provider: range.name };
        }
    }
    return { isCloud: false };
}

/**
 * Detect timing anomalies in event sequences
 * Events that happen faster than humanly possible suggest bot activity
 */
export function detectTimingAnomaly(events: { timestamp: number; type: string }[]): boolean {
    if (!events || events.length < 2) return false;

    const sortedEvents = [...events].sort((a, b) => a.timestamp - b.timestamp);

    let impossiblyFastCount = 0;
    for (let i = 1; i < sortedEvents.length; i++) {
        const delta = sortedEvents[i].timestamp - sortedEvents[i - 1].timestamp;

        // Tap events faster than 50ms are suspicious (human minimum is ~70-100ms)
        if (delta < 50 && (sortedEvents[i].type === 'tap' || sortedEvents[i].type === 'touch')) {
            impossiblyFastCount++;
        }
    }

    // More than 10% impossibly fast events is suspicious
    return impossiblyFastCount > events.length * 0.1;
}

/**
 * Detect low entropy (bot-like repetitive behavior)
 * Bots often have very repetitive interaction patterns
 */
export function detectLowEntropy(events: { type: string; x?: number; y?: number }[]): boolean {
    if (!events || events.length < 10) return false;

    const typeFrequency: Record<string, number> = {};
    for (const event of events) {
        typeFrequency[event.type] = (typeFrequency[event.type] || 0) + 1;
    }

    const types = Object.keys(typeFrequency);
    if (types.length < 2) return true; // Only one event type is suspicious

    // Check if all tap coordinates are exactly the same (bot signature)
    const taps = events.filter(e => e.x !== undefined && e.y !== undefined);
    if (taps.length > 5) {
        const coords = taps.map(e => `${Math.round(e.x! / 10)},${Math.round(e.y! / 10)}`);
        const uniqueCoords = new Set(coords);
        if (uniqueCoords.size < taps.length * 0.2) {
            return true; // Less than 20% unique coordinates is suspicious
        }
    }

    return false;
}

/**
 * Detect rapid geo change (teleportation)
 * If a device appears in two distant locations within a short time, it's suspicious
 */
export async function detectRapidGeoChange(
    deviceId: string,
    currentLat: number,
    currentLng: number,
    timestamp: Date
): Promise<{ detected: boolean; distance?: number; timeDelta?: number }> {
    // Get the device's last known location
    const [lastSession] = await db
        .select({
            lat: sessions.geoLatitude,
            lng: sessions.geoLongitude,
            time: sessions.startedAt,
        })
        .from(sessions)
        .where(and(
            eq(sessions.deviceId, deviceId),
            sql`${sessions.geoLatitude} IS NOT NULL`
        ))
        .orderBy(sql`${sessions.startedAt} DESC`)
        .limit(1);

    if (!lastSession || !lastSession.lat || !lastSession.lng) {
        return { detected: false };
    }

    // Calculate distance using Haversine formula
    const R = 6371; // Earth radius in km
    const dLat = (currentLat - lastSession.lat) * Math.PI / 180;
    const dLng = (currentLng - lastSession.lng) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lastSession.lat * Math.PI / 180) * Math.cos(currentLat * Math.PI / 180) *
        Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c;

    // Time difference in hours
    const timeDelta = (timestamp.getTime() - lastSession.time.getTime()) / (1000 * 60 * 60);

    // Max reasonable travel speed: 1000 km/h (faster than any commercial flight)
    const maxSpeed = 1000;
    const possibleDistance = maxSpeed * timeDelta;

    if (distance > possibleDistance) {
        return { detected: true, distance, timeDelta };
    }

    return { detected: false, distance, timeDelta };
}

/**
 * Record an abuse signal for a device/session
 */
export async function recordAbuseSignal(
    signal: SignalDetails,
    deviceId?: string,
    sessionId?: string
): Promise<void> {
    try {
        await db.insert(abuseSignals).values({
            deviceId,
            sessionId,
            signalType: signal.type,
            severity: signal.severity,
            metadata: signal.metadata || {},
            detectedAt: new Date(),
        });
    } catch (err) {
        logger.warn({ err, signal, deviceId, sessionId }, 'Failed to record abuse signal');
    }
}

/**
 * Update device trust score based on detected signals
 */
export async function updateDeviceTrustScore(
    deviceId: string,
    signals: SignalDetails[]
): Promise<number> {
    // Start with perfect trust
    let score = 1.0;
    const flags: TrustFlags = {};

    // Deductions per signal type
    const deductions: Record<string, { amount: number; flag: keyof TrustFlags }> = {
        timing_anomaly: { amount: 0.15, flag: 'timing_anomaly' },
        entropy_low: { amount: 0.2, flag: 'entropy_low' },
        replay_detected: { amount: 0.5, flag: 'replay_detected' },
        cloud_ip: { amount: 0.1, flag: 'cloud_ip' },
        rapid_geo_change: { amount: 0.25, flag: 'rapid_geo_change' },
    };

    // Apply severity multipliers
    const severityMultipliers: Record<string, number> = {
        low: 0.25,
        medium: 0.5,
        high: 1.0,
        critical: 2.0,
    };

    for (const signal of signals) {
        const def = deductions[signal.type];
        if (def) {
            const multiplier = severityMultipliers[signal.severity] || 1.0;
            score -= def.amount * multiplier;
            flags[def.flag] = true;
        }
    }

    // Clamp score between 0 and 1
    score = Math.max(0, Math.min(1, score));

    try {
        await db.insert(deviceTrustScores)
            .values({
                deviceId,
                score,
                flags,
                updatedAt: new Date(),
            })
            .onConflictDoUpdate({
                target: deviceTrustScores.deviceId,
                set: {
                    score,
                    flags,
                    updatedAt: new Date(),
                },
            });

        logger.info({ deviceId, score, signalCount: signals.length }, 'Device trust score updated');
    } catch (err) {
        logger.warn({ err, deviceId, score }, 'Failed to update device trust score');
    }

    return score;
}

/**
 * Run all fraud checks for a session and update trust score
 */
export async function evaluateSessionTrust(
    sessionId: string,
    deviceId: string,
    clientIp: string,
    events?: { timestamp: number; type: string; x?: number; y?: number }[],
    geoData?: { lat: number; lng: number }
): Promise<{ score: number; signals: SignalDetails[] }> {
    const signals: SignalDetails[] = [];

    // Check for cloud IP
    const cloudCheck = isCloudIp(clientIp);
    if (cloudCheck.isCloud) {
        const signal: SignalDetails = {
            type: 'cloud_ip',
            severity: 'medium',
            metadata: { provider: cloudCheck.provider, ip: clientIp },
        };
        signals.push(signal);
        await recordAbuseSignal(signal, deviceId, sessionId);
    }

    // Check for timing anomalies
    if (events && detectTimingAnomaly(events)) {
        const signal: SignalDetails = {
            type: 'timing_anomaly',
            severity: 'high',
            metadata: { eventCount: events.length },
        };
        signals.push(signal);
        await recordAbuseSignal(signal, deviceId, sessionId);
    }

    // Check for low entropy
    if (events && detectLowEntropy(events)) {
        const signal: SignalDetails = {
            type: 'entropy_low',
            severity: 'medium',
            metadata: { eventCount: events.length },
        };
        signals.push(signal);
        await recordAbuseSignal(signal, deviceId, sessionId);
    }

    // Check for rapid geo change
    if (geoData) {
        const geoCheck = await detectRapidGeoChange(deviceId, geoData.lat, geoData.lng, new Date());
        if (geoCheck.detected) {
            const signal: SignalDetails = {
                type: 'rapid_geo_change',
                severity: 'high',
                metadata: { distance: geoCheck.distance, timeDelta: geoCheck.timeDelta },
            };
            signals.push(signal);
            await recordAbuseSignal(signal, deviceId, sessionId);
        }
    }

    // Update the device trust score
    const score = await updateDeviceTrustScore(deviceId, signals);

    return { score, signals };
}
