import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    and: vi.fn((...args) => ({ args })),
    desc: vi.fn((...args) => ({ args })),
    eq: vi.fn((...args) => ({ args })),
    isNotNull: vi.fn((...args) => ({ args })),
    isNull: vi.fn((...args) => ({ args })),
    or: vi.fn((...args) => ({ args })),
    db: {
        select: vi.fn(),
    },
    storageEndpoints: {
        active: 'storage_endpoints.active',
        priority: 'storage_endpoints.priority',
        projectId: 'storage_endpoints.project_id',
        shadow: 'storage_endpoints.shadow',
    } as any,
    safeDecrypt: vi.fn(() => 'secret'),
    logger: {
        debug: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
    },
    send: vi.fn(),
    destroy: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
    and: mocks.and,
    desc: mocks.desc,
    eq: mocks.eq,
    isNotNull: mocks.isNotNull,
    isNull: mocks.isNull,
    or: mocks.or,
}));

vi.mock('../db/client.js', () => ({
    db: mocks.db,
}));

vi.mock('../db/schema.js', () => ({
    storageEndpoints: mocks.storageEndpoints,
}));

vi.mock('../services/crypto.js', () => ({
    safeDecrypt: mocks.safeDecrypt,
}));

vi.mock('../logger.js', () => ({
    logger: mocks.logger,
}));

vi.mock('../config.js', () => ({
    config: {
        NODE_ENV: 'test',
        S3_ENDPOINT: '',
        S3_PUBLIC_ENDPOINT: '',
    },
}));

vi.mock('@aws-sdk/client-s3', () => {
    class MockCommand {
        input: Record<string, unknown>;

        constructor(input: Record<string, unknown>) {
            this.input = input;
        }
    }

    return {
        S3Client: class {
            send = mocks.send;
            destroy = mocks.destroy;
        },
        PutObjectCommand: MockCommand,
        GetObjectCommand: MockCommand,
        DeleteObjectCommand: MockCommand,
        HeadObjectCommand: MockCommand,
        ListObjectsV2Command: MockCommand,
        DeleteObjectsCommand: MockCommand,
    };
});

import { checkS3Connection, clearEndpointCaches } from '../db/s3.js';

const GLOBAL_ENDPOINT = {
    id: 'global_endpoint',
    projectId: null,
    endpointUrl: 'https://storage.local',
    bucket: 'recordings',
    region: 'us-east-1',
    accessKeyId: 'access',
    keyRef: 'encrypted-secret',
    priority: 10,
    active: true,
    shadow: false,
    storageClass: null,
};

function mockGlobalEndpointQuery(): void {
    mocks.db.select.mockImplementation(() => ({
        from: vi.fn(() => ({
            where: vi.fn(() => ({
                orderBy: vi.fn(() => ({
                    limit: vi.fn(async () => [GLOBAL_ENDPOINT]),
                })),
            })),
        })),
    }));
}

describe('S3 readiness health cache', () => {
    beforeEach(() => {
        clearEndpointCaches();
        vi.clearAllMocks();
        mockGlobalEndpointQuery();
        mocks.send.mockResolvedValue({});
    });

    afterEach(() => {
        vi.restoreAllMocks();
        clearEndpointCaches();
    });

    it('deduplicates concurrent checks and reuses the result for 30 seconds', async () => {
        let releaseCheck: (() => void) | undefined;
        mocks.send.mockImplementationOnce(() => new Promise((resolve) => {
            releaseCheck = () => resolve({});
        }));

        const firstCheck = checkS3Connection();
        const secondCheck = checkS3Connection();

        await vi.waitFor(() => {
            expect(mocks.send).toHaveBeenCalledTimes(1);
        });
        releaseCheck?.();

        await expect(Promise.all([firstCheck, secondCheck])).resolves.toEqual([true, true]);
        await expect(checkS3Connection()).resolves.toBe(true);
        expect(mocks.db.select).toHaveBeenCalledTimes(1);
        expect(mocks.send).toHaveBeenCalledTimes(1);
    });

    it('caches an unhealthy result to avoid probe-driven retry storms', async () => {
        mocks.send.mockRejectedValueOnce(new Error('storage unavailable'));

        await expect(checkS3Connection()).resolves.toBe(false);
        await expect(checkS3Connection()).resolves.toBe(false);

        expect(mocks.db.select).toHaveBeenCalledTimes(1);
        expect(mocks.send).toHaveBeenCalledTimes(1);
        expect(mocks.logger.warn).toHaveBeenCalledTimes(1);
    });

    it('refreshes the cached result after its 30-second TTL', async () => {
        const now = vi.spyOn(Date, 'now').mockReturnValue(1_000);

        await expect(checkS3Connection()).resolves.toBe(true);

        now.mockReturnValue(30_999);
        await expect(checkS3Connection()).resolves.toBe(true);
        expect(mocks.send).toHaveBeenCalledTimes(1);

        now.mockReturnValue(31_000);
        await expect(checkS3Connection()).resolves.toBe(true);
        expect(mocks.db.select).toHaveBeenCalledTimes(2);
        expect(mocks.send).toHaveBeenCalledTimes(2);
    });

    it('clears cached health together with endpoint and client caches', async () => {
        await expect(checkS3Connection()).resolves.toBe(true);

        clearEndpointCaches();

        await expect(checkS3Connection()).resolves.toBe(true);
        expect(mocks.db.select).toHaveBeenCalledTimes(2);
        expect(mocks.send).toHaveBeenCalledTimes(2);
    });

    it('does not let a cleared in-flight check overwrite a newer result', async () => {
        let releaseFirstCheck: (() => void) | undefined;
        mocks.send
            .mockImplementationOnce(() => new Promise((resolve) => {
                releaseFirstCheck = () => resolve({});
            }))
            .mockRejectedValueOnce(new Error('storage unavailable'));

        const staleCheck = checkS3Connection();
        await vi.waitFor(() => {
            expect(mocks.send).toHaveBeenCalledTimes(1);
        });

        clearEndpointCaches();
        await expect(checkS3Connection()).resolves.toBe(false);
        releaseFirstCheck?.();
        await expect(staleCheck).resolves.toBe(true);

        await expect(checkS3Connection()).resolves.toBe(false);
        expect(mocks.send).toHaveBeenCalledTimes(2);
    });
});
