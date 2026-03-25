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

    if (parts.length >= 7 && parts[1] === 'session') {
        return {
            sessionId: `${parts[1]}_${parts[2]}_${parts[3]}`,
            contentType: parts[4] || '',
            batchNumber: parts[5] || '',
        };
    }

    if (parts.length >= 5) {
        return {
            sessionId: parts[1] || '',
            contentType: parts[2] || '',
            batchNumber: parts[3] || '',
        };
    }

    throw ApiError.badRequest('Invalid batchId format');
}

export function parseSegmentId(segmentId: string): {
    sessionId: string;
    kind: string;
    startTime: number;
} {
    const parts = segmentId.split('_');

    if (parts.length >= 7 && parts[1] === 'session') {
        return {
            sessionId: `${parts[1]}_${parts[2]}_${parts[3]}`,
            kind: parts[4] || '',
            startTime: Number.parseInt(parts[5] || '', 10),
        };
    }

    if (parts.length >= 5) {
        return {
            sessionId: parts[1] || '',
            kind: parts[2] || '',
            startTime: Number.parseInt(parts[3] || '', 10),
        };
    }

    throw ApiError.badRequest('Invalid segmentId format');
}

export function sanitizeIngestErrorMessage(err: unknown, maxLength = 1000): string {
    // eslint-disable-next-line no-control-regex
    return String(err).replace(/\x00/g, '').slice(0, maxLength);
}
