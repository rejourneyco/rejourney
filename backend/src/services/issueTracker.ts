/**
 * Issue Tracker Service
 * 
 * Handles real-time upsert of issues when errors, crashes, ANRs come in via ingest.
 * This ensures the Issues Feed stays up-to-date without requiring manual sync.
 */

import { eq, and, sql } from 'drizzle-orm';
import { db, issues, issueEvents, projects } from '../db/client.js';
import { logger } from '../logger.js';
import { triggerCrashAlert, triggerAnrAlert } from './alertService.js';

export interface IssueData {
    projectId: string;
    issueType: 'error' | 'crash' | 'anr' | 'rage_tap';
    title: string;
    subtitle?: string;
    culprit?: string;
    screenName?: string;
    componentName?: string;
    isHandled?: boolean;
    fingerprint: string;
    timestamp: Date;
    sessionId?: string;
    userId?: string;
    stackTrace?: string;
    deviceModel?: string;
    osVersion?: string;
    appVersion?: string;
}

/**
 * Generate a fingerprint for grouping similar issues
 * For ANRs, we extract the key stack frame info and normalize addresses
 */
export function generateFingerprint(type: string, name: string, message: string): string {
    let normalized = message || '';

    // For ANR/crash stack traces, extract meaningful parts
    if (type === 'anr' || type === 'crash') {
        // Extract function/method names from stack frames, ignoring addresses
        // Pattern: 0   Framework.dylib   0x00000001234 -[ClassName methodName] + 123
        const frameMatches = normalized.match(/\[\w+\s+\w+\]|\w+::\w+|@objc\s+\w+|_\$[\w.]+/g);
        if (frameMatches && frameMatches.length > 0) {
            // Use the first 3 meaningful frames as fingerprint
            normalized = frameMatches.slice(0, 3).join(':');
        } else {
            // Fallback: just use the type (all ANRs grouped together if no frame info)
            normalized = type;
        }
    } else {
        // For errors, normalize numbers and take first 100 chars
        normalized = normalized.slice(0, 100).toLowerCase().replace(/[0-9]+/g, 'N');
    }

    return `${type}:${name}:${normalized}`;
}

/**
 * Generate fingerprint specifically for ANRs
 * Groups by the actual code location causing the hang, not memory addresses
 */
export function generateANRFingerprint(threadState: string): string {
    if (!threadState) {
        return 'anr:ANR:unknown';
    }

    // Extract meaningful stack frame info (method names, class names)
    // Look for patterns like: -[ClassName methodName], MyClass.myMethod, etc.
    const lines = threadState.split('\n');
    const meaningfulFrames: string[] = [];

    for (const line of lines) {
        // Skip header lines and memory-only lines
        if (line.includes('Thread Stack') || line.includes('PC:') || line.includes('LR:') || line.includes('SP:')) {
            continue;
        }

        // Extract method/function name from stack frame
        // Pattern: frame_num   binary_name   addr   method_name + offset
        const methodMatch = line.match(/\[\w+\s+\w+[:\w]*\]|\w+::\w+[\w:]*|@objc\s+\w+|_\$s[\w.]+/);
        if (methodMatch) {
            meaningfulFrames.push(methodMatch[0]);
        }
    }

    if (meaningfulFrames.length > 0) {
        // Use first 3 meaningful frames
        return `anr:ANR:${meaningfulFrames.slice(0, 3).join(':')}`;
    }

    // Fallback: group all ANRs without extractable frames together
    return 'anr:ANR:main_thread_blocked';
}

/**
 * Calculate priority based on event count and recency
 */
function calculatePriority(eventCount: number, events24h: number): 'low' | 'medium' | 'high' | 'critical' {
    if (eventCount >= 1000 && events24h >= 100) return 'critical';
    if (eventCount >= 100 && events24h >= 10) return 'high';
    if (eventCount >= 10 || events24h >= 1) return 'medium';
    return 'low';
}

/**
 * Get date string in YYYY-MM-DD format
 */
function getDateStr(date: Date): string {
    return date.toISOString().split('T')[0];
}

/**
 * Upsert an issue - create if new, update if exists
 * This is called from ingest when processing errors, crashes, ANRs
 */
