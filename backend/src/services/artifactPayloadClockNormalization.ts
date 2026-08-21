import { gzipSync, gunzipSync } from 'zlib';
import { uploadToS3ForArtifact } from '../db/s3.js';
import {
    MAX_FUTURE_CLIENT_CLOCK_SKEW_MS,
    extractSessionClockMetadata,
    normalizeClientEpochMsForSession,
} from './sessionClock.js';

const EXPLICIT_EPOCH_MS_FIELD_NAMES = new Set([
    'time',
    'timems',
    'timestamp',
    'timestampms',
    'timestamps',
    'clienttimestamp',
    'clienttimestampms',
    'servertimestamp',
    'servertimestampms',
    'starttime',
    'starttimems',
    'endtime',
    'endtimems',
    'requeststarttime',
    'requestendtime',
    'responsestarttime',
    'responseendtime',
    'starttimestamp',
    'starttimestampms',
    'endtimestamp',
    'endtimestampms',
    'startedat',
    'startedatms',
    'endedat',
    'endedatms',
    'chunkstartedat',
    'chunkstartedatms',
    'chunkendedat',
    'chunkendedatms',
    'capturedat',
    'capturedatms',
    'capturetime',
    'capturetimems',
    'capturetimestamp',
    'capturetimestampms',
    'eventtime',
    'eventtimems',
    'eventtimestamp',
    'eventtimestampms',
    'createdat',
    'createdatms',
    'updatedat',
    'updatedatms',
    'savedat',
    'savedatms',
    'sentat',
    'sentatms',
    'receivedat',
    'receivedatms',
    'observedat',
    'observedatms',
    'reportedat',
    'reportedatms',
    'occurredat',
    'occurredatms',
    'detectedat',
    'detectedatms',
    'firstseenat',
    'firstseenatms',
    'lastseenat',
    'lastseenatms',
    'lastoccurredat',
    'lastoccurredatms',
    'lastuploadtime',
    'lastuploadtimems',
    'lastretrytime',
    'lastretrytimems',
]);

const RELATIVE_TIME_FIELD_RE = /(duration|elapsed|offset|latency|timeout|interval|ttl|age|uptime|runtime|backgroundtime|waittime|rendertime|processingtime|responsetime|loadtime)/i;
const EPOCH_MS_FIELD_RE = /(?:^|[_-])(?:timestamp|time|date)s?(?:ms)?$|(?:^|[_-])(?:started|ended|created|updated|saved|captured|observed|reported|occurred|detected|received|sent|firstseen|lastseen|lastoccurred)at(?:ms)?$/i;
const MIN_EPOCH_MS = 10_000_000_000;

export type ArtifactPayloadClockNormalizationResult = {
    data: Buffer;
    normalized: boolean;
    normalizedFieldCount: number;
    parsed: unknown | null;
    uploadedSizeBytes: number | null;
};

function isGzipBuffer(buffer: Buffer): boolean {
    return buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b;
}

function isEpochMsField(key: string | null): boolean {
    if (!key || RELATIVE_TIME_FIELD_RE.test(key)) return false;
    const normalizedKey = key.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    return EXPLICIT_EPOCH_MS_FIELD_NAMES.has(normalizedKey) ||
        EPOCH_MS_FIELD_RE.test(key) ||
        normalizedKey.endsWith('timestamp') ||
        normalizedKey.endsWith('timestampms') ||
        normalizedKey.endsWith('timems') ||
        normalizedKey.endsWith('datems') ||
        normalizedKey.endsWith('atms');
}

function parseJsonBuffer(data: Buffer): unknown {
    const raw = isGzipBuffer(data) ? gunzipSync(data) : data;
    return JSON.parse(raw.toString('utf8'));
}

function findEarliestFutureEpochMs(
    value: unknown,
    key: string | null,
    futureThresholdMs: number,
    earliest: number | null,
): number | null {
    if (typeof value === 'number' && value >= MIN_EPOCH_MS && isEpochMsField(key)) {
        if (value <= futureThresholdMs) return earliest;
        return earliest === null ? value : Math.min(earliest, value);
    }

    if (Array.isArray(value)) {
        for (const item of value) {
            earliest = findEarliestFutureEpochMs(item, key, futureThresholdMs, earliest);
        }
        return earliest;
    }

    if (value && typeof value === 'object') {
        for (const [childKey, childValue] of Object.entries(value)) {
            earliest = findEarliestFutureEpochMs(childValue, childKey, futureThresholdMs, earliest);
        }
    }

    return earliest;
}

