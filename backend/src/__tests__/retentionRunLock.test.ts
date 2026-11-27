import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    query: vi.fn(),
}));

vi.mock('../db/client.js', () => ({
    pool: { query: mocks.query },
}));

import {
    DEFAULT_STALE_SECONDS,
    RETENTION_RUN_LOCK_NAME,
    tryAcquireRetentionRunLock,
} from '../services/retentionRunLock.js';

describe('retention run lock', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('treats a lock as stale after three minutes without a heartbeat', async () => {
        // Six missed 30-second heartbeats. At 15 minutes a run that died
        // without releasing blocked the next two or three 5-minute schedules.
        expect(DEFAULT_STALE_SECONDS).toBe(180);

        mocks.query.mockResolvedValueOnce({ rows: [{ owner_id: 'owner_a' }] });

        await expect(tryAcquireRetentionRunLock('owner_a')).resolves.toBe(true);

        expect(mocks.query).toHaveBeenCalledTimes(1);
        const [text, params] = mocks.query.mock.calls[0];
        expect(text).toContain("retention_run_lock.heartbeat_at < NOW() - ($3 * INTERVAL '1 second')");
        expect(params).toEqual([RETENTION_RUN_LOCK_NAME, 'owner_a', 180]);
    });

    it('still accepts an explicit stale window', async () => {
        mocks.query.mockResolvedValueOnce({ rows: [{ owner_id: 'owner_a' }] });

        await tryAcquireRetentionRunLock('owner_a', 45);

        expect(mocks.query.mock.calls[0][1]).toEqual([RETENTION_RUN_LOCK_NAME, 'owner_a', 45]);
    });

    it('reports the lock as held when another owner keeps it', async () => {
        mocks.query.mockResolvedValueOnce({ rows: [] });

        await expect(tryAcquireRetentionRunLock('owner_b')).resolves.toBe(false);
    });
});
