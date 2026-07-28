import { eq, sql } from 'drizzle-orm';
import { db, sessions, sessionMetrics } from '../db/client.js';
import { trackANRAsIssue, trackCrashAsIssue } from './issueTracker.js';
import { mergeAnrDeviceMetadata, resolveAnrStackTrace } from './anrStack.js';
import { persistAnrOccurrence, persistCrashOccurrence } from './stabilityIngest.js';

export async function processCrashesArtifact(job: any, session: any, projectId: string, _s3ObjectKey: string, data: Buffer, log: any) {
    const payload = JSON.parse(data.toString());
    const crashList = payload.crashes || (Array.isArray(payload) ? payload : [payload]);

    let crashSessionId = job.sessionId;
    let crashSession = session;
    if (payload.sessionId && payload.sessionId.length > 0) {
        crashSessionId = payload.sessionId;
        const [existingCrashSession] = await db.select().from(sessions).where(eq(sessions.id, crashSessionId)).limit(1);
        crashSession = existingCrashSession;
        if (!existingCrashSession) {
            await db.insert(sessions).values({
                id: crashSessionId,
                projectId,
                status: 'processing',
                platform: 'ios',
            });
            await db.insert(sessionMetrics).values({ sessionId: crashSessionId });
            crashSession = {
                id: crashSessionId,
                projectId,
                platform: 'ios',
            };
        }
    }

    let insertedCrashCount = 0;
    for (const crash of crashList) {
        // Extract device info from crash metadata
        const deviceMeta = crash.deviceMetadata || {};
        const enrichedDeviceMeta = {
            platform: crashSession?.platform,
            model: crashSession?.deviceModel,
            deviceModel: crashSession?.deviceModel,
            systemVersion: crashSession?.osVersion,
            osVersion: crashSession?.osVersion,
            appVersion: crashSession?.appVersion,
            sdkVersion: crashSession?.sdkVersion,
            ...deviceMeta,
        };
        const deviceModel = enrichedDeviceMeta.model || enrichedDeviceMeta.deviceModel;
        const osVersion = enrichedDeviceMeta.systemVersion || enrichedDeviceMeta.osVersion;
        const appVersion = enrichedDeviceMeta.appVersion;

        // Format stack trace as string for display
        // iOS sends as array of frame strings, Android sends as single string
        let stackTraceStr: string | null = null;
        if (crash.stackTrace) {
            if (Array.isArray(crash.stackTrace)) {
                stackTraceStr = crash.stackTrace.join('\n');
            } else if (typeof crash.stackTrace === 'string') {
                stackTraceStr = crash.stackTrace;
            }
        }

        const persisted = await persistCrashOccurrence({
            sessionId: crashSessionId,
            projectId,
            incidentId: crash.incidentId,
            timestamp: new Date(crash.timestamp || Date.now()),
            exceptionName: crash.exceptionName || 'Unknown Exception',
            reason: crash.reason,
            stackTrace: stackTraceStr,
            fingerprint: crash.fingerprint || null,
            deviceMetadata: enrichedDeviceMeta,
            status: 'open',
            occurrenceCount: 1,
        });
        if (!persisted.inserted) continue;
        insertedCrashCount += 1;

        // Track as an issue for the Issues Feed
        trackCrashAsIssue({
            projectId,
            exceptionName: crash.exceptionName || 'Unknown Exception',
            reason: crash.reason,
            stackTrace: stackTraceStr || undefined,
            timestamp: new Date(crash.timestamp || Date.now()),
            sessionId: crashSessionId,
            deviceModel,
            osVersion,
            appVersion,
            userId: crashSession?.userDisplayId || crashSession?.anonymousHash || crashSession?.deviceId,
        }).catch(() => { }); // Fire and forget
    }

    // Update crash count in session metrics
    await db.update(sessionMetrics)
        .set({ crashCount: sql`COALESCE(${sessionMetrics.crashCount}, 0) + ${insertedCrashCount}` })
        .where(eq(sessionMetrics.sessionId, crashSessionId));


    log.debug({ crashCount: insertedCrashCount, receivedCrashCount: crashList.length }, 'Crashes artifact processed');
}

