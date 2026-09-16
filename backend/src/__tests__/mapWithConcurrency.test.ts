import { describe, expect, it } from 'vitest';
import { mapWithConcurrency } from '../utils/mapWithConcurrency.js';

describe('mapWithConcurrency', () => {
    it('returns results in input order and never exceeds the concurrency bound', async () => {
        let inFlight = 0;
        let peak = 0;
        const items = [30, 5, 20, 1, 15, 10];
        const results = await mapWithConcurrency(items, 2, async (delay, index) => {
            inFlight += 1;
            peak = Math.max(peak, inFlight);
            await new Promise((resolve) => setTimeout(resolve, delay));
            inFlight -= 1;
            return `${index}:${delay}`;
        });
        expect(results).toEqual(['0:30', '1:5', '2:20', '3:1', '4:15', '5:10']);
        expect(peak).toBe(2);
    });

    it('handles empty input and a concurrency larger than the input', async () => {
        expect(await mapWithConcurrency([], 4, async (x) => x)).toEqual([]);
        expect(await mapWithConcurrency([1, 2], 10, async (x) => x * 2)).toEqual([2, 4]);
    });
});