export async function trackIssue(data: IssueData): Promise<string | null> {
    try {
        const now = new Date();
        const cutoff24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const dateStr = getDateStr(data.timestamp);

        // Check if issue already exists
        const [existing] = await db
            .select()
            .from(issues)
            .where(and(
                eq(issues.projectId, data.projectId),
                eq(issues.fingerprint, data.fingerprint)
            ))
            .limit(1);

        if (existing) {
            // Update existing issue
            const dailyEvents = (existing.dailyEvents as Record<string, number>) || {};
            dailyEvents[dateStr] = (dailyEvents[dateStr] || 0) + 1;

            // Calculate new 24h count
            let newEvents24h = existing.events24h;
            if (data.timestamp >= cutoff24h) {
                newEvents24h = existing.events24h + 1;
            }

            // Update affected versions
            const affectedVersions = (existing.affectedVersions as Record<string, number>) || {};
            if (data.appVersion) {
                affectedVersions[data.appVersion] = (affectedVersions[data.appVersion] || 0) + 1;
            }

            // Update affected devices
            const affectedDevices = (existing.affectedDevices as Record<string, number>) || {};
            if (data.deviceModel) {
                affectedDevices[data.deviceModel] = (affectedDevices[data.deviceModel] || 0) + 1;
            }

            const newEventCount = Number(existing.eventCount) + 1;
            const priority = calculatePriority(newEventCount, newEvents24h);

            await db
                .update(issues)
                .set({
                    lastSeen: data.timestamp > existing.lastSeen ? data.timestamp : existing.lastSeen,
                    eventCount: sql`${issues.eventCount} + 1`,
                    events24h: newEvents24h,
                    events90d: existing.events90d + 1,
                    dailyEvents,
                    affectedVersions,
                    affectedDevices,
                    priority,
                    status: 'ongoing', // Mark as ongoing since we just saw activity
                    // Update sample if this is more recent
                    ...(data.timestamp > existing.lastSeen ? {
                        sampleSessionId: data.sessionId || existing.sampleSessionId,
                        sampleStackTrace: data.stackTrace || existing.sampleStackTrace,
                        sampleDeviceModel: data.deviceModel || existing.sampleDeviceModel,
                        sampleOsVersion: data.osVersion || existing.sampleOsVersion,
                        sampleAppVersion: data.appVersion || existing.sampleAppVersion,
                    } : {}),
                    updatedAt: now,
                })
                .where(eq(issues.id, existing.id));

            // Create issue_event record for this occurrence
            await db.insert(issueEvents).values({
                issueId: existing.id,
                sessionId: data.sessionId || null,
                timestamp: data.timestamp,
                screenName: data.screenName,
                userId: data.userId,
                deviceModel: data.deviceModel,
                osVersion: data.osVersion,
                appVersion: data.appVersion,
                errorMessage: data.subtitle,
                stackTrace: data.stackTrace,
            });

            return existing.id;
        } else {
            // Create new issue
            // Get project name for short ID
            const [project] = await db
                .select({ name: projects.name })
                .from(projects)
                .where(eq(projects.id, data.projectId))
                .limit(1);

            const projectName = (project?.name || 'PROJECT').toUpperCase().replace(/[^A-Z0-9]/g, '-').slice(0, 20);

            // Get next short ID
            const nextIdResult = await db
                .select({ count: sql<number>`count(*)` })
                .from(issues)
                .where(eq(issues.projectId, data.projectId));
            const nextNum = (Number(nextIdResult[0]?.count) || 0) + 1;
            const shortId = `${projectName}-${nextNum}`;

            const dailyEvents: Record<string, number> = { [dateStr]: 1 };
            const affectedVersions: Record<string, number> = data.appVersion ? { [data.appVersion]: 1 } : {};
            const affectedDevices: Record<string, number> = data.deviceModel ? { [data.deviceModel]: 1 } : {};

            const isRecent = data.timestamp >= cutoff24h;

            const newIssue = await db.insert(issues).values({
                projectId: data.projectId,
                shortId,
                fingerprint: data.fingerprint,
                issueType: data.issueType,
                title: data.title,
                subtitle: data.subtitle,
                culprit: data.culprit,
                screenName: data.screenName,
                componentName: data.componentName,
                isHandled: data.isHandled ?? true,
                priority: 'medium',
                status: 'ongoing',
                firstSeen: data.timestamp,
                lastSeen: data.timestamp,
                eventCount: BigInt(1),
                userCount: 1,
                events24h: isRecent ? 1 : 0,
                events90d: 1,
                dailyEvents,
                affectedVersions,
                affectedDevices,
                sampleSessionId: data.sessionId,
                sampleStackTrace: data.stackTrace,
                sampleDeviceModel: data.deviceModel,
                sampleOsVersion: data.osVersion,
                sampleAppVersion: data.appVersion,
            }).returning({ id: issues.id });

            // Create issue_event record for this first occurrence
            if (newIssue && newIssue[0]) {
                await db.insert(issueEvents).values({
                    issueId: newIssue[0].id,
                    sessionId: data.sessionId || null,
                    timestamp: data.timestamp,
                    screenName: data.screenName,
                    userId: data.userId,
                    deviceModel: data.deviceModel,
                    osVersion: data.osVersion,
                    appVersion: data.appVersion,
                    errorMessage: data.subtitle,
                    stackTrace: data.stackTrace,
                });
                return newIssue[0].id;
            }
            return null;
        }
    } catch (error) {
        // Log but don't throw - issue tracking shouldn't break ingest
        logger.error({ error, fingerprint: data.fingerprint }, 'Failed to track issue');
        return null;
    }
}

