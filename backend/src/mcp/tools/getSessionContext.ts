import { z } from 'zod';
import { FAULT_TYPES } from '../data/types.js';
import type { SessionBundle } from '../data/types.js';
import { notFound } from '../errors.js';
import type { DashboardLinks } from '../links.js';
import { outputMetaSchema } from '../output/emit.js';
import { out } from '../output/fields.js';
import { capStack } from '../stack.js';
import { SLOW_REQUEST_MS, condenseTimeline } from '../timeline/condense.js';
import {
    ABANDON_AFTER_ERROR_SECONDS,
    MOMENT_KINDS,
    RAGE_CLUSTER_GAP_SECONDS,
    STUCK_LOOP_MIN_VISITS,
    STUCK_LOOP_WINDOW_SECONDS,
    STUCK_TAP_MIN_REPEATS,
    STUCK_TAP_WINDOW_SECONDS,
    detectMoments,
    screenVisits,
    trimTimeline,
} from '../timeline/moments.js';
import { sessionIdInput, stackOutput } from './common.js';
import { FRAMES_UNAVAILABLE_REASON, mdEventLine, mdList, mdStack, mdText, mdTime, timelineEventOutput } from './contextShared.js';
import { sessionDetailOutput, toSessionDetailOutput } from './getSession.js';
import { UNTRUSTED_CONTENT_NOTE, defineTool } from './types.js';

const MAX_FAULTS = 5;
/**
 * Sizes tried in turn until the whole result (structured part plus the
 * markdown brief) is inside the byte target. The moments and what led up to
 * them are kept longest; the plain timeline goes first.
 */
const SIZE_STEPS = [
    { maxEvents: 120, head: 30, tail: 30, maxBefore: 8, maxMoments: 20, stackFrames: 30 },
    { maxEvents: 80, head: 20, tail: 20, maxBefore: 6, maxMoments: 16, stackFrames: 20 },
    { maxEvents: 50, head: 12, tail: 12, maxBefore: 4, maxMoments: 12, stackFrames: 12 },
    { maxEvents: 30, head: 8, tail: 8, maxBefore: 3, maxMoments: 10, stackFrames: 8 },
    { maxEvents: 16, head: 4, tail: 4, maxBefore: 2, maxMoments: 6, stackFrames: 5 },
];
/**
 * A result is read by a model, and every byte is its context: about 10,000
 * tokens at most. The full timeline stays available, paged, from
 * get_session_timeline.
 */
export const SESSION_CONTEXT_BYTE_TARGET = 32_000;

const momentOutput = z.strictObject({
    kind: z.enum(MOMENT_KINDS),
    /** Seconds since session start. */
    t: z.number(),
    tEnd: z.number().optional(),
    screen: out.text(120).optional(),
    name: out.text(200),
    detail: out.text(300).optional(),
    count: z.number(),
    faultId: out.id().optional(),
    /** Events in the 10 seconds before the moment, oldest first. */
    before: z.array(timelineEventOutput),
    /** Log lines from 10 seconds before to 2 seconds after. */
    logs: z.array(timelineEventOutput),
    /** Opens the replay at the moment. */
    link: out.link(),
});

const sessionContextOutput = z.strictObject({
    session: sessionDetailOutput,
    /** Screens in order with the time spent on each, from the timeline. Empty when the timeline has no screen events. */
    screens: z.array(z.strictObject({ name: out.text(120), t: z.number(), seconds: z.number().nullable() })),
    timeline: z.strictObject({
        /** "ok", or why recorded events are missing: none recorded, expired, or partial (too large or too slow to read fully). */
        eventStream: z.enum(['ok', 'none', 'expired', 'partial']),
        totalEvents: z.number(),
        /** Events left out of the middle to keep the result small. The start, the end and every moment window are kept. */
        omittedFromMiddle: z.number(),
        events: z.array(timelineEventOutput),
    }),
    moments: z.array(momentOutput),
    /** Moments found beyond the limit and not listed. */
    momentsDropped: z.number(),
    faults: z.array(
        z.strictObject({
            id: out.id(),
            type: z.enum(FAULT_TYPES),
            name: out.text(255),
            message: out.text(600).nullable(),
            occurredAt: out.timestamp(),
            atSeconds: z.number(),
            screenName: out.text(255).nullable(),
            durationMs: z.number().nullable(),
            stack: stackOutput,
            link: out.link(),
        }),
    ),
    faultsOmitted: z.number(),
    customEvents: z.array(z.strictObject({ name: out.text(120), count: z.number() })),
    /** What this data cannot show. Statements of fact, not guesses. */
    openQuestions: z.array(out.text(300)),
    /** The same content as a brief to paste: Session, What the user did, Where it went wrong, Evidence, Open questions, Links. */
    markdown: out.derived(),
    meta: outputMetaSchema,
});

type SessionContextResult = z.infer<typeof sessionContextOutput>;

