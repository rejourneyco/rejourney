import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    send: vi.fn(),
    safeDecrypt: vi.fn(() => 'secret'),
    logger: {
        debug: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
    },
}));

vi.mock('../config.js', () => ({
    config: {
        S3_ENDPOINT: '',
        S3_PUBLIC_ENDPOINT: '',
        RETENTION_S3_CONCURRENCY: 4,
    },
}));

vi.mock('../services/crypto.js', () => ({
    safeDecrypt: mocks.safeDecrypt,
}));

vi.mock('../logger.js', () => ({
    logger: mocks.logger,
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
        },
        PutObjectCommand: MockCommand,
        GetObjectCommand: MockCommand,
        DeleteObjectCommand: MockCommand,
        HeadObjectCommand: MockCommand,
        ListObjectsV2Command: MockCommand,
        DeleteObjectsCommand: MockCommand,
    };
});

import {
    deletePrefixFromStorageEndpoints,
    normalizeStorageEndpointForS3Client,
    type StorageEndpoint,
} from '../db/s3.js';

function endpoint(overrides: Partial<StorageEndpoint> = {}): StorageEndpoint {
    return {
        id: 'endpoint_1',
        projectId: null,
        endpointUrl: 'https://storage.local',
        bucket: 'bucket',
        region: 'us-east-1',
        accessKeyId: 'access',
        keyRef: 'secret',
        priority: 0,
        active: true,
        shadow: false,
        storageClass: null,
        ...overrides,
    };
}

describe('S3 retention deletion', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('normalizes bucket-hosted endpoints to virtual-hosted S3 addressing', () => {
        expect(normalizeStorageEndpointForS3Client(
            'https://rejourney-recordings-3.s3.nl-ams.scw.cloud',
            'rejourney-recordings-3',
        )).toEqual({
            endpointUrl: 'https://s3.nl-ams.scw.cloud',
            forcePathStyle: false,
            addressingMode: 'virtual-hosted',
        });

        expect(normalizeStorageEndpointForS3Client(
            'https://s3.us-east-va.io.cloud.ovh.us',
            'rejourney-recordings-2',
        )).toEqual({
            endpointUrl: 'https://s3.us-east-va.io.cloud.ovh.us',
            forcePathStyle: true,
            addressingMode: 'path-style',
        });
    });

    it('treats a missing listed prefix as already deleted', async () => {
        const err = Object.assign(new Error('The specified key does not exist.'), {
            name: 'NoSuchKey',
            Code: 'NoSuchKey',
            $metadata: { httpStatusCode: 404 },
        });
        mocks.send.mockRejectedValueOnce(err);

        const result = await deletePrefixFromStorageEndpoints('tenant/team/project/session/', [
            endpoint({
                id: 'endpoint_missing',
                endpointUrl: 'https://rejourney-recordings-3.s3.nl-ams.scw.cloud',
                bucket: 'rejourney-recordings-3',
            }),
        ]);

        expect(result.deletedObjectCount).toBe(0);
        expect(result.deletedBytes).toBe(0);
        expect(result.endpointResults[0]).toMatchObject({
            endpointId: 'endpoint_missing',
            bucket: 'rejourney-recordings-3',
            missingPrefix: true,
            listStatus: 'missing',
        });
    });
});
