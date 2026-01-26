/**
 * Teams Routes
 * 
 * Team management, membership, and invitations
 */

import { Router } from 'express';
import { randomBytes } from 'crypto';
import { eq, and, count, sql, isNull } from 'drizzle-orm';
import { db, teams, teamMembers, teamInvitations, users, projects } from '../db/client.js';
import { logger } from '../logger.js';
import { sessionAuth, requireTeamAccess, requireTeamAdmin, asyncHandler, ApiError } from '../middleware/index.js';
import { validate } from '../middleware/validation.js';
import { dashboardRateLimiter } from '../middleware/rateLimit.js';
import { sendTeamInviteEmail } from '../services/email.js';
import { auditFromRequest } from '../services/auditLog.js';
import {
    createTeamSchema,
    updateTeamSchema,
    addTeamMemberSchema,
    updateTeamMemberSchema,
    removeTeamMemberSchema,
    teamIdParamSchema,
    invitationIdParamSchema,
    acceptInvitationSchema,
} from '../validation/teams.js';

const router = Router();

/**
 * Get all teams for user
 * GET /api/teams
 */
router.get(
    '/',
    sessionAuth,
    dashboardRateLimiter,
    asyncHandler(async (req, res) => {
        const memberships = await db
            .select({
                role: teamMembers.role,
                team: teams,
            })
            .from(teamMembers)
            .innerJoin(teams, eq(teamMembers.teamId, teams.id))
            .where(eq(teamMembers.userId, req.user!.id));

        const teamsData = memberships.map((m) => ({
            ...m.team,
            role: m.role,
        }));

        res.json({ teams: teamsData });
    })
);

/**
 * Create a new team
 * POST /api/teams
 */
router.post(
    '/',
    sessionAuth,
    dashboardRateLimiter,
    validate(createTeamSchema),
    asyncHandler(async (req, res) => {
        // Teams start on free tier - Stripe subscription created via billing flow
        const [team] = await db.insert(teams).values({
            name: req.body.name || `${req.user!.email.split('@')[0]}'s Team`,
            ownerUserId: req.user!.id,
        }).returning();

        // Create team member entry for owner
        await db.insert(teamMembers).values({
            teamId: team.id,
            userId: req.user!.id,
            role: 'owner',
        });

        logger.info({ teamId: team.id, userId: req.user!.id }, 'Team created');

        // Audit log
        await auditFromRequest(req, 'team_created', {
            targetType: 'team',
            targetId: team.id,
            newValue: { name: team.name },
        });

        res.status(201).json({ team });
    })
);

/**
 * Get team by ID
 * GET /api/teams/:teamId
 */
router.get(
    '/:teamId',
    sessionAuth,
    validate(teamIdParamSchema, 'params'),
    requireTeamAccess,
    asyncHandler(async (req, res) => {
        const [team] = await db.select().from(teams).where(eq(teams.id, req.params.teamId)).limit(1);

        if (!team) {
            throw ApiError.notFound('Team not found');
        }

        // Get project count (non-deleted)
        const [projectCountResult] = await db
            .select({ count: count() })
            .from(projects)
            .where(and(eq(projects.teamId, req.params.teamId), sql`${projects.deletedAt} IS NULL`));

        // Get member count
        const [memberCountResult] = await db
            .select({ count: count() })
            .from(teamMembers)
            .where(eq(teamMembers.teamId, req.params.teamId));

        res.json({
            team: {
                ...team,
                projectCount: Number(projectCountResult?.count ?? 0),
                memberCount: Number(memberCountResult?.count ?? 0),
            },
        });
    })
);

/**
 * Update team
 * PUT /api/teams/:teamId
 */
router.put(
    '/:teamId',
    sessionAuth,
    validate(teamIdParamSchema, 'params'),
    validate(updateTeamSchema),
    requireTeamAdmin,
    asyncHandler(async (req, res) => {
        const [team] = await db.update(teams)
            .set({
                name: req.body.name,
                updatedAt: new Date(),
            })
            .where(eq(teams.id, req.params.teamId))
            .returning();

        logger.info({ teamId: team.id, userId: req.user!.id }, 'Team updated');

        // Audit log
        await auditFromRequest(req, 'project_updated', {
            targetType: 'team',
            targetId: team.id,
            newValue: { name: team.name },
        });

        res.json({ team });
    })
);

/**
 * Get team members
 * GET /api/teams/:teamId/members
 */
