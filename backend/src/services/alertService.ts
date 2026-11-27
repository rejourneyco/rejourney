/**
 * Project email delivery for low-frequency stability digests.
 *
 * Stability email is deliberately project-scoped rather than occurrence-scoped:
 * a worker groups rising issue and API signals, this service suppresses signals
 * already included during the last seven days, and no project can receive more
 * than three stability digests in a rolling seven-day window.
 */

import { and, eq, gte, sql } from 'drizzle-orm';
import {
    alertHistory,
    alertRecipients,
    db,
    emailLogs,
    projects,
    users,
} from '../db/client.js';
import { logger } from '../logger.js';
import {
    sendStabilityDigestEmail,
    stabilityDigestSubject,
} from './email.js';
import {
    selectStabilityDigestTrends,
    STABILITY_DIGEST_WINDOW_DAYS,
    type StabilityTrend,
} from './stabilityTrends.js';

type AlertRecipient = {
    email: string;
    name: string | null;
    timeZone: string | null;
};

export interface TriggerStabilityDigestEmailInput {
    projectId: string;
    detectedAt?: Date;
    trends: StabilityTrend[];
}

export interface TriggerStabilityDigestEmailResult {
    sent: boolean;
    trendCount: number;
    recipientCount: number;
    reason?: 'weekly_cap' | 'already_reported' | 'no_recipients' | 'send_failed';
}

async function getRecipientDetails(projectId: string): Promise<AlertRecipient[]> {
    return db
        .select({
            email: users.email,
            name: users.displayName,
            timeZone: users.registrationTimezone,
        })
        .from(alertRecipients)
        .innerJoin(users, eq(alertRecipients.userId, users.id))
        .where(eq(alertRecipients.projectId, projectId));
}

async function getProjectName(projectId: string): Promise<string> {
    const [project] = await db
        .select({ name: projects.name })
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1);
    return project?.name || 'Unknown Project';
}

async function logEmailSends(input: {
    projectId: string;
    recipients: AlertRecipient[];
    alertType: string;
    subject: string;
    issueTitle?: string;
    issueId?: string | null;
}): Promise<void> {
    if (input.recipients.length === 0) return;
    try {
        await db.insert(emailLogs).values(input.recipients.map((recipient) => ({
            projectId: input.projectId,
            recipientEmail: recipient.email,
            recipientName: recipient.name,
            alertType: input.alertType,
            subject: input.subject,
            issueTitle: input.issueTitle?.slice(0, 500),
            issueId: input.issueId || null,
            status: 'sent',
        })));
    } catch (error) {
        logger.error(
            { error, projectId: input.projectId, alertType: input.alertType },
            'Failed to log email sends',
        );
    }
}

export async function triggerStabilityDigestEmail(
    input: TriggerStabilityDigestEmailInput,
): Promise<TriggerStabilityDigestEmailResult> {
    const detectedAt = input.detectedAt ?? new Date();
    const cutoff = new Date(
        detectedAt.getTime() - STABILITY_DIGEST_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    );

    try {
        const recipientDetails = await getRecipientDetails(input.projectId);
        if (recipientDetails.length === 0) {
            return {
                sent: false,
                trendCount: input.trends.length,
                recipientCount: 0,
                reason: 'no_recipients',
            };
        }

        const projectName = await getProjectName(input.projectId);
        const reservation = await db.transaction(async (tx) => {
            // Multiple API/worker replicas used to run this check concurrently.
            // Serialize each project and reserve the digest before SMTP so a
            // rolling deployment cannot race past the hard weekly cap.
            await tx.execute(sql`
                select pg_advisory_xact_lock(hashtext(${input.projectId}))
            `);

            const recentHistory = await tx
                .select({
                    alertType: alertHistory.alertType,
                    fingerprint: alertHistory.fingerprint,
                })
                .from(alertHistory)
                .where(and(
                    eq(alertHistory.projectId, input.projectId),
                    gte(alertHistory.sentAt, cutoff),
                ));

            const digestCount = recentHistory.filter(
                (entry) => entry.alertType === 'stability_digest',
            ).length;
            const recentlyReportedSignals = recentHistory
                .filter((entry) => entry.alertType === 'stability_digest_signal')
                .map((entry) => entry.fingerprint)
                .filter((fingerprint): fingerprint is string => Boolean(fingerprint));
            const selection = selectStabilityDigestTrends({
                trends: input.trends,
                recentDigestCount: digestCount,
                recentlyReportedSignalKeys: recentlyReportedSignals,
            });
            if (selection.reason) {
                return {
                    reason: selection.reason,
                    trends: [] as StabilityTrend[],
                    digestCount,
                };
            }

            await tx.insert(alertHistory).values([
                {
                    projectId: input.projectId,
                    alertType: 'stability_digest',
                    fingerprint: `stability-digest:${detectedAt.toISOString()}`,
                    recipientCount: recipientDetails.length,
                },
                ...selection.trends.map((trend) => ({
                    projectId: input.projectId,
                    alertType: 'stability_digest_signal',
                    fingerprint: trend.signalKey,
                    recipientCount: 0,
                })),
            ]);

            return {
                trends: selection.trends,
                digestCount,
            };
        });

        if (reservation.reason === 'weekly_cap') {
            return {
                sent: false,
                trendCount: 0,
                recipientCount: 0,
                reason: 'weekly_cap',
            };
        }
        if (reservation.reason === 'already_reported') {
            return {
                sent: false,
                trendCount: 0,
                recipientCount: 0,
                reason: 'already_reported',
            };
        }
        const eligibleTrends = reservation.trends;

        await sendStabilityDigestEmail(recipientDetails, {
            projectId: input.projectId,
            projectName,
            trends: eligibleTrends,
            detectedAt,
        });

        await logEmailSends({
            projectId: input.projectId,
            recipients: recipientDetails,
            alertType: 'stability_digest',
            subject: stabilityDigestSubject({ projectName, trendCount: eligibleTrends.length }),
            issueTitle: eligibleTrends.map((trend) => trend.title).join(' · '),
            issueId: eligibleTrends.find((trend) => trend.issueId)?.issueId,
        });

        logger.info(
            {
                projectId: input.projectId,
                recipients: recipientDetails.length,
                trendCount: eligibleTrends.length,
                weeklyDigestNumber: reservation.digestCount + 1,
            },
            'Stability trend digest email sent',
        );
        return {
            sent: true,
            trendCount: eligibleTrends.length,
            recipientCount: recipientDetails.length,
        };
    } catch (error) {
        logger.error(
            { projectId: input.projectId, error },
            'Failed to send stability trend digest email',
        );
        return {
            sent: false,
            trendCount: 0,
            recipientCount: 0,
            reason: 'send_failed',
        };
    }
}
