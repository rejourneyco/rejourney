import { z } from 'zod';
import {
    FRICTION_EXAMPLES_PER_GROUP,
    FRICTION_KINDS,
    FRICTION_MAX_RANGE_DAYS, FRICTION_SESSION_SCAN_CAP,
    FRICTION_THRESHOLDS,
    SESSION_PLATFORMS,
} from '../data/types.js';
import type { FrictionKind } from '../data/types.js';
import { invalidArgument, notFound } from '../errors.js';
import { outputMetaSchema } from '../output/emit.js';
import { out } from '../output/fields.js';
import { projectIdInput, rangeOutput, resolveTimeRange, timeRangeInput, toRangeOutput } from './common.js';
import { UNTRUSTED_CONTENT_NOTE, defineTool } from './types.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const T = FRICTION_THRESHOLDS;

/** Kinds counted from per-session counters: they say that a session had the problem, not where in the app. */
const PER_SESSION_COUNTER_KINDS: readonly FrictionKind[] = ['rage_taps', 'dead_taps', 'api_errors', 'slow_start', 'slow_api', 'short_session_after_error'];

function resolveFrictionRange(args: { from?: string; to?: string }, now: Date) {
    const range = resolveTimeRange(args, now);
    if (range.to.getTime() - range.from.getTime() > FRICTION_MAX_RANGE_DAYS * DAY_MS) {
        throw invalidArgument(`The time range may span at most ${FRICTION_MAX_RANGE_DAYS} days.`);
    }
    return range;
}

function share(part: number, whole: number): number | null {
    return whole > 0 ? Math.round((part / whole) * 10_000) / 10_000 : null;
}

