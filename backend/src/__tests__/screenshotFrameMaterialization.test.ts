import { gzipSync } from 'node:zlib';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    db: {
        select: vi.fn(),
    },
    downloadFromS3ForArtifact: vi.fn(),
    getSignedDownloadUrl: vi.fn(),
    getSignedDownloadUrlForProject: vi.fn(),
    redis: {
        del: vi.fn(async () => 1),
        get: vi.fn(async () => null),
        setex: vi.fn(async (_key: string, _ttlSeconds: number, _value: string) => 'OK'),
    },
    uploadToS3ForArtifact: vi.fn(
        async (): Promise<{ success: boolean; endpointId: string; error?: string }> => ({
            success: true,
            endpointId: 'endpoint-1',
        }),
    ),
}));

vi.mock('drizzle-orm', () => ({
    and: vi.fn((...args) => ({ args })),
    eq: vi.fn((...args) => ({ args })),
}));

vi.mock('../db/client.js', () => ({
    db: mocks.db,
    recordingArtifacts: {
        endpointId: 'recording_artifacts.endpoint_id',
        endTime: 'recording_artifacts.end_time',
        frameCount: 'recording_artifacts.frame_count',
        id: 'recording_artifacts.id',
        kind: 'recording_artifacts.kind',
        s3ObjectKey: 'recording_artifacts.s3_object_key',
        sessionId: 'recording_artifacts.session_id',
        startTime: 'recording_artifacts.start_time',
        status: 'recording_artifacts.status',
    },
    sessions: {
        endedAt: 'sessions.ended_at',
        id: 'sessions.id',
        projectId: 'sessions.project_id',
        startedAt: 'sessions.started_at',
    },
}));

vi.mock('../db/redis.js', () => ({
    getRedis: () => mocks.redis,
}));

vi.mock('../db/s3.js', () => ({
    downloadFromS3ForArtifact: mocks.downloadFromS3ForArtifact,
    getSignedDownloadUrl: mocks.getSignedDownloadUrl,
    getSignedDownloadUrlForProject: mocks.getSignedDownloadUrlForProject,
    uploadToS3ForArtifact: mocks.uploadToS3ForArtifact,
}));

vi.mock('../logger.js', () => ({
    logger: {
        debug: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
    },
}));

import { getSessionScreenshotFrames } from '../services/screenshotFrames.js';

function tarHeader(name: string, size: number): Buffer {
    const header = Buffer.alloc(512, 0);
    header.write(name, 0, 100, 'utf8');
    header.write('0000777\0', 100, 8, 'ascii');
    header.write('0000000\0', 108, 8, 'ascii');
    header.write('0000000\0', 116, 8, 'ascii');
    header.write(size.toString(8).padStart(11, '0') + '\0', 124, 12, 'ascii');
    header.write('00000000000\0', 136, 12, 'ascii');
    header.fill(0x20, 148, 156);
    header[156] = '0'.charCodeAt(0);

    let checksum = 0;
    for (const byte of header) checksum += byte;
    header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
    return header;
}

function tarGzipFiles(files: Array<{ name: string; data: Buffer }>): Buffer {
    const parts: Buffer[] = [];
    for (const file of files) {
        const padding = Buffer.alloc((512 - (file.data.length % 512)) % 512, 0);
        parts.push(tarHeader(file.name, file.data.length), file.data, padding);
    }
    parts.push(Buffer.alloc(1024, 0));
    return gzipSync(Buffer.concat(parts));
}

function queueSessionAndSegments(
    startedAt: Date,
    segments: Array<Record<string, unknown>>,
): void {
    mocks.db.select
        .mockImplementationOnce(() => ({
            from: vi.fn(() => ({
                where: vi.fn(() => ({
                    limit: vi.fn(async () => [{
                        projectId: 'project-1',
                        startedAt,
                        endedAt: null,
                    }]),
                })),
            })),
        }))
        .mockImplementationOnce(() => ({
            from: vi.fn(() => ({
                where: vi.fn(() => ({
                    orderBy: vi.fn(async () => segments),
                })),
            })),
        }));
}

