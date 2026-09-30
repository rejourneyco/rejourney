import { describe, expect, it } from 'vitest';
import { calendarDateKeys, pendingRollupDates } from '../utils/rollupCalendar.js';
const now = new Date('2026-09-30T11:00:00Z');
const keys = (last: string | null) => pendingRollupDates(last, now).map(date => date.toISOString().slice(0, 10));
describe('rollup calendar continuity', () => {
    it('catches up missed days oldest first instead of jumping to yesterday', () => {
        expect(keys('2026-09-26')).toEqual(['2026-09-27', '2026-09-28', '2026-09-29']);
    });
    it('bounds outage recovery and never includes the incomplete current day', () => {
        expect(keys('2026-08-01')).toHaveLength(7);
        expect(keys('2026-09-29')).toEqual([]);
        expect(keys(null)).toEqual(['2026-09-29']);
    });
    it('includes zero-activity days across month and leap-day boundaries', () => {
        expect(calendarDateKeys('2024-02-28', '2024-03-01')).toEqual(['2024-02-28', '2024-02-29', '2024-03-01']);
    });
});
