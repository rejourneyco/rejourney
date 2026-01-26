import { describe, it, expect } from 'vitest';
import { calculatePromotionScore } from '../utils/promotionLogic.js';

describe('calculatePromotionScore', () => {
    it('should promote sessions with high interaction density', () => {
        const score = calculatePromotionScore({
            durationSeconds: 60,
            touchCount: 20, // 20 taps/min
            scrollCount: 0
        });
        // Combined fixed weight (duration > 120s is 0.2, <5 touches is -0.15)
        // Here duration is 60 (no fixed weight). touchCount is 20 (no fixed weight).
        // Density 20 > 15 -> +0.2
        expect(score).toBeGreaterThanOrEqual(0.2);
    });

    it('should promote sessions with high API failure rate', () => {
        const score = calculatePromotionScore({
            apiTotalCount: 10,
            apiErrorCount: 3 // 30% failure rate
        });
        // Density 0. apiTotal < 3 check? Oh, wait, I set apiTotal >= 3.
        // failureRate 3/10 = 0.3 > 0.2 -> +0.25
        // SOFT_CONDITIONS: apiErrorCount >= 1 -> +0.4
        // Total expected: 0.4 + 0.25 = 0.65
        expect(score).toBeGreaterThanOrEqual(0.6);
    });

    it('should promote sessions with poor network stats even if short', () => {
        const score = calculatePromotionScore({
            durationSeconds: 30,
            apiTotalCount: 5,
            apiErrorCount: 2, // 40% failure
            isConstrained: true
        });
        // apiErrorCount >= 1 -> +0.4
        // isConstrained -> +0.2
        // failureRate 0.4 > 0.2 -> +0.25
        // Total: 0.85
        expect(score).toBeGreaterThanOrEqual(0.8);
    });

    it('should NOT promote empty short sessions', () => {
        const score = calculatePromotionScore({
            durationSeconds: 5,
            touchCount: 0,
            scrollCount: 0
        });
        expect(score).toBe(0);
    });
});
