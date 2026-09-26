import { describe, expect, it } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

import {
    buildArchiveExactIdSearchCondition,
    buildArchiveTextSearchCondition,
    escapeIlikePattern,
    isIdentifierLikeSearchQuery,
    normalizeArchiveSearchQuery,
    shouldSearchAnonymousDisplayName,
} from '../services/sessionArchiveListSort.js';

const dialect = new PgDialect();

describe('session archive list search', () => {
    it('escapes wildcard characters for ILIKE patterns', () => {
        expect(escapeIlikePattern(String.raw`100%_done\ok`)).toBe(String.raw`100\%\_done\\ok`);
    });

    it('detects generated anonymous display name queries', () => {
        expect(shouldSearchAnonymousDisplayName('FluffyPanda3A8B72')).toBe(true);
        expect(shouldSearchAnonymousDisplayName('Fluffy Panda 3A8B72')).toBe(true);
        expect(shouldSearchAnonymousDisplayName('Panda')).toBe(true);
        expect(shouldSearchAnonymousDisplayName('3A8B72')).toBe(true);
        expect(shouldSearchAnonymousDisplayName('iPhone')).toBe(false);
    });

    it('includes the generated anonymous display name expression when relevant', () => {
        const condition = buildArchiveTextSearchCondition('FluffyPanda3A8B72');

        expect(condition).not.toBeNull();
        const query = dialect.sqlToQuery(condition!);
        expect(query.sql).toContain('sha256(convert_to');
        expect(query.sql).toContain('user_display_id');
        expect(query.sql).toContain('ilike');
    });

    it('cleans pasted IDs before matching', () => {
        expect(normalizeArchiveSearchQuery('  user_123​ ')).toBe('user_123');
        expect(normalizeArchiveSearchQuery('"user_123"')).toBe('user_123');
        expect(normalizeArchiveSearchQuery("'user@example.com'")).toBe('user@example.com');
        expect(normalizeArchiveSearchQuery('x'.repeat(300))).toHaveLength(256);
    });

    it('treats single-token input as a possible identifier', () => {
        expect(isIdentifierLikeSearchQuery('user_123')).toBe(true);
        expect(isIdentifierLikeSearchQuery('user@example.com')).toBe(true);
        expect(isIdentifierLikeSearchQuery('9f73c1e0-5b6a-4f22-9c1e-54f6c8d7b0aa')).toBe(true);
        expect(isIdentifierLikeSearchQuery('abc')).toBe(true);
        expect(isIdentifierLikeSearchQuery('42')).toBe(true);
        expect(isIdentifierLikeSearchQuery('用户123')).toBe(true);
        expect(isIdentifierLikeSearchQuery('')).toBe(false);
        expect(isIdentifierLikeSearchQuery('iPhone 15 Pro')).toBe(false);
    });

    it('matches identifiers exactly on indexed columns without ILIKE', () => {
        const condition = buildArchiveExactIdSearchCondition(' "user_123" ');

        expect(condition).not.toBeNull();
        const query = dialect.sqlToQuery(condition!);
        expect(query.sql).toContain('"user_display_id" = $');
        expect(query.sql).toContain('"device_id" = $');
        expect(query.sql).not.toContain('ilike');
        expect(query.params).toEqual(['user_123', 'user_123', 'user_123', 'user_123']);
    });
});
