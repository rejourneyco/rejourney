/**
 * Retention Worker
 * 
 * Deletes expired replay screenshot artifacts based on retention tier:
 * - Scans sessions past retention window
 * - Deletes ONLY screenshot archive S3 objects (keeps session data, events, crashes, etc.)
 * - Removes screenshot artifact rows from recording_artifacts table
 * - Updates session flags to indicate replay data is deleted
 * 
 * IMPORTANT: Session metadata (events, crashes, ANRs, hierarchy) is kept indefinitely
 * as it has negligible storage cost and provides valuable analytics data.
 * 
 * S3 KEY SAFETY:
 * - Screenshot files are stored at: tenant/{teamId}/project/{projectId}/sessions/{sessionId}/screenshots/{timestamp}.tar.gz
 * - We validate the S3 key contains /screenshots/ and ends with .tar.gz before deletion
 * - Only artifacts with kind='screenshots' are processed
 */

import { eq, and, lt, isNotNull, sql, ne } from 'drizzle-orm';
import { db, pool, sessions, recordingArtifacts, projects } from '../db/client.js';
import { logger } from '../logger.js';
import { deleteFromS3ForProject } from '../db/s3.js';
import { retentionTiers } from '../config.js';
import { pingWorker } from '../services/monitoring.js';
import { hardDeleteProject } from '../services/deletion.js';

const RUN_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const BATCH_SIZE = 100;

// Safety patterns - screenshot archives must match these patterns.
const SCREENSHOT_KEY_PATTERNS = {
    requiredSubstring: '/screenshots/',
    validExtensions: ['.tar.gz'],
};

let isRunning = true;

/**
 * Validate that an S3 key looks like a screenshot archive
 * This is a safety check to prevent accidental deletion of non-screenshot data.
 */
function isValidScreenshotS3Key(key: string): boolean {
    if (!key) return false;

    // Must contain /screenshots/ directory.
    if (!key.includes(SCREENSHOT_KEY_PATTERNS.requiredSubstring)) {
        return false;
    }

    // Must end with a valid screenshot extension.
    const hasValidExtension = SCREENSHOT_KEY_PATTERNS.validExtensions.some(ext =>
        key.toLowerCase().endsWith(ext)
    );

    return hasValidExtension;
}

/**
 * Process expired sessions - delete screenshot artifacts only.
 *
 * Session metadata (events, crashes, ANRs, hierarchy) is kept indefinitely
 * as it provides valuable analytics with negligible storage cost.
 * Only screenshot archive files are deleted based on retention tier.
 */
