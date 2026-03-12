import { gunzipSync, gzipSync } from 'zlib';
import { describe, expect, it } from 'vitest';
import {
    isGzipBuffer,
    normalizeHierarchyArtifactBuffer,
} from '../services/hierarchyArtifactCompression.js';

describe('hierarchyArtifactCompression', () => {
    it('detects gzip magic bytes', () => {
        const gzipped = gzipSync(Buffer.from('{"ok":true}', 'utf8'));
        expect(isGzipBuffer(gzipped)).toBe(true);
        expect(isGzipBuffer(Buffer.from('{"ok":true}', 'utf8'))).toBe(false);
    });

    it('recompresses raw hierarchy JSON stored under a .json.gz key', () => {
        const raw = Buffer.from('{"timestamp":1,"root":{"type":"View"}}', 'utf8');
        const result = normalizeHierarchyArtifactBuffer('tenant/team/project/sessions/id/hierarchy/123.json.gz', raw);

        expect(result.repaired).toBe(true);
        expect(result.reason).toBe('recompressed_raw_json');
        expect(isGzipBuffer(result.normalizedBuffer)).toBe(true);
        expect(gunzipSync(result.normalizedBuffer).toString('utf8')).toBe(raw.toString('utf8'));
    });

    it('keeps already-gzipped hierarchy payloads unchanged', () => {
        const gzipped = gzipSync(Buffer.from('{"timestamp":2}', 'utf8'));
        const result = normalizeHierarchyArtifactBuffer('tenant/team/project/sessions/id/hierarchy/124.json.gz', gzipped);

        expect(result.repaired).toBe(false);
        expect(result.reason).toBe('already_gzipped');
        expect(result.normalizedBuffer).toEqual(gzipped);
    });

    it('does not touch non-target keys', () => {
        const raw = Buffer.from('{"timestamp":3}', 'utf8');
        const result = normalizeHierarchyArtifactBuffer('tenant/team/project/sessions/id/hierarchy/125.json', raw);

        expect(result.repaired).toBe(false);
        expect(result.reason).toBe('not_target');
        expect(result.normalizedBuffer).toEqual(raw);
    });

    it('refuses to repair invalid raw payloads', () => {
        const invalid = Buffer.from('not-json', 'utf8');
        const result = normalizeHierarchyArtifactBuffer('tenant/team/project/sessions/id/hierarchy/126.json.gz', invalid);

        expect(result.repaired).toBe(false);
        expect(result.reason).toBe('invalid_raw_payload');
        expect(result.normalizedBuffer).toEqual(invalid);
    });
});
