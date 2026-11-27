import { z } from 'zod';
import {
    FAULT_SUMMARY_EXAMPLES_PER_GROUP,
    FAULT_SUMMARY_GROUPS,
    FAULT_SUMMARY_LEAD_UP_SESSIONS,
    FAULT_SUMMARY_SCAN_CAP,
    FAULT_TYPES,
    SESSION_PLATFORMS,
} from '../data/types.js';
import { notFound } from '../errors.js';
import { outputMetaSchema } from '../output/emit.js';
import { out } from '../output/fields.js';
import { TIMELINE_EVENT_TYPES } from '../timeline/condense.js';
import { computeCommonLeadUp } from '../timeline/moments.js';
import { cappedCountOutput, projectIdInput, rangeOutput, resolveTimeRange, timeRangeInput, toCappedCount, toRangeOutput } from './common.js';
import { LEAD_UP_SECONDS, leadUpBefore, timelineEventOutput } from './contextShared.js';
import { UNTRUSTED_CONTENT_NOTE, defineTool } from './types.js';

const LEAD_UP_EVENTS_PER_EXAMPLE = 15;
const WITH_LEAD_UP_CREDITS = 5;

const breakdownRow = z.strictObject({
    name: out.text(255),
    /** Rows of this fault type. */
    count: z.number(),
    /** Distinct sessions those rows belong to. */
    sessions: z.number(),
});

/**
 * The answer to "what are our ANRs / crashes / errors, and where do they
 * concentrate?" in one call. It reads the fault rows themselves, so it also
 * covers faults that were never grouped into an issue.
 */
