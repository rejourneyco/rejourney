import { describe, expect, it, vi } from 'vitest';
import {
    DEFAULT_HEAP_PRESSURE_RATIO,
    computeHeapUsageRatio,
    createHeapPressureGuard,
    isHeapUnderPressure,
} from '../services/heapPressure.js';

const LIMIT = 384 * 1024 * 1024;

describe('heap pressure helper', () => {
    it('uses 75% of the heap limit as the default threshold', () => {
        expect(DEFAULT_HEAP_PRESSURE_RATIO).toBe(0.75);
    });

    it('computes used / limit', () => {
        expect(computeHeapUsageRatio(0, LIMIT)).toBe(0);
        expect(computeHeapUsageRatio(LIMIT / 2, LIMIT)).toBe(0.5);
        expect(computeHeapUsageRatio(LIMIT, LIMIT)).toBe(1);
    });

    it('reports pressure only above the threshold', () => {
        expect(isHeapUnderPressure(0.74 * 1000, 1000)).toBe(false);
        expect(isHeapUnderPressure(0.75 * 1000, 1000)).toBe(false);
        expect(isHeapUnderPressure(0.75 * 1000 + 1, 1000)).toBe(true);
        expect(isHeapUnderPressure(990, 1000)).toBe(true);
    });

    it('honours a custom threshold', () => {
        expect(isHeapUnderPressure(600, 1000, 0.5)).toBe(true);
        expect(isHeapUnderPressure(500, 1000, 0.5)).toBe(false);
    });

    it('treats a zero or invalid limit as no pressure', () => {
        expect(computeHeapUsageRatio(100, 0)).toBe(0);
        expect(computeHeapUsageRatio(100, -1)).toBe(0);
        expect(computeHeapUsageRatio(100, Number.NaN)).toBe(0);
        expect(computeHeapUsageRatio(100, Number.POSITIVE_INFINITY)).toBe(0);
        expect(computeHeapUsageRatio(Number.NaN, 1000)).toBe(0);
        expect(computeHeapUsageRatio(-5, 1000)).toBe(0);
        expect(computeHeapUsageRatio(undefined as unknown as number, undefined as unknown as number)).toBe(0);
        expect(isHeapUnderPressure(100, 0)).toBe(false);
        expect(isHeapUnderPressure(100, Number.NaN)).toBe(false);
    });

    it('trips once, reports the reading, and stays tripped', () => {
        const readings = [
            { used_heap_size: 100, heap_size_limit: 1000 },
            { used_heap_size: 900, heap_size_limit: 1000 },
            { used_heap_size: 100, heap_size_limit: 1000 },
        ];
        const readHeapStatistics = vi.fn(() => readings.shift() ?? { used_heap_size: 0, heap_size_limit: 1000 });
        const onPressure = vi.fn();
        const guard = createHeapPressureGuard({ readHeapStatistics, onPressure });

        expect(guard.shouldStop()).toBe(false);
        expect(guard.tripped).toBe(false);
        expect(onPressure).not.toHaveBeenCalled();

        expect(guard.shouldStop()).toBe(true);
        expect(guard.tripped).toBe(true);
        expect(onPressure).toHaveBeenCalledTimes(1);
        expect(onPressure).toHaveBeenCalledWith({
            usedHeapBytes: 900,
            heapLimitBytes: 1000,
            ratio: 0.9,
            threshold: 0.75,
        });

        // Latched: no further sampling, no second warning, even if memory is freed.
        expect(guard.shouldStop()).toBe(true);
        expect(readHeapStatistics).toHaveBeenCalledTimes(2);
        expect(onPressure).toHaveBeenCalledTimes(1);
    });

    it('never trips on an unusable heap limit', () => {
        const guard = createHeapPressureGuard({
            readHeapStatistics: () => ({ used_heap_size: 5_000, heap_size_limit: 0 }),
        });

        expect(guard.shouldStop()).toBe(false);
        expect(guard.tripped).toBe(false);
    });

    it('reads the real V8 heap statistics by default', () => {
        const guard = createHeapPressureGuard({ threshold: Number.POSITIVE_INFINITY });

        expect(guard.shouldStop()).toBe(false);
    });
});
