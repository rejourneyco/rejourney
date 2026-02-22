/**
 * Alert Service
 * 
 * Handles sending alert emails with rate limiting and deduplication.
 * This service is called by event handlers (crash ingest, error detection, etc.)
 */

import { eq, and, gte, sql, desc } from 'drizzle-orm';
import { db, alertSettings, alertRecipients, alertHistory, emailLogs, projects, users, issues, apiEndpointDailyStats } from '../db/client.js';
import { logger } from '../logger.js';
import { config } from '../config.js';
import {
    sendCrashAlertEmail,
    sendAnrAlertEmail,
    sendErrorSpikeAlertEmail,
    sendApiDegradationAlertEmail,
} from './email.js';

// Rate limiting constants
const SAME_ISSUE_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour
const SAME_TYPE_COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes  
const DAILY_ALERT_CAP = 20;

// Alert types
type AlertType = 'crash' | 'anr' | 'error_spike' | 'api_degradation';

/**
 * Check if an alert should be sent based on rate limits
 */
async function shouldSendAlert(
    projectId: string,
    alertType: AlertType,
    fingerprint?: string
): Promise<{ canSend: boolean; reason?: string }> {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const sameIssueThreshold = new Date(now.getTime() - SAME_ISSUE_COOLDOWN_MS);
    const sameTypeThreshold = new Date(now.getTime() - SAME_TYPE_COOLDOWN_MS);

    // Check daily cap
    const [dailyCount] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(alertHistory)
        .where(and(
            eq(alertHistory.projectId, projectId),
            gte(alertHistory.sentAt, oneDayAgo)
        ));

    if ((dailyCount?.count ?? 0) >= DAILY_ALERT_CAP) {
        return { canSend: false, reason: 'Daily alert cap reached' };
    }

    // Check same issue cooldown (if fingerprint provided)
    if (fingerprint) {
        const [recentSameIssue] = await db
            .select()
            .from(alertHistory)
            .where(and(
                eq(alertHistory.projectId, projectId),
                eq(alertHistory.fingerprint, fingerprint),
                gte(alertHistory.sentAt, sameIssueThreshold)
            ))
            .limit(1);

        if (recentSameIssue) {
            return { canSend: false, reason: 'Same issue alerted recently' };
        }
    }

    // Check same type cooldown
    const [recentSameType] = await db
        .select()
        .from(alertHistory)
        .where(and(
            eq(alertHistory.projectId, projectId),
            eq(alertHistory.alertType, alertType),
            gte(alertHistory.sentAt, sameTypeThreshold)
        ))
        .limit(1);

    if (recentSameType) {
        return { canSend: false, reason: 'Same alert type sent recently' };
    }

    return { canSend: true };
}

/**
 * Record that an alert was sent
 */
async function recordAlertSent(
    projectId: string,
    alertType: AlertType,
    recipientCount: number,
    fingerprint?: string
): Promise<void> {
    await db.insert(alertHistory).values({
        projectId,
        alertType,
        fingerprint,
        recipientCount,
    });
}

/**
 * Get alert recipients with name and email for logging
 */
async function getRecipientDetails(projectId: string): Promise<{ email: string; name: string | null }[]> {
    const recipients = await db
        .select({ 
            email: users.email,
            name: users.displayName,
        })
        .from(alertRecipients)
        .innerJoin(users, eq(alertRecipients.userId, users.id))
        .where(eq(alertRecipients.projectId, projectId));

    return recipients;
}

/**
 * Log individual email sends to email_logs table
 */
async function logEmailSends(
    projectId: string,
    recipients: { email: string; name: string | null }[],
    alertType: string,
    subject: string,
    issueTitle?: string,
    issueId?: string,
    status: 'sent' | 'failed' = 'sent',
    errorMessage?: string
): Promise<void> {
    if (recipients.length === 0) return;

    try {
        await db.insert(emailLogs).values(
            recipients.map(r => ({
                projectId,
                recipientEmail: r.email,
                recipientName: r.name,
                alertType,
                subject,
                issueTitle,
                issueId,
                status,
                errorMessage,
            }))
        );
    } catch (err) {
        logger.error({ err, projectId, alertType }, 'Failed to log email sends');
    }
}

/**
 * Get project name for email display
 */
async function getProjectName(projectId: string): Promise<string> {
    const [project] = await db
        .select({ name: projects.name })
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1);

    return project?.name || 'Unknown Project';
}

/**
 * Get alert settings for a project
 */
