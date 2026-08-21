import { promisify } from 'node:util';
import { gunzip } from 'node:zlib';

const gunzipAsync = promisify(gunzip);

export type GzipMagicMinimumBytes = 2 | 3;

export function isMaybeGzippedJson(
    data: Buffer,
    s3ObjectKey?: string | null,
    gzipMagicMinimumBytes: GzipMagicMinimumBytes = 2,
): boolean {
    return (
        data.length >= gzipMagicMinimumBytes
        && data[0] === 0x1f
        && data[1] === 0x8b
    ) || Boolean(s3ObjectKey?.endsWith('.gz'));
}

/**
 * Parse artifact JSON without blocking the event loop while inflating gzip data.
 * If a `.gz` object actually contains raw JSON, retain the historical raw-JSON fallback.
 */
export async function parseMaybeGzippedJson(
    data: Buffer,
    s3ObjectKey?: string | null,
    gzipMagicMinimumBytes: GzipMagicMinimumBytes = 2,
): Promise<any> {
    if (!isMaybeGzippedJson(data, s3ObjectKey, gzipMagicMinimumBytes)) {
        return JSON.parse(data.toString('utf8'));
    }

    try {
        const decompressed = await gunzipAsync(data);
        return JSON.parse(decompressed.toString('utf8'));
    } catch {
        return JSON.parse(data.toString('utf8'));
    }
}
