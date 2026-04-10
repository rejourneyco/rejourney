declare module '../../../scripts/k8s/backup-quality.mjs' {
    export interface BackupQualityResult {
        highQuality: boolean;
        qualityTier: string;
        qualityRuleVersion: number;
        manifestPresent: boolean;
        actualR2ArtifactCount: number;
        actualR2ObjectCount: number;
        qualityReason: {
            reasons: string[];
            [key: string]: unknown;
        };
    }

    export function evaluateBackupQuality(input: {
        manifest: unknown;
        plannedArtifactCount: number;
        artifactCount: number;
        actualR2ArtifactCount: number;
        actualR2ObjectCount: number;
        manifestPresent: boolean;
    }): BackupQualityResult;
}
