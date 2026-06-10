import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { __researchLakeTestInternals } from '../services/researchLake.js';

const require = createRequire(import.meta.url);
const jpeg = require('jpeg-js') as {
    encode: (input: { data: Buffer; width: number; height: number }, quality?: number) => {
        data: Buffer;
    };
};

describe('research lake anonymized payload shape', () => {
    it('allows anonymized sample keys but rejects raw identity and location values', () => {
        const safePayload = {
            manifest: {
                lake: 'interaction',
                project_key: 'a1b2c3d4e5f607182930',
                sample_key: 'f'.repeat(32),
                files: {
                    ui_frames: `v1/lake=interaction/project_key=a1b2/date=2026-05-11/sample_key=${'f'.repeat(32)}/ui_frames.jsonl.gz`,
                },
            },
            frame: {
                frame_key: 'abc123',
                source_kind: 'rrweb',
                has_href: true,
                has_src: false,
                text_class: 'masked',
            },
        };

        expect(__researchLakeTestInternals.containsIdentifierRisk(safePayload)).toBe(false);
        expect(__researchLakeTestInternals.containsIdentifierRisk({ session_id: 'session_1778538040547_ec8c9af04f3c4bb0b1a3fe0d3fb8e84c' })).toBe(true);
        expect(__researchLakeTestInternals.containsIdentifierRisk({ raw_url: 'https://example.com/account/123' })).toBe(true);
        expect(__researchLakeTestInternals.containsIdentifierRisk({ email: 'person@example.com' })).toBe(true);
        expect(__researchLakeTestInternals.containsIdentifierRisk({ network: '127.0.0.1' })).toBe(true);
        expect(__researchLakeTestInternals.containsIdentifierRisk({ device_id: 'device-123' })).toBe(true);
    });

    it('extracts compact screenshot feature grids without storing raw pixels', () => {
        const width = 16;
        const height = 16;
        const data = Buffer.alloc(width * height * 4);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const offset = (y * width + x) * 4;
                data[offset] = x * 16;
                data[offset + 1] = y * 16;
                data[offset + 2] = (x + y) * 8;
                data[offset + 3] = 255;
            }
        }

        const jpegFrame = jpeg.encode({ data, width, height }, 80).data;
        const features = __researchLakeTestInternals.imageFeatureGrid(jpegFrame);

        expect(features).not.toBeNull();
        expect(features?.width).toBe(width);
        expect(features?.height).toBe(height);
        expect(features?.lumaGrid).toHaveLength(64);
        expect(features?.edgeGrid).toHaveLength(64);
        expect(features?.colorGrid).toHaveLength(64);
        expect(features?.lumaGrid.every((value) => value >= 0 && value <= 15)).toBe(true);
        expect(features?.edgeGrid.every((value) => value >= 0 && value <= 15)).toBe(true);
    });
});
