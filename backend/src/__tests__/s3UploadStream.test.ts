import { Readable } from 'stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    and: vi.fn((...args) => ({ args })),
    desc: vi.fn((...args) => ({ args })),
    eq: vi.fn((...args) => ({ args })),
    isNull: vi.fn((...args) => ({ args })),
    or: vi.fn((...args) => ({ args })),
    db: {
        select: vi.fn(),
    },
    storageEndpoints: { id: 'storage_endpoints.id' } as any,
    safeDecrypt: vi.fn(() => 'secret'),
    logger: {
        debug: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
    },
    mockS3Send: vi.fn(),
    getSignedUrl: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
    and: mocks.and,
    desc: mocks.desc,
    eq: mocks.eq,
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
        S3_ENDPOINT: '',
        S3_PUBLIC_ENDPOINT: '',
    },
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
    getSignedUrl: mocks.getSignedUrl,
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
            send = mocks.mockS3Send;
        },
        PutObjectCommand: MockCommand,
        GetObjectCommand: MockCommand,
        DeleteObjectCommand: MockCommand,
        HeadObjectCommand: MockCommand,
        ListObjectsV2Command: MockCommand,
        DeleteObjectsCommand: MockCommand,
    };
});

import { uploadStreamToS3ForArtifact } from '../db/s3.js';

function queueEndpoint(id: string) {
    mocks.db.select.mockImplementationOnce(() => ({
        from: vi.fn(() => ({
            where: vi.fn(() => ({
                limit: vi.fn(async () => [{
                    id,
                    projectId: null,
                    endpointUrl: 'https://storage.local',
                    bucket: 'bucket',
                    region: 'us-east-1',
                    accessKeyId: 'access',
                    keyRef: 'encrypted-secret',
                    priority: 0,
                    active: true,
                    shadow: false,
                }]),
            })),
        })),
    }));
}

describe('uploadStreamToS3ForArtifact', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.mockS3Send.mockImplementation(async (command: { input?: Record<string, unknown> }) => {
            const body = command.input?.Body;
            if (body && typeof (body as AsyncIterable<Uint8Array>)[Symbol.asyncIterator] === 'function') {
                for await (const _chunk of body as AsyncIterable<Uint8Array>) {
                    // Drain the body to simulate the S3 client consuming the upload stream.
                }
            }
            return {};
        });
    });

    it('returns a controlled aborted failure when the request stream disconnects', async () => {
        queueEndpoint('endpoint_abort');

        const body = new Readable({
            read() {
                this.push(Buffer.from('partial'));
                const err = new Error('aborted') as Error & { code?: string };
                err.code = 'ECONNRESET';
                this.destroy(err);
            },
        });

        const result = await uploadStreamToS3ForArtifact(
            'project_1',
            'tenant/project/session/screenshots/1000.tar.gz',
            body,
            'application/gzip',
            'endpoint_abort',
            7,
        );

        expect(result).toMatchObject({
            success: false,
            endpointId: 'endpoint_abort',
            errorType: 'aborted',
        });
    });

    it('still succeeds for a normal upload stream', async () => {
        queueEndpoint('endpoint_success');

        const result = await uploadStreamToS3ForArtifact(
            'project_1',
            'tenant/project/session/screenshots/1001.tar.gz',
            Readable.from([Buffer.from('ok')]),
            'application/gzip',
            'endpoint_success',
            2,
        );

        expect(result).toEqual({
            success: true,
            endpointId: 'endpoint_success',
        });
    });
});
