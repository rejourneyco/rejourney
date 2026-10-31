/**
 * Resolve the project ids an analytics query may read.
 *
 * Without a requested project the scope is every project the caller can
 * access. A requested project is only honored when it is one of those
 * accessible projects; otherwise null is returned so the route can deny it.
 */
export function resolveRequestedProjectScope(
    requestedProjectId: unknown,
    accessibleProjectIds: readonly string[],
): string[] | null {
    if (requestedProjectId === undefined || requestedProjectId === null || requestedProjectId === '') {
        return [...accessibleProjectIds];
    }
    if (typeof requestedProjectId !== 'string') return null;
    return accessibleProjectIds.includes(requestedProjectId) ? [requestedProjectId] : null;
}
