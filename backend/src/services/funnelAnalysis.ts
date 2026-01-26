import { db, sessions, sessionMetrics, projectFunnelStats } from '../db/client.js';
import { eq, desc, and, gt, sql } from 'drizzle-orm';
import { logger } from '../logger.js';
import { getRedis } from '../db/redis.js';
import { normalizeScreenPath } from '../utils/screenPaths.js';

/**
 * Funnel Analysis Service
 *
 * Automatically learns the "Happy Path" or typical user funnel for a project
 * by analyzing recent sessions.
 */

// Configuration
const ANALYSIS_SAMPLE_SIZE = 1000;
const FLOW_PROFILE_SAMPLE_SIZE = 750;
const MIN_PATH_LENGTH = 3;
const MIN_CONFIDENCE_THRESHOLD = 0.3; // 30% of users must follow this path to be considered "The Funnel"
const MIN_FUNNEL_SAMPLE_SIZE = 50;
const MIN_FLOW_PROFILE_SAMPLE_SIZE = 30;
const MIN_SESSION_DURATION_SECONDS = 10;
const ENTRY_SCREENS_MAX = 3;
const ENTRY_SCREEN_MIN_SHARE = 0.12;
const ENTRY_SCREEN_MIN_COUNT = 5;
const MAX_PATH_STEPS = 5;
const MAX_SCREEN_PATH_LENGTH = 10;
const FLOW_CACHE_TTL_SECONDS = 60 * 60;

interface PathNode {
    screen: string;
    count: number;
    children: Map<string, PathNode>;
}

export interface FlowProfile {
    entryScreens: string[];
    entryScreenCounts: Record<string, number>;
    entryConfidence: number;
    dominantPath: string[];
    pathConfidence: number;
    sampleSize: number;
}

type FlowProfileSessionRow = {
    screensVisited: string[] | null;
};

type FlowProfileOptions = {
    minPathLength: number;
    minSampleSize: number;
};

function buildFlowProfileFromSessions(
    recentSessions: FlowProfileSessionRow[],
    options: FlowProfileOptions
): FlowProfile | null {
    const root: PathNode = { screen: 'root', count: 0, children: new Map() };
    const entryCounts: Record<string, number> = {};
    let sampleSize = 0;

    for (const session of recentSessions) {
        const screens = normalizeScreenPath(session.screensVisited || [], { maxLength: MAX_SCREEN_PATH_LENGTH });
        if (screens.length < options.minPathLength) {
            continue;
        }

        sampleSize++;
        root.count++;

        const entryScreen = screens[0];
        entryCounts[entryScreen] = (entryCounts[entryScreen] || 0) + 1;

        let currentNode = root;
        for (const screen of screens) {
            if (!currentNode.children.has(screen)) {
                currentNode.children.set(screen, { screen, count: 0, children: new Map() });
            }
            currentNode = currentNode.children.get(screen)!;
            currentNode.count++;
        }
    }

    if (sampleSize < options.minSampleSize) {
        return null;
    }

    const entryScreensSorted = Object.entries(entryCounts).sort((a, b) => b[1] - a[1]);
    let entryScreens = entryScreensSorted
        .filter(([, count]) => count >= ENTRY_SCREEN_MIN_COUNT && count / sampleSize >= ENTRY_SCREEN_MIN_SHARE)
        .slice(0, ENTRY_SCREENS_MAX)
        .map(([screen]) => screen);

    if (entryScreens.length === 0 && entryScreensSorted.length > 0) {
        entryScreens = [entryScreensSorted[0][0]];
    }

    const entryScreenCounts = entryScreens.reduce((acc, screen) => {
        acc[screen] = entryCounts[screen] || 0;
        return acc;
    }, {} as Record<string, number>);

    const { path: dominantPath, terminalNode } = pickDominantPath(root, MAX_PATH_STEPS);
    const pathConfidence = terminalNode && sampleSize > 0 ? terminalNode.count / sampleSize : 0;
    const entryConfidence = entryScreensSorted.length > 0 ? entryScreensSorted[0][1] / sampleSize : 0;

    return {
        entryScreens,
        entryScreenCounts,
        entryConfidence,
        dominantPath,
        pathConfidence,
        sampleSize,
    };
}

function pickDominantPath(
    root: PathNode,
    maxSteps: number
): { path: string[]; terminalNode: PathNode | null } {
    const learnedPath: string[] = [];
    let currentNode: PathNode | null = root;

    while (currentNode && learnedPath.length < maxSteps) {
        if (currentNode.children.size === 0) break;

        let bestChild: PathNode | null = null;
        let maxCount = -1;

        for (const child of currentNode.children.values()) {
            if (child.count > maxCount) {
                maxCount = child.count;
                bestChild = child;
            }
        }

        if (!bestChild) break;

        const dropoffRate = currentNode.count > 0 ? bestChild.count / currentNode.count : 0;
        if (dropoffRate < 0.1) break;

        learnedPath.push(bestChild.screen);
        currentNode = bestChild;
    }

    if (learnedPath.length === 0) {
        return { path: [], terminalNode: null };
    }

    return { path: learnedPath, terminalNode: currentNode };
}

