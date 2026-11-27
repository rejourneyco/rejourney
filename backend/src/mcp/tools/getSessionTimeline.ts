import { z } from 'zod';
import { outputMetaSchema } from '../output/emit.js';
import { decodeCursor, encodeCursor } from '../data/cursor.js';
import { invalidArgument, notFound } from '../errors.js';
import { out } from '../output/fields.js';
import { TIMELINE_EVENT_TYPES, condenseTimeline } from '../timeline/condense.js';
import { sessionIdInput } from './common.js';
import { timelineEventOutput } from './contextShared.js';
import { UNTRUSTED_CONTENT_NOTE, defineTool } from './types.js';

export const DEFAULT_TIMELINE_PAGE = 200;
export const MAX_TIMELINE_PAGE = 500;

const cursorShape = z.strictObject({ offset: z.int().min(0).max(1_000_000) });

export const getSessionTimelineTool = defineTool({
    name: 'get_session_timeline',
    title: 'Session timeline',
    description:
        'What happened in a session, in order: screens, taps with their labels, rage and dead taps, failed network requests, errors, crashes, ANRs, custom events and logs. '
        + 'Times are seconds since session start; repeated events are collapsed with a count. Narrow with a time window or event types. '
        + `Event types: ${TIMELINE_EVENT_TYPES.join(', ')}. Costs 1 credit. ${UNTRUSTED_CONTENT_NOTE}`,
    inputSchema: z.strictObject({
        sessionId: sessionIdInput,
        fromSeconds: z.number().min(0).max(864_000).optional().describe('Only events at or after this many seconds from session start.'),
        toSeconds: z.number().min(0).max(864_000).optional().describe('Only events at or before this many seconds from session start.'),
        types: z.array(z.enum(TIMELINE_EVENT_TYPES)).min(1).max(TIMELINE_EVENT_TYPES.length).optional().describe('Only these event types.'),
        limit: z.int().min(1).max(MAX_TIMELINE_PAGE).optional().describe(`Events per page. Default ${DEFAULT_TIMELINE_PAGE}.`),
        cursor: z.string().max(600).optional().describe('nextCursor from the previous page. Keep every other argument the same.'),
    }),
    outputSchema: z.strictObject({
        sessionId: out.id(),
        durationSeconds: z.number(),
        /** "ok", or why recorded events are missing: none recorded, expired, or partial (too large or too slow to read fully). */
        eventStream: z.enum(['ok', 'none', 'expired', 'partial']),
        totalEvents: z.number(),
        events: z.array(timelineEventOutput),
        nextCursor: out.cursor().nullable(),
        link: out.link(),
        meta: outputMetaSchema,
    }),
    requiredScope: 'sessions:read',
    credits: () => 1,
    argKinds: { sessionId: 'session', fromSeconds: 'neutral', toSeconds: 'neutral', types: 'neutral', limit: 'neutral', cursor: 'neutral' },
    maxDbRoundTrips: 3,
    validate(args) {
        if (args.fromSeconds !== undefined && args.toSeconds !== undefined && args.fromSeconds > args.toSeconds) {
            throw invalidArgument('"fromSeconds" must not be after "toSeconds".');
        }
        if (args.cursor !== undefined) decodeCursor(args.cursor, cursorShape);
    },
    async handler(args, ctx, deps) {
        const source = await deps.data.getSessionTimeline(ctx, args.sessionId);
        if (!source) throw notFound();

        const all = condenseTimeline(source.events, {
            sessionStartMs: source.sessionStartMs,
            fromSeconds: args.fromSeconds,
            toSeconds: args.toSeconds,
            types: args.types,
        });
        const offset = args.cursor === undefined ? 0 : decodeCursor(args.cursor, cursorShape).offset;
        const limit = args.limit ?? DEFAULT_TIMELINE_PAGE;
        const page = all.slice(offset, offset + limit);

        const cursorAfter = (kept: number): string | null =>
            offset + kept >= all.length ? null : encodeCursor({ offset: offset + kept });
        return {
            data: {
                sessionId: source.sessionId,
                durationSeconds: source.durationSeconds,
                eventStream: source.eventStream,
                totalEvents: all.length,
                events: page,
                nextCursor: cursorAfter(page.length),
                link: deps.links.session(source.sessionId),
            },
            paging: { listKey: 'events', cursorAfter },
        };
    },
});
