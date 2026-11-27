/** Input pieces, output pieces and small helpers shared by the tools. */

import { z } from 'zod';
import { SESSION_ISSUE_TYPES, SESSION_PLATFORMS } from '../data/types.js';
import type { CappedCount, SessionFilter, SessionSummary, TimeRange } from '../data/types.js';
import { invalidArgument } from '../errors.js';
import type { DashboardLinks } from '../links.js';
import { out } from '../output/fields.js';

export const MAX_RANGE_DAYS = 90;
export const DEFAULT_RANGE_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export const projectIdInput = z.uuid().describe('Project id, from list_projects.');
export const sessionIdInput = z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,64}$/, 'Invalid session id')
    .describe('Session id.');

const instant = () => z.iso.datetime({ offset: true });

export const timeRangeInput = {
    from: instant().optional().describe(`Start of the time range (ISO 8601). Default: ${DEFAULT_RANGE_DAYS} days before "to".`),
    to: instant().optional().describe(`End of the time range (ISO 8601, exclusive). Default: now. The range may span at most ${MAX_RANGE_DAYS} days.`),
};

/** Applies the defaults and enforces the 90-day maximum. */
export function resolveTimeRange(args: { from?: string; to?: string }, now: Date): TimeRange {
    const to = args.to ? new Date(args.to) : (args.from ? new Date(Math.min(now.getTime(), new Date(args.from).getTime() + MAX_RANGE_DAYS * DAY_MS)) : now);
    const from = args.from ? new Date(args.from) : new Date(to.getTime() - DEFAULT_RANGE_DAYS * DAY_MS);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) throw invalidArgument('Invalid time range.');
    if (from.getTime() >= to.getTime()) throw invalidArgument('"from" must be before "to".');
    if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * DAY_MS) {
        throw invalidArgument(`The time range may span at most ${MAX_RANGE_DAYS} days.`);
    }
    return { from, to };
}

const filterText = (max: number) => z.string().trim().min(1).max(max);

export const sessionFilterInput = {
    projectId: projectIdInput,
    ...timeRangeInput,
    platform: z.enum(SESSION_PLATFORMS).optional().describe('"mobile" means ios or android.'),
    appVersion: filterText(50).optional().describe('Exact app version.'),
    userId: filterText(255).optional().describe('Exact user id as set by the app. Not available when identifier masking is on.'),
    screenName: filterText(255).optional().describe('Sessions that visited this screen (case-insensitive exact name).'),
    country: filterText(100).optional().describe('Two-letter country code or exact country name.'),
    customEventName: filterText(255).optional().describe('Sessions that logged this custom event (exact name).'),
    issueType: z.enum(SESSION_ISSUE_TYPES).optional().describe('Sessions with at least one crash, ANR, error, dead tap, a slow start (over 3 s), or repeated rage taps.'),
    hasReplay: z.boolean().optional().describe('Only sessions with (true) or without (false) a viewable replay.'),
};

export const sessionFilterArgKinds = {
    projectId: 'project',
    from: 'neutral',
    to: 'neutral',
    platform: 'neutral',
    appVersion: 'filter',
    userId: 'filter',
    screenName: 'filter',
    country: 'filter',
    customEventName: 'filter',
    issueType: 'neutral',
    hasReplay: 'neutral',
} as const;

export interface SessionFilterArgs {
    projectId: string;
    from?: string;
    to?: string;
    platform?: (typeof SESSION_PLATFORMS)[number];
    appVersion?: string;
    userId?: string;
    screenName?: string;
    country?: string;
    customEventName?: string;
    issueType?: (typeof SESSION_ISSUE_TYPES)[number];
    hasReplay?: boolean;
}

export function toSessionFilter(args: SessionFilterArgs, now: Date, maskIdentifiers: boolean): SessionFilter {
    if (maskIdentifiers && args.userId !== undefined) {
        // With masking on, user ids are hidden from results; a filter on them
        // would let a caller confirm one by probing.
        throw invalidArgument('Filtering by user id is not available while identifier masking is on.');
    }
    return {
        projectId: args.projectId,
        range: resolveTimeRange(args, now),
        platform: args.platform,
        appVersion: args.appVersion,
        userId: args.userId,
        screenName: args.screenName,
        country: args.country,
        customEventName: args.customEventName,
        issueType: args.issueType,
        hasReplay: args.hasReplay,
    };
}

export const cappedCountOutput = z.strictObject({
    count: z.number(),
    /** True when more rows match than were counted. */
    capped: z.boolean(),
    display: out.text(24),
});

export function toCappedCount(total: CappedCount): z.infer<typeof cappedCountOutput> {
    const formatted = total.count.toLocaleString('en-US');
    return { count: total.count, capped: total.capped, display: total.capped ? `${formatted}+` : formatted };
}

export const rangeOutput = z.strictObject({ from: out.timestamp(), to: out.timestamp() });

export function toRangeOutput(range: TimeRange): z.infer<typeof rangeOutput> {
    return { from: range.from.toISOString(), to: range.to.toISOString() };
}

export const sessionSummaryOutput = z.strictObject({
    id: out.id(),
    startedAt: out.timestamp(),
    durationSeconds: z.number(),
    platform: out.text(20).nullable(),
    appVersion: out.text(50).nullable(),
    deviceModel: out.text(100).nullable(),
    country: out.text(100).nullable(),
    userId: out.userId().nullable(),
    screenCount: z.number(),
    crashes: z.number(),
    anrs: z.number(),
    errors: z.number(),
    rageTaps: z.number(),
    deadTaps: z.number(),
    hasReplay: z.boolean(),
    link: out.link(),
});

export function toSessionSummaryOutput(session: SessionSummary, links: DashboardLinks): z.infer<typeof sessionSummaryOutput> {
    return {
        id: session.id,
        startedAt: session.startedAt,
        durationSeconds: session.durationSeconds,
        platform: session.platform,
        appVersion: session.appVersion,
        deviceModel: session.deviceModel,
        country: session.country,
        userId: session.userId,
        screenCount: session.screenCount,
        crashes: session.crashes,
        anrs: session.anrs,
        errors: session.errors,
        rageTaps: session.rageTaps,
        deadTaps: session.deadTaps,
        hasReplay: session.hasReplay,
        link: links.session(session.id),
    };
}

export const stackOutput = z.strictObject({
    frames: z.array(out.stackFrame()),
    totalFrames: z.number(),
    truncated: z.boolean(),
});
