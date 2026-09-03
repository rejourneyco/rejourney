import { describe, expect, it } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

import {
    getSessionArchiveIssueFilterCondition,
    normalizeSessionArchiveIssueFilter,
    sessionArchiveIssueFilterUsesMetrics,
} from '../services/sessionArchiveFilters.js';

describe('sessionArchiveFilters', () => {
    it('normalizes known issue filters and rejects unknown values', () => {
        expect(normalizeSessionArchiveIssueFilter('crashes')).toBe('crashes');
        expect(normalizeSessionArchiveIssueFilter('new_user')).toBe('new_user');
        expect(normalizeSessionArchiveIssueFilter('failed_funnel')).toBeNull();
        expect(normalizeSessionArchiveIssueFilter('totally_unknown')).toBeNull();
        expect(normalizeSessionArchiveIssueFilter(undefined)).toBeNull();
    });

    it('marks only metric-backed filters as requiring a metrics join', () => {
        expect(sessionArchiveIssueFilterUsesMetrics('crashes')).toBe(true);
        expect(sessionArchiveIssueFilterUsesMetrics('rage')).toBe(true);
        expect(sessionArchiveIssueFilterUsesMetrics('new_user')).toBe(false);
        expect(sessionArchiveIssueFilterUsesMetrics('all')).toBe(false);
        expect(sessionArchiveIssueFilterUsesMetrics(null)).toBe(false);
    });

    it('returns SQL conditions only for active issue filters', () => {
        expect(getSessionArchiveIssueFilterCondition('crashes')).toBeDefined();
        expect(getSessionArchiveIssueFilterCondition('slow_api')).toBeDefined();
        expect(getSessionArchiveIssueFilterCondition('new_user')).toBeDefined();
        expect(getSessionArchiveIssueFilterCondition('all')).toBeUndefined();
        expect(getSessionArchiveIssueFilterCondition(null)).toBeUndefined();
    });

    it('flags new users from the scrub-surviving ledger ordinal before falling back to the legacy check', () => {
        const dialect = new PgDialect();
        const { sql } = dialect.sqlToQuery(getSessionArchiveIssueFilterCondition('new_user')!);
        const normalized = sql.replace(/\s+/g, ' ').trim();

        expect(normalized).toContain('"sessions"."visitor_session_ordinal" = 1');
        // Ordinal wins when present; the legacy correlated NOT EXISTS only runs for un-keyed rows.
        expect(normalized.indexOf('visitor_session_ordinal')).toBeLessThan(normalized.indexOf('not exists'));
        expect(normalized).toMatch(/^coalesce\(/);
    });
});
