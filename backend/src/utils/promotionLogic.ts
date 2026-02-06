/**
 * Replay Promotion Pure Logic
 * 
 * Contains pure functions and constants for evaluating session quality.
 * This file MUST NOT import anything that has side-effects (like DB or Config).
 */

// =============================================================================
// Types
// =============================================================================

export interface SessionMetrics {
    crashCount: number;
    anrCount: number;
    apiErrorCount: number;
    errorCount: number;
    rageTapCount: number;
    deadTapCount: number;
    avgApiLatencyMs: number;
    durationSeconds: number;
    startupTimeMs: number; // App startup time in milliseconds
    // Extended metrics from session_metrics table
    touchCount?: number;
    scrollCount?: number;
    gestureCount?: number;
    apiSuccessCount?: number;
    apiTotalCount?: number;
    interactionScore?: number;
    explorationScore?: number;
    uxScore?: number;
    frameCount?: number;
    screenCount?: number; // Number of unique screens visited
    customEventCount?: number;
    screensVisited?: string[]; // Adding screensVisited for funnel analysis
    networkType?: string;
    isConstrained?: boolean; // Low data mode
    isExpensive?: boolean; // Metered connection
}

// =============================================================================
// Configuration
// =============================================================================

/**
 * Soft promote conditions with weights.
 * Session is promoted if total score >= SCORE_THRESHOLD.
 */
export const SOFT_CONDITIONS = [
    // Error conditions - any errors are worth capturing
    { field: 'apiErrorCount', threshold: 1, weight: 0.4 },
    { field: 'errorCount', threshold: 1, weight: 0.35 },

    // Performance conditions - relaxed thresholds
    { field: 'avgApiLatencyMs', threshold: 300, weight: 0.3 },
    { field: 'startupTimeMs', threshold: 1500, weight: 0.25 },

    // Engagement signals (interesting sessions)
    { field: 'durationSeconds', threshold: 120, weight: 0.2 }, // 2+ minute sessions (was 5)
    { field: 'customEventCount', threshold: 2, weight: 0.15 }, // Sessions with custom events (was 5)

    // Network issues (constrained environments)
    { field: 'isConstrained', threshold: 1, weight: 0.2 }, // Low data mode
    { field: 'isExpensive', threshold: 1, weight: 0.15 },  // Metered connection

    // Low engagement (potential UX issues)
    { field: 'touchCount', threshold: 5, weight: -0.15, inverse: true }, // Very few touches might indicate confusion
] as const;

export const SCORE_THRESHOLD = 0.25; // Lowered from 0.3 for more "trigger happy" promotion

// =============================================================================
// Promotion Logic
// =============================================================================

/**
 * Calculate soft promotion score based on session metrics.
 */
export function calculatePromotionScore(metrics: Partial<SessionMetrics>): number {
    let score = 0;

    // 1. Fixed conditions from SOFT_CONDITIONS
    for (const cond of SOFT_CONDITIONS) {
        const value = (metrics as any)[cond.field] ?? 0;
        const isInverse = (cond as any).inverse === true;

        if (isInverse) {
            if (value > 0 && value < cond.threshold) {
                score += cond.weight;
            }
        } else {
            if (value >= cond.threshold) {
                score += cond.weight;
            }
        }
    }

    // 2. Interaction Density Signal (Taps + Scrolls per Minute)
    const durationMins = (metrics.durationSeconds ?? 0) / 60;
    if (durationMins > 0.1) { // Only for sessions long enough to measure
        const interactionCount = (metrics.touchCount ?? 0) + (metrics.scrollCount ?? 0) * 0.5;
        const density = interactionCount / durationMins;

        if (density > 15) { // Highly active session
            score += 0.2;
        } else if (density > 5) { // Moderately active
            score += 0.1;
        }
    }

    // 3. API Frustration Signal (Failure Rate)
    const apiTotal = metrics.apiTotalCount ?? 0;
    const apiErrors = metrics.apiErrorCount ?? 0;
    if (apiTotal >= 3) { // Enough samples to be meaningful
        const failureRate = apiErrors / apiTotal;
        if (failureRate > 0.2) { // 20%+ failure rate is frustrating
            score += 0.25;
        } else if (failureRate > 0) {
            score += 0.1;
        }
    }

    // 4. Discovery Signal (Variety of screens)
    if (metrics.screenCount && metrics.screenCount >= 3) {
        score += 0.15;
    }

    return Math.max(0, score); // Clamp to non-negative
}
