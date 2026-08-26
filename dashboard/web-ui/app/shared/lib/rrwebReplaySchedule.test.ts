import { describe, expect, it } from 'vitest';
import {
    computeLoadedRanges,
    computeSegmentTimeBounds,
    pickNextPendingSegment,
    type RrwebReplaySegment,
} from './rrwebReplayLoader';

function seg(index: number, startTime: number | null = null, endTime: number | null = null): RrwebReplaySegment {
    return { index, startTime, endTime, eventCount: 1, sizeBytes: 100, url: `https://r2/${index}` };
}

describe('computeSegmentTimeBounds', () => {
    it('spans min start to max end when metadata exists', () => {
        expect(computeSegmentTimeBounds([seg(0, 1000, 2000), seg(1, 2000, 5000)])).toEqual({ min: 1000, max: 5000 });
    });

    it('returns null without usable metadata', () => {
        expect(computeSegmentTimeBounds([seg(0), seg(1)])).toBeNull();
    });
});

describe('pickNextPendingSegment', () => {
    const segments = [seg(1, 1000, 2000), seg(2, 2000, 3000), seg(3, 3000, 4000), seg(4, 4000, 5000)];
    const bounds = { min: 0, max: 5000 };

    it('loads in order when nobody has scrubbed', () => {
        expect(pickNextPendingSegment(segments, 5, null, bounds)).toBe(0);
    });

    it('jumps the queue to the segment covering the seek target', () => {
        // 70% of 0..5000 = 3500 → inside segment index 3 (position 2 in pending)
        expect(pickNextPendingSegment(segments, 5, 0.7, bounds)).toBe(2);
    });

    it('picks the nearest segment when the target falls in a gap', () => {
        const sparse = [seg(1, 1000, 1500), seg(4, 4000, 5000)];
        // 50% = 2500 → nearest is 1500 (distance 1000) vs 4000 (distance 1500)
        expect(pickNextPendingSegment(sparse, 5, 0.5, bounds)).toBe(0);
    });

    it('falls back to proportional index without time metadata', () => {
        const bare = [seg(1), seg(2), seg(3), seg(4)];
        // fraction 1.0 of 5 segments → target index 4 → last pending entry
        expect(pickNextPendingSegment(bare, 5, 1, null)).toBe(3);
    });

    it('handles an empty queue', () => {
        expect(pickNextPendingSegment([], 5, 0.5, bounds)).toBe(-1);
    });
});

describe('computeLoadedRanges', () => {
    it('maps loaded segments to timeline fractions and merges adjacent ranges', () => {
        const segments = [seg(0, 0, 1000), seg(1, 1000, 2000), seg(2, 3000, 4000)];
        const ranges = computeLoadedRanges(segments, new Set([0, 1, 2]), { min: 0, max: 4000 });
        // 0..2000 merges into one range; 3000..4000 stays separate
        expect(ranges).toEqual([
            { start: 0, end: 0.5 },
            { start: 0.75, end: 1 },
        ]);
    });

    it('uses index-proportional ranges without metadata', () => {
        const segments = [seg(0), seg(1), seg(2), seg(3)];
        const ranges = computeLoadedRanges(segments, new Set([0, 3]), null);
        expect(ranges).toEqual([
            { start: 0, end: 0.25 },
            { start: 0.75, end: 1 },
        ]);
    });

    it('returns nothing when nothing is loaded', () => {
        expect(computeLoadedRanges([seg(0, 0, 100)], new Set(), { min: 0, max: 100 })).toEqual([]);
    });
});