async function fetchRecentSessions(
    projectId: string,
    sampleSize: number,
    minPathLength: number,
    minDurationSeconds: number
): Promise<FlowProfileSessionRow[]> {
    return db
        .select({
            screensVisited: sessionMetrics.screensVisited,
        })
        .from(sessionMetrics)
        .innerJoin(sessions, eq(sessions.id, sessionMetrics.sessionId))
        .where(
            and(
                eq(sessions.projectId, projectId),
                gt(sessions.durationSeconds, minDurationSeconds),
                sql`${sessionMetrics.screensVisited} IS NOT NULL`,
                sql`array_length(${sessionMetrics.screensVisited}, 1) >= ${minPathLength}`
            )
        )
        .orderBy(desc(sessions.startedAt))
        .limit(sampleSize);
}

export async function getProjectFlowProfile(projectId: string): Promise<FlowProfile | null> {
    const redis = getRedis();
    const cacheKey = `flow_profile:${projectId}`;

    if (redis) {
        try {
            const cached = await redis.get(cacheKey);
            if (cached) {
                return JSON.parse(cached) as FlowProfile;
            }
        } catch (err) {
            logger.warn({ err, projectId }, 'Failed to read flow profile cache');
        }
    }

    const recentSessions = await fetchRecentSessions(
        projectId,
        FLOW_PROFILE_SAMPLE_SIZE,
        1,
        MIN_SESSION_DURATION_SECONDS
    );

    const flowProfile = buildFlowProfileFromSessions(recentSessions, {
        minPathLength: 1,
        minSampleSize: MIN_FLOW_PROFILE_SAMPLE_SIZE,
    });

    if (!flowProfile) {
        return null;
    }

    if (redis) {
        try {
            await redis.set(cacheKey, JSON.stringify(flowProfile), 'EX', FLOW_CACHE_TTL_SECONDS);
        } catch (err) {
            logger.warn({ err, projectId }, 'Failed to write flow profile cache');
        }
    }

    return flowProfile;
}

/**
 * Analyze recent sessions to learn the typical user funnel.
 * Updates the project_funnel_stats table.
 */
export async function analyzeProjectFunnel(projectId: string): Promise<void> {
    const startTime = Date.now();

    try {
        // 1. Fetch recent sessions with screen data
        const recentSessions = await fetchRecentSessions(
            projectId,
            ANALYSIS_SAMPLE_SIZE,
            MIN_PATH_LENGTH,
            MIN_SESSION_DURATION_SECONDS
        );

        const flowProfile = buildFlowProfileFromSessions(recentSessions, {
            minPathLength: MIN_PATH_LENGTH,
            minSampleSize: MIN_FUNNEL_SAMPLE_SIZE,
        });

        if (!flowProfile) {
            logger.info({ projectId, count: recentSessions.length }, 'Not enough data to analyze funnel');
            return;
        }

        const learnedPath = flowProfile.dominantPath;
        const confidence = flowProfile.pathConfidence;

        // 4. Validate the path
        if (learnedPath.length < MIN_PATH_LENGTH) {
            logger.debug({ projectId, learnedPath }, 'Learned path too short');
            return;
        }

        if (confidence < MIN_CONFIDENCE_THRESHOLD) {
            logger.info({ projectId, confidence, minThreshold: MIN_CONFIDENCE_THRESHOLD }, 'Funnel confidence too low, skipping update');
            return;
        }

        // The "Target" is the end of this common flow
        const targetScreen = learnedPath[learnedPath.length - 1];

        logger.info({
            projectId,
            learnedPath,
            targetScreen,
            confidence,
            sampleSize: flowProfile.sampleSize,
        }, 'Funnel analysis complete');

        // 5. Save to DB
        await db
            .insert(projectFunnelStats)
            .values({
                projectId,
                funnelPath: learnedPath,
                targetScreen,
                confidence,
                sampleSize: flowProfile.sampleSize,
            })
            .onConflictDoUpdate({
                target: projectFunnelStats.projectId,
                set: {
                    funnelPath: learnedPath,
                    targetScreen,
                    confidence,
                    sampleSize: flowProfile.sampleSize,
                    updatedAt: new Date(),
                },
            });
    } catch (err) {
        logger.error({ err, projectId }, 'Failed to analyze project funnel');
    } finally {
        logger.debug({ projectId, durationMs: Date.now() - startTime }, 'Funnel analysis finished');
    }
}
