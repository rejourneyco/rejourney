import { describe, expect, it, vi } from 'vitest';
import { createSingleFlight } from '../utils/asyncWork.js';
import { mapWithConcurrency } from '../utils/mapWithConcurrency.js';

describe('dashboard asynchronous work', () => {
    it('shares overlapping builds without retaining stale responses', async () => {
        const once = createSingleFlight<number>();
        let finish!: (value: number) => void;
        const build = vi.fn(() => new Promise<number>((resolve) => { finish = resolve; }));
        const first = once('project-a', build);
        const second = once('project-a', build);
        expect(first).toBe(second);
        await Promise.resolve();
        finish(1);
        expect(await first).toBe(1);
        expect(await once('project-a', async () => 2)).toBe(2);
        expect(build).toHaveBeenCalledTimes(1);
    });

    it('isolates scopes and allows retry after failure', async () => {
        const once = createSingleFlight<number>();
        await expect(once('a', async () => { throw new Error('temporary'); })).rejects.toThrow('temporary');
        expect(await once('a', async () => 1)).toBe(1);
        expect(await once('b', async () => 2)).toBe(2);
    });

    it('runs reads concurrently within the limit and preserves artifact order', async () => {
        let active = 0;
        let peak = 0;
        const result = await mapWithConcurrency([30, 5, 15, 1, 2], 3, async (delay) => {
            active++;
            peak = Math.max(peak, active);
            await new Promise((resolve) => setTimeout(resolve, delay));
            active--;
            return delay;
        });
        expect(peak).toBe(3);
        expect(result).toEqual([30, 5, 15, 1, 2]);
        expect(await mapWithConcurrency([], 3, async () => 1)).toEqual([]);
    });
});
