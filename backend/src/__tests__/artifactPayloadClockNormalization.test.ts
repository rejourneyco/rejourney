import { describe, expect, it, vi } from 'vitest';
import { gunzipSync } from 'zlib';
import {
    MAX_FUTURE_CLIENT_CLOCK_SKEW_MS,
    SESSION_CLOCK_METADATA_KEY,
} from '../services/sessionClock.js';

type ArtifactUploadMock = (
    projectId: string,
    key: string,
    body: Buffer | string,
    contentType?: string,
    metadata?: Record<string, string>,
    endpointId?: string | null,
) => Promise<{ success: boolean; endpointId: string; error?: string }>;

const uploadToS3ForArtifactMock = vi.hoisted(() => vi.fn<ArtifactUploadMock>(async () => ({
    success: true,
    endpointId: 'endpoint_1',
})));

vi.mock('../db/s3.js', () => ({
    uploadToS3ForArtifact: uploadToS3ForArtifactMock,
}));

import {
    normalizeArtifactPayloadClockFields,
    normalizeArtifactPayloadClockFieldsInStorage,
} from '../services/artifactPayloadClockNormalization.js';

const SERVER_NOW = new Date('2026-06-12T18:00:00.000Z');
const RAW_SESSION_STARTED_AT_MS = Date.UTC(2026, 5, 27, 12, 15, 14, 606);
const FUTURE_SKEW_MS = RAW_SESSION_STARTED_AT_MS - SERVER_NOW.getTime();

function skewedSession() {
    return {
        id: 'session_1782562514606_f773101763561a6b10cbd164da847e8e',
        startedAt: SERVER_NOW,
        metadata: {
            [SESSION_CLOCK_METADATA_KEY]: {
                ruleVersion: 'future-client-clock-v1',
                clamped: true,
                rawSessionStartedAtMs: RAW_SESSION_STARTED_AT_MS,
                normalizedStartedAtMs: SERVER_NOW.getTime(),
                serverObservedAtMs: SERVER_NOW.getTime(),
                futureSkewMs: FUTURE_SKEW_MS,
                maxFutureSkewMs: MAX_FUTURE_CLIENT_CLOCK_SKEW_MS,
            },
        },
    };
}

