/**
 * Team Validation Schemas
 */

import { z } from 'zod';

export const createTeamSchema = z.object({
    name: z.string().min(1).max(100).optional(),
});

export const updateTeamSchema = z.object({
    name: z.string().min(1).max(100).optional(),
    billingPlan: z.string().optional(),
});

export const addTeamMemberSchema = z.object({
    email: z.string().email('Invalid email address'),
    role: z.enum(['admin', 'member', 'billing_admin']).default('member'),
});

export const updateTeamMemberSchema = z.object({
    userId: z.string().uuid('Invalid user ID'),
    role: z.enum(['owner', 'admin', 'member', 'billing_admin']),
});

export const removeTeamMemberSchema = z.object({
    userId: z.string().uuid('Invalid user ID'),
});

export const teamIdParamSchema = z.object({
    teamId: z.string().uuid('Invalid team ID'),
});

export const invitationIdParamSchema = z.object({
    teamId: z.string().uuid('Invalid team ID'),
    invitationId: z.string().uuid('Invalid invitation ID'),
});

export const acceptInvitationSchema = z.object({
    token: z.string().min(32, 'Invalid invitation token'),
});

export type CreateTeamInput = z.infer<typeof createTeamSchema>;
export type UpdateTeamInput = z.infer<typeof updateTeamSchema>;
export type AddTeamMemberInput = z.infer<typeof addTeamMemberSchema>;
export type UpdateTeamMemberInput = z.infer<typeof updateTeamMemberSchema>;
export type RemoveTeamMemberInput = z.infer<typeof removeTeamMemberSchema>;
export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>;