router.get(
    '/:teamId/members',
    sessionAuth,
    validate(teamIdParamSchema, 'params'),
    requireTeamAccess,
    asyncHandler(async (req, res) => {
        const members = await db
            .select({
                id: teamMembers.id,
                teamId: teamMembers.teamId,
                userId: teamMembers.userId,
                role: teamMembers.role,
                createdAt: teamMembers.createdAt,
                user: {
                    id: users.id,
                    email: users.email,
                    displayName: users.displayName,
                    avatarUrl: users.avatarUrl,
                },
            })
            .from(teamMembers)
            .innerJoin(users, eq(teamMembers.userId, users.id))
            .where(eq(teamMembers.teamId, req.params.teamId))
            .orderBy(teamMembers.createdAt);

        res.json({
            members: members.map((m) => ({
                id: m.id,
                teamId: m.teamId,
                userId: m.userId,
                role: m.role,
                email: m.user.email,
                displayName: m.user.displayName,
                avatarUrl: m.user.avatarUrl,
                createdAt: m.createdAt.toISOString(),
            })),
        });
    })
);

/**
 * Add team member (or send invitation if user doesn't exist)
 * POST /api/teams/:teamId/members
 */
router.post(
    '/:teamId/members',
    sessionAuth,
    validate(teamIdParamSchema, 'params'),
    validate(addTeamMemberSchema),
    requireTeamAdmin,
    asyncHandler(async (req, res) => {
        const { email, role } = req.body;
        const teamId = req.params.teamId;
        const normalizedEmail = email.toLowerCase().trim();

        // Get team info for email
        const [team] = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1);
        if (!team) {
            throw ApiError.notFound('Team not found');
        }

        // Find user by email
        const [existingUser] = await db
            .select()
            .from(users)
            .where(eq(users.email, normalizedEmail))
            .limit(1);

        if (existingUser) {
            // Check if already a member
            const [existing] = await db
                .select()
                .from(teamMembers)
                .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, existingUser.id)))
                .limit(1);

            if (existing) {
                throw ApiError.conflict('User is already a team member');
            }

            // Add directly as member
            const [member] = await db.insert(teamMembers).values({
                teamId,
                userId: existingUser.id,
                role: role === 'admin' ? 'admin' : 'member',
            }).returning();

            logger.info({ teamId, userId: existingUser.id, addedBy: req.user!.id }, 'Team member added');

            // Audit log
            await auditFromRequest(req, 'team_member_added', {
                targetType: 'team',
                targetId: teamId,
                newValue: { userId: existingUser.id, email: existingUser.email, role: member.role },
            });

            res.status(201).json({
                member: {
                    id: member.id,
                    teamId: member.teamId,
                    userId: member.userId,
                    role: member.role,
                    email: existingUser.email,
                    displayName: existingUser.displayName,
                    createdAt: member.createdAt.toISOString(),
                },
            });
        } else {
            // User doesn't exist - create invitation
            // Check if there's already a pending invitation
            const [existingInvite] = await db
                .select()
                .from(teamInvitations)
                .where(and(
                    eq(teamInvitations.teamId, teamId),
                    eq(teamInvitations.email, normalizedEmail),
                    isNull(teamInvitations.acceptedAt)
                ))
                .limit(1);

            if (existingInvite) {
                throw ApiError.conflict('An invitation has already been sent to this email');
            }

            // Generate secure token
            const token = randomBytes(32).toString('hex');
            const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

            const [invitation] = await db.insert(teamInvitations).values({
                teamId,
                email: normalizedEmail,
                role: role === 'admin' ? 'admin' : 'member',
                token,
                invitedBy: req.user!.id,
                expiresAt,
            }).returning();

            // Send invitation email
            const inviterName = req.user!.displayName || req.user!.email;
            await sendTeamInviteEmail(normalizedEmail, team.name || 'Unnamed Team', inviterName, invitation.role, token);

            logger.info({ teamId, email: normalizedEmail, invitedBy: req.user!.id }, 'Team invitation sent');

            res.status(201).json({
                invitation: {
                    id: invitation.id,
                    teamId: invitation.teamId,
                    email: invitation.email,
                    role: invitation.role,
                    expiresAt: invitation.expiresAt.toISOString(),
                    createdAt: invitation.createdAt.toISOString(),
                },
                message: 'Invitation sent. User will receive an email to join.',
            });
        }
    })
);

/**
 * Update team member role
 * PUT /api/teams/:teamId/members
 */
