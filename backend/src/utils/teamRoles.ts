/**
 * Team role rules shared by the team and project routes.
 */

export const TEAM_ADMIN_ROLES = ['owner', 'admin'] as const;

export function isTeamAdminRole(role: string | null | undefined): boolean {
    return typeof role === 'string' && (TEAM_ADMIN_ROLES as readonly string[]).includes(role);
}

/**
 * The team's recorded owner (teams.owner_user_id) is the source of truth.
 * A membership row saying 'owner' only counts when the team has no recorded
 * owner, so an 'owner' role written onto another member never grants
 * owner-only actions.
 */
export function isTeamOwner(params: {
    userId: string;
    ownerUserId: string | null | undefined;
    membershipRole: string | null | undefined;
}): boolean {
    if (params.ownerUserId) return params.ownerUserId === params.userId;
    return params.membershipRole === 'owner';
}

/**
 * Moving a project needs admin rights on the team it leaves and on the team
 * it joins.
 */
export function canMoveProjectBetweenTeams(params: {
    sourceRole: string | null | undefined;
    destinationRole: string | null | undefined;
}): boolean {
    return isTeamAdminRole(params.sourceRole) && isTeamAdminRole(params.destinationRole);
}

/**
 * Whether an actor may change a member's role through the member update
 * endpoint. Ownership is never granted or removed there, and members holding
 * an 'owner' role can only be changed by the team's recorded owner.
 */
export function canChangeTeamMemberRole(params: {
    actorIsTeamOwner: boolean;
    targetIsTeamOwner: boolean;
    targetCurrentRole: string | null | undefined;
    nextRole: string;
}): { allowed: true } | { allowed: false; reason: 'owner_role_not_assignable' | 'cannot_change_owner' | 'owner_access_required' } {
    if (params.nextRole === 'owner') return { allowed: false, reason: 'owner_role_not_assignable' };
    if (params.targetIsTeamOwner) return { allowed: false, reason: 'cannot_change_owner' };
    if (params.targetCurrentRole === 'owner' && !params.actorIsTeamOwner) {
        return { allowed: false, reason: 'owner_access_required' };
    }
    return { allowed: true };
}