export const summarizeFaultsTool = defineTool({
    name: 'summarize_faults',
    title: 'Summarize faults',
    description:
        'Breaks down all crashes, all ANRs or all errors of one project over a time range (default 7 days): how many and in how many sessions, '
        + `the top ${FAULT_SUMMARY_GROUPS} groups by signature with up to ${FAULT_SUMMARY_EXAMPLES_PER_GROUP} example faults each, and counts by app version, platform, OS version, device, screen (errors only) and day. `
        + 'ANRs also get how long the main thread was blocked (median, 90th percentile, longest). '
        + 'Start here for "why do we get ANRs / crashes / this many errors" and for comparing versions or platforms: it reads the rows themselves, so it includes faults that belong to no issue in list_issues. '
        + `Set includeLeadUp to also read the ${LEAD_UP_SECONDS} seconds before the fault in up to ${FAULT_SUMMARY_LEAD_UP_SESSIONS} sessions (drawn by a stable hash across all rows, so large groups appear in proportion) and get what those lead-ups have in common: `
        + `use it for "what are users doing right before" instead of reading sessions one by one. With it the call costs ${WITH_LEAD_UP_CREDITS} credits. `
        + 'Pass an example faultId to get_crash_context for its stack and the 30 seconds before it; a group with an issueId can go to get_issue_context. '
        + `Reads at most ${FAULT_SUMMARY_SCAN_CAP.toLocaleString('en-US')} rows, newest first: when total.capped is true every figure describes only the most recent rows, so use a shorter range. `
        + 'Counts are fault rows, not rates: for a rate divide by the session count from get_project_health or search_sessions with the same filters. '
        + `Found by fixed rules, no model. Costs 2 credits, ${WITH_LEAD_UP_CREDITS} with includeLeadUp. ${UNTRUSTED_CONTENT_NOTE}`,
    inputSchema: z.strictObject({
        projectId: projectIdInput,
        type: z.enum(FAULT_TYPES).describe('Which rows to break down.'),
        ...timeRangeInput,
        platform: z.enum(SESSION_PLATFORMS).optional().describe('"mobile" means ios or android.'),
        appVersion: z.string().trim().min(1).max(50).optional().describe('Exact app version.'),
        includeLeadUp: z.boolean().optional().describe(`Also read what happened in the ${LEAD_UP_SECONDS} seconds before a sample of these faults. Default false.`),
    }),
    outputSchema: z.strictObject({
        projectId: out.id(),
        type: z.enum(FAULT_TYPES),
        range: rangeOutput,
        /** Fault rows read. When capped, everything below describes the most recent rows only. */
        total: cappedCountOutput,
        /** Distinct sessions with at least one of these rows. */
        sessionsAffected: z.number(),
        /** Distinct signatures among the rows read; `groups` lists the largest. */
        groupCount: z.number(),
        groups: z.array(
            z.strictObject({
                name: out.text(255),
                /** Start of the message (crash, error) or of the stack as stored (ANR). */
                detail: out.text(300).nullable(),
                count: z.number(),
                sessions: z.number(),
                /** count / total.count. */
                shareOfRows: z.number().nullable(),
                /** First and last occurrence among the rows read. */
                firstSeen: out.timestamp(),
                lastSeen: out.timestamp(),
                /** The grouped issue for these rows, usable with get_issue_context. Absent when they belong to no issue. */
                issueId: out.id().optional(),
                issueLink: out.link().optional(),
                /** Most recent occurrences. faultId goes to get_crash_context, sessionId to get_session_context. */
                examples: z.array(z.strictObject({ faultId: out.id(), sessionId: out.id().nullable(), link: out.link().nullable() })),
            }),
        ),
        /** ANRs only: milliseconds the main thread was blocked. */
        blockedMs: z.strictObject({ median: z.number(), p90: z.number(), longest: z.number() }).nullable(),
        byAppVersion: z.array(breakdownRow),
        byPlatform: z.array(breakdownRow),
        byOsVersion: z.array(breakdownRow),
        byDevice: z.array(breakdownRow),
        /** Errors only: crash and ANR rows carry no screen. */
        byScreen: z.array(breakdownRow),
        /** Rows per UTC day, oldest first. Days with none are absent. */
        daily: z.array(z.strictObject({ day: out.text(10), count: z.number(), sessions: z.number() })),
        /** Null unless includeLeadUp was set. */
        leadUp: z
            .strictObject({
                windowSeconds: z.number(),
                /** Sessions whose lead-up was read. "Common" below means present in more than half of them. */
                sessionsSampled: z.number(),
                commonScreens: z.array(z.strictObject({ name: out.text(120), sessions: z.number() })),
                commonEventTypes: z.array(z.strictObject({ type: z.enum(TIMELINE_EVENT_TYPES), sessions: z.number() })),
                commonEvents: z.array(z.strictObject({ type: z.enum(TIMELINE_EVENT_TYPES), name: out.text(200), sessions: z.number() })),
                examples: z.array(
                    z.strictObject({
                        faultId: out.id(),
                        sessionId: out.id(),
                        /** The group this fault belongs to. */
                        name: out.text(255),
                        /** Seconds from session start to the fault. */
                        atSeconds: z.number(),
                        eventStream: z.enum(['ok', 'none', 'expired', 'partial']),
                        /** The last events before the fault, oldest first. */
                        events: z.array(timelineEventOutput),
                        eventsDropped: z.boolean(),
                        /** Opens the replay at the fault. */
                        link: out.link(),
                    }),
                ),
            })
            .nullable(),
        meta: outputMetaSchema,
    }),
    requiredScope: 'issues:read',
    credits: (args) => (args.includeLeadUp ? WITH_LEAD_UP_CREDITS : 2),
    argKinds: { projectId: 'project', type: 'neutral', from: 'neutral', to: 'neutral', platform: 'neutral', appVersion: 'filter', includeLeadUp: 'neutral' },
    maxDbRoundTrips: 5,
    validate(args, env) {
        resolveTimeRange(args, env.now);
    },
    async handler(args, ctx, deps) {
        const range = resolveTimeRange(args, deps.now());
        const summary = await deps.data.summarizeFaults(ctx, {
            projectId: args.projectId,
            type: args.type,
            range,
            platform: args.platform,
            appVersion: args.appVersion,
        });
        if (!summary) throw notFound();

        // The lead-up: one fault per session, in the order of the stable draw,
        // each read from the event files around it only.
        let leadUp = null;
        if (args.includeLeadUp) {
            const picked = new Map<string, (typeof summary.sample)[number]>();
            for (const row of summary.sample) {
                if (picked.size >= FAULT_SUMMARY_LEAD_UP_SESSIONS) break;
                if (!picked.has(row.sessionId)) picked.set(row.sessionId, row);
            }
            const aroundMs = new Map([...picked.values()].map((row) => [row.sessionId, row.occurredAtMs]));
            const bundles = picked.size > 0 ? await deps.data.getSessionBundles(ctx, [...picked.keys()], { aroundMs }) : [];
            const bundleById = new Map(bundles.map((bundle) => [bundle.session.id, bundle]));
            const examples = [...picked.values()].flatMap((row) => {
                const bundle = bundleById.get(row.sessionId);
                if (!bundle) return [];
                const before = leadUpBefore(bundle.timeline, row.occurredAtMs, LEAD_UP_SECONDS, LEAD_UP_EVENTS_PER_EXAMPLE);
                return [{
                    faultId: row.faultId,
                    sessionId: row.sessionId,
                    name: row.name,
                    atSeconds: before.atSeconds,
                    eventStream: bundle.timeline.eventStream,
                    events: before.events,
                    eventsDropped: before.dropped,
                    link: deps.links.session(row.sessionId, row.occurredAtMs),
                }];
            });
            const common = computeCommonLeadUp(examples.map((example) => example.events));
            leadUp = {
                windowSeconds: LEAD_UP_SECONDS,
                sessionsSampled: common.sessionsSampled,
                commonScreens: common.screens,
                commonEventTypes: common.eventTypes,
                commonEvents: common.events,
                examples,
            };
        }

        const rows = (entries: Array<{ name: string; count: number; sessions: number }>) =>
            entries.map((entry) => ({ name: entry.name, count: entry.count, sessions: entry.sessions }));
        return {
            data: {
                projectId: summary.projectId,
                type: summary.type,
                range: toRangeOutput(range),
                total: toCappedCount(summary.total),
                sessionsAffected: summary.sessions,
                groupCount: summary.groupCount,
                groups: summary.groups.map((group) => ({
                    name: group.name,
                    detail: group.detail,
                    count: group.count,
                    sessions: group.sessions,
                    shareOfRows: summary.total.count > 0 ? Math.round((group.count / summary.total.count) * 10_000) / 10_000 : null,
                    firstSeen: group.firstSeen,
                    lastSeen: group.lastSeen,
                    ...(group.issueId ? { issueId: group.issueId, issueLink: deps.links.issue(group.issueId) } : {}),
                    examples: group.examples.map((example) => ({
                        faultId: example.faultId,
                        sessionId: example.sessionId,
                        link: example.sessionId ? deps.links.session(example.sessionId, example.occurredAtMs) : null,
                    })),
                })),
                blockedMs: summary.durationMs ? { median: summary.durationMs.p50, p90: summary.durationMs.p90, longest: summary.durationMs.max } : null,
                byAppVersion: rows(summary.byAppVersion),
                byPlatform: rows(summary.byPlatform),
                byOsVersion: rows(summary.byOsVersion),
                byDevice: rows(summary.byDevice),
                byScreen: rows(summary.byScreen),
                daily: summary.daily.map((entry) => ({ day: entry.day, count: entry.count, sessions: entry.sessions })),
                leadUp,
            },
        };
    },
});
