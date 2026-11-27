import { z } from 'zod';
import { outputMetaSchema } from '../output/emit.js';
import type { SessionDetail } from '../data/types.js';
import { notFound } from '../errors.js';
import type { DashboardLinks } from '../links.js';
import { out } from '../output/fields.js';
import { sessionIdInput, sessionSummaryOutput, toSessionSummaryOutput } from './common.js';
import { UNTRUSTED_CONTENT_NOTE, defineTool } from './types.js';

export const sessionDetailOutput = sessionSummaryOutput.extend({
    projectId: out.id(),
    endedAt: out.timestamp().nullable(),
    status: out.text(20),
    device: z.strictObject({
        model: out.text(100).nullable(),
        osVersion: out.text(50).nullable(),
        sdkVersion: out.text(50).nullable(),
        /** Short stable hash of the device id; the same device gives the same hash within a project. */
        deviceHash: out.pseudonym().nullable(),
    }),
    isAnonymous: z.boolean(),
    location: z.strictObject({
        country: out.text(100).nullable(),
        countryCode: out.text(10).nullable(),
        city: out.city().nullable(),
    }),
    metrics: z.strictObject({
        totalEvents: z.number(),
        touches: z.number(),
        scrolls: z.number(),
        gestures: z.number(),
        inputs: z.number(),
        customEvents: z.number(),
        apiTotal: z.number(),
        apiErrors: z.number(),
        apiAvgResponseMs: z.number(),
        appStartupMs: z.number().nullable(),
    }),
    /** Screens in the order first visited. */
    screens: z.array(out.text(255)),
    screensTruncated: z.boolean(),
    replay: z.strictObject({
        available: z.boolean(),
        unavailableReason: out.text(40).nullable(),
    }),
});

export function toSessionDetailOutput(session: SessionDetail, links: DashboardLinks): z.infer<typeof sessionDetailOutput> {
    return {
        ...toSessionSummaryOutput(session, links),
        projectId: session.projectId,
        endedAt: session.endedAt,
        status: session.status,
        device: {
            model: session.deviceModel,
            osVersion: session.osVersion,
            sdkVersion: session.sdkVersion,
            deviceHash: session.deviceHash,
        },
        isAnonymous: session.isAnonymous,
        location: { country: session.country, countryCode: session.countryCode, city: session.city },
        metrics: { ...session.metrics },
        screens: [...session.screens],
        screensTruncated: session.screensTruncated,
        replay: { available: session.hasReplay, unavailableReason: session.replayUnavailableReason },
    };
}

export const getSessionTool = defineTool({
    name: 'get_session',
    title: 'Session details',
    description:
        'One session: device, app version, duration, event and error counts, the screens visited in order, whether a replay can be opened, and a dashboard link. '
        + `Use get_session_timeline for what happened inside it. Costs 1 credit. ${UNTRUSTED_CONTENT_NOTE}`,
    inputSchema: z.strictObject({ sessionId: sessionIdInput }),
    outputSchema: z.strictObject({
        session: sessionDetailOutput,
        meta: outputMetaSchema,
    }),
    requiredScope: 'sessions:read',
    credits: () => 1,
    argKinds: { sessionId: 'session' },
    maxDbRoundTrips: 2,
    async handler(args, ctx, deps) {
        const session = await deps.data.getSession(ctx, args.sessionId);
        if (!session) throw notFound();
        return {
            data: {
                session: toSessionDetailOutput(session, deps.links),
            },
        };
    },
});
