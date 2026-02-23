/**
 * Replay Promotion Service
 * 
 * Evaluates session metadata to determine if replay frames should be uploaded.
 * Uses a combination of hard rules (crash/ANR/high-latency = always) and soft scoring.
 * 
 * Rate limiting is applied with different limits per reason type:
 * - Crashes/ANRs: Lower limits (can indicate systemic issues)
 * - Rage taps: Higher limits (sporadic user frustration, not systemic)
 * - API errors: Moderate limits (can flood during outages)
 * - Score-based: Higher limits (diverse quality sessions)
 */

import { logger } from '../logger.js';
import { getRedis } from '../db/redis.js';
import { getProjectFlowProfile } from './funnelAnalysis.js';
import { getUniqueScreenCount, normalizeScreenPath } from '../utils/screenPaths.js';
import {
    SessionMetrics,
    SCORE_THRESHOLD,
    calculatePromotionScore
} from '../utils/promotionLogic.js';

import { getAdaptiveScaleFactor } from '../utils/adaptiveSampling.js';
import { config } from '../config.js';

// =============================================================================
// Types
// =============================================================================

// SessionMetrics type removed - now imported from ../utils/promotionLogic.js

/**
 * Project quota configuration for replay promotion.
 */
export interface QuotaConfig {
    recordingEnabled: boolean;
    maxRecordingMinutes: number;
}

export type PromotionReason =
    | 'crash'
    | 'anr'
    | 'high_latency'     // API latency > 1000ms
    | 'slow_startup'     // App startup > 3000ms
    | 'rage_tap'         // Explicit rage tap promotion
    | 'dead_tap'         // Taps on unresponsive interactive elements
    | 'low_exploration'  // User stuck/confused - low screens per minute
    | 'stuck_first_screen' // User stuck on initial screen
    | 'failed_funnel'    // User dropped off the happy path
    | 'low_network'      // Constrained or metered connection (for categorization)
    | 'score'
    | 'sample'
    | 'not_promoted'
    | 'rate_limited'
    | 'recording_disabled'
    | 'quota_exceeded';

export interface PromotionResult {
    promoted: boolean;
    reason: PromotionReason;
    score?: number;
}

// Global toggle for whether to apply replay promotion heuristics.
// When false, all eligible sessions are promoted without applying scoring or hard/soft rules.
const USE_PROMOTION_LOGIC = config.REPLAY_USE_PROMOTION_LOGIC;

// =============================================================================
// Configuration
// =============================================================================

/**
 * Hard promote thresholds - sessions meeting these are ALWAYS promoted
 * (subject to rate limiting to prevent floods during outages)
 * 
 * RELAXED THRESHOLDS: We want to catch most sessions with any issues.
 * Storage is cheap, missing replays is expensive for debugging.
 */
export const HARD_PROMOTE_THRESHOLDS = {
    // Critical issues - always promote
    crashCount: 1,
    anrCount: 1,
    // Performance issues - relaxed to catch more slow sessions
    avgApiLatencyMs: 500,   // 500ms average API latency (was 1000)
    startupTimeMs: 2000,    // 2 second app startup time (was 3000)
    // User frustration - even 1 rage tap is worth capturing
    rageTapCount: 1,        // (was 2)
    // Dead taps - tapping elements that look interactive but don't respond
    deadTapCount: 3,        // 3+ dead taps indicates real UX pain
    // Low exploration - user stuck/confused
    minDurationSecondsForExploration: 60, // 1 minute minimum (was 2 minutes)
    screensPerMinuteThreshold: 0.75,      // Below this = low exploration (was 0.5)
    // First screen stuck - user never progressed past entry
    minDurationSecondsForFirstScreen: 20,
    maxScreensForFirstScreen: 1,
    // API errors - even 1 is worth capturing
    apiErrorCount: 1,
} as const;

// SOFT_CONDITIONS and SCORE_THRESHOLD removed - now imported from ../utils/promotionLogic.js

/**
 * Rate limits per reason, per project, per 15-minute window.
 * 
 * RELAXED: Higher limits to capture more sessions. Storage is cheap,
 * missing replays is expensive for debugging.
 */