function cloneWithNormalizedTimes(params: {
    dynamicCorrectionMs: number;
    key: string | null;
    serverNow: Date;
    session: { metadata?: unknown; startedAt?: Date | string | null };
    value: unknown;
}): { normalizedFieldCount: number; value: unknown } {
    if (typeof params.value === 'number' && params.value >= MIN_EPOCH_MS && isEpochMsField(params.key)) {
        const serverNowMs = params.serverNow.getTime();
        if (
            Number.isFinite(serverNowMs)
            && params.dynamicCorrectionMs > 0
            && params.value > serverNowMs + MAX_FUTURE_CLIENT_CLOCK_SKEW_MS
        ) {
            const corrected = Math.floor(params.value - params.dynamicCorrectionMs);
            if (corrected > 0) {
                return { normalizedFieldCount: corrected === params.value ? 0 : 1, value: corrected };
            }
        }

        const normalized = normalizeClientEpochMsForSession(params.value, params.session, params.serverNow);
        if (normalized.normalized && normalized.value !== null) {
            return { normalizedFieldCount: 1, value: normalized.value };
        }
        return { normalizedFieldCount: 0, value: params.value };
    }

    if (Array.isArray(params.value)) {
        let normalizedFieldCount = 0;
        const value = params.value.map((item) => {
            const normalized = cloneWithNormalizedTimes({
                dynamicCorrectionMs: params.dynamicCorrectionMs,
                key: params.key,
                serverNow: params.serverNow,
                session: params.session,
                value: item,
            });
            normalizedFieldCount += normalized.normalizedFieldCount;
            return normalized.value;
        });
        return { normalizedFieldCount, value };
    }

    if (params.value && typeof params.value === 'object') {
        let normalizedFieldCount = 0;
        const value: Record<string, unknown> = {};
        for (const [key, childValue] of Object.entries(params.value)) {
            const normalized = cloneWithNormalizedTimes({
                dynamicCorrectionMs: params.dynamicCorrectionMs,
                key,
                serverNow: params.serverNow,
                session: params.session,
                value: childValue,
            });
            normalizedFieldCount += normalized.normalizedFieldCount;
            value[key] = normalized.value;
        }
        return { normalizedFieldCount, value };
    }

    return { normalizedFieldCount: 0, value: params.value };
}

export function normalizeArtifactPayloadClockFields(params: {
    data: Buffer;
    serverNow?: Date;
    session: { metadata?: unknown; startedAt?: Date | string | null };
}): ArtifactPayloadClockNormalizationResult {
    let parsed: unknown;
    try {
        parsed = parseJsonBuffer(params.data);
    } catch {
        return {
            data: params.data,
            normalized: false,
            normalizedFieldCount: 0,
            parsed: null,
            uploadedSizeBytes: null,
        };
    }

    const serverNow = params.serverNow ?? new Date();
    const hasStoredSessionClock = Boolean(extractSessionClockMetadata(params.session)?.clamped);
    const serverNowMs = serverNow.getTime();
    const sessionStartedAtMs = params.session.startedAt
        ? new Date(params.session.startedAt).getTime()
        : Number.NaN;
    const hasFutureSessionStart = Number.isFinite(serverNowMs)
        && Number.isFinite(sessionStartedAtMs)
        && sessionStartedAtMs > serverNowMs + MAX_FUTURE_CLIENT_CLOCK_SKEW_MS;
    const earliestFutureEpochMs = Number.isFinite(serverNowMs) && !hasStoredSessionClock
        ? findEarliestFutureEpochMs(
            parsed,
            null,
            serverNowMs + MAX_FUTURE_CLIENT_CLOCK_SKEW_MS,
            null,
        )
        : null;

    // The normal path has neither a stored/session correction nor a future
    // timestamp. Return after one read-only traversal instead of cloning the
    // complete artifact object graph.
    if (!hasStoredSessionClock && !hasFutureSessionStart && earliestFutureEpochMs === null) {
        return {
            data: params.data,
            normalized: false,
            normalizedFieldCount: 0,
            parsed,
            uploadedSizeBytes: null,
        };
    }

    const dynamicCorrectionMs = earliestFutureEpochMs === null
        ? 0
        : Math.max(0, earliestFutureEpochMs - serverNowMs);

    const normalized = cloneWithNormalizedTimes({
        dynamicCorrectionMs,
        key: null,
        serverNow,
        session: params.session,
        value: parsed,
    });

    if (normalized.normalizedFieldCount === 0) {
        return {
            data: params.data,
            normalized: false,
            normalizedFieldCount: 0,
            parsed,
            uploadedSizeBytes: null,
        };
    }

    const data = Buffer.from(JSON.stringify(normalized.value), 'utf8');
    return {
        data,
        normalized: true,
        normalizedFieldCount: normalized.normalizedFieldCount,
        parsed: normalized.value,
        uploadedSizeBytes: null,
    };
}

export async function normalizeArtifactPayloadClockFieldsInStorage(params: {
    artifactId?: string | null;
    data: Buffer;
    endpointId?: string | null;
    kind: string;
    log?: { info: (payload: Record<string, unknown>, message: string) => void };
    projectId: string;
    s3Key: string;
    session: { id?: string | null; metadata?: unknown; startedAt?: Date | string | null };
}): Promise<ArtifactPayloadClockNormalizationResult> {
    const normalized = normalizeArtifactPayloadClockFields({
        data: params.data,
        session: params.session,
    });

    if (!normalized.normalized) return normalized;

    const uploadBody = params.s3Key.endsWith('.gz')
        ? gzipSync(normalized.data, { level: 9 })
        : normalized.data;
    const contentType = params.s3Key.endsWith('.gz')
        ? 'application/gzip'
        : 'application/json';

    const uploadResult = await uploadToS3ForArtifact(
        params.projectId,
        params.s3Key,
        uploadBody,
        contentType,
        {
            artifact_id: params.artifactId ?? '',
            session_id: params.session.id ?? '',
            kind: params.kind,
            clock_normalized: 'true',
        },
        params.endpointId,
    );

    if (!uploadResult.success) {
        throw new Error(uploadResult.error || `Failed to normalize artifact clock fields for ${params.s3Key}`);
    }

    params.log?.info({
        artifactId: params.artifactId ?? null,
        kind: params.kind,
        normalizedFieldCount: normalized.normalizedFieldCount,
        s3Key: params.s3Key,
        sessionId: params.session.id ?? null,
    }, 'Normalized future client-clock fields in artifact payload');

    return {
        ...normalized,
        uploadedSizeBytes: uploadBody.length,
    };
}
