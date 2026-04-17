import { describe, expect, it } from 'vitest';

// @ts-expect-error Shared backup-quality script is plain ESM under scripts/k8s.
import { evaluateBackupQuality } from '../../../scripts/k8s/backup-quality.mjs';

function buildManifest(overrides: Record<string, unknown> = {}) {
    return {
        version: '3.0',
        session: {
            id: 'session_1',
            durationSeconds: 12,
            ...((overrides.session as Record<string, unknown> | undefined) ?? {}),
        },
        artifacts: [
            { kind: 'events', startTime: 0, endTime: 4_000 },
            { kind: 'hierarchy', startTime: 0, endTime: 4_000 },
            { kind: 'screenshots', startTime: 0, endTime: 4_000 },
            ...((overrides.extraArtifacts as Record<string, unknown>[] | undefined) ?? []),
        ],
        backupArtifacts: [
            { kind: 'events', status: 'copied', repairStatus: 'unchanged', backupFormat: 'mirrored_source', frameCount: 0 },
            { kind: 'hierarchy', status: 'copied', repairStatus: 'unchanged', backupFormat: 'mirrored_source', frameCount: 0 },
            { kind: 'screenshots', status: 'copied', repairStatus: 'unchanged', backupFormat: 'tar_gzip_repacked_from_binary_bundle', frameCount: 12 },
            ...((overrides.extraBackupArtifacts as Record<string, unknown>[] | undefined) ?? []),
        ],
        ...overrides,
    };
}

describe('backup-quality evaluator', () => {
    it('marks structurally complete replay backups as high quality', () => {
        const result = evaluateBackupQuality({
            manifest: buildManifest(),
            plannedArtifactCount: 3,
            artifactCount: 3,
            actualR2ArtifactCount: 3,
            actualR2ObjectCount: 4,
            manifestPresent: true,
        });

        expect(result.highQuality).toBe(true);
        expect(result.qualityTier).toBe('high_quality');
        expect(result.qualityReason.reasons).toEqual([]);
    });

    it('downgrades short screenshot coverage to usable', () => {
        const result = evaluateBackupQuality({
            manifest: buildManifest({
                artifacts: [
                    { kind: 'events', startTime: 0, endTime: 2_000 },
                    { kind: 'hierarchy', startTime: 0, endTime: 2_000 },
                    { kind: 'screenshots', startTime: 0, endTime: 2_000 },
                ],
                backupArtifacts: [
                    { kind: 'events', status: 'copied', repairStatus: 'unchanged', backupFormat: 'mirrored_source', frameCount: 0 },
                    { kind: 'hierarchy', status: 'copied', repairStatus: 'unchanged', backupFormat: 'mirrored_source', frameCount: 0 },
                    { kind: 'screenshots', status: 'copied', repairStatus: 'unchanged', backupFormat: 'tar_gzip_repacked_from_binary_bundle', frameCount: 2 },
                ],
            }),
            plannedArtifactCount: 3,
            artifactCount: 3,
            actualR2ArtifactCount: 3,
            actualR2ObjectCount: 4,
            manifestPresent: true,
        });

        expect(result.highQuality).toBe(false);
        expect(result.qualityTier).toBe('usable');
        expect(result.qualityReason.reasons).toContain('too_short');
        expect(result.qualityReason.reasons).toContain('low_frame_count');
    });

    it('marks parity mismatches as broken', () => {
        const result = evaluateBackupQuality({
            manifest: buildManifest(),
            plannedArtifactCount: 3,
            artifactCount: 3,
            actualR2ArtifactCount: 2,
            actualR2ObjectCount: 3,
            manifestPresent: true,
        });

        expect(result.highQuality).toBe(false);
        expect(result.qualityTier).toBe('broken');
        expect(result.qualityReason.reasons).toContain('r2_artifact_count_mismatch');
    });

    it('classifies matching observe-only backups with a dedicated quality tier', () => {
        const result = evaluateBackupQuality({
            manifest: buildManifest({
                session: {
                    observeOnly: true,
                },
                artifacts: [
                    { kind: 'events', startTime: 0, endTime: 4_000 },
                    { kind: 'hierarchy', startTime: 0, endTime: 4_000 },
                ],
                backupArtifacts: [
                    { kind: 'events', status: 'copied', repairStatus: 'unchanged', backupFormat: 'mirrored_source', frameCount: 0 },
                    { kind: 'hierarchy', status: 'copied', repairStatus: 'unchanged', backupFormat: 'mirrored_source', frameCount: 0 },
                ],
            }),
            plannedArtifactCount: 2,
            artifactCount: 2,
            actualR2ArtifactCount: 2,
            actualR2ObjectCount: 3,
            manifestPresent: true,
        });

        expect(result.highQuality).toBe(false);
        expect(result.qualityTier).toBe('observe_only');
        expect(result.qualityReason.reasons).toEqual([]);
        expect(result.qualityReason.observeOnly).toBe(true);
        expect(result.qualityReason.expectedArtifactKinds).toEqual(['events', 'hierarchy']);
    });

    it('marks observe-only backups with screenshots as broken', () => {
        const result = evaluateBackupQuality({
            manifest: buildManifest({
                session: {
                    observeOnly: true,
                },
            }),
            plannedArtifactCount: 3,
            artifactCount: 3,
            actualR2ArtifactCount: 3,
            actualR2ObjectCount: 4,
            manifestPresent: true,
        });

        expect(result.highQuality).toBe(false);
        expect(result.qualityTier).toBe('broken');
        expect(result.qualityReason.reasons).toContain('unexpected_screenshots_for_observe_only');
    });

    it('marks malformed hierarchy payloads as broken', () => {
        const result = evaluateBackupQuality({
            manifest: buildManifest({
                backupArtifacts: [
                    { kind: 'events', status: 'copied', repairStatus: 'unchanged', backupFormat: 'mirrored_source', frameCount: 0 },
                    { kind: 'hierarchy', status: 'copied', repairStatus: 'skipped_invalid_payload', backupFormat: 'mirrored_source', frameCount: 0 },
                    { kind: 'screenshots', status: 'copied', repairStatus: 'unchanged', backupFormat: 'tar_gzip_repacked_from_binary_bundle', frameCount: 12 },
                ],
            }),
            plannedArtifactCount: 3,
            artifactCount: 3,
            actualR2ArtifactCount: 3,
            actualR2ObjectCount: 4,
            manifestPresent: true,
        });

        expect(result.highQuality).toBe(false);
        expect(result.qualityTier).toBe('broken');
        expect(result.qualityReason.reasons).toContain('invalid_hierarchy_payload');
    });
});
