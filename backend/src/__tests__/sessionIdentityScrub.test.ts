import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    query: vi.fn(),
    logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    },
}));

vi.mock('../db/client.js', () => ({
    pool: {
        query: mocks.query,
    },
}));

vi.mock('../logger.js', () => ({
    logger: mocks.logger,
}));

import { scrubExpiredSessionIdentitiesBatch } from '../services/sessionIdentityScrub.js';

describe('session identity scrub', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('clears direct session identity and linked session pointers', async () => {
        mocks.query
            .mockResolvedValueOnce({ rows: [{ id: 'session_1' }], rowCount: 1 })
            .mockResolvedValue({ rows: [], rowCount: 1 });

        const result = await scrubExpiredSessionIdentitiesBatch(100);

        expect(result).toMatchObject({
            attempted: 1,
            scrubbed: 1,
            linkedRowsScrubbed: 6,
            reachedProcessingCap: false,
        });

        const scrubSql = String(mocks.query.mock.calls[0]?.[0]);
        expect(scrubSql).toContain('device_id = NULL');
        expect(scrubSql).toContain('user_display_id = NULL');
        expect(scrubSql).toContain('anonymous_hash = NULL');
        expect(scrubSql).toContain('anonymous_display_id = NULL');
        expect(scrubSql).toContain("events = '[]'::jsonb");
        expect(scrubSql).toContain("metadata = '{}'::jsonb");
        expect(scrubSql).toContain('identity_scrubbed_at = NOW()');

        const linkedSql = mocks.query.mock.calls.slice(1).map((call) => String(call[0])).join('\n');
        expect(linkedSql).toContain('UPDATE crashes SET session_id = NULL');
        expect(linkedSql).toContain('UPDATE anrs SET session_id = NULL');
        expect(linkedSql).toContain('UPDATE errors SET session_id = NULL');
        expect(linkedSql).toContain('UPDATE issue_events SET session_id = NULL, user_id = NULL');
        expect(linkedSql).toContain('UPDATE issues SET sample_session_id = NULL');
        expect(linkedSql).toContain('UPDATE replay_share_links SET revoked_at');
    });
});
