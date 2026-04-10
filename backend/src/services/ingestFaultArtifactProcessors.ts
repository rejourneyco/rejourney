import { eq, sql } from 'drizzle-orm';
import { db, sessions, sessionMetrics, anrs, crashes, appDailyStats } from '../db/client.js';
import { trackANRAsIssue, trackCrashAsIssue } from './issueTracker.js';
import { mergeAnrDeviceMetadata, resolveAnrStackTrace } from './anrStack.js';

export async function processCrashesArtifact(job: any, _session: any, projectId: string, _s3ObjectKey: string, data: Buffer, log: any) {
    const payload = JSON.parse(data.toString());
    const crashList = payload.crashes || (Array.isArray(payload) ? payload : [payload]);

    let crashSessionId = job.sessionId;
    if (payload.sessionId && payload.sessionId.length > 0) {
        crashSessionId = payload.sessionId;
        const [crashSession] = await db.select().from(sessions).where(eq(sessions.id, crashSessionId)).limit(1);
        if (!crashSession) {
            await db.insert(sessions).values({
                id: crashSessionId,
                projectId,
                status: 'processing',
                platform: 'ios',
            });
            await db.insert(sessionMetrics).values({ sessionId: crashSessionId });
        }
    }

    for (const crash of crashList) {
        // Extract device info from crash metadata
        const deviceMeta = crash.deviceMetadata || {};
        const deviceModel = deviceMeta.model || deviceMeta.deviceModel;
        const osVersion = deviceMeta.systemVersion || deviceMeta.osVersion;
        const appVersion = deviceMeta.appVersion;

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

        await db.insert(crashes).values({
            sessionId: crashSessionId,
            projectId,
            timestamp: new Date(crash.timestamp || Date.now()),
            exceptionName: crash.exceptionName || 'Unknown Exception',
            reason: crash.reason,
            stackTrace: stackTraceStr,
            fingerprint: crash.fingerprint || null,
            deviceMetadata: crash.deviceMetadata,
            status: 'open',
            occurrenceCount: 1
        });

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
        }).catch(() => { }); // Fire and forget
    }

    // Update crash count in session metrics
    await db.update(sessionMetrics)
        .set({ crashCount: sql`${sessionMetrics.crashCount} + ${crashList.length} ` })
        .where(eq(sessionMetrics.sessionId, crashSessionId));


    // Update daily stats
    const period = new Date().toISOString().split('T')[0];
    await db.insert(appDailyStats).values({
        projectId,
        date: period as any,
        totalCrashes: crashList.length
    }).onConflictDoUpdate({
        target: [appDailyStats.projectId, appDailyStats.date],
        set: { totalCrashes: sql`${appDailyStats.totalCrashes} + ${crashList.length} ` }
    });

    log.debug({ crashCount: crashList.length }, 'Crashes artifact processed');
}

/**
 * Process ANRs artifact - insert ANR records
 */
export async function processAnrsArtifact(job: any, _session: any, projectId: string, _s3ObjectKey: string, data: Buffer, log: any) {
    const payload = JSON.parse(data.toString());
    const anrList = payload.anrs || (Array.isArray(payload) ? payload : [payload]);

    let anrSessionId = job.sessionId;
    if (payload.sessionId && payload.sessionId.length > 0) {
        anrSessionId = payload.sessionId;
        const [anrSession] = await db.select().from(sessions).where(eq(sessions.id, anrSessionId)).limit(1);
        if (!anrSession) {
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
        }
    }

    for (const anr of anrList) {
        // Extract device info from ANR metadata
        const deviceMeta = anr.deviceMetadata || {};
        const deviceModel = deviceMeta.model || deviceMeta.deviceModel;
        const osVersion = deviceMeta.systemVersion || deviceMeta.osVersion;
        const appVersion = deviceMeta.appVersion;
        const stackTrace = resolveAnrStackTrace({
            threadState: anr.threadState,
            stack: anr.stackTrace,
            frames: anr.frames,
            deviceMetadata: anr.deviceMetadata,
        });

        await db.insert(anrs).values({
            sessionId: anrSessionId,
            projectId,
            timestamp: new Date(anr.timestamp || Date.now()),
            durationMs: anr.durationMs || 5000,
            threadState: stackTrace,
            deviceMetadata: mergeAnrDeviceMetadata(anr.deviceMetadata, stackTrace, anr.threadState),
            status: 'open',
            occurrenceCount: 1
        });

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
        }).catch(() => { }); // Fire and forget
    }

    // Ensure session_metrics row exists (upsert pattern)
    await db.insert(sessionMetrics).values({
        sessionId: anrSessionId,
    }).onConflictDoNothing();

    // Update ANR count in session metrics
    const updateResult = await db.update(sessionMetrics)
        .set({ anrCount: sql`COALESCE(${sessionMetrics.anrCount}, 0) + ${anrList.length} ` })
        .where(eq(sessionMetrics.sessionId, anrSessionId));

    log.info({ anrSessionId, anrCount: anrList.length, updateResult }, 'Updated session_metrics anrCount');


    // Update daily stats
    const period = new Date().toISOString().split('T')[0];
    await db.insert(appDailyStats).values({
        projectId,
        date: period as any,
        totalAnrs: anrList.length
    }).onConflictDoUpdate({
        target: [appDailyStats.projectId, appDailyStats.date],
        set: { totalAnrs: sql`COALESCE(${appDailyStats.totalAnrs}, 0) + ${anrList.length} ` }
    });

    log.info({ anrCount: anrList.length, anrSessionId, projectId }, 'ANRs artifact processed');
}