export const REASON_RATE_LIMITS: Record<string, number> = {
    crash: 100,        // Increased from 50
    anr: 100,          // Increased from 50
    high_latency: 100, // Increased from 25
    slow_startup: 100, // Increased from 30
    rage_tap: 1000,    // Increased from 500
    dead_tap: 1000,    // Dead tap promotion
    low_exploration: 200, // Increased from 100
    stuck_first_screen: 200,
    failed_funnel: 200,   // NEW: Failed funnel
    api_error: 200,    // NEW: API errors
    score: 500,        // Increased from 200
    sample: 500,       // Increased from 200
};

const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

// =============================================================================
// Rate Limiting
// =============================================================================

/**
 * Get the current 15-minute window ID for rate limiting.
 */
function getWindowId(): number {
    return Math.floor(Date.now() / RATE_LIMIT_WINDOW_MS);
}

/**
 * Check if a promotion reason is rate limited for a project.
 */
async function isRateLimited(projectId: string, reason: string): Promise<boolean> {
    const limit = REASON_RATE_LIMITS[reason];
    if (!limit) return false;

    const redis = getRedis();
    const key = `replay_rate:${projectId}:${reason}:${getWindowId()}`;

    try {
        const count = await redis.get(key);
        return count !== null && parseInt(count) >= limit;
    } catch (err) {
        logger.warn({ err, projectId, reason }, 'Replay rate limit check failed');
        return false; // Allow on error
    }
}

/**
 * Increment the rate counter for a promotion reason.
 */
async function incrementRateCounter(projectId: string, reason: string): Promise<void> {
    const redis = getRedis();
    const key = `replay_rate:${projectId}:${reason}:${getWindowId()}`;

    try {
        const pipeline = redis.pipeline();
        pipeline.incr(key);
        pipeline.expire(key, Math.ceil(RATE_LIMIT_WINDOW_MS / 1000) + 60); // TTL with buffer
        await pipeline.exec();
    } catch (err) {
        logger.warn({ err, projectId, reason }, 'Replay rate counter increment failed');
    }
}



// =============================================================================
// Promotion Logic
// =============================================================================

// calculatePromotionScore removed - now imported from ../utils/promotionLogic.js

function getScreenStats(metrics: Partial<SessionMetrics>): { screenPath: string[]; uniqueScreenCount: number } {
    const screenPath = normalizeScreenPath(metrics.screensVisited ?? []);
    const uniqueScreenCount = metrics.screenCount ?? getUniqueScreenCount(screenPath);
    return { screenPath, uniqueScreenCount };
}

/**
 * Evaluate whether a session should be promoted for replay upload.
 * 
 * Decision order (with rate limiting at each step):
 * 1. HARD PROMOTE - Critical issues (always record):
 *    - Crashes (crashCount >= 1)
 *    - ANRs (anrCount >= 1)
 *    - High API latency (avgApiLatencyMs >= 1000ms)
 *    - Slow startup (startupTimeMs >= 3000ms)
 *    - Rage taps (rageTapCount >= 2) - HIGH rate limit since user-driven
 * 
 * 2. SOFT PROMOTE - Quality scoring (combined signal threshold):
 *    - Multiple minor issues that together indicate problems
 *    - Score >= 0.5 triggers promotion
 * 
 * 3. RANDOM SAMPLE - Baseline visibility:
 *    - Project-configured sample rate for baseline data
 * 
 * Rate limits are calibrated per reason:
 * - Systemic issues (crash, ANR, API errors): Lower limits
 * - User-driven signals (rage taps): MUCH higher limits
 */
