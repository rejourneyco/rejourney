import { Router } from 'express';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db, roadmapPosts, roadmapVotes, users } from '../db/client.js';
import { ApiError, asyncHandler, dashboardRateLimiter, sessionAuth, validate, writeApiRateLimiter } from '../middleware/index.js';
import { assertNoDuplicateContentSpam, enforceNewAccountActionLimit } from '../services/abuseDetection.js';
import { createRoadmapPostSchema, roadmapPostIdParamSchema } from '../validation/roadmap.js';

const router = Router();

type RoadmapPostRow = {
    id: string;
    authorUserId: string | null;
    title: string;
    details: string;
    status: string;
    developerComment: string | null;
    createdAt: Date;
    updatedAt: Date;
    voteCount: number;
    authorName: string | null;
    authorEmail: string | null;
};

function serializeRoadmapPost(row: RoadmapPostRow) {
    return {
        id: row.id,
        authorUserId: row.authorUserId,
        authorName: row.authorName || row.authorEmail?.split('@')[0] || 'Community',
        title: row.title,
        details: row.details,
        status: row.status,
        developerComment: row.developerComment,
        votes: Number(row.voteCount ?? 0),
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    };
}

async function fetchRoadmapPost(postId: string) {
    const voteCountSql = sql<number>`(
        select count(*)::int
        from ${roadmapVotes}
        where ${roadmapVotes.postId} = ${roadmapPosts.id}
    )`;

    const [post] = await db
        .select({
            id: roadmapPosts.id,
            authorUserId: roadmapPosts.authorUserId,
            title: roadmapPosts.title,
            details: roadmapPosts.details,
            status: roadmapPosts.status,
            developerComment: roadmapPosts.developerComment,
            createdAt: roadmapPosts.createdAt,
            updatedAt: roadmapPosts.updatedAt,
            voteCount: voteCountSql,
            authorName: users.displayName,
            authorEmail: users.email,
        })
        .from(roadmapPosts)
        .leftJoin(users, eq(roadmapPosts.authorUserId, users.id))
        .where(eq(roadmapPosts.id, postId))
        .limit(1);

    return post ? serializeRoadmapPost(post) : null;
}

async function assertRoadmapPostExists(postId: string): Promise<void> {
    const [existingPost] = await db
        .select({ id: roadmapPosts.id })
        .from(roadmapPosts)
        .where(eq(roadmapPosts.id, postId))
        .limit(1);

    if (!existingPost) {
        throw ApiError.notFound('Roadmap post not found');
    }
}

async function setRoadmapVoteState(postId: string, userId: string, shouldVote: boolean) {
    await assertRoadmapPostExists(postId);

    if (!shouldVote) {
        await db
            .delete(roadmapVotes)
            .where(and(eq(roadmapVotes.postId, postId), eq(roadmapVotes.userId, userId)));

        return {
            post: await fetchRoadmapPost(postId),
            voted: false,
            alreadyVoted: false,
        };
    }

    await db
        .insert(roadmapVotes)
        .values({
            postId,
            userId,
        })
        .onConflictDoNothing();

    return {
        post: await fetchRoadmapPost(postId),
        voted: true,
        alreadyVoted: false,
    };
}

router.get(
    '/',
    dashboardRateLimiter,
    asyncHandler(async (_req, res) => {
        const voteCountSql = sql<number>`(
            select count(*)::int
            from ${roadmapVotes}
            where ${roadmapVotes.postId} = ${roadmapPosts.id}
        )`;

        const posts = await db
            .select({
                id: roadmapPosts.id,
                authorUserId: roadmapPosts.authorUserId,
                title: roadmapPosts.title,
                details: roadmapPosts.details,
                status: roadmapPosts.status,
                developerComment: roadmapPosts.developerComment,
                createdAt: roadmapPosts.createdAt,
                updatedAt: roadmapPosts.updatedAt,
                voteCount: voteCountSql,
                authorName: users.displayName,
                authorEmail: users.email,
            })
            .from(roadmapPosts)
            .leftJoin(users, eq(roadmapPosts.authorUserId, users.id))
            .orderBy(desc(voteCountSql), desc(roadmapPosts.createdAt))
            .limit(100);

        res.json({ posts: posts.map(serializeRoadmapPost) });
    })
);

router.get(
    '/me/votes',
    sessionAuth,
    dashboardRateLimiter,
    asyncHandler(async (req, res) => {
        const votes = await db
            .select({ postId: roadmapVotes.postId })
            .from(roadmapVotes)
            .where(eq(roadmapVotes.userId, req.user!.id));

        res.json({ postIds: votes.map((vote) => vote.postId) });
    })
);

router.post(
    '/',
    sessionAuth,
    writeApiRateLimiter,
    validate(createRoadmapPostSchema),
    asyncHandler(async (req, res) => {
        const { title, details } = req.body;

        await enforceNewAccountActionLimit({
            userId: req.user!.id,
            action: 'roadmap_post',
        });

        await assertNoDuplicateContentSpam({
            actorId: req.user!.id,
            action: 'roadmap_post',
            contentParts: [title, details],
            maxIdenticalInWindow: 3,
            maxIdenticalTargets: 2,
        });

        const [created] = await db
            .insert(roadmapPosts)
            .values({
                authorUserId: req.user!.id,
                title,
                details,
            })
            .returning({ id: roadmapPosts.id });

        const post = await fetchRoadmapPost(created.id);
        res.status(201).json({ post });
    })
);

router.post(
    '/:postId/vote',
    sessionAuth,
    writeApiRateLimiter,
    validate(roadmapPostIdParamSchema, 'params'),
    asyncHandler(async (req, res) => {
        const postId = req.params.postId;
        const requestedVotedState = typeof req.body?.voted === 'boolean' ? req.body.voted : null;

        if (requestedVotedState !== null) {
            const result = await setRoadmapVoteState(postId, req.user!.id, requestedVotedState);
            res.status(requestedVotedState ? 201 : 200).json(result);
            return;
        }

        await assertRoadmapPostExists(postId);

        const [existingVote] = await db
            .select({ id: roadmapVotes.id })
            .from(roadmapVotes)
            .where(and(eq(roadmapVotes.postId, postId), eq(roadmapVotes.userId, req.user!.id)))
            .limit(1);

        const shouldVote = requestedVotedState ?? !existingVote;

        if (!shouldVote) {
            await db
                .delete(roadmapVotes)
                .where(and(eq(roadmapVotes.postId, postId), eq(roadmapVotes.userId, req.user!.id)));

            const post = await fetchRoadmapPost(postId);
            res.json({
                post,
                voted: false,
                alreadyVoted: Boolean(existingVote),
            });
            return;
        }

        await db
            .insert(roadmapVotes)
            .values({
                postId,
                userId: req.user!.id,
            })
            .onConflictDoNothing();

        const post = await fetchRoadmapPost(postId);
        res.status(201).json({
            post,
            voted: true,
            alreadyVoted: false,
        });
    })
);

router.post(
    '/:postId/unvote',
    sessionAuth,
    writeApiRateLimiter,
    validate(roadmapPostIdParamSchema, 'params'),
    asyncHandler(async (req, res) => {
        const result = await setRoadmapVoteState(req.params.postId, req.user!.id, false);
        res.json(result);
    })
);

router.delete(
    '/:postId/vote',
    sessionAuth,
    writeApiRateLimiter,
    validate(roadmapPostIdParamSchema, 'params'),
    asyncHandler(async (req, res) => {
        const result = await setRoadmapVoteState(req.params.postId, req.user!.id, false);
        res.json(result);
    })
);

export default router;
