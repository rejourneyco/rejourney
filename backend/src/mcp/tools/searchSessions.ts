import { z } from 'zod';
import { outputMetaSchema } from '../output/emit.js';
import { decodeCursor, encodeCursor } from '../data/cursor.js';
import { notFound } from '../errors.js';
import { out } from '../output/fields.js';
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

export const SEARCH_PAGE_SIZE = 25;

const cursorShape = z.strictObject({
    t: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}$/),
    id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
});

export const searchSessionsTool = defineTool({
    name: 'search_sessions',
    title: 'Search sessions',
    description:
        `Finds sessions in one project, newest first, ${SEARCH_PAGE_SIZE} per page. Filter by time range, platform, app version, user, screen, country, custom event and issue type. `
        + 'Returns a total counted up to 10,000. For conclusions about a whole group use sample_sessions instead: this list is newest-first, not random. '
        + `Costs 1 credit. ${UNTRUSTED_CONTENT_NOTE}`,
    inputSchema: z.strictObject({
        ...sessionFilterInput,
        cursor: z.string().max(600).optional().describe('nextCursor from the previous page. Keep every other argument the same.'),
    }),
    outputSchema: z.strictObject({
        range: rangeOutput,
        total: cappedCountOutput,
        sessions: z.array(sessionSummaryOutput),
        nextCursor: out.cursor().nullable(),
        meta: outputMetaSchema,
    }),
    requiredScope: 'sessions:read',
    credits: () => 1,
    argKinds: { ...sessionFilterArgKinds, cursor: 'neutral' },
    maxDbRoundTrips: 3,
    validate(args, env) {
        resolveTimeRange(args, env.now);
        if (args.cursor !== undefined) decodeCursor(args.cursor, cursorShape);
    },
    async handler(args, ctx, deps) {
        const filter = toSessionFilter(args, deps.now(), ctx.maskIdentifiers);
        const after = args.cursor === undefined ? undefined : decodeCursor(args.cursor, cursorShape);
        const page = await deps.data.searchSessions(ctx, filter, {
            limit: SEARCH_PAGE_SIZE,
            after: after ? { startedAtKey: after.t, id: after.id } : undefined,
        });
        if (!page) throw notFound();

        const cursorAfter = (kept: number): string | null => {
            if (kept >= page.sessions.length && !page.hasMore) return null;
            if (kept === 0) return args.cursor ?? null;
            const last = page.keys[kept - 1];
            return encodeCursor({ t: last.startedAtKey, id: last.id });
        };
        return {
            data: {
                range: toRangeOutput(filter.range),
                total: toCappedCount(page.total),
                sessions: page.sessions.map((session) => toSessionSummaryOutput(session, deps.links)),
                nextCursor: cursorAfter(page.sessions.length),
            },
            paging: { listKey: 'sessions', cursorAfter },
        };
    },
});