/**
 * Process ANRs artifact - insert ANR records
 */
export async function processAnrsArtifact(job: any, session: any, projectId: string, _s3ObjectKey: string, data: Buffer, log: any) {
    const payload = JSON.parse(data.toString());
    const anrList = payload.anrs || (Array.isArray(payload) ? payload : [payload]);

    let anrSessionId = job.sessionId;
    let anrSession = session;
    if (payload.sessionId && payload.sessionId.length > 0) {
        anrSessionId = payload.sessionId;
        const [existingAnrSession] = await db.select().from(sessions).where(eq(sessions.id, anrSessionId)).limit(1);
        anrSession = existingAnrSession;
        if (!existingAnrSession) {
            const inferredPlatform =
                (anrList?.[0]?.platform as string | undefined) ||
                (payload.platform as string | undefined) ||
                'unknown';
            await db.insert(sessions).values({
                id: anrSessionId,
                projectId,
                status: 'processing',
                platform: inferredPlatform,
            });
            await db.insert(sessionMetrics).values({ sessionId: anrSessionId });
            anrSession = {
                id: anrSessionId,
                projectId,
                platform: inferredPlatform,
            };
        }
    }

    let insertedAnrCount = 0;
    for (const anr of anrList) {
        // Extract device info from ANR metadata
        const deviceMeta = anr.deviceMetadata || {};
        const enrichedDeviceMeta = {
            platform: anrSession?.platform,
            model: anrSession?.deviceModel,
            deviceModel: anrSession?.deviceModel,
            systemVersion: anrSession?.osVersion,
            osVersion: anrSession?.osVersion,
            appVersion: anrSession?.appVersion,
            sdkVersion: anrSession?.sdkVersion,
            ...deviceMeta,
        };
        const deviceModel = enrichedDeviceMeta.model || enrichedDeviceMeta.deviceModel;
        const osVersion = enrichedDeviceMeta.systemVersion || enrichedDeviceMeta.osVersion;
        const appVersion = enrichedDeviceMeta.appVersion;
        const stackTrace = resolveAnrStackTrace({
            threadState: anr.threadState,
            stack: anr.stackTrace,
            frames: anr.frames,
            deviceMetadata: anr.deviceMetadata,
        });

        const mergedDeviceMetadata = mergeAnrDeviceMetadata(enrichedDeviceMeta, stackTrace, anr.threadState);
        const persisted = await persistAnrOccurrence({
            sessionId: anrSessionId,
            projectId,
            incidentId: anr.incidentId,
            timestamp: new Date(anr.timestamp || Date.now()),
            durationMs: anr.durationMs || 5000,
            threadState: stackTrace,
            deviceMetadata: mergedDeviceMetadata,
            status: 'open',
            occurrenceCount: 1,
        });
        if (!persisted.inserted) continue;
        insertedAnrCount += 1;

        // Track as an issue for the Issues Feed
        trackANRAsIssue({
            projectId,
            durationMs: anr.durationMs || 5000,
            stackTrace: stackTrace || undefined,
            timestamp: new Date(anr.timestamp || Date.now()),
            sessionId: anrSessionId,
            deviceModel,
            osVersion,
            appVersion,
            userId: anrSession?.userDisplayId || anrSession?.anonymousHash || anrSession?.deviceId,
        }).catch(() => { }); // Fire and forget
    }

    // Ensure session_metrics row exists (upsert pattern)
    await db.insert(sessionMetrics).values({
        sessionId: anrSessionId,
    }).onConflictDoNothing();

    // Update ANR count in session metrics
    const updateResult = await db.update(sessionMetrics)
        .set({ anrCount: sql`COALESCE(${sessionMetrics.anrCount}, 0) + ${insertedAnrCount}` })
        .where(eq(sessionMetrics.sessionId, anrSessionId));

    log.info({ anrSessionId, anrCount: insertedAnrCount, receivedAnrCount: anrList.length, updateResult }, 'Updated session_metrics anrCount');


    log.info({ anrCount: insertedAnrCount, receivedAnrCount: anrList.length, anrSessionId, projectId }, 'ANRs artifact processed');
}
