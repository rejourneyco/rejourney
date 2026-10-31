import { describe, expect, it } from 'vitest';
import {
    canChangeTeamMemberRole,
    canMoveProjectBetweenTeams,
    isTeamOwner,
} from '../utils/teamRoles.js';
import { addTeamMemberSchema, updateTeamMemberSchema } from '../validation/teams.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';

describe('canMoveProjectBetweenTeams', () => {
    it('requires owner/admin on both the source and destination teams', () => {
        expect(canMoveProjectBetweenTeams({ sourceRole: 'admin', destinationRole: 'owner' })).toBe(true);
        expect(canMoveProjectBetweenTeams({ sourceRole: 'owner', destinationRole: 'admin' })).toBe(true);
    });

    it('refuses to move a project out of a team where the caller is only a member', () => {
        expect(canMoveProjectBetweenTeams({ sourceRole: 'member', destinationRole: 'owner' })).toBe(false);
        expect(canMoveProjectBetweenTeams({ sourceRole: 'billing_admin', destinationRole: 'owner' })).toBe(false);
        expect(canMoveProjectBetweenTeams({ sourceRole: undefined, destinationRole: 'owner' })).toBe(false);
    });

    it('refuses to move into a team where the caller is not an admin', () => {
        expect(canMoveProjectBetweenTeams({ sourceRole: 'owner', destinationRole: 'member' })).toBe(false);
        expect(canMoveProjectBetweenTeams({ sourceRole: 'owner', destinationRole: null })).toBe(false);
    });
});

describe('isTeamOwner', () => {
    it('trusts the team\'s recorded owner over the membership role', () => {
        expect(isTeamOwner({ userId: 'u1', ownerUserId: 'u1', membershipRole: 'owner' })).toBe(true);
        expect(isTeamOwner({ userId: 'u1', ownerUserId: 'u1', membershipRole: 'admin' })).toBe(true);
        expect(isTeamOwner({ userId: 'u2', ownerUserId: 'u1', membershipRole: 'owner' })).toBe(false);
    });

    it('falls back to the membership role only when no owner is recorded', () => {
        expect(isTeamOwner({ userId: 'u2', ownerUserId: null, membershipRole: 'owner' })).toBe(true);
        expect(isTeamOwner({ userId: 'u2', ownerUserId: undefined, membershipRole: 'admin' })).toBe(false);
    });
});

describe('canChangeTeamMemberRole', () => {
    const base = { actorIsTeamOwner: false, targetIsTeamOwner: false, targetCurrentRole: 'member' };

    it('never grants ownership through a member role update', () => {
        expect(canChangeTeamMemberRole({ ...base, nextRole: 'owner' })).toEqual({ allowed: false, reason: 'owner_role_not_assignable' });
        expect(canChangeTeamMemberRole({ ...base, actorIsTeamOwner: true, nextRole: 'owner' }))
            .toEqual({ allowed: false, reason: 'owner_role_not_assignable' });
    });

    it('never changes the recorded owner\'s role', () => {
        expect(canChangeTeamMemberRole({ ...base, targetIsTeamOwner: true, targetCurrentRole: 'owner', nextRole: 'member' }))
            .toEqual({ allowed: false, reason: 'cannot_change_owner' });
    });

    it('lets only the owner change a member holding an owner role', () => {
        expect(canChangeTeamMemberRole({ ...base, targetCurrentRole: 'owner', nextRole: 'member' }))
            .toEqual({ allowed: false, reason: 'owner_access_required' });
        expect(canChangeTeamMemberRole({ ...base, actorIsTeamOwner: true, targetCurrentRole: 'owner', nextRole: 'member' }))
            .toEqual({ allowed: true });
    });

    it('keeps the existing admin flows for non-owner roles', () => {
        expect(canChangeTeamMemberRole({ ...base, nextRole: 'admin' })).toEqual({ allowed: true });
        expect(canChangeTeamMemberRole({ ...base, targetCurrentRole: 'admin', nextRole: 'member' })).toEqual({ allowed: true });
        expect(canChangeTeamMemberRole({ ...base, nextRole: 'billing_admin' })).toEqual({ allowed: true });
    });
});

describe('team member validation', () => {
    it('rejects role "owner" on member updates', () => {
        expect(updateTeamMemberSchema.safeParse({ userId: USER_ID, role: 'owner' }).success).toBe(false);
    });

    it('accepts the roles the dashboard sends', () => {
        for (const role of ['member', 'admin', 'billing_admin']) {
            expect(updateTeamMemberSchema.safeParse({ userId: USER_ID, role }).success, role).toBe(true);
        }
    });

    it('still rejects owner on member invites', () => {
        expect(addTeamMemberSchema.safeParse({ email: 'a@example.com', role: 'owner' }).success).toBe(false);
    });
});
