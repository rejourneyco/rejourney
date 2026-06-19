/**
 * Alert Service
 * 
 * Handles sending alert emails with rate limiting and deduplication.
 * This service is called by event handlers (crash ingest, error detection, etc.)
 */

import { eq, and, gte, sql, desc } from 'drizzle-orm';
import { db, alertSettings, alertRecipients, alertHistory, emailLogs, projects, users, issues } from '../db/client.js';
import { getClickHouseClient, isClickHouseReadsEnabled } from '../db/clickhouse.js';
import { logger } from '../logger.js';
import {
    emailDashboardAppPath,
    sendCrashAlertEmail,
    sendAnrAlertEmail,
    sendErrorSpikeAlertEmail,
    sendApiDegradationAlertEmail,
    sendLeakScanEmail,
} from './email.js';
import { shouldSendForEmailRules } from './emailAlertRules.js';
import { querySlowestApiEndpointsFromClickHouse } from './apiEndpointStatsClickHouse.js';
import { buildClickHouseIgnoredEndpointCondition, normalizeIgnoredApiEndpointPatterns } from '../utils/apiEndpointIgnoreRules.js';

// Rate limiting constants
const SAME_ISSUE_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour
const SAME_TYPE_COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes  
const DAILY_ALERT_CAP = 20;

// Alert types
type AlertType = 'crash' | 'anr' | 'error_spike' | 'api_degradation' | 'leak_scan';

export interface LeakScanDigestIssue {
    id: string;
    shortId?: string | null;
    title: string;
    issueType?: string | null;
    severity?: string | null;
    status?: string | null;
    whyItMatters?: string | null;
    estimatedAffectedUsers: number;
    affectedSessions?: number | null;
    firstSeen?: Date | null;
    lastSeen?: Date | null;
    contextStatus?: string | null;
    topSignals?: string[] | null;
}

export interface TriggerLeakScanDigestEmailInput {
    projectId: string;
    scanRunId: string;
    completedAt?: Date;
    admittedSessions?: number;
    issues: LeakScanDigestIssue[];
}

export interface TriggerLeakScanDigestEmailResult {
    sent: boolean;
    issueCount: number;
    recipientCount: number;
    reason?: string;
}

interface ErrorSpikeAlertWindowOptions {
    currentWindowStart: Date;
    currentWindowEnd: Date;
    baselineWindowStart: Date;
    baselineWindowEnd: Date;
}

async function queryEndpointErrorRateForAlert(params: {
    projectId: string;
    start: Date;
    end: Date;
    ignoredApiEndpoints: string[];
}): Promise<{ errorRate: number; errorCount: number; totalCount: number } | null> {
    if (!isClickHouseReadsEnabled()) return null;

    const ignoredCondition = buildClickHouseIgnoredEndpointCondition(
        params.ignoredApiEndpoints,
        'endpoint',
        'alertIgnoredEndpoint',
        'method',
        'path',
    );

    const result = await getClickHouseClient().query({
        query: `
            SELECT
                countIf(is_error = 1) AS error_count,
                count() AS total_count,
                if(count() > 0, round((countIf(is_error = 1) / count()) * 100, 4), 0) AS error_rate
            FROM rejourney.api_endpoint_request_events
            WHERE project_id = {projectId: String}
              AND event_time BETWEEN {start: DateTime64(3)} AND {end: DateTime64(3)}
              ${ignoredCondition.condition}
        `,
        query_params: {
            projectId: params.projectId,
            start: params.start.toISOString().replace('T', ' ').replace('Z', ''),
            end: params.end.toISOString().replace('T', ' ').replace('Z', ''),
            ...ignoredCondition.queryParams,
        },
        format: 'JSONEachRow',
    });
    const [row] = await result.json<{ error_count: string; total_count: string; error_rate: string }>();
    if (!row) return { errorRate: 0, errorCount: 0, totalCount: 0 };
    return {
        errorRate: Number(row.error_rate || 0),
        errorCount: Number(row.error_count || 0),
        totalCount: Number(row.total_count || 0),
    };
}

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