async function processExpiredSessions(): Promise<number> {
    let processedCount = 0;
    let totalScreenshotsDeleted = 0;
    let skippedNonScreenshotKeys = 0;

    const now = new Date();

    // For each retention tier, find expired sessions
    for (const tierConfig of retentionTiers) {
        if (tierConfig.days === null) continue; // Unlimited retention

        const expiryDate = new Date(now.getTime() - tierConfig.days * 24 * 60 * 60 * 1000);

        // Find expired sessions that still have replay recordings.
        const expiredSessions = await db
            .select({
                session: sessions,
                teamId: projects.teamId,
            })
            .from(sessions)
            .innerJoin(projects, eq(sessions.projectId, projects.id))
            .where(
                and(
                    eq(sessions.retentionTier, tierConfig.tier),
                    lt(sessions.startedAt, expiryDate),
                    eq(sessions.recordingDeleted, false),
                    eq(sessions.status, 'ready')
                )
            )
            .limit(BATCH_SIZE);

        for (const { session } of expiredSessions) {
            try {
                // Get ONLY screenshot artifacts for this session - keep events, crashes, ANRs, etc.
                const screenshotArtifacts = await db
                    .select()
                    .from(recordingArtifacts)
                    .where(
                        and(
                            eq(recordingArtifacts.sessionId, session.id),
                            eq(recordingArtifacts.kind, 'screenshots')
                        )
                    );

                // Also log how many non-screenshot artifacts are retained for verification.
                const retainedArtifactsCount = await db
                    .select({ count: sql<number>`count(*)` })
                    .from(recordingArtifacts)
                    .where(
                        and(
                            eq(recordingArtifacts.sessionId, session.id),
                            ne(recordingArtifacts.kind, 'screenshots')
                        )
                    );
                const retainedCount = retainedArtifactsCount[0]?.count ?? 0;

                // Delete ONLY screenshot S3 objects with safety validation.
                let deletedScreenshotCount = 0;
                for (const artifact of screenshotArtifacts) {
                    try {
                        // SAFETY CHECK: Validate the S3 key looks like a screenshot archive.
                        if (!isValidScreenshotS3Key(artifact.s3ObjectKey)) {
                            logger.warn({
                                artifactId: artifact.id,
                                kind: artifact.kind,
                                s3ObjectKey: artifact.s3ObjectKey,
                            }, 'SAFETY: Skipping artifact deletion - S3 key does not match screenshot pattern');
                            skippedNonScreenshotKeys++;
                            continue;
                        }

                        await deleteFromS3ForProject(session.projectId, artifact.s3ObjectKey);

                        // Hard delete the screenshot artifact row from DB.
                        await db.delete(recordingArtifacts)
                            .where(eq(recordingArtifacts.id, artifact.id));

                        deletedScreenshotCount++;
                        totalScreenshotsDeleted++;
                    } catch (err) {
                        logger.error({ err, artifactId: artifact.id, s3Key: artifact.s3ObjectKey }, 'Failed to delete screenshot artifact');
                    }
                }

                // Mark session as recording deleted (screenshots gone, session data remains).
                await db.update(sessions)
                    .set({
                        recordingDeleted: true,
                        recordingDeletedAt: now,
                        isReplayExpired: true,
                    })
                    .where(eq(sessions.id, session.id));

                processedCount++;
                logger.info({ 
                    sessionId: session.id, 
                    tier: tierConfig.tier,
                    deletedScreenshotCount,
                    retainedArtifacts: retainedCount,
                }, 'Session replay expired - screenshots deleted, session data retained');

            } catch (err) {
                logger.error({ err, sessionId: session.id }, 'Failed to process expired session');
            }
        }
    }

    // Log summary if any work was done
    if (processedCount > 0 || skippedNonScreenshotKeys > 0) {
        logger.info({
            sessionsProcessed: processedCount,
            totalScreenshotsDeleted,
            skippedNonScreenshotKeys,
        }, 'Replay retention cleanup cycle complete');
    }

    return processedCount;
}

/**
 * Process projects marked for deletion (soft deleted)
 * GDPR Compliance:
 * 1. Delete all assets from S3 (recursive)
 * 2. Hard delete project and all associated data from DB
 */
async function processDeletedProjects(): Promise<number> {
    let processedCount = 0;

    // Find projects soft-deleted more than 1 minute ago (buffer for race conditions)
    // or just process immediately if preferred.
    const deletedProjects = await db
        .select()
        .from(projects)
        .where(isNotNull(projects.deletedAt))
        .limit(BATCH_SIZE);

    for (const project of deletedProjects) {
        try {
            logger.info({ projectId: project.id }, 'Processing project deletion...');

            await hardDeleteProject({
                id: project.id,
                teamId: project.teamId,
                name: project.name,
                publicKey: project.publicKey,
            });

            processedCount++;
            logger.info({ projectId: project.id }, 'Project hard deleted (GDPR compliant)');

        } catch (err) {
            logger.error({ err, projectId: project.id }, 'Failed to process deleted project');
        }
    }

    return processedCount;
}

/**
 * Main worker loop
 */
async function runWorker(): Promise<void> {
    while (isRunning) {
        try {
            const expiredCount = await processExpiredSessions();
            const deletedProjectCount = await processDeletedProjects();
            const processedCount = expiredCount + deletedProjectCount;

            if (processedCount > 0) {
                logger.info({ processedCount }, 'Retention worker completed cycle');
            }

            await pingWorker('retentionWorker', 'up', `processed=${processedCount}`);
        } catch (err) {
            logger.error({ err }, 'Retention worker error');
            await pingWorker('retentionWorker', 'down', String(err)).catch(() => { });
        }

        await new Promise((resolve) => setTimeout(resolve, RUN_INTERVAL_MS));
    }
}

// Graceful shutdown
async function shutdown(signal: string) {
    logger.info({ signal }, 'Retention worker shutting down...');
    isRunning = false;

    await pool.end();
    process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Start worker
logger.info('🗑️ Retention worker started');
runWorker().catch((err) => {
    logger.error({ err }, 'Retention worker fatal error');
    process.exit(1);
});