function buildContext(bundle: SessionBundle, links: DashboardLinks, step: (typeof SIZE_STEPS)[number]) {
    const { session, timeline: source } = bundle;
    const all = condenseTimeline(source.events, { sessionStartMs: source.sessionStartMs });
    const detection = detectMoments(all, { maxBefore: step.maxBefore, maxMoments: step.maxMoments });
    const trimmed = trimTimeline(all, detection.moments, step);
    const atMs = (seconds: number) => source.sessionStartMs + Math.round(seconds * 1000);

    const shownFaults = bundle.faults.slice(0, MAX_FAULTS);
    const openQuestions: string[] = [`${FRAMES_UNAVAILABLE_REASON} What was on screen is not shown.`];
    if (source.eventStream === 'none') openQuestions.push('No recorded event stream was found for this session: the timeline holds only crash, ANR and error rows and stored custom events.');
    if (source.eventStream === 'expired') openQuestions.push('The recorded event stream is past retention: the timeline holds only crash, ANR and error rows and stored custom events.');
    if (source.eventStream === 'partial') openQuestions.push('The recorded event stream was too large or too slow to read fully: the timeline is incomplete.');
    if (trimmed.omitted > 0) openQuestions.push(`${trimmed.omitted} of ${trimmed.total} timeline events from the middle of the session are not included.`);
    if (detection.dropped > 0) openQuestions.push(`${detection.dropped} more moments were found than are listed.`);
    if (bundle.faults.length > shownFaults.length) openQuestions.push(`${bundle.faults.length - shownFaults.length} more crash, ANR or error rows exist than are listed.`);
    if (shownFaults.some((fault) => fault.stackTrace)) openQuestions.push('Stack traces are as stored and not symbolicated.');
    if (!all.some((event) => event.type === 'screen')) openQuestions.push('The timeline has no screen events, so time per screen is unknown.');
    openQuestions.push('Successful requests under the slow threshold, typed text and tap coordinates are not part of this data.');

    return {
        session: toSessionDetailOutput(session, links),
        screens: screenVisits(all),
        timeline: { eventStream: source.eventStream, totalEvents: all.length, omittedFromMiddle: trimmed.omitted, events: trimmed.events },
        moments: detection.moments.map((moment) => ({ ...moment, link: links.session(session.id, atMs(moment.t)) })),
        momentsDropped: detection.dropped,
        faults: shownFaults.map((fault) => ({
            id: fault.id,
            type: fault.type,
            name: fault.name,
            message: fault.message,
            occurredAt: new Date(fault.occurredAtMs).toISOString(),
            atSeconds: Math.round(((fault.occurredAtMs - source.sessionStartMs) / 1000) * 10) / 10,
            screenName: fault.screenName,
            durationMs: fault.durationMs,
            stack: capStack(fault.stackTrace, step.stackFrames),
            link: links.session(session.id, fault.occurredAtMs),
        })),
        faultsOmitted: bundle.faults.length - shownFaults.length,
        customEvents: bundle.customEvents.map((event) => ({ name: event.name, count: event.count })),
        openQuestions,
    };
}