export async function evaluateReplayPromotion(
    projectId: string,
    metrics: Partial<SessionMetrics>,
    healthyReplaysPromoted: number = 0.05
): Promise<PromotionResult> {
    const { HARD_PROMOTE_THRESHOLDS: T } = await import('./replayPromotion.js');

    // =========================================================================
    // HARD PROMOTE: Crashes (highest priority)
    // =========================================================================
    if ((metrics.crashCount ?? 0) >= T.crashCount) {
        if (await isRateLimited(projectId, 'crash')) {
            logger.info({ projectId, crashCount: metrics.crashCount }, 'Replay rate limit hit for crash');
            return { promoted: false, reason: 'rate_limited' };
        }
        await incrementRateCounter(projectId, 'crash');
        logger.debug({ projectId, crashCount: metrics.crashCount }, 'Session promoted: crash');
        return { promoted: true, reason: 'crash' };
    }

    // =========================================================================
    // HARD PROMOTE: ANRs
    // =========================================================================
    if ((metrics.anrCount ?? 0) >= T.anrCount) {
        if (await isRateLimited(projectId, 'anr')) {
            logger.info({ projectId, anrCount: metrics.anrCount }, 'Replay rate limit hit for ANR');
            return { promoted: false, reason: 'rate_limited' };
        }
        await incrementRateCounter(projectId, 'anr');
        logger.debug({ projectId, anrCount: metrics.anrCount }, 'Session promoted: ANR');
        return { promoted: true, reason: 'anr' };
    }

    // =========================================================================
    // HARD PROMOTE: High API Latency (performance issue)
    // =========================================================================
    const adaptiveAdjustment = await getAdaptiveScaleFactor(projectId);

    if ((metrics.avgApiLatencyMs ?? 0) >= T.avgApiLatencyMs) {
        if (await isRateLimited(projectId, 'high_latency')) {
            logger.info({ projectId, avgApiLatencyMs: metrics.avgApiLatencyMs }, 'Replay rate limit hit for high latency');
            return { promoted: false, reason: 'rate_limited' };
        }
        await incrementRateCounter(projectId, 'high_latency');
        logger.debug({ projectId, avgApiLatencyMs: metrics.avgApiLatencyMs }, 'Session promoted: high API latency');
        return { promoted: true, reason: 'high_latency' };
    }

    // =========================================================================
    // HARD PROMOTE: Slow Startup (UX issue)
    // =========================================================================
    if ((metrics.startupTimeMs ?? 0) >= T.startupTimeMs) {
        if (await isRateLimited(projectId, 'slow_startup')) {
            logger.info({ projectId, startupTimeMs: metrics.startupTimeMs }, 'Replay rate limit hit for slow startup');
            return { promoted: false, reason: 'rate_limited' };
        }
        await incrementRateCounter(projectId, 'slow_startup');
        logger.debug({ projectId, startupTimeMs: metrics.startupTimeMs }, 'Session promoted: slow startup');
        return { promoted: true, reason: 'slow_startup' };
    }

    // =========================================================================
    // HARD PROMOTE: Rage Taps (user frustration - HIGH rate limit!)
    // Even a single rage tap is valuable signal now.
    // =========================================================================
    if ((metrics.rageTapCount ?? 0) >= T.rageTapCount) {
        if (await isRateLimited(projectId, 'rage_tap')) {
            logger.info({ projectId, rageTapCount: metrics.rageTapCount }, 'Replay rate limit hit for rage tap');
            return { promoted: false, reason: 'rate_limited' };
        }
        await incrementRateCounter(projectId, 'rage_tap');
        logger.debug({ projectId, rageTapCount: metrics.rageTapCount }, 'Session promoted: rage taps');
        return { promoted: true, reason: 'rage_tap' };
    }

    // =========================================================================
    // HARD PROMOTE: Dead Taps (unresponsive UI elements)
    // 3+ dead taps means the user repeatedly hit broken/disabled elements.
    // =========================================================================
    if ((metrics.deadTapCount ?? 0) >= T.deadTapCount) {
        if (await isRateLimited(projectId, 'dead_tap')) {
            logger.info({ projectId, deadTapCount: metrics.deadTapCount }, 'Replay rate limit hit for dead tap');
            return { promoted: false, reason: 'rate_limited' };
        }
        await incrementRateCounter(projectId, 'dead_tap');
        logger.debug({ projectId, deadTapCount: metrics.deadTapCount }, 'Session promoted: dead taps');
        return { promoted: true, reason: 'dead_tap' };
    }

    // =========================================================================
    // HARD PROMOTE: API Errors (network/backend issues)
    // Any API error is worth capturing to debug backend issues.
    // =========================================================================
    if ((metrics.apiErrorCount ?? 0) >= T.apiErrorCount) {
        if (await isRateLimited(projectId, 'api_error')) {
            logger.info({ projectId, apiErrorCount: metrics.apiErrorCount }, 'Replay rate limit hit for API errors');
            return { promoted: false, reason: 'rate_limited' };
        }
        await incrementRateCounter(projectId, 'api_error');
        logger.debug({ projectId, apiErrorCount: metrics.apiErrorCount }, 'Session promoted: API errors');
        return { promoted: true, reason: 'high_latency' }; // Reuse existing reason type
    }

    // =========================================================================
    // HARD PROMOTE: Stuck on First Screen (entry flow dropoff)
    // =========================================================================
    const { screenPath, uniqueScreenCount } = getScreenStats(metrics);
    const durationSeconds = metrics.durationSeconds ?? 0;
    const entryFlowProfile = screenPath.length > 0
        && screenPath.length <= T.maxScreensForFirstScreen
        && durationSeconds >= T.minDurationSecondsForFirstScreen
        ? await getProjectFlowProfile(projectId)
        : null;
    const entryScreens = entryFlowProfile?.entryScreens
        ?? (entryFlowProfile?.dominantPath?.length ? [entryFlowProfile.dominantPath[0]] : []);
    const firstScreen = screenPath[0];
    const isEntryScreen = Boolean(firstScreen && (entryScreens.length > 0 ? entryScreens.includes(firstScreen) : true));

    if (
        isEntryScreen
        && screenPath.length <= T.maxScreensForFirstScreen
        && durationSeconds >= T.minDurationSecondsForFirstScreen
    ) {
        if (await isRateLimited(projectId, 'stuck_first_screen')) {
            logger.info({ projectId, firstScreen, durationSeconds }, 'Replay rate limit hit for first screen stuck');
            return { promoted: false, reason: 'rate_limited' };
        }
        await incrementRateCounter(projectId, 'stuck_first_screen');
        logger.debug({ projectId, firstScreen, durationSeconds }, 'Session promoted: stuck on first screen');
        return { promoted: true, reason: 'stuck_first_screen' };
    }

    // =========================================================================
    // HARD PROMOTE: Low Exploration (user stuck/confused)
    // If user spent 2+ minutes but visited very few screens (< 0.5 screens/min),
    // they may be confused or stuck on a particular flow.
    // This captures UX issues that don't manifest as rage taps.
    // =========================================================================
    const durationMinutes = durationSeconds / 60;
    const screenCount = uniqueScreenCount;
    if (durationMinutes >= T.minDurationSecondsForExploration / 60 && screenCount > 0) {
        const screensPerMinute = screenCount / durationMinutes;
        if (screensPerMinute < T.screensPerMinuteThreshold) {
            if (await isRateLimited(projectId, 'low_exploration')) {
                logger.info({ projectId, screensPerMinute, screenCount, durationMinutes }, 'Replay rate limit hit for low exploration');
                return { promoted: false, reason: 'rate_limited' };
            }
            await incrementRateCounter(projectId, 'low_exploration');
            logger.debug({ projectId, screensPerMinute, screenCount, durationMinutes }, 'Session promoted: low exploration');
            return { promoted: true, reason: 'low_exploration' };
        }
    }

    // =========================================================================
    // HARD PROMOTE: Failed Funnel (User dropped off happy path)
    // =========================================================================
    const { db, projectFunnelStats } = await import('../db/client.js');
    const { eq } = await import('drizzle-orm');

    // Fetch learned funnel for project
    const [funnelStats] = await db
        .select()
        .from(projectFunnelStats)
        .where(eq(projectFunnelStats.projectId, projectId))
        .limit(1);

    if (funnelStats && funnelStats.funnelPath && funnelStats.funnelPath.length > 0) {
        const sessionPath = screenPath.length > 0 ? screenPath : (metrics.screensVisited || []);
        const happyPath = funnelStats.funnelPath;
        const targetScreen = funnelStats.targetScreen;

        // Check if session followed the start of the funnel
        // e.g. Happy Path: [A, B, C, D]
        // Session: [A, B, X] -> Failed!
        // Session: [A, B, C, D] -> Success (don't promote)

        // 1. Must match at least the first 2 steps to be considered "entering the funnel"
        const minMatch = Math.min(2, happyPath.length - 1);
        let matchesStart = true;

        if (sessionPath.length >= minMatch) {
            for (let i = 0; i < minMatch; i++) {
                if (sessionPath[i] !== happyPath[i]) {
                    matchesStart = false;
                    break;
                }
            }
        } else {
            matchesStart = false;
        }

        // 2. Did they reach the target?
        const reachedTarget = sessionPath.includes(targetScreen);

        if (matchesStart && !reachedTarget) {
            // They started the funnel but didn't finish!
            if (await isRateLimited(projectId, 'failed_funnel')) {
                logger.info({ projectId }, 'Replay rate limit hit for failed funnel');
                return { promoted: false, reason: 'rate_limited' };
            }
            await incrementRateCounter(projectId, 'failed_funnel');
            logger.debug({ projectId, sessionPath, happyPath }, 'Session promoted: failed funnel');
            return { promoted: true, reason: 'failed_funnel' };
        }
    }

    // =========================================================================
    // SOFT PROMOTE: Score-based (combined signals)
    // =========================================================================
    const score = calculatePromotionScore(metrics);
    if (score >= SCORE_THRESHOLD) {
        if (await isRateLimited(projectId, 'score')) {
            logger.info({ projectId, score }, 'Replay rate limit hit for score');
            return { promoted: false, reason: 'rate_limited', score };
        }
        await incrementRateCounter(projectId, 'score');
        logger.debug({ projectId, score }, 'Session promoted: score threshold');
        return { promoted: true, reason: 'score', score };
    }

    // =========================================================================
    // RANDOM SAMPLING: Baseline visibility
    // Default to a dynamic sample rate based on project scale
    // =========================================================================
    const baseSampleRate = healthyReplaysPromoted;
    const effectiveSampleRate = baseSampleRate * adaptiveAdjustment;

    if (Math.random() < effectiveSampleRate) {
        if (await isRateLimited(projectId, 'sample')) {
            logger.info({ projectId }, 'Replay rate limit hit for sample');
            return { promoted: false, reason: 'rate_limited', score };
        }
        await incrementRateCounter(projectId, 'sample');
        logger.debug({ projectId }, 'Session promoted: random sample');
        return { promoted: true, reason: 'sample', score };
    }

    return { promoted: false, reason: 'not_promoted', score };
}

