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

import { enqueueSessionBackupCandidate } from '../services/sessionBackupQueue.js';

describe('sessionBackupQueue', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('queues a finalized eligible session only when it is not already backed up', async () => {
        mocks.pool.query.mockResolvedValue({
            rows: [{ session_id: 'session_1' }],
        });

        const result = await enqueueSessionBackupCandidate('session_1');

        expect(result).toBe(true);
        expect(mocks.pool.query).toHaveBeenCalledTimes(1);
        const query = String(mocks.pool.query.mock.calls[0][0]);
        expect(query).toContain('INSERT INTO session_backup_queue');
        expect(query).toContain('FROM sessions s');
        expect(query).toContain('JOIN projects p ON p.id = s.project_id');
        expect(query).toContain('FROM session_backup_log bl');
        expect(query).toContain('ON CONFLICT (session_id) DO NOTHING');
        expect(query).toContain("s.status IN ('ready', 'completed')");
        expect(query).toContain('s.ended_at IS NOT NULL');
        expect(query).toContain("ra.status = 'ready'");
        expect(query).toContain('AND (');
        expect(query).toContain('recording_artifacts ra');
        expect(query).toContain('FROM ingest_jobs ij');
        expect(query).toContain('FROM session_metrics sm');
        expect(query).toContain('bl.planned_artifact_count >=');
    });

    it('returns false without querying when session id is empty', async () => {
        const result = await enqueueSessionBackupCandidate('');

        expect(result).toBe(false);
        expect(mocks.pool.query).not.toHaveBeenCalled();
    });

    it('fails closed when the queue table does not exist yet', async () => {
        const error = Object.assign(new Error('relation does not exist'), { code: '42P01' });
        mocks.pool.query.mockRejectedValue(error);

        const result = await enqueueSessionBackupCandidate('session_1');

        expect(result).toBe(false);
        expect(mocks.logger.warn).toHaveBeenCalled();
    });
});
