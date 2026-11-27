import { z } from 'zod';
import { FAULT_TYPES } from '../data/types.js';
import { notFound } from '../errors.js';
import { outputMetaSchema } from '../output/emit.js';
import { out } from '../output/fields.js';
import { capStack } from '../stack.js';
import { stackOutput } from './common.js';
import { FRAMES_UNAVAILABLE_REASON, LEAD_UP_SECONDS, deviceOutput, leadUpBefore, timelineEventOutput } from './contextShared.js';
import { UNTRUSTED_CONTENT_NOTE, defineTool } from './types.js';

export const CRASH_CONTEXT_WINDOW_SECONDS = LEAD_UP_SECONDS;

/**
 * The single-fault variant of the context tools: the same lead-up window and
 * output fragments as get_session_context and get_issue_context, for one
 * crash, ANR or error id.
 */
export const getCrashContextTool = defineTool({
    name: 'get_crash_context',
    title: 'Crash context',
    description:
        'One crash, ANR or error in a single call: what it was, the device, the stack trace (at most 60 frames, as stored: not symbolicated) '
        + `and the session timeline for the ${CRASH_CONTEXT_WINDOW_SECONDS} seconds before it. Fault ids come from get_session_timeline and get_session_context. `
        + `For the whole session use get_session_context; for the whole group use get_issue_context. Costs 4 credits. ${UNTRUSTED_CONTENT_NOTE}`,
    inputSchema: z.strictObject({
        faultId: z.uuid().describe('Id of a crash, ANR or error.'),
        type: z.enum(FAULT_TYPES).optional().describe('What the id refers to, if known. Otherwise all three are tried.'),
    }),
    outputSchema: z.strictObject({
        fault: z.strictObject({
            id: out.id(),
            type: z.enum(FAULT_TYPES),
            projectId: out.id(),
            name: out.text(255),
            message: out.text(1000).nullable(),
            occurredAt: out.timestamp(),
            status: out.text(20),
            screenName: out.text(255).nullable(),
            /** ANRs only: how long the main thread was blocked. */
            durationMs: z.number().nullable(),
        }),
        device: deviceOutput,
        stack: stackOutput,
        /** Null when the session is gone (deleted or past retention). */
        session: z
            .strictObject({
                id: out.id(),
                /** Seconds from session start to the fault. */
                faultAtSeconds: z.number(),
                hasReplay: z.boolean(),
                /** Opens the replay at the moment of the fault. */
                link: out.link(),
            })
            .nullable(),
        timeline: z.strictObject({
            windowSeconds: z.number(),
            eventStream: z.enum(['ok', 'none', 'expired', 'partial', 'no_session']),
            events: z.array(timelineEventOutput),
            /** True when the window held more events than are returned; the ones closest to the fault are kept. */
            eventsDropped: z.boolean(),
        }),
        frames: z.array(z.strictObject({})).max(0),
        framesUnavailableReason: out.text(120),
        meta: outputMetaSchema,
    }),
    requiredScope: 'issues:read',
    credits: () => 4,
    argKinds: { faultId: 'fault', type: 'neutral' },
    maxDbRoundTrips: 6,
    async handler(args, ctx, deps) {
        const fault = await deps.data.getFault(ctx, args.faultId, args.type);
        if (!fault) throw notFound();

        // Only the event files around the fault: the lead-up is all this tool shows.
        const source = fault.sessionId ? await deps.data.getSessionTimeline(ctx, fault.sessionId, { aroundMs: fault.occurredAtMs }) : null;
        const leadUp = source ? leadUpBefore(source, fault.occurredAtMs) : null;
        return {
            data: {
                fault: {
                    id: fault.id,
                    type: fault.type,
                    projectId: fault.projectId,
                    name: fault.name,
                    message: fault.message,
                    occurredAt: fault.occurredAt,
                    status: fault.status,
                    screenName: fault.screenName,
                    durationMs: fault.durationMs,
                },
                device: { ...fault.device },
                stack: capStack(fault.stackTrace),
                session: source && leadUp
                    ? {
                        id: source.sessionId,
                        faultAtSeconds: leadUp.atSeconds,
                        hasReplay: fault.sessionHasReplay,
                        link: deps.links.session(source.sessionId, fault.occurredAtMs),
                    }
                    : null,
                timeline: {
                    windowSeconds: CRASH_CONTEXT_WINDOW_SECONDS,
                    eventStream: source ? source.eventStream : ('no_session' as const),
                    events: leadUp?.events ?? [],
                    eventsDropped: leadUp?.dropped ?? false,
                },
                frames: [],
                framesUnavailableReason: FRAMES_UNAVAILABLE_REASON,
            },
        };
    },
});