/** Rendered from the scrubbed result: data only, no causes, no advice. */
export function renderSessionMarkdown(result: SessionContextResult): string {
    const s = result.session;
    const m = s.metrics;
    const lines: string[] = [`# Session ${mdText(s.id)}`, '', '## Session'];
    lines.push(`- Started ${s.startedAt}, lasted ${s.durationSeconds} s, status ${mdText(s.status)}`);
    lines.push(`- ${mdText(s.platform) || 'unknown platform'}, app ${mdText(s.appVersion) || 'unknown'}, ${mdText(s.device.model) || 'unknown device'}, OS ${mdText(s.device.osVersion) || 'unknown'}, SDK ${mdText(s.device.sdkVersion) || 'unknown'}`);
    lines.push(`- User: ${s.isAnonymous ? 'anonymous' : mdText(s.userId)}; device ${mdText(s.device.deviceHash) || 'unknown'}; ${[mdText(s.location.city), mdText(s.location.country)].filter(Boolean).join(', ') || 'location unknown'}`);
    lines.push(`- Counts: ${m.totalEvents} events, ${m.touches} taps, ${s.rageTaps} rage taps, ${s.deadTaps} dead taps, ${s.errors} errors, ${s.crashes} crashes, ${s.anrs} ANRs, ${m.apiErrors} of ${m.apiTotal} API calls failed`);
    lines.push(`- Replay: ${s.replay.available ? 'available' : `not available (${mdText(s.replay.unavailableReason) || 'unknown'})`}`);

    lines.push('', '## What the user did');
    if (result.screens.length > 0) {
        lines.push(`- Screens: ${result.screens.map((screen) => `${mdText(screen.name, 60)}${screen.seconds === null ? '' : ` (${Math.round(screen.seconds)} s)`}`).join(' → ')}`);
    } else if (s.screens.length > 0) {
        lines.push(`- Screens (order first visited, no times): ${s.screens.map((screen) => mdText(screen, 60)).join(' → ')}`);
    } else {
        lines.push('- No screens recorded.');
    }
    if (result.customEvents.length > 0) lines.push(`- Custom events: ${result.customEvents.map((event) => `${mdText(event.name, 60)} ×${event.count}`).join(', ')}`);
    const shown = result.timeline.events.slice(0, 80);
    lines.push(`- Timeline (${shown.length} of ${result.timeline.totalEvents} events shown here${result.timeline.omittedFromMiddle > 0 ? `; ${result.timeline.omittedFromMiddle} omitted from the middle` : ''}):`);
    for (const event of shown) lines.push(`  ${mdEventLine(event)}`);

    lines.push('', '## Where it went wrong');
    lines.push(...mdList(
        result.moments.map((moment) => {
            const span = moment.tEnd !== undefined && moment.tEnd > moment.t ? `–${mdTime(moment.tEnd)}` : '';
            const where = moment.screen ? ` on ${mdText(moment.screen, 80)}` : '';
            const detail = moment.detail ? ` (${mdText(moment.detail)})` : '';
            return `- \`${mdTime(moment.t)}${span}\` ${moment.kind}${where}: ${mdText(moment.name)}${detail}${moment.count > 1 ? ` ×${moment.count}` : ''}`;
        }),
        '- The detection rules found no moments in this session.',
    ));

    lines.push('', '## Evidence');
    for (const moment of result.moments) {
        lines.push(`### Before ${moment.kind} at ${mdTime(moment.t)}`);
        lines.push(...mdList(moment.before.map(mdEventLine), '- No events in the 10 seconds before.'));
        if (moment.logs.length > 0) {
            lines.push('Logs:');
            lines.push(...moment.logs.map(mdEventLine));
        }
    }
    for (const fault of result.faults) {
        lines.push(`### ${fault.type} at ${mdTime(fault.atSeconds)}: ${mdText(fault.name)}`);
        if (fault.message) lines.push(mdText(fault.message, 400));
        lines.push('', ...mdStack(fault.stack.frames, 20), '');
    }
    if (result.moments.length === 0 && result.faults.length === 0) lines.push('- Nothing to show.');

    lines.push('', '## Open questions');
    lines.push(...result.openQuestions.map((question) => `- ${mdText(question, 300)}`));

    lines.push('', '## Links');
    lines.push(`- Session: ${s.link}`);
    for (const moment of result.moments) lines.push(`- ${moment.kind} at ${mdTime(moment.t)}: ${moment.link}`);
    return lines.join('\n');
}

export const getSessionContextTool = defineTool({
    name: 'get_session_context',
    title: 'Session context',
    description:
        'Everything needed to explain one session, in one call: session facts, screens in order with time on each, the condensed timeline, the moments where something went wrong '
        + 'with the 10 seconds before each, nearby log lines, crash, ANR and error details with stacks, custom events, links that open the replay at each moment, '
        + 'and the same content as a markdown brief. Moments are found by fixed rules, no model: '
        + `rage taps no more than ${RAGE_CLUSTER_GAP_SECONDS} s apart on one screen form one cluster; every dead tap, failed request, error, crash and ANR; requests of ${SLOW_REQUEST_MS} ms or more; `
        + `stuck_loop when a screen is entered ${STUCK_LOOP_MIN_VISITS} times within ${STUCK_LOOP_WINDOW_SECONDS} s or one target is tapped ${STUCK_TAP_MIN_REPEATS} times within ${STUCK_TAP_WINDOW_SECONDS} s; `
        + `abandon_after_error when the session's last event comes within ${ABANDON_AFTER_ERROR_SECONDS} s of a failed request, error, rage tap or dead tap. `
        + `Long timelines are trimmed in the middle (get_session_timeline has every event, paged). The brief states facts only: causes are for you to work out. Costs 3 credits. ${UNTRUSTED_CONTENT_NOTE}`,
    inputSchema: z.strictObject({ sessionId: sessionIdInput }),
    outputSchema: sessionContextOutput,
    requiredScope: 'sessions:read',
    credits: () => 3,
    argKinds: { sessionId: 'session' },
    maxDbRoundTrips: 3,
    renderMarkdown: renderSessionMarkdown,
    async handler(args, ctx, deps) {
        const [bundle] = await deps.data.getSessionBundles(ctx, [args.sessionId]);
        if (!bundle) throw notFound();
        // Measured with the brief, which repeats much of the structured part.
        // Rendered here from unscrubbed data only to size it; the brief sent is
        // rendered again by the output layer from the scrubbed result.
        const size = (candidate: ReturnType<typeof buildContext>) =>
            Buffer.byteLength(JSON.stringify(candidate), 'utf8')
            + Buffer.byteLength(renderSessionMarkdown({ ...candidate, markdown: '', meta: { tookMs: 0, credits: 0, truncated: false, cached: false } } as unknown as SessionContextResult), 'utf8');
        let data = buildContext(bundle, deps.links, SIZE_STEPS[0]);
        for (const step of SIZE_STEPS.slice(1)) {
            if (size(data) <= SESSION_CONTEXT_BYTE_TARGET) break;
            data = buildContext(bundle, deps.links, step);
        }
        return { data };
    },
});
