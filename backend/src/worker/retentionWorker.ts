/**
 * Retention Worker
 * 
 * Deletes expired VIDEO recording artifacts based on retention tier:
 * - Scans sessions past retention window
 * - Deletes ONLY video/MP4 S3 objects (keeps session data, events, crashes, etc.)
 * - Removes video artifact rows from recording_artifacts table
 * - Updates session flags to indicate video recording is deleted
 * 
 * IMPORTANT: Session metadata (events, crashes, ANRs, hierarchy) is kept indefinitely
 * as it has negligible storage cost and provides valuable analytics data.
 * 
 * S3 KEY SAFETY:
 * - Video files are stored at: tenant/{teamId}/project/{projectId}/sessions/{sessionId}/segments/{timestamp}.mp4
 * - We validate the S3 key contains /segments/ and ends with .mp4 before deletion
 * - Only artifacts with kind='video' are processed
 */

import { eq, and, lt, isNotNull, sql, ne } from 'drizzle-orm';
import { db, pool, sessions, recordingArtifacts, projects } from '../db/client.js';
import { logger } from '../logger.js';
import { deleteFromS3ForProject } from '../db/s3.js';
import { retentionTiers } from '../config.js';
import { pingWorker } from '../services/monitoring.js';

const RUN_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const BATCH_SIZE = 100;

// Safety patterns - video files must match these patterns
const VIDEO_KEY_PATTERNS = {
    requiredSubstring: '/segments/',
    validExtensions: ['.mp4', '.m4v'],
};

let isRunning = true;

/**
 * Validate that an S3 key looks like a video segment
 * This is a safety check to prevent accidental deletion of non-video data
 */
function isValidVideoS3Key(key: string): boolean {
    if (!key) return false;
    
    // Must contain /segments/ directory
    if (!key.includes(VIDEO_KEY_PATTERNS.requiredSubstring)) {
        return false;
    }
    
    // Must end with a valid video extension
    const hasValidExtension = VIDEO_KEY_PATTERNS.validExtensions.some(ext => 
        key.toLowerCase().endsWith(ext)
    );
    
    return hasValidExtension;
}

/**
 * Process expired sessions - delete VIDEO artifacts only
 * 
 * Session metadata (events, crashes, ANRs, hierarchy) is kept indefinitely
 * as it provides valuable analytics with negligible storage cost.
 * Only video/MP4 files are deleted based on retention tier.
 */
async function processExpiredSessions(): Promise<number> {
    let processedCount = 0;
    let totalVideosDeleted = 0;
    let skippedNonVideoKeys = 0;

    const now = new Date();

    // For each retention tier, find expired sessions
    for (const tierConfig of retentionTiers) {
        if (tierConfig.days === null) continue; // Unlimited retention

        const expiryDate = new Date(now.getTime() - tierConfig.days * 24 * 60 * 60 * 1000);

        // Find expired sessions that still have video recordings
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
                // Get ONLY VIDEO artifacts for this session - keep events, crashes, ANRs, etc.
                const videoArtifacts = await db
                    .select()
                    .from(recordingArtifacts)
                    .where(
                        and(
                            eq(recordingArtifacts.sessionId, session.id),
                            eq(recordingArtifacts.kind, 'video')
                        )
                    );

                // Also log how many non-video artifacts are retained for verification
                const retainedArtifactsCount = await db
                    .select({ count: sql<number>`count(*)` })
                    .from(recordingArtifacts)
                    .where(
                        and(
                            eq(recordingArtifacts.sessionId, session.id),
                            ne(recordingArtifacts.kind, 'video')
                        )
                    );
                const retainedCount = retainedArtifactsCount[0]?.count ?? 0;

                // Delete ONLY video S3 objects with safety validation
                let deletedVideoCount = 0;
                for (const artifact of videoArtifacts) {
                    try {
                        // SAFETY CHECK: Validate the S3 key looks like a video file
                        if (!isValidVideoS3Key(artifact.s3ObjectKey)) {
                            logger.warn({
                                artifactId: artifact.id,
                                kind: artifact.kind,
                                s3ObjectKey: artifact.s3ObjectKey,
                            }, 'SAFETY: Skipping artifact deletion - S3 key does not match video pattern');
                            skippedNonVideoKeys++;
                            continue;
                        }

                        await deleteFromS3ForProject(session.projectId, artifact.s3ObjectKey);

                        // Hard delete the video artifact row from DB
                        await db.delete(recordingArtifacts)
                            .where(eq(recordingArtifacts.id, artifact.id));
                        
                        deletedVideoCount++;
                        totalVideosDeleted++;
                    } catch (err) {
                        logger.error({ err, artifactId: artifact.id, s3Key: artifact.s3ObjectKey }, 'Failed to delete video artifact');
                    }
                }

                // Mark session as recording deleted (video is gone, but session data remains)
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
                    deletedVideoCount,
                    retainedArtifacts: retainedCount,
                }, 'Session video expired - videos deleted, session data retained');

            } catch (err) {
                logger.error({ err, sessionId: session.id }, 'Failed to process expired session');
            }
        }
    }

    // Log summary if any work was done
    if (processedCount > 0 || skippedNonVideoKeys > 0) {
        logger.info({
            sessionsProcessed: processedCount,
            totalVideosDeleted,
            skippedNonVideoKeys,
        }, 'Video retention cleanup cycle complete');
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

            // 1. Delete S3 Assets
            // This includes recordings, snapshots, and any other artifacts
            try {
                // Lazy import to avoid circular dependency issues if any
                const { deleteProjectAssets } = await import('../db/s3.js');
                await deleteProjectAssets(project.id, project.teamId);
                logger.info({ projectId: project.id }, 'S3 assets deleted');
            } catch (err) {
                logger.error({ err, projectId: project.id }, 'Failed to delete S3 assets, continuing to DB cleanup');
                // We continue to DB deletion even if S3 fails partially,
                // or we might want to retry. for now, we log and proceed to avoid zombie projects.
            }

            // 2. Hard Delete from DB
            // Cascading deletes should handle related tables (sessions, events, etc.)
            // if configured in schema, otherwise we'd manually delete them here.
            // Assuming DB schema has ON DELETE CASCADE for foreign keys.
            await db.delete(projects)
                .where(eq(projects.id, project.id));

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