/**
 * Evaluate replay promotion with quota checks.
 * 
 * Wraps evaluateReplayPromotion with additional project quota validation:
 * - recordingEnabled: Recording must be enabled for the project
 * - maxRecordingMinutes: Session duration must not exceed project limit
 */
export async function evaluateReplayPromotionWithQuota(
    projectId: string,
    metrics: Partial<SessionMetrics>,
    healthyReplaysPromoted: number,
    quota: QuotaConfig
): Promise<PromotionResult> {
    // Check if recording is enabled for this project
    if (!quota.recordingEnabled) {
        logger.debug({ projectId }, 'Replay not promoted: recording disabled');
        return { promoted: false, reason: 'recording_disabled' };
    }

    // Check if session exceeds max recording limit
    const durationMinutes = (metrics.durationSeconds ?? 0) / 60;
    if (durationMinutes > quota.maxRecordingMinutes) {
        logger.debug(
            { projectId, durationMinutes, maxRecordingMinutes: quota.maxRecordingMinutes },
            'Replay not promoted: session exceeds max recording minutes'
        );
        return { promoted: false, reason: 'quota_exceeded' };
    }

    // If promotion logic is disabled, always promote eligible sessions without applying heuristics.
    if (!USE_PROMOTION_LOGIC) {
        return { promoted: true, reason: 'sample', score: 1 };
    }

    // Delegate to main evaluation logic
    return evaluateReplayPromotion(projectId, metrics, healthyReplaysPromoted);
}


