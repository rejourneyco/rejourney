import { Readable } from 'node:stream';
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
    endpoint: {
        id: 'endpoint_retry',
        projectId: null,
        endpointUrl: 'https://storage.local',
        bucket: 'recordings',
        region: 'us-east-1',
        accessKeyId: 'access',
        keyRef: 'encrypted-secret',
        priority: 10,
        active: true,
        shadow: false,
        storageClass: 'STANDARD_IA',
    },
    getEndpointByIdCache: vi.fn(),
    setEndpointByIdCache: vi.fn(async () => undefined),
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
    storageEndpoints: {
        active: 'storage_endpoints.active',
        priority: 'storage_endpoints.priority',
        projectId: 'storage_endpoints.project_id',
        shadow: 'storage_endpoints.shadow',
    },
}));

vi.mock('../db/redis.js', () => ({
    getEndpointByIdCache: mocks.getEndpointByIdCache,
    setEndpointByIdCache: mocks.setEndpointByIdCache,
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

vi.mock('@aws-sdk/s3-request-presigner', () => ({
    getSignedUrl: vi.fn(),
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

import {
    S3_PUT_OPERATION_ABORTED_MAX_ATTEMPTS,
    clearEndpointCaches,
    isRetryableS3PutOperationAborted,
    uploadStreamToS3ForArtifact,
    uploadToS3ForArtifact,
} from '../db/s3.js';

function operationAbortedError(overrides: Record<string, unknown> = {}): Error {
    return Object.assign(new Error('A conflicting conditional operation is currently in progress'), {
        name: 'OperationAborted',
        $metadata: { httpStatusCode: 409 },
        ...overrides,
    });
}

function mockNoShadowEndpoints(): void {
    mocks.db.select.mockImplementation(() => ({
        from: vi.fn(() => ({
            where: vi.fn(() => ({
                orderBy: vi.fn(async () => []),
            })),
        })),
    }));
}

describe('S3 PutObject OperationAborted retry', () => {
    beforeEach(() => {
        clearEndpointCaches();
        vi.clearAllMocks();
        mocks.getEndpointByIdCache.mockResolvedValue(mocks.endpoint);
        mocks.send.mockResolvedValue({});
        mockNoShadowEndpoints();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        clearEndpointCaches();
    });

    it.each([
        [{ name: 'OperationAborted', $metadata: { httpStatusCode: 409 } }],
        [{ name: 'S3ServiceException', Code: 'OperationAborted', statusCode: '409' }],
        [{ code: 'operationaborted', status: 409 }],
        [{ Code: 'OPERATIONABORTED', httpStatusCode: 409 }],
        [{ name: 'OperationAborted', $response: { statusCode: 409 } }],
    ])('recognizes the exact provider error fields: %o', (err) => {
        expect(isRetryableS3PutOperationAborted(err)).toBe(true);
    });

    it.each([
        [{ name: 'OperationAborted', $metadata: { httpStatusCode: 500 } }],
        [{ name: 'OperationAborted' }],
        [{ name: 'ConditionalRequestConflict', $metadata: { httpStatusCode: 409 } }],
        [{ name: 'AccessDenied', Code: 'OperationAbortedElsewhere', statusCode: 409 }],
        [{ message: 'OperationAborted', statusCode: 409 }],
        [null],
    ])('rejects non-exact retry candidates: %o', (err) => {
        expect(isRetryableS3PutOperationAborted(err)).toBe(false);
    });

    it('retries a replayable PutObject conflict and preserves every command input', async () => {
        vi.useFakeTimers();
        vi.spyOn(Math, 'random').mockReturnValue(0.5);
        mocks.send
            .mockRejectedValueOnce(operationAbortedError())
            .mockRejectedValueOnce(operationAbortedError({
                name: 'S3ServiceException',
                Code: 'OperationAborted',
                statusCode: 409,
            }))
            .mockResolvedValueOnce({});

        const body = Buffer.from('same bytes on every attempt');
        const metadata = { artifact_id: 'artifact_1', kind: 'rrweb' };
        const upload = uploadToS3ForArtifact(
            'project_1',
            'tenant/team/project/session/rrweb/segment.json.gz',
            body,
            'application/gzip',
            metadata,
            mocks.endpoint.id,
        );

        await vi.runAllTimersAsync();
        await expect(upload).resolves.toEqual({
            success: true,
            endpointId: mocks.endpoint.id,
        });
        expect(mocks.send).toHaveBeenCalledTimes(3);
        expect(mocks.logger.warn).toHaveBeenCalledTimes(2);

        const inputs = mocks.send.mock.calls.map(([command]) => command.input as Record<string, unknown>);
        for (const input of inputs) {
            expect(input).toEqual({
                Bucket: mocks.endpoint.bucket,
                Key: 'tenant/team/project/session/rrweb/segment.json.gz',
                Body: body,
                ContentType: 'application/gzip',
                Metadata: metadata,
                StorageClass: mocks.endpoint.storageClass,
            });
            expect(input.Body).toBe(body);
            expect(input.Metadata).toBe(metadata);
        }
    });

    it('stops at the bounded attempt cap and returns the existing failure shape', async () => {
        vi.useFakeTimers();
        vi.spyOn(Math, 'random').mockReturnValue(0.5);
        mocks.send.mockRejectedValue(operationAbortedError());

        const upload = uploadToS3ForArtifact(
            'project_1',
            'tenant/team/project/session/hierarchy/segment.json.gz',
            Buffer.from('{}'),
            'application/gzip',
            undefined,
            mocks.endpoint.id,
        );

        await vi.runAllTimersAsync();
        await expect(upload).resolves.toMatchObject({
            success: false,
            endpointId: mocks.endpoint.id,
            error: expect.stringContaining('OperationAborted'),
        });
        expect(mocks.send).toHaveBeenCalledTimes(S3_PUT_OPERATION_ABORTED_MAX_ATTEMPTS);
        expect(mocks.logger.warn).toHaveBeenCalledTimes(S3_PUT_OPERATION_ABORTED_MAX_ATTEMPTS - 1);
        expect(mocks.logger.error).toHaveBeenCalledTimes(1);
    });

    it('does not retry an unrelated HTTP 409', async () => {
        mocks.send.mockRejectedValueOnce(Object.assign(new Error('bucket conflict'), {
            name: 'BucketAlreadyExists',
            $metadata: { httpStatusCode: 409 },
        }));

        await expect(uploadToS3ForArtifact(
            'project_1',
            'tenant/team/project/session/screenshots/segment.tar.gz',
            Buffer.from('archive'),
            'application/gzip',
            undefined,
            mocks.endpoint.id,
        )).resolves.toMatchObject({ success: false });

        expect(mocks.send).toHaveBeenCalledTimes(1);
        expect(mocks.logger.warn).not.toHaveBeenCalled();
    });

    it('keeps the non-replayable stream upload one-shot', async () => {
        mocks.send.mockRejectedValueOnce(operationAbortedError());

        await expect(uploadStreamToS3ForArtifact(
            'project_1',
            'tenant/team/project/session/screenshots/stream.tar.gz',
            Readable.from([Buffer.from('archive')]),
            'application/gzip',
            mocks.endpoint.id,
            7,
        )).resolves.toMatchObject({
            success: false,
            endpointId: mocks.endpoint.id,
            errorType: 'storage',
        });

        expect(mocks.send).toHaveBeenCalledTimes(1);
        expect(mocks.logger.warn).not.toHaveBeenCalled();
    });
});
