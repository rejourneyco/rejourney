import { describe, expect, it } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

import {
    buildArchiveTextSearchCondition,
    escapeIlikePattern,
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
});
