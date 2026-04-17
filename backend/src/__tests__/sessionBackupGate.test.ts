import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    pool: {
        query: vi.fn(),
    },
    logger: {
        warn: vi.fn(),
    },
}));

vi.mock('../db/client.js', () => ({
    pool: mocks.pool,
}));

vi.mock('../logger.js', () => ({
    logger: mocks.logger,
}));

import { getBackedUpSessionIds } from '../services/sessionBackupGate.js';

describe('sessionBackupGate', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns only session_ids returned by the DB (stricter backup vs artifact count match)', async () => {
        mocks.pool.query.mockResolvedValue({
            rows: [{ session_id: 'session_without_artifacts' }, { session_id: 'session_with_artifacts_and_backup' }],
        });

        const result = await getBackedUpSessionIds([
            'session_without_artifacts',
            'session_with_artifacts_and_backup',
            'session_with_artifacts_but_no_backup',
        ]);

        expect(result).toEqual(new Set([
            'session_without_artifacts',
            'session_with_artifacts_and_backup',
        ]));
    });

    it('requires artifact_count to cover lateral artifact_rows and reads from session_backup_log', async () => {
        mocks.pool.query.mockResolvedValue({ rows: [] });

        await getBackedUpSessionIds(['session_1']);

        expect(mocks.pool.query).toHaveBeenCalledTimes(1);
        const sql = String(mocks.pool.query.mock.calls[0][0]);
        expect(sql).toContain('bl.artifact_count >= COALESCE(artifact_stats.artifact_rows, 0)');
        expect(sql).toContain('FROM sessions s');
        expect(sql).toContain('LEFT JOIN session_backup_log bl ON bl.session_id = s.id');
        expect(sql).toContain('FROM session_metrics sm');
        expect(sql).toContain('FROM ingest_jobs ij');
        expect(sql).toContain('COALESCE(s.replay_segment_count, 0) = 0');
        expect(sql).not.toContain('s.observe_only = true');
    });

    it('fails closed when session_backup_log table does not exist', async () => {
        const error = Object.assign(new Error('relation does not exist'), { code: '42P01' });
        mocks.pool.query.mockRejectedValue(error);

        const result = await getBackedUpSessionIds(['session_1']);

        expect(result).toEqual(new Set());
        expect(mocks.logger.warn).toHaveBeenCalled();
    });
});
