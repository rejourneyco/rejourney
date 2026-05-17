import { z } from 'zod';

export const createRoadmapPostSchema = z.object({
    title: z.string().trim().min(3, 'Idea must be at least 3 characters').max(160, 'Idea must be 160 characters or fewer'),
    details: z.string().trim().min(10, 'Details must be at least 10 characters').max(1200, 'Details must be 1200 characters or fewer'),
});

export const roadmapPostIdParamSchema = z.object({
    postId: z.string().uuid('Invalid roadmap post ID'),
});

export type CreateRoadmapPostInput = z.infer<typeof createRoadmapPostSchema>;
