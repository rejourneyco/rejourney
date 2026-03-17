import { describe, expect, it } from 'vitest';

import {
    getSessionArchiveIssueFilterCondition,
    normalizeSessionArchiveIssueFilter,
    sessionArchiveIssueFilterUsesMetrics,
} from '../services/sessionArchiveFilters.js';

describe('sessionArchiveFilters', () => {
    it('normalizes known issue filters and rejects unknown values', () => {
        expect(normalizeSessionArchiveIssueFilter('crashes')).toBe('crashes');
        expect(normalizeSessionArchiveIssueFilter('failed_funnel')).toBeNull();
        expect(normalizeSessionArchiveIssueFilter('totally_unknown')).toBeNull();
        expect(normalizeSessionArchiveIssueFilter(undefined)).toBeNull();
    });

    it('marks only metric-backed filters as requiring a metrics join', () => {
        expect(sessionArchiveIssueFilterUsesMetrics('crashes')).toBe(true);
        expect(sessionArchiveIssueFilterUsesMetrics('rage')).toBe(true);
        expect(sessionArchiveIssueFilterUsesMetrics('all')).toBe(false);
        expect(sessionArchiveIssueFilterUsesMetrics(null)).toBe(false);
    });

    it('returns SQL conditions only for active issue filters', () => {
        expect(getSessionArchiveIssueFilterCondition('crashes')).toBeDefined();
        expect(getSessionArchiveIssueFilterCondition('slow_api')).toBeDefined();
        expect(getSessionArchiveIssueFilterCondition('all')).toBeUndefined();
        expect(getSessionArchiveIssueFilterCondition(null)).toBeUndefined();
    });
});
