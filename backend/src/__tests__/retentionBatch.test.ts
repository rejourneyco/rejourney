import { describe, expect, it, vi } from 'vitest';
import {
    interleaveBatches,
    runBoundedConcurrentBatch,
} from '../services/retentionBatch.js';

describe('retention batch helpers', () => {
    it('interleaves tier batches so every tier makes progress', () => {
        expect(interleaveBatches([
            ['tier1-a', 'tier1-b', 'tier1-c'],
            ['tier3-a'],
            ['tier4-a', 'tier4-b'],
        ])).toEqual([
            'tier1-a',
            'tier3-a',
            'tier4-a',
            'tier1-b',
            'tier4-b',
            'tier1-c',
        ]);
    });

    it('processes every claimed item exactly once with bounded concurrency', async () => {
        const items = Array.from({ length: 20 }, (_, index) => index);
        const processed: number[] = [];
        let active = 0;
        let maxActive = 0;

        const result = await runBoundedConcurrentBatch(
            items,
            { concurrency: 4 },
            async (item) => {
                active += 1;
                maxActive = Math.max(maxActive, active);
                await new Promise((resolve) => setTimeout(resolve, 2));
                processed.push(item);
                active -= 1;
            },
        );

        expect(result).toEqual({
            startedCount: 20,
            completedCount: 20,
            stoppedEarly: false,
        });
        expect(new Set(processed)).toEqual(new Set(items));
        expect(processed).toHaveLength(items.length);
        expect(maxActive).toBeGreaterThan(1);
        expect(maxActive).toBeLessThanOrEqual(4);
    });

    it('stops claiming new work at the deadline and leaves the remainder retryable', async () => {
        let deadlineChecks = 0;
        const processed: number[] = [];

        const result = await runBoundedConcurrentBatch(
            [1, 2, 3, 4],
            {
                concurrency: 1,
                deadlineAtMs: 50,
                now: () => {
                    deadlineChecks += 1;
                    return deadlineChecks <= 2 ? 0 : 100;
                },
            },
            async (item) => {
                processed.push(item);
            },
        );

        expect(processed).toEqual([1, 2]);
        expect(result).toEqual({
            startedCount: 2,
            completedCount: 2,
            stoppedEarly: true,
        });
    });

    it('stops claiming new work once shouldStop reports true and leaves the remainder retryable', async () => {
        const processed: number[] = [];
        let stop = false;

        const result = await runBoundedConcurrentBatch(
            [1, 2, 3, 4, 5],
            {
                concurrency: 1,
                shouldStop: () => stop,
            },
            async (item) => {
                processed.push(item);
                if (item === 2) stop = true;
            },
        );

        expect(processed).toEqual([1, 2]);
        expect(result).toEqual({
            startedCount: 2,
            completedCount: 2,
            stoppedEarly: true,
        });
    });

    it('checks shouldStop before the first claim', async () => {
        const processed: number[] = [];
        const shouldStop = vi.fn(() => true);

        const result = await runBoundedConcurrentBatch(
            [1, 2, 3],
            { concurrency: 2, shouldStop },
            async (item) => {
                processed.push(item);
            },
        );

        expect(processed).toEqual([]);
        expect(shouldStop).toHaveBeenCalled();
        expect(result).toEqual({
            startedCount: 0,
            completedCount: 0,
            stoppedEarly: true,
        });
    });

    it('lets in-flight items finish after shouldStop trips under concurrency', async () => {
        const started: number[] = [];
        const finished: number[] = [];
        let stop = false;

        const result = await runBoundedConcurrentBatch(
            [1, 2, 3, 4, 5, 6],
            { concurrency: 2, shouldStop: () => stop },
            async (item) => {
                started.push(item);
                // Both workers hold an item when the guard trips.
                if (item === 2) stop = true;
                await new Promise((resolve) => setTimeout(resolve, 2));
                finished.push(item);
            },
        );

        expect(started).toEqual([1, 2]);
        expect(new Set(finished)).toEqual(new Set([1, 2]));
        expect(result).toEqual({
            startedCount: 2,
            completedCount: 2,
            stoppedEarly: true,
        });
    });

    it('still honours the deadline when shouldStop stays false', async () => {
        let checks = 0;
        const processed: number[] = [];

        const result = await runBoundedConcurrentBatch(
            [1, 2, 3],
            {
                concurrency: 1,
                deadlineAtMs: 50,
                now: () => {
                    checks += 1;
                    return checks <= 1 ? 0 : 100;
                },
                shouldStop: () => false,
            },
            async (item) => {
                processed.push(item);
            },
        );

        expect(processed).toEqual([1]);
        expect(result.stoppedEarly).toBe(true);
    });
});