describe('screenshot frame materialization', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.redis.get.mockResolvedValue(null);
        mocks.redis.setex.mockResolvedValue('OK');
        mocks.uploadToS3ForArtifact.mockResolvedValue({
            success: true,
            endpointId: 'endpoint-1',
        });
    });

    it('shares one same-key upload promise while preserving duplicate frame entries, count, and order', async () => {
        const sessionId = 'session-1';
        const startedAt = new Date('2026-06-12T18:00:00.000Z');
        const timestamp = startedAt.getTime() + 500;
        const firstJpeg = Buffer.from([0xff, 0xd8, 0xff, 0x01, 0xd9]);
        const secondJpeg = Buffer.from([0xff, 0xd8, 0xff, 0x02, 0xd9]);
        const archive = tarGzipFiles([
            { name: `${startedAt.getTime()}_1_500.jpeg`, data: firstJpeg },
            { name: `${startedAt.getTime()}_1_${timestamp}.jpeg`, data: secondJpeg },
        ]);

        queueSessionAndSegments(startedAt, [{
            artifactId: 'artifact-1',
            archiveS3Key: 'tenant/team/project/session/screenshots/segment.tar.gz',
            endpointId: 'endpoint-1',
            startTime: startedAt.getTime(),
            endTime: null,
            frameCount: 2,
        }]);
        mocks.downloadFromS3ForArtifact.mockResolvedValue(archive);

        const result = await getSessionScreenshotFrames(sessionId, {
            skipCache: true,
            urlMode: 'none',
        });

        expect(mocks.uploadToS3ForArtifact).toHaveBeenCalledTimes(1);
        expect(mocks.uploadToS3ForArtifact).toHaveBeenCalledWith(
            'project-1',
            `sessions/${sessionId}/frames/${timestamp}.jpg`,
            firstJpeg,
            'image/jpeg',
            {
                session_id: sessionId,
                kind: 'screenshot_frame',
                timestamp: String(timestamp),
            },
            'endpoint-1',
        );

        expect(result).toMatchObject({
            totalFrames: 2,
            processedSegments: 1,
            totalSegments: 1,
            frames: [
                { timestamp, index: 0, url: '' },
                { timestamp, index: 1, url: '' },
            ],
        });

        const finalCacheCall = mocks.redis.setex.mock.calls.at(-1);
        const cached = JSON.parse(String(finalCacheCall?.[2]));
        expect(cached.totalFrames).toBe(2);
        expect(cached.frames).toEqual([
            expect.objectContaining({
                timestamp,
                index: 0,
                s3Key: `sessions/${sessionId}/frames/${timestamp}.jpg`,
                endpointId: 'endpoint-1',
                directReady: true,
            }),
            expect.objectContaining({
                timestamp,
                index: 1,
                s3Key: `sessions/${sessionId}/frames/${timestamp}.jpg`,
                endpointId: 'endpoint-1',
                directReady: true,
            }),
        ]);
    });

    it('evicts a failed shared upload so a later duplicate can retry the same key', async () => {
        const sessionId = 'session-retry';
        const startedAt = new Date('2026-06-12T18:00:00.000Z');
        const timestamp = startedAt.getTime() + 500;
        const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
        const duplicateArchive = tarGzipFiles([
            { name: `${startedAt.getTime()}_1_500.jpeg`, data: jpeg },
            { name: `${startedAt.getTime()}_1_${timestamp}.jpeg`, data: jpeg },
        ]);
        const retryArchive = tarGzipFiles([
            { name: `${startedAt.getTime()}_1_500.jpeg`, data: jpeg },
        ]);

        queueSessionAndSegments(startedAt, [
            {
                artifactId: 'artifact-1',
                archiveS3Key: 'tenant/team/project/session/screenshots/segment-1.tar.gz',
                endpointId: 'endpoint-1',
                startTime: startedAt.getTime(),
                endTime: null,
                frameCount: 2,
            },
            {
                artifactId: 'artifact-2',
                archiveS3Key: 'tenant/team/project/session/screenshots/segment-2.tar.gz',
                endpointId: 'endpoint-1',
                startTime: startedAt.getTime(),
                endTime: null,
                frameCount: 1,
            },
        ]);
        mocks.downloadFromS3ForArtifact
            .mockResolvedValueOnce(duplicateArchive)
            .mockResolvedValueOnce(retryArchive);
        mocks.uploadToS3ForArtifact
            .mockResolvedValueOnce({
                success: false,
                endpointId: 'endpoint-1',
                error: 'transient conflict',
            })
            .mockResolvedValueOnce({
                success: true,
                endpointId: 'endpoint-1',
            });

        const result = await getSessionScreenshotFrames(sessionId, {
            skipCache: true,
            urlMode: 'none',
        });

        expect(mocks.uploadToS3ForArtifact).toHaveBeenCalledTimes(2);
        expect(result).toMatchObject({
            totalFrames: 3,
            processedSegments: 2,
            totalSegments: 2,
            frames: [
                { timestamp, index: 0, url: '' },
                { timestamp, index: 1, url: '' },
                { timestamp, index: 2, url: '' },
            ],
        });

        const finalCacheCall = mocks.redis.setex.mock.calls.at(-1);
        const cached = JSON.parse(String(finalCacheCall?.[2]));
        expect(cached.frames).toEqual([
            expect.objectContaining({
                timestamp,
                index: 0,
                s3Key: null,
                directReady: false,
            }),
            expect.objectContaining({
                timestamp,
                index: 1,
                s3Key: null,
                directReady: false,
            }),
            expect.objectContaining({
                timestamp,
                index: 2,
                s3Key: `sessions/${sessionId}/frames/${timestamp}.jpg`,
                endpointId: 'endpoint-1',
                directReady: true,
            }),
        ]);
    });
});
