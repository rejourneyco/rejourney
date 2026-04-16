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
     * Quality tier used for sessions intentionally started with observeOnly:true.
     * These are not broken — they just have no visual artifacts by design.
     */
    export const OBSERVE_ONLY_QUALITY_TIER: string;

    export function evaluateBackupQuality(input: {
        manifest: unknown;
        plannedArtifactCount: number;
        artifactCount: number;
        actualR2ArtifactCount: number;
        actualR2ObjectCount: number;
        manifestPresent: boolean;
        /** When true, short-circuits all checks and returns observe_only quality tier */
        observeOnly?: boolean;
    }): BackupQualityResult;
}