router.put(
    '/:teamId/members',
    sessionAuth,
    validate(teamIdParamSchema, 'params'),
    validate(updateTeamMemberSchema),
    requireTeamAdmin,
    asyncHandler(async (req, res) => {
        const { userId, role } = req.body;
        const teamId = req.params.teamId;

        // Cannot change owner role
        const [team] = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1);
        if (team?.ownerUserId === userId && role !== 'owner') {
            throw ApiError.badRequest('Cannot change owner role. Transfer ownership first.');
        }

        await db.update(teamMembers)
            .set({ role })
            .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)));

        logger.info({ teamId, userId, role, updatedBy: req.user!.id }, 'Team member role updated');

        // Audit log
        await auditFromRequest(req, 'team_member_role_changed', {
            targetType: 'team',
            targetId: teamId,
            newValue: { userId, role },
        });

        res.json({ success: true });
    })
);

/**
 * Remove team member
 * DELETE /api/teams/:teamId/members
 */
router.delete(
    '/:teamId/members',
    sessionAuth,
    validate(teamIdParamSchema, 'params'),
    validate(removeTeamMemberSchema),
    requireTeamAdmin,
    asyncHandler(async (req, res) => {
        const { userId } = req.body;
        const teamId = req.params.teamId;

        // Cannot remove owner
        const [team] = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1);
        if (team?.ownerUserId === userId) {
            throw ApiError.badRequest('Cannot remove team owner');
        }

        await db.delete(teamMembers)
            .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)));

        logger.info({ teamId, userId, removedBy: req.user!.id }, 'Team member removed');

        // Audit log
        await auditFromRequest(req, 'team_member_removed', {
            targetType: 'team',
            targetId: teamId,
            previousValue: { userId },
        });

        res.json({ success: true });
    })
);

// =============================================================================
// Invitation Endpoints
// =============================================================================

/**
 * Get pending invitations for a team
 * GET /api/teams/:teamId/invitations
 */
router.get(
    '/:teamId/invitations',
    sessionAuth,
    validate(teamIdParamSchema, 'params'),
    requireTeamAdmin,
    asyncHandler(async (req, res) => {
        const teamId = req.params.teamId;

        const invitations = await db
            .select({
                id: teamInvitations.id,
                teamId: teamInvitations.teamId,
                email: teamInvitations.email,
                role: teamInvitations.role,
                expiresAt: teamInvitations.expiresAt,
                createdAt: teamInvitations.createdAt,
                invitedBy: teamInvitations.invitedBy,
                inviter: {
                    email: users.email,
                    displayName: users.displayName,
                },
            })
            .from(teamInvitations)
            .leftJoin(users, eq(teamInvitations.invitedBy, users.id))
            .where(and(
                eq(teamInvitations.teamId, teamId),
                isNull(teamInvitations.acceptedAt)
            ))
            .orderBy(teamInvitations.createdAt);

        res.json({
            invitations: invitations.map((inv) => ({
                id: inv.id,
                teamId: inv.teamId,
                email: inv.email,
                role: inv.role,
                expiresAt: inv.expiresAt.toISOString(),
                createdAt: inv.createdAt.toISOString(),
                inviterEmail: inv.inviter?.email,
                inviterName: inv.inviter?.displayName,
                expired: inv.expiresAt < new Date(),
            })),
        });
    })
);

/**
 * Cancel/delete an invitation
 * DELETE /api/teams/:teamId/invitations/:invitationId
 */
router.delete(
    '/:teamId/invitations/:invitationId',
    sessionAuth,
    validate(invitationIdParamSchema, 'params'),
    requireTeamAdmin,
    asyncHandler(async (req, res) => {
        const { teamId, invitationId } = req.params;

        const result = await db.delete(teamInvitations)
            .where(and(
                eq(teamInvitations.id, invitationId),
                eq(teamInvitations.teamId, teamId)
            ))
            .returning();

        if (result.length === 0) {
            throw ApiError.notFound('Invitation not found');
        }

        logger.info({ teamId, invitationId, cancelledBy: req.user!.id }, 'Team invitation cancelled');

        res.json({ success: true });
    })
);

/**
 * Resend an invitation email
 * POST /api/teams/:teamId/invitations/:invitationId/resend
 */
