import { z } from 'zod';
import { outputMetaSchema } from '../output/emit.js';
import { notFound } from '../errors.js';
import {
    cappedCountOutput,
    rangeOutput,
    resolveTimeRange,
    sessionFilterArgKinds,
    sessionFilterInput,
    sessionSummaryOutput,
    toCappedCount,
    toRangeOutput,
    toSessionFilter,
    toSessionSummaryOutput,
} from './common.js';
import { UNTRUSTED_CONTENT_NOTE, defineTool } from './types.js';

export const DEFAULT_SAMPLE_SIZE = 25;
export const MAX_SAMPLE_SIZE = 50;

export const sampleSessionsTool = defineTool({
    name: 'sample_sessions',
    title: 'Sample sessions',
    description:
        'A uniform random sample of the sessions matching a filter (same filters as search_sessions), so that what you find in the sample generalises to the group. '
        + 'The same seed gives the same sample; change the seed for a fresh one. Pass the ids to get_session_digests to read them cheaply. '
        + `Costs 1 credit. ${UNTRUSTED_CONTENT_NOTE}`,
    inputSchema: z.strictObject({
        ...sessionFilterInput,
        size: z.int().min(1).max(MAX_SAMPLE_SIZE).optional().describe(`Sessions to return. Default ${DEFAULT_SAMPLE_SIZE}, at most ${MAX_SAMPLE_SIZE}.`),
        seed: z.int().min(0).max(2_147_483_647).optional().describe('Sample seed. Default 0.'),
    }),
    outputSchema: z.strictObject({
        range: rangeOutput,
        /** How many sessions match the filter (the group the sample was drawn from). */
        population: cappedCountOutput,
        seed: z.number(),
        sessions: z.array(sessionSummaryOutput),
        /** A sample is never paged. */
        nextCursor: z.null(),
        meta: outputMetaSchema,
    }),
    requiredScope: 'sessions:read',
    credits: () => 1,
    argKinds: { ...sessionFilterArgKinds, size: 'neutral', seed: 'neutral' },
    maxDbRoundTrips: 6,
    validate(args, env) {
        resolveTimeRange(args, env.now);
    },
    async handler(args, ctx, deps) {
        const filter = toSessionFilter(args, deps.now(), ctx.maskIdentifiers);
        const seed = args.seed ?? 0;
        const sample = await deps.data.sampleSessions(ctx, filter, { size: args.size ?? DEFAULT_SAMPLE_SIZE, seed });
        if (!sample) throw notFound();
        return {
            data: {
                range: toRangeOutput(filter.range),
                population: toCappedCount(sample.population),
                seed,
                sessions: sample.sessions.map((session) => toSessionSummaryOutput(session, deps.links)),
                nextCursor: null,
            },
            // A sample has no next page: if it has to be shortened, ask for a smaller size.
            paging: { listKey: 'sessions', cursorAfter: () => null },
        };
    },
});

