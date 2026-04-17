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

    export const BACKUP_QUALITY_RULE_VERSION: number;
    /**
     * Quality tier used for successfully backed up observe-only sessions whose
     * artifact set matches the non-visual profile.
     */
    export const OBSERVE_ONLY_QUALITY_TIER: string;

    export function evaluateBackupQuality(input: {
        manifest: unknown;
        plannedArtifactCount: number;
        artifactCount: number;
        actualR2ArtifactCount: number;
        actualR2ObjectCount: number;
        manifestPresent: boolean;
    }): BackupQualityResult;
}