/**
 * Evaluate and promote a session for replay.
 * This is THE single function that handles all promotion logic.
 * Can be called from API routes or from the ingest worker.
 * 
 * @returns { promoted: boolean; reason: string; score?: number }
 */
export async function evaluateAndPromoteSession(
    sessionId: string,
    projectId: string,
    durationSeconds: number
): Promise<{ promoted: boolean; reason: string; score?: number }> {
    const { db, sessions, sessionMetrics, projects } = await import('../db/client.js');
    const { eq } = await import('drizzle-orm');

    // 1. Fetch the latest session state and metrics
    const [sessionResult] = await db
        .select({
            session: sessions,
            metrics: sessionMetrics,
        })
        .from(sessions)
        .leftJoin(sessionMetrics, eq(sessions.id, sessionMetrics.sessionId))
        .where(eq(sessions.id, sessionId))
        .limit(1);

    if (!sessionResult) {
        return { promoted: false, reason: 'session_not_found' };
    }

    const session = sessionResult.session;
    const metrics = sessionResult.metrics;

    // 3. Already promoted - return early (but still calculate score for updates if needed)
    if (session.replayPromoted) {
        return { promoted: true, reason: session.replayPromotedReason || 'already_promoted' };
    }

    // 4. No screenshot segments - nothing to promote.
    const screenshotSegmentCount = metrics?.screenshotSegmentCount ?? 0;
    const hasRecordingData = screenshotSegmentCount > 0;

    // RULE: Require screenshot replay data for promotion.
    // Sessions without any visual replay data should not be promoted.
    if (!hasRecordingData) {
        return { promoted: false, reason: 'no_recording_data' };
    }

    // 5. Get project config
    const [project] = await db
        .select({
            healthyReplaysPromoted: projects.healthyReplaysPromoted,
            recordingEnabled: projects.recordingEnabled,
            maxRecordingMinutes: projects.maxRecordingMinutes,
        })
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1);

    // 6. Build evaluation metrics from the fully processed session data
    const screenPath = normalizeScreenPath(metrics?.screensVisited ?? []);
    const evaluationMetrics = {
        crashCount: metrics?.crashCount ?? 0,
        anrCount: metrics?.anrCount ?? 0,
        apiErrorCount: metrics?.apiErrorCount ?? 0,
        errorCount: metrics?.errorCount ?? 0,
        rageTapCount: metrics?.rageTapCount ?? 0,
        avgApiLatencyMs: metrics?.apiAvgResponseMs ?? 0,
        startupTimeMs: metrics?.appStartupTimeMs ?? 0,
        durationSeconds: durationSeconds,
        touchCount: metrics?.touchCount ?? 0,
        scrollCount: metrics?.scrollCount ?? 0,
        gestureCount: metrics?.gestureCount ?? 0,
        customEventCount: metrics?.customEventCount ?? 0,
        isConstrained: metrics?.isConstrained ?? false,
        isExpensive: metrics?.isExpensive ?? false,
        interactionScore: metrics?.interactionScore ?? 0,
        explorationScore: metrics?.explorationScore ?? 0,
        screensVisited: metrics?.screensVisited ?? [],
        screenCount: getUniqueScreenCount(screenPath),
    };

    const quotaConfig: QuotaConfig = {
        recordingEnabled: project?.recordingEnabled ?? true,
        maxRecordingMinutes: project?.maxRecordingMinutes ?? 10,
    };

    // 7. Evaluate promotion
    const result = await evaluateReplayPromotionWithQuota(
        projectId,
        evaluationMetrics,
        project?.healthyReplaysPromoted ?? 0.05,
        quotaConfig
    );

    // 8. Update the session with score and promotion status
    const updateData: any = {
        replayPromotionScore: result.score || 0,
        updatedAt: new Date(),
    };

    if (result.promoted) {
        updateData.replayPromoted = true;
        updateData.replayPromotedReason = result.reason;
        updateData.replayPromotedAt = new Date();
    }

    await db.update(sessions)
        .set(updateData)
        .where(eq(sessions.id, sessionId));

    if (result.promoted) {
        logger.info({
            sessionId,
            reason: result.reason,
            score: result.score,
            screenshotSegmentCount,
        }, 'Session promoted for replay');
    }

    return result;
}
