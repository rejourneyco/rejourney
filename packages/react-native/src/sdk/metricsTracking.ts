/**
 * Session Metrics Module for Rejourney SDK
 * 
 * Tracks and calculates session metrics including interaction scores,
 * API performance, and user engagement metrics.
 * Split from autoTracking.ts for better code organization.
 */

/**
 * Session metrics structure
 */
export interface SessionMetrics {
    totalEvents: number;
    touchCount: number;
    scrollCount: number;
    gestureCount: number;
    inputCount: number;
    navigationCount: number;
    errorCount: number;
    rageTapCount: number;
    apiSuccessCount: number;
    apiErrorCount: number;
    apiTotalCount: number;
    netTotalDurationMs: number;
    netTotalBytes: number;
    screensVisited: string[];
    uniqueScreensCount: number;
    interactionScore: number;
    explorationScore: number;
    uxScore: number;
}

let metrics: SessionMetrics = createEmptyMetrics();
let sessionStartTime = 0;
let maxSessionDurationMs = 10 * 60 * 1000;

/**
 * Create empty metrics object
 */
export function createEmptyMetrics(): SessionMetrics {
    return {
        totalEvents: 0,
        touchCount: 0,
        scrollCount: 0,
        gestureCount: 0,
        inputCount: 0,
        navigationCount: 0,
        errorCount: 0,
        rageTapCount: 0,
        apiSuccessCount: 0,
        apiErrorCount: 0,
        apiTotalCount: 0,
        netTotalDurationMs: 0,
        netTotalBytes: 0,
        screensVisited: [],
        uniqueScreensCount: 0,
        interactionScore: 100,
        explorationScore: 100,
        uxScore: 100,
    };
}

/**
 * Reset all metrics
 */
export function resetMetrics(): void {
    metrics = createEmptyMetrics();
    sessionStartTime = 0;
}

/**
 * Initialize metrics for new session
 */
export function initMetrics(): void {
    metrics = createEmptyMetrics();
    sessionStartTime = Date.now();
}

/**
 * Get current session metrics with calculated scores
 */
export function getSessionMetrics(): SessionMetrics {
    const rawDuration = Date.now() - sessionStartTime;
    const durationMs = Math.min(rawDuration, maxSessionDurationMs);

    const interactionScore = calculateInteractionScore(durationMs);
    const explorationScore = calculateExplorationScore();
    const uxScore = calculateUXScore();

    return {
        ...metrics,
        interactionScore,
        explorationScore,
        uxScore,
    };
}

/**
 * Set max session duration (in minutes)
 */
export function setMaxSessionDurationMinutes(minutes?: number): void {
    if (minutes !== undefined && minutes > 0) {
        // Clamp to 1-10 minutes
        const clampedMinutes = Math.max(1, Math.min(10, minutes));
        maxSessionDurationMs = clampedMinutes * 60 * 1000;
    }
}

export function incrementTouchCount(): void {
    metrics.touchCount++;
    metrics.totalEvents++;
}

export function incrementScrollCount(): void {
    metrics.scrollCount++;
    metrics.totalEvents++;
}

export function incrementNavigationCount(): void {
    metrics.navigationCount++;
    metrics.totalEvents++;
}

export function incrementRageTapCount(): void {
    metrics.rageTapCount++;
}

export function incrementErrorCount(): void {
    metrics.errorCount++;
    metrics.totalEvents++;
}

export function addScreenVisited(screenName: string): void {
    metrics.screensVisited.push(screenName);
    metrics.uniqueScreensCount = new Set(metrics.screensVisited).size;
}

export function trackAPIMetrics(
    success: boolean,
    durationMs: number = 0,
    responseBytes: number = 0
): void {
    metrics.apiTotalCount++;

    if (durationMs > 0) {
        metrics.netTotalDurationMs += durationMs;
    }
    if (responseBytes > 0) {
        metrics.netTotalBytes += responseBytes;
    }

    if (success) {
        metrics.apiSuccessCount++;
    } else {
        metrics.apiErrorCount++;
        metrics.errorCount++;
    }
}

/**
 * Calculate interaction score based on engagement with app
 * Higher = more engaged (more interactions per minute)
 */
function calculateInteractionScore(durationMs: number): number {
    if (durationMs <= 0) return 100;

    const durationMinutes = durationMs / 60000;
    const interactionsPerMinute = metrics.touchCount / Math.max(0.5, durationMinutes);

    if (interactionsPerMinute < 2) return 20;
    if (interactionsPerMinute < 5) return 50;
    if (interactionsPerMinute < 10) return 70;
    if (interactionsPerMinute <= 30) return 100;
    if (interactionsPerMinute <= 60) return 80;
    return 50;
}

/**
 * Calculate exploration score based on screens visited
 * Higher = user explored more of the app
 */
function calculateExplorationScore(): number {
    const uniqueScreens = metrics.uniqueScreensCount;

    if (uniqueScreens >= 10) return 100;
    if (uniqueScreens >= 7) return 90;
    if (uniqueScreens >= 5) return 80;
    if (uniqueScreens >= 3) return 60;
    if (uniqueScreens >= 2) return 40;
    return 20;
}

/**
 * Calculate UX score based on errors and frustration
 * Higher = better experience (fewer issues)
 */
function calculateUXScore(): number {
    let score = 100;

    score -= metrics.errorCount * 10;
    score -= metrics.rageTapCount * 20;
    score -= metrics.apiErrorCount * 5;
    return Math.max(0, Math.min(100, score));
}