async function hasAlertBeenSent(
    projectId: string,
    alertType: AlertType,
    fingerprint: string
): Promise<boolean> {
    const [existing] = await db
        .select({ id: alertHistory.id })
        .from(alertHistory)
        .where(and(
            eq(alertHistory.projectId, projectId),
            eq(alertHistory.alertType, alertType),
            eq(alertHistory.fingerprint, fingerprint)
        ))
        .limit(1);

    return Boolean(existing);
}

/**
 * Get alert recipients with name and email for logging
 */
async function getRecipientDetails(projectId: string): Promise<{ email: string; name: string | null; timeZone: string | null }[]> {
    const recipients = await db
        .select({ 
            email: users.email,
            name: users.displayName,
            timeZone: users.registrationTimezone,
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

export async function triggerLeakScanDigestEmail(
    input: TriggerLeakScanDigestEmailInput
): Promise<TriggerLeakScanDigestEmailResult> {
    const sortedIssues = input.issues
        .filter((issue) => issue.title.trim().length > 0)
        .sort((a, b) =>
            (b.estimatedAffectedUsers || 0) - (a.estimatedAffectedUsers || 0) ||
            (b.affectedSessions || 0) - (a.affectedSessions || 0)
        );

        if (sortedIssues.length === 0) {
            return { sent: false, issueCount: 0, recipientCount: 0, reason: 'no_issues' };
        }

    try {
        const settings = await getProjectAlertSettings(input.projectId);
        if (settings?.leakScanAlertsEnabled === false) {
            logger.debug({ projectId: input.projectId }, 'Leak scan digest emails disabled');
            return {
                sent: false,
                issueCount: sortedIssues.length,
                recipientCount: 0,
                reason: 'disabled',
            };
        }

        if (await hasAlertBeenSent(input.projectId, 'leak_scan', input.scanRunId)) {
            return {
                sent: false,
                issueCount: sortedIssues.length,
                recipientCount: 0,
                reason: 'already_sent',
            };
        }

        const recipientDetails = await getRecipientDetails(input.projectId);
        if (recipientDetails.length === 0) {
            logger.debug({ projectId: input.projectId }, 'No leak scan alert recipients');
            return {
                sent: false,
                issueCount: sortedIssues.length,
                recipientCount: 0,
                reason: 'no_recipients',
            };
        }

        const recipients = recipientDetails.map(r => ({
            email: r.email,
            name: r.name,
            timeZone: r.timeZone,
        }));
        const projectName = await getProjectName(input.projectId);
        const dashboardUrl = emailDashboardAppPath('/leaks');

        await sendLeakScanEmail(recipients, {
            projectId: input.projectId,
            projectName,
            dashboardUrl,
            issues: sortedIssues,
            completedAt: input.completedAt ?? new Date(),
            admittedSessions: input.admittedSessions ?? null,
        });

        await recordAlertSent(input.projectId, 'leak_scan', recipients.length, input.scanRunId);
        await logEmailSends(
            input.projectId,
            recipientDetails,
            'leak_scan',
            `Leak scan for ${projectName}: ${sortedIssues.length} ${sortedIssues.length === 1 ? 'issue' : 'issues'}`,
            `${sortedIssues.length} leak ${sortedIssues.length === 1 ? 'issue' : 'issues'}`,
        );

        logger.info(
            {
                projectId: input.projectId,
                scanRunId: input.scanRunId,
                recipients: recipients.length,
                issueCount: sortedIssues.length,
            },
            'Leak scan digest email sent',
        );

        return {
            sent: true,
            issueCount: sortedIssues.length,
            recipientCount: recipients.length,
        };
    } catch (error) {
        logger.error({ projectId: input.projectId, scanRunId: input.scanRunId, error }, 'Failed to send leak scan digest email');
        return {
            sent: false,
            issueCount: sortedIssues.length,
            recipientCount: 0,
            reason: 'send_failed',
        };
    }
}

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
        if (!shouldSendForEmailRules(settings, 'crash', { affectedUsers })) {
            logger.debug({ projectId, affectedUsers }, 'Crash alert did not match email rules');
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
        const recipients = recipientDetails.map(r => ({ email: r.email, name: r.name, timeZone: r.timeZone }));

        // Fetch detailed issue data if issueId provided
        let stackTrace: string | undefined;
        let affectedVersions: Record<string, number> | undefined;
        let affectedDevices: Record<string, number> | undefined;
        let shortId: string | undefined;
        let subtitle: string | undefined;
        let screenName: string | undefined;
        let componentName: string | undefined;
        let culprit: string | undefined;
        let environment: string | undefined;
        let status: string | undefined;
        let priority: string | undefined;
        let firstSeen: Date | undefined;
        let lastSeen: Date | undefined;
        let isHandled: boolean | undefined;
        let eventCount: number | undefined;
        let events24h: number | undefined;
        let events90d: number | undefined;
        let sampleSessionId: string | undefined;
        let sampleAppVersion: string | undefined;
        let sampleOsVersion: string | undefined;
        let sampleDeviceModel: string | undefined;
        let affectedUsersForEmail = affectedUsers;

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
                culprit = issue.culprit || undefined;
                environment = issue.environment || undefined;
                status = issue.status || undefined;
                priority = issue.priority || undefined;
                firstSeen = issue.firstSeen || undefined;
                lastSeen = issue.lastSeen || undefined;
                isHandled = issue.isHandled === null ? undefined : issue.isHandled;
                eventCount = issue.eventCount ? Number(issue.eventCount) : undefined;
                events24h = issue.events24h ?? undefined;
                events90d = issue.events90d ?? undefined;
                sampleSessionId = issue.sampleSessionId || undefined;
                sampleAppVersion = issue.sampleAppVersion || undefined;
                sampleOsVersion = issue.sampleOsVersion || undefined;
                sampleDeviceModel = issue.sampleDeviceModel || undefined;
                affectedUsersForEmail = Number(issue.userCount || affectedUsers);
            }
        }

        const projectName = await getProjectName(projectId);
        const issueUrl = emailDashboardAppPath(issueId ? `/general/${issueId}` : '/general');

        await sendCrashAlertEmail(recipients, {
            projectId,
            projectName,
            crashTitle,
            subtitle,
            shortId,
            issueId,
            affectedUsers: affectedUsersForEmail,
            eventCount,
            events24h,
            events90d,
            issueUrl,
            stackTrace,
            affectedVersions,
            affectedDevices,
            screenName,
            componentName,
            culprit,
            environment,
            status,
            priority,
            firstSeen,
            lastSeen,
            isHandled,
            sampleSessionId,
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
        if (!shouldSendForEmailRules(settings, 'anr', { durationMs, affectedUsers })) {
            logger.debug({ projectId, durationMs, affectedUsers }, 'ANR alert did not match email rules');
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
        const recipients = recipientDetails.map(r => ({ email: r.email, name: r.name, timeZone: r.timeZone }));

        let stackTrace: string | undefined;
        let affectedVersions: Record<string, number> | undefined;
        let affectedDevices: Record<string, number> | undefined;
        let shortId: string | undefined;
        let screenName: string | undefined;
        let componentName: string | undefined;
        let culprit: string | undefined;
        let environment: string | undefined;
        let status: string | undefined;
        let priority: string | undefined;
        let firstSeen: Date | undefined;
        let lastSeen: Date | undefined;
        let eventCount: number | undefined;
        let events24h: number | undefined;
        let events90d: number | undefined;
        let sampleSessionId: string | undefined;
        let sampleAppVersion: string | undefined;
        let sampleOsVersion: string | undefined;
        let sampleDeviceModel: string | undefined;
        let affectedUsersForEmail = affectedUsers;

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
                componentName = issue.componentName || undefined;
                culprit = issue.culprit || undefined;
                environment = issue.environment || undefined;
                status = issue.status || undefined;
                priority = issue.priority || undefined;
                firstSeen = issue.firstSeen || undefined;
                lastSeen = issue.lastSeen || undefined;
                eventCount = issue.eventCount ? Number(issue.eventCount) : undefined;
                events24h = issue.events24h ?? undefined;
                events90d = issue.events90d ?? undefined;
                sampleSessionId = issue.sampleSessionId || undefined;
                sampleAppVersion = issue.sampleAppVersion || undefined;
                sampleOsVersion = issue.sampleOsVersion || undefined;
                sampleDeviceModel = issue.sampleDeviceModel || undefined;
                affectedUsersForEmail = Number(issue.userCount || affectedUsers);
            }
        }

        const projectName = await getProjectName(projectId);
        const issueUrl = emailDashboardAppPath(issueId ? `/general/${issueId}` : '/general');

        await sendAnrAlertEmail(recipients, {
            projectId,
            projectName,
            durationMs,
            affectedUsers: affectedUsersForEmail,
            eventCount,
            events24h,
            events90d,
            shortId,
            issueId,
            issueUrl,
            stackTrace,
            affectedVersions,
            affectedDevices,
            screenName,
            componentName,
            culprit,
            environment,
            status,
            priority,
            firstSeen,
            lastSeen,
            sampleSessionId,
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
    previousRate: number,
    options?: ErrorSpikeAlertWindowOptions
): Promise<void> {
    try {
        const settings = await getProjectAlertSettings(projectId);
        if (!settings?.errorSpikeAlertsEnabled) {
            logger.debug({ projectId }, 'Error spike alerts disabled');
            return;
        }

        const ignoredApiEndpoints = normalizeIgnoredApiEndpointPatterns(settings.ignoredApiEndpoints ?? []);
        if (ignoredApiEndpoints.length > 0) {
            if (!options) {
                logger.debug({ projectId, ignoredApiEndpoints }, 'Error spike alert skipped because ignored endpoints could not be applied without a time window');
                return;
            }

            try {
                const [currentEndpointRate, previousEndpointRate] = await Promise.all([
                    queryEndpointErrorRateForAlert({
                        projectId,
                        start: options.currentWindowStart,
                        end: options.currentWindowEnd,
                        ignoredApiEndpoints,
                    }),
                    queryEndpointErrorRateForAlert({
                        projectId,
                        start: options.baselineWindowStart,
                        end: options.baselineWindowEnd,
                        ignoredApiEndpoints,
                    }),
                ]);

                if (!currentEndpointRate || !previousEndpointRate) {
                    logger.debug({ projectId, ignoredApiEndpoints }, 'Error spike alert skipped because ignored endpoint rates could not be read from ClickHouse');
                    return;
                }

                if (currentEndpointRate.totalCount === 0 || previousEndpointRate.totalCount === 0) {
                    logger.debug({ projectId, currentEndpointRate, previousEndpointRate }, 'Error spike alert skipped because ignored endpoint filtering left no comparable API traffic');
                    return;
                }

                currentRate = currentEndpointRate.errorRate;
                previousRate = previousEndpointRate.errorRate;
            } catch (error) {
                logger.warn({ projectId, error }, 'Error spike alert skipped because ignored endpoint filtering failed');
                return;
            }
        }

        if (currentRate <= previousRate) {
            logger.debug({ projectId, currentRate, previousRate }, 'Error spike alert skipped because error rate did not increase');
            return;
        }

        const percentIncrease = previousRate > 0
            ? ((currentRate - previousRate) / previousRate) * 100
            : 100;

        if (!shouldSendForEmailRules(settings, 'error_spike', { percentIncrease })) {
            logger.debug({ projectId, percentIncrease }, 'Error spike did not match email rules');
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
        const recipients = recipientDetails.map(r => ({ email: r.email, name: r.name, timeZone: r.timeZone }));

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
        // Link to the sessions list so users can see the affected sessions directly,
        // rather than the general overview which shows crashes/ANRs (a different thing).
        const issueUrl = emailDashboardAppPath('/sessions');

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
        const spikeTitle = `API error rate increased ${percentIncrease.toFixed(0)}%`;
        const subject = `⚠️ API Error Rate Spike: ${spikeTitle}`;
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

        if (!shouldSendForEmailRules(settings, 'api_degradation', {
            latencyMs: currentLatencyMs,
            percentIncrease,
        })) {
            logger.debug({ projectId, currentLatencyMs, percentIncrease }, 'API degradation did not match email rules');
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
        const recipients = recipientDetails.map(r => ({ email: r.email, name: r.name, timeZone: r.timeZone }));

        // Fetch slowest endpoints for today
        const today = new Date().toISOString().split('T')[0];
        const slowestEndpoints = await querySlowestApiEndpointsFromClickHouse({
            projectId,
            date: today,
            limit: 5,
        });

        const projectName = await getProjectName(projectId);
        const issueUrl = emailDashboardAppPath('/api');

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
                latency: Number(e.latency || 0),
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
