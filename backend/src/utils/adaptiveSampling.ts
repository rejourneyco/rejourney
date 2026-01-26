import { db, appDailyStats } from '../db/client.js';
import { sql, desc, eq, and } from 'drizzle-orm';
import { logger } from '../logger.js';

/**
 * Calculate an adaptive adjustment factor based on project session volume.
 * 
 * Logic:
 * - Low volume (< 50 sessions/day): adjustment = 1.0 (no reduction)
 * - Medium volume (50-500 sessions/day): adjustment = 0.5
 * - High volume (> 500 sessions/day): adjustment = 0.2
 */
export async function getAdaptiveScaleFactor(projectId: string): Promise<number> {
    try {
        // Look at the last 3 days of stats
        const threeDaysAgo = new Date();
        threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

        const stats = await db
            .select({ totalSessions: appDailyStats.totalSessions })
            .from(appDailyStats)
            .where(
                and(
                    eq(appDailyStats.projectId, projectId),
                    sql`${appDailyStats.date} >= ${threeDaysAgo.toISOString().split('T')[0]}`
                )
            )
            .orderBy(desc(appDailyStats.date));

        if (stats.length === 0) return 1.0; // New project, default to high visibility

        const avgDailySessions = stats.reduce((acc, s) => acc + (s.totalSessions || 0), 0) / stats.length;

        if (avgDailySessions < 50) return 1.0;
        if (avgDailySessions < 500) return 0.5;
        return 0.2;
    } catch (err) {
        logger.warn({ err, projectId }, 'Failed to calculate adaptive scale factor');
        return 1.0; // Fallback to full rate
    }
}
