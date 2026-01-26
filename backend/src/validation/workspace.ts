import { z } from 'zod';

// Flexible tab schema that accepts what the frontend actually sends
export const tabStateSchema = z.object({
    id: z.string().min(1), // Can be "overview", "session_xxx", etc - not required to be UUID
    title: z.string().min(1),
    path: z.string().min(1), // Frontend sends 'path', not 'route'
    // Optional fields from legacy schema
    type: z.string().optional(),
    route: z.string().optional(),
    icon: z.string().optional(),
    state: z.record(z.any()).optional(),
    pinned: z.boolean().optional(),
    createdAt: z.string().optional(),
    lastActiveAt: z.string().optional(),
});

export const workspaceQuerySchema = z.object({
    teamId: z.string().uuid(),
    projectId: z.string().uuid(),
    key: z.string().min(1).default('default').optional(),
});

export const workspaceUpsertSchema = z.object({
    teamId: z.string().uuid(),
    projectId: z.string().uuid(),
    workspaceKey: z.string().min(1).default('default'),
    tabs: z.array(tabStateSchema),
    activeTabId: z.string().nullable(), // Not required to be UUID
    recentlyClosed: z.array(tabStateSchema).default([]),
});

export const workspaceReopenSchema = z.object({
    teamId: z.string().uuid(),
    projectId: z.string().uuid(),
    workspaceKey: z.string().min(1).default('default'),
    tab: tabStateSchema.optional(),
});

export const workspaceReorderSchema = z.object({
    teamId: z.string().uuid(),
    projectId: z.string().uuid(),
    workspaceKey: z.string().min(1).default('default'),
    orderedTabIds: z.array(z.string().min(1)), // Not required to be UUID
});

export type WorkspacePayload = z.infer<typeof workspaceUpsertSchema>;

