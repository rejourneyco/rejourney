import v8 from 'node:v8';

/** Fraction of V8's heap limit above which a worker should stop taking on work. */
export const DEFAULT_HEAP_PRESSURE_RATIO = 0.75;

export interface HeapPressureReading {
    usedHeapBytes: number;
    heapLimitBytes: number;
    ratio: number;
    threshold: number;
}

export interface HeapStatisticsSource {
    used_heap_size: number;
    heap_size_limit: number;
}

/**
 * used / limit, or 0 when either number is unusable. An unreadable limit must
 * not look like pressure, or one bad reading would stop all work for good.
 */
export function computeHeapUsageRatio(usedHeapBytes: number, heapLimitBytes: number): number {
    if (
        !Number.isFinite(usedHeapBytes)
        || !Number.isFinite(heapLimitBytes)
        || usedHeapBytes < 0
        || heapLimitBytes <= 0
    ) {
        return 0;
    }
    return usedHeapBytes / heapLimitBytes;
}

export function isHeapUnderPressure(
    usedHeapBytes: number,
    heapLimitBytes: number,
    threshold = DEFAULT_HEAP_PRESSURE_RATIO,
): boolean {
    return computeHeapUsageRatio(usedHeapBytes, heapLimitBytes) > threshold;
}

export interface HeapPressureGuard {
    /** Samples the heap; stays true for the life of the guard once it has tripped. */
    shouldStop: () => boolean;
    readonly tripped: boolean;
}

export function createHeapPressureGuard(options: {
    threshold?: number;
    readHeapStatistics?: () => HeapStatisticsSource;
    /** Called once, with the reading that tripped the guard. */
    onPressure?: (reading: HeapPressureReading) => void;
} = {}): HeapPressureGuard {
    const threshold = options.threshold ?? DEFAULT_HEAP_PRESSURE_RATIO;
    const readHeapStatistics = options.readHeapStatistics ?? (() => v8.getHeapStatistics());
    let tripped = false;

    return {
        shouldStop: () => {
            if (tripped) return true;

            const stats = readHeapStatistics();
            if (!isHeapUnderPressure(stats.used_heap_size, stats.heap_size_limit, threshold)) {
                return false;
            }

            tripped = true;
            options.onPressure?.({
                usedHeapBytes: stats.used_heap_size,
                heapLimitBytes: stats.heap_size_limit,
                ratio: computeHeapUsageRatio(stats.used_heap_size, stats.heap_size_limit),
                threshold,
            });
            return true;
        },
        get tripped() {
            return tripped;
        },
    };
}
