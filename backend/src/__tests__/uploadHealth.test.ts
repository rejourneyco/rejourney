import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { pingMock, poolQueryMock } = vi.hoisted(() => ({
    pingMock: vi.fn(async () => 'PONG'),
    poolQueryMock: vi.fn(async () => ({ rows: [{ '?column?': 1 }] })),
}));

vi.mock('../db/client.js', () => ({
    pool: {
        query: poolQueryMock,
    },
}));

vi.mock('../db/redis.js', () => ({
    getRedis: () => ({ ping: pingMock }),
}));

import { checkUploadDependencies } from '../services/uploadHealth.js';

describe('upload health dependencies', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        poolQueryMock.mockResolvedValue({ rows: [{ '?column?': 1 }] });
        pingMock.mockResolvedValue('PONG');
    });

    it('checks Postgres through the self-releasing pool query path and then Redis', async () => {
        await expect(checkUploadDependencies()).resolves.toBeUndefined();

        expect(poolQueryMock).toHaveBeenCalledWith('SELECT 1');
        expect(pingMock).toHaveBeenCalledTimes(1);
    });

    it('propagates a database failure without checking out a client manually', async () => {
        poolQueryMock.mockRejectedValue(new Error('database unavailable'));

        await expect(checkUploadDependencies()).rejects.toThrow('database unavailable');
        expect(pingMock).not.toHaveBeenCalled();
    });

    it('keeps local probes role-correct and never probes one-shot schema jobs', () => {
        const manifest = readFileSync(`${process.cwd()}/../local-k8s/api.yaml`, 'utf8');
        const documents = manifest.split(/^---$/m);
        const clickhouseSetup = documents.find((document) => (
            document.includes('kind: Job') && document.includes('name: clickhouse-setup')
        ));
        const uploadServer = documents.find((document) => (
            document.includes('kind: Deployment') && document.includes('name: ingest-upload')
        ));

        expect(clickhouseSetup).toBeDefined();
        expect(clickhouseSetup).not.toContain('livenessProbe:');
        expect(clickhouseSetup).not.toContain('readinessProbe:');
        expect(uploadServer).toContain('path: /health/live');
        expect(uploadServer).toContain('path: /health/ready');
    });
});