/**
 * Track an error event as an issue
 */
export async function trackErrorAsIssue(params: {
    projectId: string;
    errorName: string;
    message: string;
    errorType: string;
    stack?: string;
    screenName?: string;
    componentName?: string;
    timestamp: Date;
    sessionId?: string;
    deviceModel?: string;
    osVersion?: string;
    appVersion?: string;
    fingerprint?: string;
}): Promise<void> {
    const fingerprint = params.fingerprint || generateFingerprint('error', params.errorName, params.message);

    await trackIssue({
        projectId: params.projectId,
        issueType: 'error',
        title: params.errorName,
        subtitle: params.message?.slice(0, 200),
        culprit: params.componentName || params.screenName,
        screenName: params.screenName,
        componentName: params.componentName,
        isHandled: params.errorType !== 'unhandled_exception',
        fingerprint,
        timestamp: params.timestamp,
        sessionId: params.sessionId,
        stackTrace: params.stack,
        deviceModel: params.deviceModel,
        osVersion: params.osVersion,
        appVersion: params.appVersion,
    });
}

/**
 * Track a crash event as an issue
 */
export async function trackCrashAsIssue(params: {
    projectId: string;
    exceptionName: string;
    reason?: string;
    stackTrace?: string;
    timestamp: Date;
    sessionId?: string;
    deviceModel?: string;
    osVersion?: string;
    appVersion?: string;
}): Promise<void> {
    const fingerprint = generateFingerprint('crash', params.exceptionName, params.reason || '');

    const issueId = await trackIssue({
        projectId: params.projectId,
        issueType: 'crash',
        title: params.exceptionName,
        subtitle: params.reason?.slice(0, 200),
        isHandled: false,
        fingerprint,
        timestamp: params.timestamp,
        sessionId: params.sessionId,
        stackTrace: params.stackTrace,
        deviceModel: params.deviceModel,
        osVersion: params.osVersion,
        appVersion: params.appVersion,
    });

    // Trigger crash alert (rate limited by alertService)
    if (issueId) {
        try {
            await triggerCrashAlert(
                params.projectId,
                params.exceptionName,
                1, // affectedUsers - single occurrence
                fingerprint,
                issueId
            );
        } catch (error) {
            logger.error({ error, projectId: params.projectId }, 'Failed to trigger crash alert');
        }
    }
}

/**
 * Track an ANR event as an issue
 */
export async function trackANRAsIssue(params: {
    projectId: string;
    durationMs: number;
    threadState?: string;
    timestamp: Date;
    sessionId?: string;
    deviceModel?: string;
    osVersion?: string;
    appVersion?: string;
}): Promise<void> {
    // Use the specialized ANR fingerprint that ignores memory addresses
    const fingerprint = generateANRFingerprint(params.threadState || '');

    const issueId = await trackIssue({
        projectId: params.projectId,
        issueType: 'anr',
        title: 'Application Not Responding',
        subtitle: `Blocked for ${params.durationMs}ms`,
        isHandled: false,
        fingerprint,
        timestamp: params.timestamp,
        sessionId: params.sessionId,
        stackTrace: params.threadState,
        deviceModel: params.deviceModel,
        osVersion: params.osVersion,
        appVersion: params.appVersion,
    });

    // Trigger ANR alert (rate limited by alertService)
    if (issueId) {
        try {
            await triggerAnrAlert(
                params.projectId,
                params.durationMs,
                1, // affectedUsers - single occurrence
                fingerprint,
                issueId
            );
        } catch (error) {
            logger.error({ error, projectId: params.projectId }, 'Failed to trigger ANR alert');
        }
    }
}

/**
 * Track a rage tap as an issue
 */
export async function trackRageTapAsIssue(params: {
    projectId: string;
    screenName?: string;
    tapCount: number;
    timestamp: Date;
    sessionId?: string;
    deviceModel?: string;
    osVersion?: string;
    appVersion?: string;
}): Promise<void> {
    const fingerprint = generateFingerprint('rage_tap', 'rage_tap', params.screenName || 'unknown');

    await trackIssue({
        projectId: params.projectId,
        issueType: 'rage_tap',
        title: 'Rage Tap Detected',
        subtitle: `${params.tapCount} rapid taps on ${params.screenName || 'unknown screen'}`,
        screenName: params.screenName,
        isHandled: true,
        fingerprint,
        timestamp: params.timestamp,
        sessionId: params.sessionId,
        deviceModel: params.deviceModel,
        osVersion: params.osVersion,
        appVersion: params.appVersion,
    });
}
