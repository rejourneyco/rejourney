import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import { isMaybeGzippedJson, parseMaybeGzippedJson } from '../utils/gzipJson.js';

describe('parseMaybeGzippedJson', () => {
    const payload = {
        events: [{ timestamp: 123, type: 'tap' }],
        metadata: { platform: 'android' },
    };
    const rawJson = Buffer.from(JSON.stringify(payload));

    it('parses gzip detected by magic bytes without relying on the object extension', async () => {
        await expect(parseMaybeGzippedJson(gzipSync(rawJson), 'events.json')).resolves.toEqual(payload);
    });

    it('parses ordinary raw JSON without attempting decompression', async () => {
        await expect(parseMaybeGzippedJson(rawJson, 'events.json')).resolves.toEqual(payload);
    });

    it('falls back to raw JSON for a mislabeled .gz object', async () => {
        await expect(parseMaybeGzippedJson(rawJson, 'events.json.gz')).resolves.toEqual(payload);
    });

    it('rejects corrupt gzip bytes after preserving the raw-JSON fallback', async () => {
        const corruptGzip = Buffer.from([0x1f, 0x8b, 0x00, 0x01, 0x02]);

        await expect(parseMaybeGzippedJson(corruptGzip, 'events.json')).rejects.toBeInstanceOf(SyntaxError);
    });

    it('supports both historical route magic-length checks exactly', () => {
        const twoMagicBytes = Buffer.from([0x1f, 0x8b]);

        expect(isMaybeGzippedJson(twoMagicBytes, 'events.json', 2)).toBe(true);
        expect(isMaybeGzippedJson(twoMagicBytes, 'events.json', 3)).toBe(false);
        expect(isMaybeGzippedJson(Buffer.alloc(0), 'events.json.gz', 3)).toBe(true);
    });
});