router.post(
    '/:teamId/invitations/:invitationId/resend',
    sessionAuth,
    validate(invitationIdParamSchema, 'params'),
    requireTeamAdmin,
    asyncHandler(async (req, res) => {
        const { teamId, invitationId } = req.params;

        // Get invitation
        const [invitation] = await db
            .select()
            .from(teamInvitations)
            .where(and(
                eq(teamInvitations.id, invitationId),
                eq(teamInvitations.teamId, teamId),
                isNull(teamInvitations.acceptedAt)
            ))
            .limit(1);

        if (!invitation) {
            throw ApiError.notFound('Invitation not found');
        }

        // Get team info
        const [team] = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1);
        if (!team) {
            throw ApiError.notFound('Team not found');
        }

        // Generate new token and extend expiry
        const newToken = randomBytes(32).toString('hex');
        const newExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

        await db.update(teamInvitations)
            .set({
                token: newToken,
                expiresAt: newExpiresAt,
            })
            .where(eq(teamInvitations.id, invitationId));

        // Resend email
        const inviterName = req.user!.displayName || req.user!.email;
        await sendTeamInviteEmail(invitation.email, team.name || 'Unnamed Team', inviterName, invitation.role, newToken);

        logger.info({ teamId, invitationId, email: invitation.email, resentBy: req.user!.id }, 'Team invitation resent');

        res.json({ success: true, message: 'Invitation resent' });
    })
);

/**
 * Accept an invitation (public endpoint, requires auth)
 * POST /api/invitations/accept
 */
router.post(
    '/invitations/accept',
    sessionAuth,
    validate(acceptInvitationSchema),
    asyncHandler(async (req, res) => {
        const { token } = req.body;
        const userId = req.user!.id;
        const userEmail = req.user!.email.toLowerCase();

        // Find invitation by token
        const [invitation] = await db
            .select()
            .from(teamInvitations)
            .where(and(
                eq(teamInvitations.token, token),
                isNull(teamInvitations.acceptedAt)
            ))
            .limit(1);

        if (!invitation) {
            throw ApiError.notFound('Invitation not found or already accepted');
        }

        // Check if expired
        if (invitation.expiresAt < new Date()) {
            throw ApiError.badRequest('Invitation has expired');
        }

        // Check email matches (must match the invited email)
        if (invitation.email.toLowerCase() !== userEmail) {
            throw ApiError.forbidden('This invitation was sent to a different email address');
        }

        // Check if already a member
        const [existingMember] = await db
            .select()
            .from(teamMembers)
            .where(and(eq(teamMembers.teamId, invitation.teamId), eq(teamMembers.userId, userId)))
            .limit(1);

        if (existingMember) {
            // Mark invitation as accepted anyway
            await db.update(teamInvitations)
                .set({ acceptedAt: new Date() })
                .where(eq(teamInvitations.id, invitation.id));

            throw ApiError.conflict('You are already a member of this team');
        }

        // Add user to team
        await db.insert(teamMembers).values({
            teamId: invitation.teamId,
            userId,
            role: invitation.role,
        });

        // Mark invitation as accepted
        await db.update(teamInvitations)
            .set({ acceptedAt: new Date() })
            .where(eq(teamInvitations.id, invitation.id));

        // Get team info for response
        const [team] = await db.select().from(teams).where(eq(teams.id, invitation.teamId)).limit(1);

        logger.info({ teamId: invitation.teamId, userId, role: invitation.role }, 'Team invitation accepted');

        res.json({
            success: true,
            team: team ? {
                id: team.id,
                name: team.name,
            } : null,
        });
    })
);

/**
 * Get invitation details by token (public, no auth required - for display before login)
 * GET /api/invitations/:token
 */
router.get(
    '/invitations/:token',
    asyncHandler(async (req, res) => {
        const { token } = req.params;

        const [invitation] = await db
            .select({
                id: teamInvitations.id,
                email: teamInvitations.email,
                role: teamInvitations.role,
                expiresAt: teamInvitations.expiresAt,
                acceptedAt: teamInvitations.acceptedAt,
                team: {
                    id: teams.id,
                    name: teams.name,
                },
            })
            .from(teamInvitations)
            .innerJoin(teams, eq(teamInvitations.teamId, teams.id))
            .where(eq(teamInvitations.token, token))
            .limit(1);

        if (!invitation) {
            throw ApiError.notFound('Invitation not found');
        }

        res.json({
            invitation: {
                id: invitation.id,
                email: invitation.email,
                role: invitation.role,
                expiresAt: invitation.expiresAt.toISOString(),
                expired: invitation.expiresAt < new Date(),
                accepted: invitation.acceptedAt !== null,
                teamName: invitation.team.name,
                teamId: invitation.team.id,
            },
        });
    })
);

export default router;
