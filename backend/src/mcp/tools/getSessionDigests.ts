import { z } from 'zod';
import { outputMetaSchema } from '../output/emit.js';
import { decodeCursor, encodeCursor } from '../data/cursor.js';
import { MAX_DIGEST_SESSIONS } from '../data/types.js';
import { out } from '../output/fields.js';
import { sessionIdInput } from './common.js';
import { UNTRUSTED_CONTENT_NOTE, defineTool } from './types.js';

const cursorShape = z.strictObject({ offset: z.int().min(0).max(MAX_DIGEST_SESSIONS) });

export function digestCredits(sessionCount: number): number {
    return 1 + Math.ceil(sessionCount / 10);
}

export const getSessionDigestsTool = defineTool({
    name: 'get_session_digests',
    title: 'Session digests',
    description:
        `Compact summaries of up to ${MAX_DIGEST_SESSIONS} sessions in one call: duration, platform, ordered screens, custom events with counts, friction counts and top errors. `
        + 'The cheap way to read many sessions, for example the ids from sample_sessions. '
        + `Costs 1 credit plus 1 per 10 sessions. ${UNTRUSTED_CONTENT_NOTE}`,
    inputSchema: z.strictObject({
        sessionIds: z.array(sessionIdInput).min(1).max(MAX_DIGEST_SESSIONS).describe(`Up to ${MAX_DIGEST_SESSIONS} session ids.`),
        cursor: z.string().max(600).optional().describe('nextCursor from a previous call that was cut short. Keep sessionIds the same.'),
    }),
    outputSchema: z.strictObject({
        digests: z.array(
            z.strictObject({
                id: out.id(),
                startedAt: out.timestamp(),
                durationSeconds: z.number(),
                platform: out.text(20).nullable(),
                appVersion: out.text(50).nullable(),
                /** Screens in the order first visited, at most 20. */
                screens: z.array(out.text(120)),
                screensTruncated: z.boolean(),
                customEvents: z.array(z.strictObject({ name: out.text(120), count: z.number() })),
                friction: z.strictObject({
                    rageTaps: z.number(),
                    deadTaps: z.number(),
                    crashes: z.number(),
                    anrs: z.number(),
                    errors: z.number(),
                    apiErrors: z.number(),
                }),
                topErrors: z.array(
                    z.strictObject({
                        kind: z.enum(['error', 'crash', 'anr']),
                        name: out.text(120),
                        message: out.text(200),
                        count: z.number(),
                    }),
                ),
                link: out.link(),
            }),
        ),
        /** Requested ids with no digest: unknown, or not readable by this connection. */
        notFound: z.array(out.id()),
        nextCursor: out.cursor().nullable(),
        meta: outputMetaSchema,
    }),
    requiredScope: 'sessions:read',
    credits: (args) => digestCredits(new Set(args.sessionIds).size),
    argKinds: { sessionIds: 'sessionList', cursor: 'neutral' },
    maxDbRoundTrips: 3,
    validate(args) {
        if (args.cursor !== undefined) decodeCursor(args.cursor, cursorShape);
    },
    async handler(args, ctx, deps) {
        const ids = [...new Set(args.sessionIds)];
        const offset = args.cursor === undefined ? 0 : decodeCursor(args.cursor, cursorShape).offset;
        const requested = ids.slice(offset);
        const digests = await deps.data.getSessionDigests(ctx, requested);
        const found = new Set(digests.map((digest) => digest.id));

        // Position in the id list of each returned digest, so a shortened
        // result can say where to resume.
        const positions = digests.map((digest) => ids.indexOf(digest.id));
        const cursorAfter = (kept: number): string | null => {
            if (kept >= digests.length) return null;
            return encodeCursor({ offset: kept === 0 ? offset : positions[kept - 1] + 1 });
        };
        return {
            data: {
                digests: digests.map((digest) => ({
                    id: digest.id,
                    startedAt: digest.startedAt,
                    durationSeconds: digest.durationSeconds,
                    platform: digest.platform,
                    appVersion: digest.appVersion,
                    screens: [...digest.screens],
                    screensTruncated: digest.screensTruncated,
                    customEvents: digest.customEvents.map((event) => ({ name: event.name, count: event.count })),
                    friction: { ...digest.friction },
                    topErrors: digest.topErrors.map((error) => ({ kind: error.kind, name: error.name, message: error.message, count: error.count })),
                    link: deps.links.session(digest.id),
                })),
                notFound: requested.filter((id) => !found.has(id)),
                nextCursor: null,
            },
            paging: { listKey: 'digests', cursorAfter },
        };
    },
});
