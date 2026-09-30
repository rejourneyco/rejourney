import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    query: vi.fn(),
    txQuery: vi.fn(),
    release: vi.fn(),
    snapshot: vi.fn(),
    logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    },
    beginRetentionDeletionLog: vi.fn(async () => 'log_1'),
    finalizeRetentionDeletionLog: vi.fn(async () => undefined),
}));

vi.mock('../db/client.js', () => ({
    pool: {
        query: mocks.query,
        connect: async () => ({ query: mocks.txQuery, release: mocks.release }),
    },
}));

vi.mock('../services/activitySnapshots.js', () => ({ snapshotBeforeIdentityExpiry: mocks.snapshot }));

vi.mock('../logger.js', () => ({
    logger: mocks.logger,
}));

vi.mock('../services/retentionAudit.js', () => ({
    beginRetentionDeletionLog: mocks.beginRetentionDeletionLog,
    finalizeRetentionDeletionLog: mocks.finalizeRetentionDeletionLog,
}));

import {
    scrubExpiredSessionIdentitiesBatch,
    scrubSessionIdentityRows,
} from '../services/sessionIdentityScrub.js';

describe('session identity scrub', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        mocks.txQuery.mockImplementation(async (query: string) => query.includes('SELECT s.id')
            ? { rows: [{ id: 'session_1' }], rowCount: 1 } : { rows: [], rowCount: 0 });
    });

    it('clears direct session identity and linked session pointers', async () => {
        mocks.query
            .mockResolvedValue({ rows: [], rowCount: 1 });

        const result = await scrubExpiredSessionIdentitiesBatch(100, { runId: 'run_1', trigger: 'identity_scrub' });

        expect(result).toMatchObject({
            attempted: 1,
            scrubbed: 1,
            linkedRowsScrubbed: 6,
            reachedProcessingCap: false,
        });

        const scrubSql = mocks.txQuery.mock.calls.map(call => String(call[0])).join('\n');
        expect(scrubSql).toContain('device_id = NULL');
        expect(scrubSql).toContain('user_display_id = NULL');
        expect(scrubSql).toContain('anonymous_hash = NULL');
        expect(scrubSql).toContain('anonymous_display_id = NULL');
        // The pseudonymous ledger key goes with the raw identifiers…
        expect(scrubSql).toContain('visitor_key = NULL');
        // …but the low-entropy lifetime ordinal survives so "new user" stays honest.
        expect(scrubSql).not.toContain('visitor_session_ordinal = NULL');
        expect(scrubSql).toContain("events = '[]'::jsonb");
        expect(scrubSql).toContain("metadata = '{}'::jsonb");
        expect(scrubSql).toContain('identity_scrubbed_at = NOW()');
        expect(scrubSql).toContain("s.started_at < NOW() - (s.retention_days * INTERVAL '1 day')");
        expect(scrubSql).toContain('FOR UPDATE OF s SKIP LOCKED');

        const linkedSql = mocks.query.mock.calls.map((call) => String(call[0])).join('\n');
        expect(linkedSql).toContain('UPDATE crashes SET session_id = NULL');
        expect(linkedSql).toContain('UPDATE anrs SET session_id = NULL');
        expect(linkedSql).toContain('UPDATE errors SET session_id = NULL');
        expect(linkedSql).toContain('UPDATE issue_events SET session_id = NULL, user_id = NULL');
        expect(linkedSql).toContain('UPDATE issues SET sample_session_id = NULL');
        expect(linkedSql).toContain('UPDATE replay_share_links SET revoked_at');

        expect(mocks.beginRetentionDeletionLog).toHaveBeenCalledWith(expect.objectContaining({
            runId: 'run_1',
            scope: 'identity_scrub',
            trigger: 'identity_scrub',
            details: expect.objectContaining({ scrubbed: 1, linkedRowsScrubbed: 6 }),
        }));
        expect(mocks.finalizeRetentionDeletionLog).toHaveBeenCalledWith('log_1', expect.objectContaining({ status: 'completed' }));
    });

    it('writes no audit row when nothing was due', async () => {
        mocks.txQuery.mockResolvedValue({ rows: [], rowCount: 0 });

        const result = await scrubExpiredSessionIdentitiesBatch(100);

        expect(result).toEqual({ attempted: 0, scrubbed: 0, linkedRowsScrubbed: 0, reachedProcessingCap: false });
        expect(mocks.query).not.toHaveBeenCalled();
        expect(mocks.snapshot).not.toHaveBeenCalled();
        expect(mocks.beginRetentionDeletionLog).not.toHaveBeenCalled();
    });

    it('scrubs an explicit session list for erasure with the same column set and audit scope', async () => {
        mocks.query
            .mockResolvedValueOnce({ rows: [{ id: 'session_1' }, { id: 'session_2' }], rowCount: 2 })
            .mockResolvedValue({ rows: [], rowCount: 2 });

        const result = await scrubSessionIdentityRows(['session_1', 'session_2', 'session_2', ''], { runId: 'erase_1' });

        expect(result).toMatchObject({ attempted: 2, scrubbed: 2, linkedRowsScrubbed: 12 });
        const [scrubSql, params] = mocks.query.mock.calls[0] as [string, unknown[]];
        expect(scrubSql).toContain('WHERE s.id = ANY($1::varchar[])');
        expect(scrubSql).toContain('identity_scrubbed_at IS NULL');
        expect(scrubSql).toContain('visitor_key = NULL');
        expect(params[0]).toEqual(['session_1', 'session_2']);
        expect(mocks.beginRetentionDeletionLog).toHaveBeenCalledWith(expect.objectContaining({
            runId: 'erase_1',
            scope: 'visitor_erasure',
        }));
    });

    it('keeps scrubbing when the audit row cannot be written', async () => {
        mocks.query
            .mockResolvedValue({ rows: [], rowCount: 0 });
        mocks.beginRetentionDeletionLog.mockRejectedValueOnce(new Error('audit down'));

        const result = await scrubExpiredSessionIdentitiesBatch(100);

        expect(result.scrubbed).toBe(1);
        expect(mocks.logger.warn).toHaveBeenCalled();
    });
    it('rolls back expiry if its aggregate snapshot fails', async () => {
        mocks.snapshot.mockRejectedValueOnce(new Error('snapshot unavailable'));
        await expect(scrubExpiredSessionIdentitiesBatch(100)).rejects.toThrow('snapshot unavailable');
        expect(mocks.txQuery).toHaveBeenCalledWith('ROLLBACK');
        expect(mocks.txQuery.mock.calls.some(call => String(call[0]).includes('UPDATE sessions'))).toBe(false);
        expect(mocks.release).toHaveBeenCalled();
    });

    it('persists aggregate counts before clearing identities in the same transaction', async () => {
        mocks.query.mockResolvedValue({ rows: [], rowCount: 0 });
        await scrubExpiredSessionIdentitiesBatch(100);
        expect(mocks.snapshot).toHaveBeenCalledWith(['session_1'], expect.objectContaining({ query: mocks.txQuery }));
        const updateIndex = mocks.txQuery.mock.calls.findIndex(call => String(call[0]).includes('UPDATE sessions'));
        expect(mocks.snapshot.mock.invocationCallOrder[0]).toBeLessThan(mocks.txQuery.mock.invocationCallOrder[updateIndex]);
        expect(mocks.txQuery).toHaveBeenLastCalledWith('COMMIT');
    });

});
