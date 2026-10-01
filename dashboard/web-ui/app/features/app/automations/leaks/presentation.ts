/** Population prevalence is unknown when only affected sessions are recorded. */
export function measuredAffectedPercent(leak: {
    affectedEstimateBasis?: string | null;
    estimatedAffectedUsersPercent?: number | null;
}): number | null {
    if (leak.affectedEstimateBasis === 'observed_only') return null;
    const value = leak.estimatedAffectedUsersPercent;
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
}

/** A triage decision does not invalidate generated context. */
export function contextCanBeCopied(leak: {
    contextStatus?: string | null;
    contextMarkdown?: string | null;
} | null): boolean {
    return Boolean(leak && (leak.contextStatus === 'ready' || leak.contextMarkdown?.trim()));
}