async function getProjectAlertSettings(projectId: string) {
    const [settings] = await db
        .select()
        .from(alertSettings)
        .where(eq(alertSettings.projectId, projectId))
        .limit(1);

    return settings;
}

// =============================================================================
// Public Alert Functions
// =============================================================================

/**
 * Send crash alert if enabled and not rate limited
 */
export async function triggerCrashAlert(
    projectId: string,
    crashTitle: string,
    affectedUsers: number,
    fingerprint: string,
    issueId?: string
): Promise<void> {
    try {
        const settings = await getProjectAlertSettings(projectId);
        if (!settings?.crashAlertsEnabled) {
            logger.debug({ projectId }, 'Crash alerts disabled');
            return;
        }

        const rateCheck = await shouldSendAlert(projectId, 'crash', fingerprint);
        if (!rateCheck.canSend) {
            logger.debug({ projectId, reason: rateCheck.reason }, 'Crash alert rate limited');
            return;
        }

        const recipientDetails = await getRecipientDetails(projectId);
        if (recipientDetails.length === 0) {
            logger.debug({ projectId }, 'No crash alert recipients');
            return;
        }
        const recipients = recipientDetails.map(r => r.email);

        // Fetch detailed issue data if issueId provided
        let stackTrace: string | undefined;
        let affectedVersions: Record<string, number> | undefined;
        let affectedDevices: Record<string, number> | undefined;
        let shortId: string | undefined;
        let subtitle: string | undefined;
        let screenName: string | undefined;
        let componentName: string | undefined;
        let environment: string | undefined;
        let firstSeen: Date | undefined;
        let lastSeen: Date | undefined;
        let isHandled: boolean | undefined;
        let eventCount: number | undefined;
        let sampleAppVersion: string | undefined;
        let sampleOsVersion: string | undefined;
        let sampleDeviceModel: string | undefined;

        if (issueId) {
            const [issue] = await db
                .select()
                .from(issues)
                .where(eq(issues.id, issueId))
                .limit(1);

            if (issue) {
                stackTrace = issue.sampleStackTrace || undefined;
                affectedVersions = (issue.affectedVersions as Record<string, number>) || undefined;
                affectedDevices = (issue.affectedDevices as Record<string, number>) || undefined;
                shortId = issue.shortId || undefined;
                subtitle = issue.subtitle || undefined;
                screenName = issue.screenName || undefined;
                componentName = issue.componentName || undefined;
                environment = issue.environment || undefined;
                firstSeen = issue.firstSeen || undefined;
                lastSeen = issue.lastSeen || undefined;
                isHandled = issue.isHandled === null ? undefined : issue.isHandled;
                eventCount = issue.eventCount ? Number(issue.eventCount) : undefined;
                sampleAppVersion = issue.sampleAppVersion || undefined;
                sampleOsVersion = issue.sampleOsVersion || undefined;
                sampleDeviceModel = issue.sampleDeviceModel || undefined;
            }
        }

        const projectName = await getProjectName(projectId);
        const baseUrl = config.PUBLIC_DASHBOARD_URL || 'http://localhost:8080';
        const issueUrl = `${baseUrl}/dashboard/general/${issueId || ''}`;

        await sendCrashAlertEmail(recipients, {
            projectId,
            projectName,
            crashTitle,
            subtitle,
            shortId,
            issueId,
            affectedUsers,
            eventCount,
            issueUrl,
            stackTrace,
            affectedVersions,
            affectedDevices,
            screenName,
            componentName,
            environment,
            firstSeen,
            lastSeen,
            isHandled,
            sampleAppVersion,
            sampleOsVersion,
            sampleDeviceModel,
        });

        await recordAlertSent(projectId, 'crash', recipients.length, fingerprint);

        // Log individual emails for audit trail
        const subject = `🔴 Crash Alert: ${crashTitle}`;
        await logEmailSends(projectId, recipientDetails, 'crash', subject, crashTitle, issueId);

        logger.info({ projectId, recipients: recipients.length, crashTitle }, 'Crash alert sent');
    } catch (error) {
        logger.error({ projectId, error }, 'Failed to send crash alert');
    }
}

/**
 * Send ANR alert if enabled and not rate limited
 */