describe('artifactPayloadClockNormalization', () => {
    it('normalizes numeric epoch-ms timestamp fields and preserves relative time fields', () => {
        const payload = {
            events: [
                {
                    timestamp: RAW_SESSION_STARTED_AT_MS + 1500,
                    payload: {
                        startTimestamp: RAW_SESSION_STARTED_AT_MS + 1000,
                        endTimestamp: RAW_SESSION_STARTED_AT_MS + 2500,
                        durationMs: 1500,
                        offsetMs: 42,
                        timestampSeconds: Math.floor(RAW_SESSION_STARTED_AT_MS / 1000),
                        timestampString: String(RAW_SESSION_STARTED_AT_MS),
                    },
                },
            ],
        };

        const normalized = normalizeArtifactPayloadClockFields({
            data: Buffer.from(JSON.stringify(payload), 'utf8'),
            serverNow: SERVER_NOW,
            session: skewedSession(),
        });

        expect(normalized.normalized).toBe(true);
        expect(normalized.normalizedFieldCount).toBe(3);

        const parsed = JSON.parse(normalized.data.toString('utf8'));
        expect(parsed.events[0].timestamp).toBe(SERVER_NOW.getTime() + 1500);
        expect(parsed.events[0].payload.startTimestamp).toBe(SERVER_NOW.getTime() + 1000);
        expect(parsed.events[0].payload.endTimestamp).toBe(SERVER_NOW.getTime() + 2500);
        expect(parsed.events[0].payload.durationMs).toBe(1500);
        expect(parsed.events[0].payload.offsetMs).toBe(42);
        expect(parsed.events[0].payload.timestampSeconds).toBe(Math.floor(RAW_SESSION_STARTED_AT_MS / 1000));
        expect(parsed.events[0].payload.timestampString).toBe(String(RAW_SESSION_STARTED_AT_MS));
    });

    it('normalizes nested SDK timestamp fields without changing relative frame timing', () => {
        const payload = {
            frames: [
                {
                    capturedAt: RAW_SESSION_STARTED_AT_MS + 33,
                    captureTimeMs: RAW_SESSION_STARTED_AT_MS + 44,
                    frameOffsetMs: 33,
                    renderTimeMs: 18,
                    runtimeMs: 2_000,
                },
            ],
            network: {
                startTimestamp: RAW_SESSION_STARTED_AT_MS + 100,
                endTimestamp: RAW_SESSION_STARTED_AT_MS + 350,
                duration: 250,
            },
            touches: [
                {
                    x: 100,
                    y: 200,
                    timestamp: RAW_SESSION_STARTED_AT_MS + 120,
                },
            ],
            savedAt: RAW_SESSION_STARTED_AT_MS + 400,
            deviceInfo: {
                time: Math.floor(RAW_SESSION_STARTED_AT_MS / 1000),
            },
        };

        const normalized = normalizeArtifactPayloadClockFields({
            data: Buffer.from(JSON.stringify(payload), 'utf8'),
            serverNow: SERVER_NOW,
            session: skewedSession(),
        });

        const parsed = JSON.parse(normalized.data.toString('utf8'));
        expect(normalized.normalizedFieldCount).toBe(6);
        expect(parsed.frames[0].capturedAt).toBe(SERVER_NOW.getTime() + 33);
        expect(parsed.frames[0].captureTimeMs).toBe(SERVER_NOW.getTime() + 44);
        expect(parsed.network.startTimestamp).toBe(SERVER_NOW.getTime() + 100);
        expect(parsed.network.endTimestamp).toBe(SERVER_NOW.getTime() + 350);
        expect(parsed.touches[0].timestamp).toBe(SERVER_NOW.getTime() + 120);
        expect(parsed.savedAt).toBe(SERVER_NOW.getTime() + 400);
        expect(parsed.frames[0].frameOffsetMs).toBe(33);
        expect(parsed.frames[0].renderTimeMs).toBe(18);
        expect(parsed.frames[0].runtimeMs).toBe(2_000);
        expect(parsed.deviceInfo.time).toBe(Math.floor(RAW_SESSION_STARTED_AT_MS / 1000));
    });

    it('leaves non-JSON binary artifacts unchanged', () => {
        const data = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);

        const normalized = normalizeArtifactPayloadClockFields({
            data,
            serverNow: SERVER_NOW,
            session: skewedSession(),
        });

        expect(normalized.normalized).toBe(false);
        expect(normalized.data).toBe(data);
        expect(normalized.normalizedFieldCount).toBe(0);
    });

    it('leaves server-corrected payloads unchanged for a skewed session', () => {
        const payload = {
            format: 'rrweb',
            events: [{ timestamp: SERVER_NOW.getTime() + 2000, data: { source: 0 } }],
        };

        const normalized = normalizeArtifactPayloadClockFields({
            data: Buffer.from(JSON.stringify(payload), 'utf8'),
            serverNow: SERVER_NOW,
            session: skewedSession(),
        });

        expect(normalized.normalized).toBe(false);
        expect(JSON.parse(normalized.data.toString('utf8'))).toEqual(payload);
        expect(normalized.parsed).toEqual(payload);
    });

    it('uses one payload-wide correction for future payloads without stored session metadata', () => {
        const payload = {
            events: [{
                timestamp: RAW_SESSION_STARTED_AT_MS + 500,
                payload: {
                    startTimestamp: RAW_SESSION_STARTED_AT_MS,
                    endTimestamp: RAW_SESSION_STARTED_AT_MS + 2500,
                },
            }],
        };

        const normalized = normalizeArtifactPayloadClockFields({
            data: Buffer.from(JSON.stringify(payload), 'utf8'),
            serverNow: SERVER_NOW,
            session: { startedAt: SERVER_NOW },
        });

        const parsed = JSON.parse(normalized.data.toString('utf8'));
        expect(parsed.events[0].payload.startTimestamp).toBe(SERVER_NOW.getTime());
        expect(parsed.events[0].timestamp).toBe(SERVER_NOW.getTime() + 500);
        expect(parsed.events[0].payload.endTimestamp).toBe(SERVER_NOW.getTime() + 2500);
    });

    it('rewrites normalized payloads back to gzipped S3 objects when the key is gzipped', async () => {
        uploadToS3ForArtifactMock.mockClear();
        const payload = {
            format: 'rrweb',
            events: [{ timestamp: RAW_SESSION_STARTED_AT_MS + 500 }],
        };

        const normalized = await normalizeArtifactPayloadClockFieldsInStorage({
            artifactId: 'artifact_1',
            data: Buffer.from(JSON.stringify(payload), 'utf8'),
            endpointId: 'endpoint_1',
            kind: 'rrweb',
            projectId: 'project_1',
            s3Key: 'tenant/team/project/sessions/session/rrweb/1782562514606.rrweb.json.gz',
            session: skewedSession(),
        });

        expect(normalized.normalized).toBe(true);
        expect(uploadToS3ForArtifactMock).toHaveBeenCalledTimes(1);
        const [, , uploadedBody, contentType] = uploadToS3ForArtifactMock.mock.calls[0];
        expect(contentType).toBe('application/gzip');
        const rewritten = JSON.parse(gunzipSync(uploadedBody as Buffer).toString('utf8'));
        expect(rewritten.events[0].timestamp).toBe(SERVER_NOW.getTime() + 500);
    });
});
