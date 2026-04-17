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
        expect(query).toContain('LEFT JOIN session_backup_log bl ON bl.session_id = s.id');
        expect(query).toContain('JOIN LATERAL (');
        expect(query).toContain('artifact_stats.ready_artifact_count > 0');
        expect(query).toContain("COUNT(*) FILTER (WHERE ra.kind = 'events')::int AS ready_events_count");
        expect(query).toContain("COUNT(*) FILTER (WHERE ra.kind = 'hierarchy')::int AS ready_hierarchy_count");
        expect(query).toContain("COUNT(*) FILTER (WHERE ra.kind = 'screenshots')::int AS ready_screenshots_count");
        expect(query).toContain('COALESCE(s.observe_only, false) = true');
        expect(query).toContain('artifact_stats.ready_screenshots_count = 0');
        expect(query).toContain('COALESCE(s.observe_only, false) = false');
        expect(query).toContain('artifact_stats.ready_screenshots_count > 0');
        expect(query).toContain('ON CONFLICT (session_id) DO NOTHING');
        expect(query).toContain("s.status IN ('ready', 'completed')");
        expect(query).toContain('s.ended_at IS NOT NULL');
        expect(query).toContain("ra.status = 'ready'");
        expect(query).toContain('next_retry_at');
        expect(query).toContain('NOW(),');
        expect(query).toContain('bl.planned_artifact_count < artifact_stats.ready_artifact_count');
        expect(query).not.toContain('FROM ingest_jobs ij');
        expect(query).not.toContain('FROM session_metrics sm');
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