export async function triggerAnrAlert(
    projectId: string,
    durationMs: number,
    affectedUsers: number,
    fingerprint: string,
    issueId?: string
): Promise<void> {
    try {
        const settings = await getProjectAlertSettings(projectId);
        if (!settings?.anrAlertsEnabled) {
            logger.debug({ projectId }, 'ANR alerts disabled');
            return;
        }

        const rateCheck = await shouldSendAlert(projectId, 'anr', fingerprint);
        if (!rateCheck.canSend) {
            logger.debug({ projectId, reason: rateCheck.reason }, 'ANR alert rate limited');
            return;
        }

        const recipientDetails = await getRecipientDetails(projectId);
        if (recipientDetails.length === 0) {
            logger.debug({ projectId }, 'No ANR alert recipients');
            return;
        }
        const recipients = recipientDetails.map(r => r.email);

        let stackTrace: string | undefined;
        let affectedVersions: Record<string, number> | undefined;
        let affectedDevices: Record<string, number> | undefined;
        let shortId: string | undefined;
        let screenName: string | undefined;
        let environment: string | undefined;
        let firstSeen: Date | undefined;
        let lastSeen: Date | undefined;
        let eventCount: number | undefined;
        let sampleAppVersion: string | undefined;
        let sampleOsVersion: string | undefined;
        let sampleDeviceModel: string | undefined;

        if (issueId) {
            const [issue] = await db
                .select()
                .from(issues)
                .where(eq(issues.id, issueId))
                .limit(1);

            if (issue) {
                stackTrace = issue.sampleStackTrace || undefined;
                affectedVersions = (issue.affectedVersions as Record<string, number>) || undefined;
                affectedDevices = (issue.affectedDevices as Record<string, number>) || undefined;
                shortId = issue.shortId || undefined;
                screenName = issue.screenName || undefined;
                environment = issue.environment || undefined;
                firstSeen = issue.firstSeen || undefined;
                lastSeen = issue.lastSeen || undefined;
                eventCount = issue.eventCount ? Number(issue.eventCount) : undefined;
                sampleAppVersion = issue.sampleAppVersion || undefined;
                sampleOsVersion = issue.sampleOsVersion || undefined;
                sampleDeviceModel = issue.sampleDeviceModel || undefined;
            }
        }

        const projectName = await getProjectName(projectId);
        const baseUrl = config.PUBLIC_DASHBOARD_URL || 'http://localhost:8080';
        const issueUrl = `${baseUrl}/dashboard/general/${issueId || ''}`;

        await sendAnrAlertEmail(recipients, {
            projectId,
            projectName,
            durationMs,
            affectedUsers,
            eventCount,
            shortId,
            issueId,
            issueUrl,
            stackTrace,
            affectedVersions,
            affectedDevices,
            screenName,
            environment,
            firstSeen,
            lastSeen,
            sampleAppVersion,
            sampleOsVersion,
            sampleDeviceModel,
        });

        await recordAlertSent(projectId, 'anr', recipients.length, fingerprint);

        // Log individual emails for audit trail
        const anrTitle = `ANR (${(durationMs / 1000).toFixed(1)}s freeze)`;
        const subject = `🟠 ANR Alert: ${anrTitle}`;
        await logEmailSends(projectId, recipientDetails, 'anr', subject, anrTitle, issueId);

        logger.info({ projectId, recipients: recipients.length, durationMs }, 'ANR alert sent');
    } catch (error) {
        logger.error({ projectId, error }, 'Failed to send ANR alert');
    }
}

/**
 * Send error spike alert if enabled and not rate limited
 */
