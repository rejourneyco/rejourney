import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../logger.js', () => ({
    logger: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

import {
    claimSessionArtifactCapLog,
    getRedis,
    incrementSessionArtifactCount,
} from '../db/redis.js';

function mockMulti(exec: () => Promise<unknown>) {
    const chain: any = {};
    chain.incr = vi.fn(() => chain);
    chain.expire = vi.fn(() => chain);
    chain.exec = vi.fn(exec);
    const multi = vi.spyOn(getRedis(), 'multi').mockReturnValue(chain);
    return { chain, multi };
}

describe('per-session artifact counter Redis helpers', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('increments and sets the TTL in one MULTI so the key can never lack an expiry', async () => {
        const { chain, multi } = mockMulti(async () => [[null, 41], [null, 1]]);

        await expect(incrementSessionArtifactCount('project-1', 'session_1', 172_800)).resolves.toBe(41);

        expect(multi).toHaveBeenCalledTimes(1);
        expect(chain.incr).toHaveBeenCalledWith('ingest:session:artifacts:project-1:session_1');
        expect(chain.expire).toHaveBeenCalledWith('ingest:session:artifacts:project-1:session_1', 172_800);
        expect(chain.exec).toHaveBeenCalledTimes(1);
    });

    it('returns null (fail open) when Redis rejects, aborts the MULTI, or errors on either command', async () => {
        mockMulti(async () => { throw new Error('Connection is closed.'); });
        await expect(incrementSessionArtifactCount('project-1', 'session_1', 60)).resolves.toBeNull();
        vi.restoreAllMocks();

        mockMulti(async () => null);
        await expect(incrementSessionArtifactCount('project-1', 'session_1', 60)).resolves.toBeNull();
        vi.restoreAllMocks();

        mockMulti(async () => [[new Error('WRONGTYPE'), null], [null, 0]]);
        await expect(incrementSessionArtifactCount('project-1', 'session_1', 60)).resolves.toBeNull();
        vi.restoreAllMocks();

        mockMulti(async () => [[null, 7], [new Error('ERR expire'), null]]);
        await expect(incrementSessionArtifactCount('project-1', 'session_1', 60)).resolves.toBeNull();
    });

    it('claims the once-per-session log line with SET NX and a TTL', async () => {
        const set = vi.spyOn(getRedis(), 'set').mockResolvedValueOnce('OK').mockResolvedValueOnce(null);

        await expect(claimSessionArtifactCapLog('project-1', 'session_1', 172_800)).resolves.toBe(true);
        await expect(claimSessionArtifactCapLog('project-1', 'session_1', 172_800)).resolves.toBe(false);

        expect(set).toHaveBeenCalledWith(
            'ingest:session:artifact_cap_logged:project-1:session_1',
            '1',
            'EX',
            172_800,
            'NX',
        );
    });

    it('does not claim the log line when Redis is unavailable', async () => {
        vi.spyOn(getRedis(), 'set').mockRejectedValueOnce(new Error('Connection is closed.'));

        await expect(claimSessionArtifactCapLog('project-1', 'session_1', 60)).resolves.toBe(false);
    });
});
