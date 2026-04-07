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

    it('returns only sessions that satisfy backup gate SQL semantics', async () => {
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

    it('fails closed when session_backup_log table does not exist', async () => {
        const error = Object.assign(new Error('relation does not exist'), { code: '42P01' });
        mocks.pool.query.mockRejectedValue(error);

        const result = await getBackedUpSessionIds(['session_1']);

        expect(result).toEqual(new Set());
        expect(mocks.logger.warn).toHaveBeenCalled();
    });
});