export async function triggerErrorSpikeAlert(
    projectId: string,
    currentRate: number,
    previousRate: number
): Promise<void> {
    try {
        const settings = await getProjectAlertSettings(projectId);
        if (!settings?.errorSpikeAlertsEnabled) {
            logger.debug({ projectId }, 'Error spike alerts disabled');
            return;
        }

        const percentIncrease = previousRate > 0
            ? ((currentRate - previousRate) / previousRate) * 100
            : 100;

        // Check if increase exceeds threshold
        if (percentIncrease < (settings.errorSpikeThresholdPercent ?? 50)) {
            logger.debug({ projectId, percentIncrease }, 'Error spike below threshold');
            return;
        }

        const rateCheck = await shouldSendAlert(projectId, 'error_spike');
        if (!rateCheck.canSend) {
            logger.debug({ projectId, reason: rateCheck.reason }, 'Error spike alert rate limited');
            return;
        }

        const recipientDetails = await getRecipientDetails(projectId);
        if (recipientDetails.length === 0) {
            logger.debug({ projectId }, 'No error spike alert recipients');
            return;
        }
        const recipients = recipientDetails.map(r => r.email);

        // Fetch top contributing errors in the last 24h
        const topErrors = await db
            .select({
                name: issues.title,
                count: sql<number>`${issues.events24h}`
            })
            .from(issues)
            .where(eq(issues.projectId, projectId))
            .orderBy(desc(issues.events24h))
            .limit(5);

        const projectName = await getProjectName(projectId);
        const baseUrl = config.PUBLIC_DASHBOARD_URL || 'http://localhost:8080';
        const issueUrl = `${baseUrl}/dashboard/general`;

        await sendErrorSpikeAlertEmail(recipients, {
            projectId,
            projectName,
            currentRate,
            previousRate,
            percentIncrease,
            issueUrl,
            topErrors: topErrors.map(e => ({ 
                name: e.name, 
                count: e.count,
            })),
            detectedAt: new Date(),
        });

        await recordAlertSent(projectId, 'error_spike', recipients.length);

        // Log individual emails for audit trail
        const spikeTitle = `Error rate increased ${percentIncrease.toFixed(0)}%`;
        const subject = `⚠️ Error Spike Alert: ${spikeTitle}`;
        await logEmailSends(projectId, recipientDetails, 'error_spike', subject, spikeTitle);

        logger.info({ projectId, recipients: recipients.length, percentIncrease }, 'Error spike alert sent');
    } catch (error) {
        logger.error({ projectId, error }, 'Failed to send error spike alert');
    }
}

/**
 * Send API degradation alert if enabled and not rate limited
 */
export async function triggerApiDegradationAlert(
    projectId: string,
    currentLatencyMs: number,
    previousLatencyMs: number
): Promise<void> {
    try {
        const settings = await getProjectAlertSettings(projectId);
        if (!settings?.apiDegradationAlertsEnabled) {
            logger.debug({ projectId }, 'API degradation alerts disabled');
            return;
        }

        const percentIncrease = previousLatencyMs > 0
            ? ((currentLatencyMs - previousLatencyMs) / previousLatencyMs) * 100
            : 100;

        // Check if increase exceeds threshold (default 100% = 2x slower)
        if (percentIncrease < (settings.apiDegradationThresholdPercent ?? 100)) {
            logger.debug({ projectId, percentIncrease }, 'API degradation below threshold');
            return;
        }

        const rateCheck = await shouldSendAlert(projectId, 'api_degradation');
        if (!rateCheck.canSend) {
            logger.debug({ projectId, reason: rateCheck.reason }, 'API degradation alert rate limited');
            return;
        }

        const recipientDetails = await getRecipientDetails(projectId);
        if (recipientDetails.length === 0) {
            logger.debug({ projectId }, 'No API degradation alert recipients');
            return;
        }
        const recipients = recipientDetails.map(r => r.email);

        // Fetch slowest endpoints for today
        const today = new Date().toISOString().split('T')[0];
        const slowestEndpoints = await db
            .select({
                endpoint: apiEndpointDailyStats.endpoint,
                latency: apiEndpointDailyStats.p50LatencyMs
            })
            .from(apiEndpointDailyStats)
            .where(and(
                eq(apiEndpointDailyStats.projectId, projectId),
                eq(apiEndpointDailyStats.date, today)
            ))
            .orderBy(desc(apiEndpointDailyStats.p50LatencyMs))
            .limit(5);

        const projectName = await getProjectName(projectId);
        const baseUrl = config.PUBLIC_DASHBOARD_URL || 'http://localhost:8080';
        const issueUrl = `${baseUrl}/projects/${projectId}/analytics`;

        await sendApiDegradationAlertEmail(recipients, {
            projectId,
            projectName,
            currentLatencyMs,
            previousLatencyMs,
            percentIncrease,
            issueUrl,
            slowestEndpoints: slowestEndpoints.map(e => ({
                method: 'API',
                path: e.endpoint,
                latency: e.latency || 0,
            })),
            detectedAt: new Date(),
        });

        await recordAlertSent(projectId, 'api_degradation', recipients.length);

        // Log individual emails for audit trail
        const apiTitle = `API latency increased ${percentIncrease.toFixed(0)}%`;
        const subject = `📉 API Degradation Alert: ${apiTitle}`;
        await logEmailSends(projectId, recipientDetails, 'api_degradation', subject, apiTitle);

        logger.info({ projectId, recipients: recipients.length, percentIncrease }, 'API degradation alert sent');
    } catch (error) {
        logger.error({ projectId, error }, 'Failed to send API degradation alert');
    }
}
