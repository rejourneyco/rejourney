/**
 * Billing Utility Tests
 * 
 * Tests for pure billing utility functions that don't require Stripe API keys.
 * These test business logic, calculations, and formatting functions.
 */

import { describe, it, expect } from 'vitest';
import {
    calculateSessionUsage,
    calculateFreeTierAllocation,
    isFreeTierExhausted,
    getFreeTierUsage,
    canRecord,
    getTeamBillingPeriod,
    getTeamBillingPeriodDates,
    formatCentsAsDollars,
    formatSessionCount,
    FREE_TIER_SESSIONS,
    WARNING_THRESHOLD_PERCENT,
} from '../utils/billing.js';

describe('Billing Utilities', () => {
    describe('calculateSessionUsage', () => {
        it('should calculate usage correctly', () => {
            const usage = calculateSessionUsage(1000, 5000);
            
            expect(usage.used).toBe(1000);
            expect(usage.limit).toBe(5000);
            expect(usage.remaining).toBe(4000);
            expect(usage.percentUsed).toBe(20);
            expect(usage.isAtLimit).toBe(false);
            expect(usage.isNearLimit).toBe(false);
        });

        it('should handle at limit', () => {
            const usage = calculateSessionUsage(5000, 5000);
            
            expect(usage.remaining).toBe(0);
            expect(usage.percentUsed).toBe(100);
            expect(usage.isAtLimit).toBe(true);
            expect(usage.isNearLimit).toBe(true);
        });

        it('should handle over limit', () => {
            const usage = calculateSessionUsage(6000, 5000);
            
            expect(usage.remaining).toBe(0);
            expect(usage.percentUsed).toBe(100);
            expect(usage.isAtLimit).toBe(true);
        });

        it('should detect near limit (>= 80%)', () => {
            const usage80 = calculateSessionUsage(4000, 5000);
            expect(usage80.percentUsed).toBe(80);
            expect(usage80.isNearLimit).toBe(true);

            const usage85 = calculateSessionUsage(4250, 5000);
            expect(usage85.percentUsed).toBe(85);
            expect(usage85.isNearLimit).toBe(true);

            const usage79 = calculateSessionUsage(3950, 5000);
            expect(usage79.percentUsed).toBe(79);
            expect(usage79.isNearLimit).toBe(false);
        });

        it('should handle zero limit', () => {
            const usage = calculateSessionUsage(100, 0);
            
            expect(usage.remaining).toBe(0);
            expect(usage.percentUsed).toBe(0);
            expect(usage.isAtLimit).toBe(true);
        });

        it('should handle zero usage', () => {
            const usage = calculateSessionUsage(0, 5000);
            
            expect(usage.remaining).toBe(5000);
            expect(usage.percentUsed).toBe(0);
            expect(usage.isAtLimit).toBe(false);
            expect(usage.isNearLimit).toBe(false);
        });
    });

    describe('calculateFreeTierAllocation', () => {
        it('should allocate all to free tier when under limit', () => {
            const allocation = calculateFreeTierAllocation(1000, 1);
            
            expect(allocation.freeSessions).toBe(1);
            expect(allocation.billableSessions).toBe(0);
        });

        it('should split between free and billable when near limit', () => {
            const allocation = calculateFreeTierAllocation(4999, 5);
            
            expect(allocation.freeSessions).toBe(1);
            expect(allocation.billableSessions).toBe(4);
        });

        it('should allocate all to billable when free tier exhausted', () => {
            const allocation = calculateFreeTierAllocation(5000, 10);
            
            expect(allocation.freeSessions).toBe(0);
            expect(allocation.billableSessions).toBe(10);
        });

        it('should handle exactly at limit', () => {
            const allocation = calculateFreeTierAllocation(4999, 1);
            
            expect(allocation.freeSessions).toBe(1);
            expect(allocation.billableSessions).toBe(0);
        });

        it('should handle zero new sessions', () => {
            const allocation = calculateFreeTierAllocation(1000, 0);
            
            expect(allocation.freeSessions).toBe(0);
            expect(allocation.billableSessions).toBe(0);
        });

        it('should handle large batch allocation', () => {
            const allocation = calculateFreeTierAllocation(3000, 5000);
            
            expect(allocation.freeSessions).toBe(2000); // Remaining free tier
            expect(allocation.billableSessions).toBe(3000); // Rest is billable
        });
    });

    describe('isFreeTierExhausted', () => {
        it('should return false when under limit', () => {
            expect(isFreeTierExhausted(1000)).toBe(false);
            expect(isFreeTierExhausted(4999)).toBe(false);
        });

        it('should return true when at limit', () => {
            expect(isFreeTierExhausted(5000)).toBe(true);
        });

        it('should return true when over limit', () => {
            expect(isFreeTierExhausted(6000)).toBe(true);
        });

        it('should handle zero usage', () => {
            expect(isFreeTierExhausted(0)).toBe(false);
        });
    });

    describe('getFreeTierUsage', () => {
        it('should return usage stats for free tier', () => {
            const usage = getFreeTierUsage(2500);
            
            expect(usage.limit).toBe(FREE_TIER_SESSIONS);
            expect(usage.used).toBe(2500);
            expect(usage.remaining).toBe(2500);
            expect(usage.percentUsed).toBe(50);
        });

        it('should handle exhausted free tier', () => {
            const usage = getFreeTierUsage(5000);
            
            expect(usage.remaining).toBe(0);
            expect(usage.percentUsed).toBe(100);
            expect(usage.isAtLimit).toBe(true);
        });
    });

    describe('canRecord', () => {
        it('should return true when under limit', () => {
            expect(canRecord(1000, 5000)).toBe(true);
            expect(canRecord(4999, 5000)).toBe(true);
        });

        it('should return false when at limit', () => {
            expect(canRecord(5000, 5000)).toBe(false);
        });

        it('should return false when over limit', () => {
            expect(canRecord(6000, 5000)).toBe(false);
        });

        it('should handle zero usage', () => {
            expect(canRecord(0, 5000)).toBe(true);
        });

        it('should handle zero limit', () => {
            expect(canRecord(0, 0)).toBe(false);
            expect(canRecord(100, 0)).toBe(false);
        });
    });

    describe('getTeamBillingPeriod', () => {
        it('should return current month format when no anchor', () => {
            const period = getTeamBillingPeriod(null);
            const now = new Date();
            const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
            
            expect(period).toBe(expected);
        });

        it('should calculate period from anchor date', () => {
            // Anchor on Jan 1, 2024
            const anchor = new Date('2024-01-01T00:00:00Z');
            const period = getTeamBillingPeriod(anchor);
            
            // Should be in format YYYY-MM-DD
            expect(period).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        });

        it('should handle anchor in same 30-day cycle', () => {
            const anchor = new Date();
            anchor.setDate(anchor.getDate() - 10); // 10 days ago
            
            const period = getTeamBillingPeriod(anchor);
            expect(period).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        });

        it('should handle anchor in previous cycle', () => {
            const anchor = new Date();
            anchor.setDate(anchor.getDate() - 35); // 35 days ago (next cycle)
            
            const period = getTeamBillingPeriod(anchor);
            expect(period).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        });
    });

    describe('getTeamBillingPeriodDates', () => {
        it('should return calendar month when no anchor', () => {
            const now = new Date();
            const { start, end, periodString } = getTeamBillingPeriodDates(null);
            
            expect(start.getFullYear()).toBe(now.getFullYear());
            expect(start.getMonth()).toBe(now.getMonth());
            expect(start.getDate()).toBe(1);
            expect(start.getHours()).toBe(0);
            expect(start.getMinutes()).toBe(0);
            
            // End should be last day of month
            const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
            expect(end.getDate()).toBe(lastDay.getDate());
            expect(end.getHours()).toBe(23);
            expect(end.getMinutes()).toBe(59);
            
            expect(periodString).toMatch(/^\d{4}-\d{2}$/);
        });

        it('should calculate 30-day cycle from anchor', () => {
            const anchor = new Date('2024-01-01T00:00:00Z');
            const { start, end, periodString } = getTeamBillingPeriodDates(anchor);
            
            expect(start).toBeInstanceOf(Date);
            expect(end).toBeInstanceOf(Date);
            expect(end.getTime()).toBeGreaterThan(start.getTime());
            
            // Should be approximately 30 days apart
            const daysDiff = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
            expect(daysDiff).toBeCloseTo(30, 0);
            
            expect(periodString).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        });

        it('should handle anchor in middle of cycle', () => {
            const anchor = new Date('2024-01-15T12:00:00Z');
            const { start, end } = getTeamBillingPeriodDates(anchor);
            
            // Start should be beginning of current cycle
            expect(start.getHours()).toBe(0);
            expect(start.getMinutes()).toBe(0);
            expect(start.getSeconds()).toBe(0);
            
            // End should be ~30 days later
            const daysDiff = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
            expect(daysDiff).toBeCloseTo(30, 0);
        });
    });

    describe('formatCentsAsDollars', () => {
        it('should format cents correctly', () => {
            expect(formatCentsAsDollars(0)).toBe('$0.00');
            expect(formatCentsAsDollars(100)).toBe('$1.00');
            expect(formatCentsAsDollars(500)).toBe('$5.00');
            expect(formatCentsAsDollars(1999)).toBe('$19.99');
            expect(formatCentsAsDollars(10000)).toBe('$100.00');
        });

        it('should handle large amounts', () => {
            expect(formatCentsAsDollars(100000)).toBe('$1000.00');
            expect(formatCentsAsDollars(999999)).toBe('$9999.99');
        });

        it('should handle fractional cents', () => {
            // Note: function uses toFixed(2), so it will round
            expect(formatCentsAsDollars(1)).toBe('$0.01');
            expect(formatCentsAsDollars(99)).toBe('$0.99');
        });
    });

    describe('formatSessionCount', () => {
        it('should format small numbers', () => {
            expect(formatSessionCount(0)).toBe('0');
            expect(formatSessionCount(1)).toBe('1');
            expect(formatSessionCount(100)).toBe('100');
        });

        it('should format with commas', () => {
            expect(formatSessionCount(1000)).toBe('1,000');
            expect(formatSessionCount(10000)).toBe('10,000');
            expect(formatSessionCount(100000)).toBe('100,000');
            expect(formatSessionCount(1000000)).toBe('1,000,000');
        });

        it('should handle large numbers', () => {
            expect(formatSessionCount(5000000)).toBe('5,000,000');
            expect(formatSessionCount(123456789)).toBe('123,456,789');
        });
    });

    describe('Constants', () => {
        it('should have correct free tier limit', () => {
            expect(FREE_TIER_SESSIONS).toBe(5000);
        });

        it('should have correct warning threshold', () => {
            expect(WARNING_THRESHOLD_PERCENT).toBe(80);
        });
    });

    describe('Edge Cases', () => {
        it('should handle negative usage gracefully', () => {
            const usage = calculateSessionUsage(-100, 5000);
            expect(usage.remaining).toBe(5100); // Limit + 100
            // Percent can be negative, but Math.min(100, ...) ensures it's at most 100
            expect(usage.percentUsed).toBeLessThanOrEqual(100);
        });

        it('should handle very large numbers', () => {
            const usage = calculateSessionUsage(1000000, 5000);
            expect(usage.remaining).toBe(0);
            expect(usage.percentUsed).toBe(100);
            expect(usage.isAtLimit).toBe(true);
        });

        it('should handle allocation with negative free tier used', () => {
            const allocation = calculateFreeTierAllocation(-100, 10);
            expect(allocation.freeSessions).toBe(10);
            expect(allocation.billableSessions).toBe(0);
        });
    });
});
