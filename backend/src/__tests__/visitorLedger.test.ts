import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    query: vi.fn(),
    logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    },
    config: {
        VISITOR_KEY_SECRET: 'visitor-secret-visitor-secret-visitor-secret',
        RESEARCH_LAKE_HASH_SECRET: undefined as string | undefined,
        SHARE_LINK_SECRET: undefined as string | undefined,
        JWT_SECRET: 'jwt-secret-jwt-secret-jwt-secret-jwt-secret',
        VISITOR_LEDGER_WRITE_ENABLED: true,
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

vi.mock('../config.js', () => ({
    config: mocks.config,
}));

import {
    VISITOR_KEY_HEX_LENGTH,
    assignSessionVisitor,
    assignSessionVisitorForRow,
    computeVisitorKey,
    expireVisitorLedgerBatch,
    invalidateProjectVisitorWindowCache,
    resolveEffectiveVisitorRetentionDays,
    resolveVisitorIdentity,
    resolveVisitorKeySecret,
    resyncTeamVisitorLedgerExpiry,
} from '../services/visitorLedger.js';

describe('visitor ledger', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.config.VISITOR_LEDGER_WRITE_ENABLED = true;
        mocks.config.VISITOR_KEY_SECRET = 'visitor-secret-visitor-secret-visitor-secret';
        invalidateProjectVisitorWindowCache('project_1');
    });

    it('derives a deterministic, project-scoped keyed hash without the raw identifier', () => {
        const key = computeVisitorKey('project_1', 'device_abc');
        expect(key).toHaveLength(VISITOR_KEY_HEX_LENGTH);
        expect(key).toMatch(/^[0-9a-f]+$/);
        expect(key).not.toContain('device_abc');
        expect(computeVisitorKey('project_1', 'device_abc')).toBe(key);
        expect(computeVisitorKey('project_2', 'device_abc')).not.toBe(key);
        expect(computeVisitorKey('project_1', 'device_xyz')).not.toBe(key);
    });

    it('falls back only to JWT_SECRET, the one secret every workload receives', () => {
        mocks.config.VISITOR_KEY_SECRET = undefined as unknown as string;
        // RESEARCH_LAKE_HASH_SECRET and SHARE_LINK_SECRET reach only some production
        // deployments, so they must never influence the key or ingest pods and workers
        // would disagree on who a visitor is.
        mocks.config.RESEARCH_LAKE_HASH_SECRET = 'research-only-secret-research-only-secret';
        mocks.config.SHARE_LINK_SECRET = 'share-link-secret-share-link-secret-share';
        expect(resolveVisitorKeySecret()).toBe(mocks.config.JWT_SECRET);
        expect(mocks.logger.warn).toHaveBeenCalledTimes(1);
        mocks.config.SHARE_LINK_SECRET = undefined;
        mocks.config.RESEARCH_LAKE_HASH_SECRET = undefined;
    });

    it('resolves the visitor identity device-first and ignores blank values', () => {
        expect(resolveVisitorIdentity({ deviceId: ' dev ', userDisplayId: 'user' })).toBe('dev');
        expect(resolveVisitorIdentity({ deviceId: '', anonymousDisplayId: 'anon_1', userDisplayId: 'user' })).toBe('anon_1');
        expect(resolveVisitorIdentity({ deviceId: null, anonymousHash: null, anonymousDisplayId: '  ', userDisplayId: 'user' })).toBe('user');
        expect(resolveVisitorIdentity({})).toBeNull();
        expect(resolveVisitorIdentity(null)).toBeNull();
    });

    it('never lets the ledger expire before the session retention period', () => {
        expect(resolveEffectiveVisitorRetentionDays(90, 7)).toBe(90);
        expect(resolveEffectiveVisitorRetentionDays(0, 7)).toBe(7);
        expect(resolveEffectiveVisitorRetentionDays(30, 3650)).toBe(3650);
        expect(resolveEffectiveVisitorRetentionDays(undefined, 14)).toBe(90);
        expect(resolveEffectiveVisitorRetentionDays(9999, 0)).toBe(365);
        expect(resolveEffectiveVisitorRetentionDays(-5, -5)).toBe(1);
    });

    it('assigns the ordinal with a single atomic upsert guarded by the session row lock', async () => {
        mocks.query.mockResolvedValueOnce({ rows: [{ ordinal: '3', first_seen_ms: '1780000000000' }], rowCount: 1 });

        const result = await assignSessionVisitor({
            sessionId: 'session_1',
            projectId: 'project_1',
            identity: 'device_abc',
            startedAt: new Date('2026-06-01T00:00:00.000Z'),
            effectiveRetentionDays: 90,
        });

        expect(result).toMatchObject({ ordinal: 3, visitorKey: computeVisitorKey('project_1', 'device_abc') });
        expect(result?.firstSeenAt.getTime()).toBe(1780000000000);

        const [sqlText, params] = mocks.query.mock.calls[0] as [string, unknown[]];
        expect(sqlText).toContain('visitor_session_ordinal IS NULL');
        expect(sqlText).toContain('identity_scrubbed_at IS NULL');
        expect(sqlText).toContain('FOR UPDATE OF s');
        expect(sqlText).toContain('INSERT INTO project_visitors');
        expect(sqlText).toContain('ON CONFLICT (project_id, visitor_key) DO UPDATE');
        expect(sqlText).toContain('session_count = project_visitors.session_count + 1');
        expect(sqlText).toContain('visitor_session_ordinal = ledger.session_count');
        expect(params).toEqual([
            'session_1',
            'project_1',
            computeVisitorKey('project_1', 'device_abc'),
            '2026-06-01T00:00:00.000Z',
            90,
        ]);
        // The raw identifier never reaches SQL.
        expect(params).not.toContain('device_abc');
    });

    it('is a no-op when disabled, when identity is blank, or when the session was already stamped', async () => {
        mocks.config.VISITOR_LEDGER_WRITE_ENABLED = false;
        expect(await assignSessionVisitor({
            sessionId: 's', projectId: 'p', identity: 'd', startedAt: new Date(), effectiveRetentionDays: 90,
        })).toBeNull();
        mocks.config.VISITOR_LEDGER_WRITE_ENABLED = true;

        expect(await assignSessionVisitor({
            sessionId: 's', projectId: 'p', identity: '   ', startedAt: new Date(), effectiveRetentionDays: 90,
        })).toBeNull();

        mocks.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
        expect(await assignSessionVisitor({
            sessionId: 's', projectId: 'p', identity: 'd', startedAt: new Date(), effectiveRetentionDays: 90,
        })).toBeNull();

        expect(await assignSessionVisitorForRow({
            id: 's', projectId: 'p', startedAt: new Date(), deviceId: 'd', visitorSessionOrdinal: 2,
        })).toBeNull();
        expect(mocks.query).toHaveBeenCalledTimes(1);
    });

    it('never throws into ingest when the database fails', async () => {
        mocks.query.mockRejectedValueOnce(new Error('boom'));
        const result = await assignSessionVisitor({
            sessionId: 'session_1',
            projectId: 'project_1',
            identity: 'device_abc',
            startedAt: new Date(),
            effectiveRetentionDays: 90,
        });
        expect(result).toBeNull();
        expect(mocks.logger.warn).toHaveBeenCalled();
    });

    it('resolves the team window once per project and applies max(window, session retention)', async () => {
        mocks.query
            .mockResolvedValueOnce({ rows: [{ days: 30 }], rowCount: 1 })
            .mockResolvedValueOnce({ rows: [{ ordinal: 1, first_seen_ms: 1 }], rowCount: 1 })
            .mockResolvedValueOnce({ rows: [{ ordinal: 2, first_seen_ms: 1 }], rowCount: 1 });

        const first = await assignSessionVisitorForRow({
            id: 's1', projectId: 'project_1', startedAt: new Date(), retentionDays: 60, deviceId: 'device_abc',
        });
        const second = await assignSessionVisitorForRow({
            id: 's2', projectId: 'project_1', startedAt: new Date(), retentionDays: 7, deviceId: 'device_abc',
        });

        expect(first?.ordinal).toBe(1);
        expect(second?.ordinal).toBe(2);
        expect(mocks.query).toHaveBeenCalledTimes(3);
        expect((mocks.query.mock.calls[1] as [string, unknown[]])[1][4]).toBe(60);
        expect((mocks.query.mock.calls[2] as [string, unknown[]])[1][4]).toBe(30);
    });

    it('expires due ledger rows in bounded, skip-locked batches', async () => {
        mocks.query.mockResolvedValueOnce({ rows: [{ id: 'a' }, { id: 'b' }], rowCount: 2 });

        const result = await expireVisitorLedgerBatch(2);

        expect(result).toEqual({ deleted: 2, reachedProcessingCap: true });
        const sqlText = String(mocks.query.mock.calls[0]?.[0]);
        expect(sqlText).toContain('expires_at < NOW()');
        expect(sqlText).toContain('FOR UPDATE SKIP LOCKED');
        expect(sqlText).toContain('DELETE FROM project_visitors');
        expect(sqlText).not.toMatch(/UPDATE sessions/i);
    });

    it('recomputes expiry for every ledger row of a team', async () => {
        mocks.query.mockResolvedValueOnce({ rows: [], rowCount: 12 });
        expect(await resyncTeamVisitorLedgerExpiry('team_1', 120)).toBe(12);
        const [sqlText, params] = mocks.query.mock.calls[0] as [string, unknown[]];
        expect(sqlText).toContain('pv.last_seen_at + ($2::int * INTERVAL \'1 day\')');
        expect(params).toEqual(['team_1', 120]);
    });
});
