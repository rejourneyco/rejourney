export type ProtectedUniqueUserCount = {
    uniqueUserCount: number;
    preservedExisting: boolean;
};

function normalizeCount(value: number | null | undefined): number | null {
    if (value === null || value === undefined) return null;
    if (!Number.isFinite(value) || value < 0) return null;
    return Math.floor(value);
}

export function protectUniqueUserCountAfterIdentityScrub(params: {
    computedUniqueUserCount: number;
    existingUniqueUserCount?: number | null;
    identityScrubbedSessionCount: number;
}): ProtectedUniqueUserCount {
    const computed = normalizeCount(params.computedUniqueUserCount) ?? 0;
    const existing = normalizeCount(params.existingUniqueUserCount);
    const scrubbedCount = normalizeCount(params.identityScrubbedSessionCount) ?? 0;

    if (scrubbedCount > 0 && existing !== null && existing > computed) {
        return {
            uniqueUserCount: existing,
            preservedExisting: true,
        };
    }

    return {
        uniqueUserCount: computed,
        preservedExisting: false,
    };
}
