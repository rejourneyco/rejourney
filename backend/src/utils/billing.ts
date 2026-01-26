/**
 * Billing Constants and Pure Functions
 * 
 * This module contains pure utility functions for session-based billing.
 * 
 * NOTE: Billing plans are now managed via Stripe Products/Prices.
 * Use the stripeProducts service for plan-related operations.
 * 
 * This module provides:
 * - Session usage calculations
 * - Free tier constants (per-user tracking)
 * - Billing period utilities
 * - Formatting helpers
 */

// =============================================================================
// Types
// =============================================================================

export interface SessionUsage {
    used: number;
    limit: number;
    remaining: number;
    percentUsed: number;
    isAtLimit: boolean;
    isNearLimit: boolean; // >= 80%
}

export interface FreeTierAllocation {
    freeSessions: number;
    billableSessions: number;
}

// =============================================================================
// Free Tier Constants
// =============================================================================

/**
 * Free tier session limit (per user across all owned teams)
 * This is the only "plan" that's not in Stripe - tracked locally.
 */
export const FREE_TIER_SESSIONS = 5000;

/**
 * Warning threshold percentage (send alert when usage hits this)
 */
export const WARNING_THRESHOLD_PERCENT = 80;

// =============================================================================
// Session Usage Functions
// =============================================================================

/**
 * Calculate session usage statistics
 * 
 * @param used - Sessions used in current period
 * @param limit - Session limit for the plan
 * @returns Usage statistics including remaining, percent, and status flags
 */
export function calculateSessionUsage(used: number, limit: number): SessionUsage {
    const remaining = Math.max(0, limit - used);
    const percentUsed = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;

    return {
        used,
        limit,
        remaining,
        percentUsed,
        isAtLimit: used >= limit,
        isNearLimit: percentUsed >= WARNING_THRESHOLD_PERCENT,
    };
}

/**
 * Calculate how many sessions of a new recording count against free tier vs billable
 * 
 * @param currentFreeTierUsed - Sessions already used from user's free tier
 * @param newSessions - New sessions to allocate (typically 1)
 * @returns Breakdown of free vs billable sessions
 */
export function calculateFreeTierAllocation(
    currentFreeTierUsed: number,
    newSessions: number = 1
): FreeTierAllocation {
    const remaining = Math.max(0, FREE_TIER_SESSIONS - currentFreeTierUsed);
    const freeSessions = Math.min(remaining, newSessions);
    const billableSessions = newSessions - freeSessions;

    return { freeSessions, billableSessions };
}

/**
 * Check if a user has exhausted their free tier
 * 
 * @param freeTierSessionsUsed - Sessions used from free tier
 * @returns true if free tier is exhausted
 */
export function isFreeTierExhausted(freeTierSessionsUsed: number): boolean {
    return freeTierSessionsUsed >= FREE_TIER_SESSIONS;
}

/**
 * Get free tier usage status for a user
 * 
 * @param freeTierSessionsUsed - Sessions used from free tier
 * @returns Usage statistics for free tier
 */
export function getFreeTierUsage(freeTierSessionsUsed: number): SessionUsage {
    return calculateSessionUsage(freeTierSessionsUsed, FREE_TIER_SESSIONS);
}

/**
 * Check if a team can record based on session limit
 * 
 * @param sessionsUsed - Sessions used this period
 * @param sessionLimit - Plan's session limit
 * @returns true if team can record (under limit)
 */
export function canRecord(sessionsUsed: number, sessionLimit: number): boolean {
    return sessionsUsed < sessionLimit;
}

// =============================================================================
// Billing Period Utilities
// =============================================================================

/**
 * Get current billing period string (YYYY-MM format) for calendar-based billing
 * @deprecated Use getTeamBillingPeriod for team-specific billing cycles
 */
export function getCurrentBillingPeriod(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Get billing period for a team based on their cycle anchor
 * Billing cycles are 30 days starting from the anchor date
 * 
 * @param anchor - Team's billing cycle anchor date (when they signed up or last upgraded)
 * @returns Period string in format YYYY-MM-DD (anchor date of current cycle)
 */
export function getTeamBillingPeriod(anchor: Date | null): string {
    const now = new Date();

    // If no anchor, use first of current month (legacy behavior)
    if (!anchor) {
        return getCurrentBillingPeriod();
    }

    // Calculate which 30-day cycle we're in
    const anchorTime = anchor.getTime();
    const nowTime = now.getTime();
    const daysSinceAnchor = Math.floor((nowTime - anchorTime) / (1000 * 60 * 60 * 24));

    // How many complete 30-day cycles have passed?
    const cycleNumber = Math.floor(daysSinceAnchor / 30);

    // Current cycle start = anchor + (cycleNumber * 30 days)
    const currentCycleStart = new Date(anchorTime + (cycleNumber * 30 * 24 * 60 * 60 * 1000));

    // Format as YYYY-MM-DD for uniqueness
    return `${currentCycleStart.getFullYear()}-${String(currentCycleStart.getMonth() + 1).padStart(2, '0')}-${String(currentCycleStart.getDate()).padStart(2, '0')}`;
}

/**
 * Get billing period dates for a team
 * 
 * @param anchor - Team's billing cycle anchor date
 * @returns Start and end dates of current billing period
 */
export function getTeamBillingPeriodDates(anchor: Date | null): { start: Date; end: Date; periodString: string } {
    const now = new Date();

    // If no anchor, use calendar month
    if (!anchor) {
        const year = now.getFullYear();
        const month = now.getMonth();
        const start = new Date(year, month, 1, 0, 0, 0, 0);
        const end = new Date(year, month + 1, 0, 23, 59, 59, 999);
        return { start, end, periodString: getCurrentBillingPeriod() };
    }

    // Calculate current 30-day cycle
    const anchorTime = anchor.getTime();
    const nowTime = now.getTime();
    const daysSinceAnchor = Math.floor((nowTime - anchorTime) / (1000 * 60 * 60 * 24));
    const cycleNumber = Math.floor(daysSinceAnchor / 30);

    const start = new Date(anchorTime + (cycleNumber * 30 * 24 * 60 * 60 * 1000));
    start.setHours(0, 0, 0, 0);

    const end = new Date(start.getTime() + (30 * 24 * 60 * 60 * 1000) - 1);

    const periodString = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;

    return { start, end, periodString };
}

// =============================================================================
// Formatting Utilities
// =============================================================================

/**
 * Format cents as a dollar string
 * 
 * @param cents - Amount in cents
 * @returns Formatted string like "$5.00"
 */
export function formatCentsAsDollars(cents: number): string {
    return `$${(cents / 100).toFixed(2)}`;
}

/**
 * Format session count with commas
 * 
 * @param sessions - Number of sessions
 * @returns Formatted string like "5,000"
 */
export function formatSessionCount(sessions: number): string {
    return sessions.toLocaleString('en-US');
}
