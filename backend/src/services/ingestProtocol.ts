import { ApiError } from '../middleware/index.js';

export function extractDeviceIdFromUploadToken(req: any): string | null {
    const token = req.headers['x-upload-token'] as string;
    if (!token) return null;

    try {
        const [payloadB64] = token.split('.');
        if (!payloadB64) return null;

        const payload = JSON.parse(Buffer.from(payloadB64, 'base64').toString('utf8'));
        return payload.deviceId || null;
    } catch {
        return null;
    }
}

export function parseRequestedSizeBytes(value: unknown): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        throw ApiError.badRequest('sizeBytes must be a positive number');
    }
    return Math.floor(parsed);
}

export function parseBatchId(batchId: string): {
    sessionId: string;
    contentType: string;
    batchNumber: string;
} {
    const parts = batchId.split('_');
    if (parts.length >= 5 && parts[0] === 'batch') {
        const batchNumber = parts[parts.length - 2] || '';
        const contentType = parts[parts.length - 3] || '';
        const sessionId = parts.slice(1, parts.length - 3).join('_');

        if (sessionId) {
            return {
                sessionId,
                contentType,
                batchNumber,
            };
        }
    }

    throw ApiError.badRequest('Invalid batchId format');
}

export function buildReplaySegmentId(params: {
    sessionId: string;
    kind: 'screenshots' | 'hierarchy';
    startTime: number;
    endTime?: number | null;
}): string {
    const startTime = Math.floor(Number(params.startTime));
    const endTime = params.endTime == null ? 'na' : String(Math.floor(Number(params.endTime)));
    return `seg_${params.sessionId}_${params.kind}_${startTime}_${endTime}`;
}

export function parseSegmentId(segmentId: string): {
    sessionId: string;
    kind: string;
    startTime: number;
    endTime?: number | null;
} {
    const match = /^seg_(.+)_(screenshots|hierarchy)_(\d+)(?:_(\d+|na))?(?:_([0-9a-f]+))?$/i.exec(segmentId);
    if (match) {
        const sessionId = match[1] || '';
        const kind = match[2] || '';
        const startTime = Number.parseInt(match[3] || '', 10);
        const endTimeRaw = match[4];

        if (sessionId && Number.isFinite(startTime)) {
            return {
                sessionId,
                kind,
                startTime,
                endTime: endTimeRaw && endTimeRaw !== 'na'
                    ? Number.parseInt(endTimeRaw, 10)
                    : null,
            };
        }
    }

    throw ApiError.badRequest('Invalid segmentId format');
}

export function sanitizeIngestErrorMessage(err: unknown, maxLength = 1000): string {
    // eslint-disable-next-line no-control-regex
    return String(err).replace(/\x00/g, '').slice(0, maxLength);
}
