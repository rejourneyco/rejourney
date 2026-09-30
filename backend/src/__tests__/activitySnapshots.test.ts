import { describe, expect, it, vi } from 'vitest';
vi.mock('../db/client.js', () => ({ pool: { query: vi.fn() } }));
vi.mock('../services/visitorLedger.js', () => ({ computeVisitorKey: vi.fn() }));
import { combineActivitySnapshots } from '../services/activitySnapshots.js';

const row = (projectId: string, dau: number, mau: number, complete = true) => ({
    project_id: projectId, date: '2026-09-29', dau, mau,
    dau_complete: complete, mau_complete: complete,
    version_dau: { v1: dau }, country_dau: { US: dau },
});

describe('historical activity snapshots', () => {
    it('merges project-scoped visitors and breakdowns without claiming incomplete history is exact', () => {
        expect(combineActivitySnapshots([row('a', 2, 5), row('b', 3, 7, false)], 2).get('2026-09-29')).toEqual({
            dau: 5, mau: 12, dauComplete: false, mauComplete: false,
            appVersionDauBreakdown: { v1: 5 }, countryDauBreakdown: { US: 5 },
        });
    });
    it('does not replace the whole selection with counts from only one project', () => {
        expect(combineActivitySnapshots([row('a', 2, 5)], 2).size).toBe(0);
    });
});