export const findFrictionTool = defineTool({
    name: 'find_friction',
    title: 'Find friction',
    description:
        'Where are users struggling? Ranks friction groups for one project and time range (default 7 days, at most 30) and compares each with the previous equal period. '
        + `Reads at most ${FRICTION_SESSION_SCAN_CAP.toLocaleString('en-US')} sessions, newest first, across both periods: check rangeComplete and previousRangeComplete before comparing counts. `
        + 'Found by fixed rules, no model. A session counts towards: '
        + `rage_taps with more than ${T.rageTapsMoreThan} rage taps; dead_taps with at least ${T.deadTapsAtLeast}; api_errors with at least ${T.apiErrorsAtLeast} failed API call; `
        + `slow_start when start-up took over ${T.slowStartMs} ms; slow_api when its average API response was over ${T.slowApiAvgMs} ms; error_burst with at least ${T.errorBurstAtLeast} errors; `
        + `crash and anr with at least one; short_session_after_error when it had an error or failed API call and lasted under ${T.shortSessionSeconds} s. `
        + `Each group has up to ${FRICTION_EXAMPLES_PER_GROUP} example sessions picked by a stable hash (not the worst ones): pass one to get_session_context. `
        + `Costs 2 credits. ${UNTRUSTED_CONTENT_NOTE}`,
    inputSchema: z.strictObject({
        projectId: projectIdInput,
        ...timeRangeInput,
        platform: z.enum(SESSION_PLATFORMS).optional().describe('"mobile" means ios or android.'),
        appVersion: z.string().trim().min(1).max(50).optional().describe('Exact app version.'),
        screenName: z.string().trim().min(1).max(255).optional().describe('Only sessions that visited this screen (case-insensitive exact name).'),
    }),
    outputSchema: z.strictObject({
        range: rangeOutput,
        previousRange: rangeOutput,
        /** Sessions in the range that match the filters: the denominator of every share below. */
        sessionsInRange: z.number(),
        /** Null when the previous period was not read whole (see previousRangeComplete): its session count is then unknown. */
        previousSessionsInRange: z.number().nullable(),
        /** True when the scan limit was reached and older sessions were not counted. */
        capped: z.boolean(),
        /** False when the scan limit cut the range itself: counts cover only its most recent sessions. Use a shorter range. */
        rangeComplete: z.boolean(),
        /**
         * False when the scan limit cut the previous period: its shares are then computed over its most recent
         * sessions only (previousSessionsScanned of them) and its counts are not comparable with the range's counts.
         */
        previousRangeComplete: z.boolean(),
        previousSessionsScanned: z.number(),
        groups: z.array(
            z.strictObject({
                kind: z.enum(FRICTION_KINDS),
                /**
                 * per_session_counter: counted from a per-session total, so it cannot be tied to a screen.
                 * per_event_rows: backed by individual error, crash or ANR rows, which carry a screen or an issue.
                 */
                signal: z.enum(['per_session_counter', 'per_event_rows']),
                concentratesOn: z.strictObject({
                    type: z.enum(['screen', 'issue', 'unknown']),
                    screen: out.text(255).optional(),
                    issueId: out.id().optional(),
                    issueTitle: out.text(300).optional(),
                    issueLink: out.link().optional(),
                    /** Events on that screen or in that issue, and the events they are a share of. */
                    events: z.number().optional(),
                    ofEvents: z.number().optional(),
                }),
                sessionsAffected: z.number(),
                /** sessionsAffected / sessionsInRange. */
                shareOfSessions: z.number().nullable(),
                /** Distinct people: user id, else anonymous id, else device, else the session itself. */
                usersAffected: z.number(),
                versions: z.array(
                    z.strictObject({ appVersion: out.text(50).nullable(), platform: out.text(20).nullable(), sessions: z.number() }),
                ),
                trend: z.strictObject({
                    previousSessionsAffected: z.number(),
                    previousShareOfSessions: z.number().nullable(),
                    /** Share now minus share before, in share points; null when either period has no sessions. Compare shares, not counts, when previousRangeComplete is false. */
                    changeInShare: z.number().nullable(),
                }),
                exampleSessions: z.array(z.strictObject({ id: out.id(), link: out.link() })),
            }),
        ),
        meta: outputMetaSchema,
    }),
    requiredScope: 'sessions:read',
    credits: () => 2,
    argKinds: { projectId: 'project', from: 'neutral', to: 'neutral', platform: 'neutral', appVersion: 'filter', screenName: 'filter' },
    maxDbRoundTrips: 4,
    validate(args, env) {
        resolveFrictionRange(args, env.now);
    },
    async handler(args, ctx, deps) {
        const range = resolveFrictionRange(args, deps.now());
        const report = await deps.data.findFriction(ctx, {
            projectId: args.projectId,
            range,
            platform: args.platform,
            appVersion: args.appVersion,
            screenName: args.screenName,
        });
        if (!report) throw notFound();

        const topIssue = (type: string) => report.topIssues.find((issue) => issue.type === type && issue.eventsInRange > 0);
        const concentration = (kind: FrictionKind) => {
            if (kind === 'crash' || kind === 'anr') {
                const issue = topIssue(kind);
                const total = report.topIssues.filter((candidate) => candidate.type === kind).reduce((sum, candidate) => sum + candidate.eventsInRange, 0);
                return issue
                    ? { type: 'issue' as const, issueId: issue.id, issueTitle: issue.title, issueLink: deps.links.issue(issue.id), events: issue.eventsInRange, ofEvents: total }
                    : { type: 'unknown' as const };
            }
            if (kind === 'error_burst') {
                const screen = report.errorScreens.find((entry) => entry.screenName);
                return screen?.screenName
                    ? { type: 'screen' as const, screen: screen.screenName, events: screen.events, ofEvents: report.errorEventsCounted }
                    : { type: 'unknown' as const };
            }
            return { type: 'unknown' as const };
        };

        const previousFrom = new Date(range.from.getTime() - (range.to.getTime() - range.from.getTime()));
        return {
            data: {
                range: toRangeOutput(range),
                previousRange: toRangeOutput({ from: previousFrom, to: range.from }),
                sessionsInRange: report.sessionsInRange,
                previousSessionsInRange: report.previousRangeComplete ? report.previousSessionsInRange : null,
                capped: report.capped,
                rangeComplete: report.rangeComplete,
                previousRangeComplete: report.previousRangeComplete,
                previousSessionsScanned: report.previousSessionsInRange,
                groups: report.groups.map((group) => {
                    const now = share(group.sessionsAffected, report.sessionsInRange);
                    const before = share(group.previousSessionsAffected, report.previousSessionsInRange);
                    return {
                        kind: group.kind,
                        signal: PER_SESSION_COUNTER_KINDS.includes(group.kind) ? ('per_session_counter' as const) : ('per_event_rows' as const),
                        concentratesOn: concentration(group.kind),
                        sessionsAffected: group.sessionsAffected,
                        shareOfSessions: now,
                        usersAffected: group.usersAffected,
                        versions: group.versions.map((version) => ({ appVersion: version.appVersion, platform: version.platform, sessions: version.sessions })),
                        trend: {
                            previousSessionsAffected: group.previousSessionsAffected,
                            previousShareOfSessions: before,
                            changeInShare: now === null || before === null ? null : Math.round((now - before) * 10_000) / 10_000,
                        },
                        exampleSessions: group.exampleSessionIds.map((id) => ({ id, link: deps.links.session(id) })),
                    };
                }),
            },
        };
    },
});
