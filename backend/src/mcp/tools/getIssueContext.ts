import { createHash } from 'node:crypto';
import { z } from 'zod';
import { notFound } from '../errors.js';
import { outputMetaSchema } from '../output/emit.js';
import { out } from '../output/fields.js';
import { capStack } from '../stack.js';
import { TIMELINE_EVENT_TYPES } from '../timeline/condense.js';
import { computeCommonLeadUp } from '../timeline/moments.js';
import { stackOutput } from './common.js';
import { FRAMES_UNAVAILABLE_REASON, LEAD_UP_SECONDS, leadUpBefore, mdEventLine, mdList, mdStack, mdText, timelineEventOutput } from './contextShared.js';
import { issueSummaryOutput, toIssueSummaryOutput } from './issueOutput.js';
import { UNTRUSTED_CONTENT_NOTE, defineTool } from './types.js';

export const ISSUE_CONTEXT_EXAMPLES = 3;
/** Lead-up events per example and stack frames, tried in turn until the result with its brief is inside the byte target. */
const SIZE_STEPS = [
    { leadUpEvents: 40, stackFrames: 60 },
    { leadUpEvents: 25, stackFrames: 40 },
    { leadUpEvents: 12, stackFrames: 25 },
    { leadUpEvents: 6, stackFrames: 15 },
];
export const ISSUE_CONTEXT_BYTE_TARGET = 32_000;
const DAY_MS = 24 * 60 * 60 * 1000;

const nameCount = z.strictObject({ name: out.text(100), count: z.number() });

const issueContextOutput = z.strictObject({
    issue: issueSummaryOutput.extend({
        projectId: out.id(),
        environment: out.text(50).nullable(),
        componentName: out.text(255).nullable(),
    }),
    trend: z.strictObject({
        last7Days: z.number(),
        previous7Days: z.number(),
        /** Events per UTC day, oldest first. */
        daily: z.array(z.strictObject({ day: out.text(10), count: z.number() })),
    }),
    affected: z.strictObject({
        versions: z.array(nameCount),
        devices: z.array(nameCount),
        /** Counted over the most recent occurrences only (see osVersionsFromOccurrences). */
        osVersions: z.array(nameCount),
        osVersionsFromOccurrences: z.number(),
    }),
    stack: stackOutput,
    /** Example sessions picked by a stable hash of the session id from the most recent occurrences. */
    examples: z.array(
        z.strictObject({
            sessionId: out.id(),
            occurredAt: out.timestamp(),
            /** Seconds from session start to the occurrence. */
            atSeconds: z.number(),
            appVersion: out.text(50).nullable(),
            deviceModel: out.text(100).nullable(),
            eventStream: z.enum(['ok', 'none', 'expired', 'partial']),
            /** The timeline for the 30 seconds before the occurrence. */
            leadUp: z.array(timelineEventOutput),
            leadUpDropped: z.boolean(),
            /** Opens the replay at the occurrence. */
            link: out.link(),
        }),
    ),
    /** What the lead-ups share: present in more than half of the sampled sessions. */
    commonLeadUp: z.strictObject({
        sessionsSampled: z.number(),
        screens: z.array(z.strictObject({ name: out.text(120), sessions: z.number() })),
        eventTypes: z.array(z.strictObject({ type: z.enum(TIMELINE_EVENT_TYPES), sessions: z.number() })),
        events: z.array(z.strictObject({ type: z.enum(TIMELINE_EVENT_TYPES), name: out.text(200), sessions: z.number() })),
    }),
    openQuestions: z.array(out.text(300)),
    /** The same content as a brief to paste: Issue, Who is affected, Stack, What users were doing before, Evidence, Open questions, Links. */
    markdown: out.derived(),
    meta: outputMetaSchema,
});

type IssueContextResult = z.infer<typeof issueContextOutput>;

/** Rendered from the scrubbed result: data only, no causes, no advice. */
export function renderIssueMarkdown(result: IssueContextResult): string {
    const issue = result.issue;
    const counts = (entries: Array<{ name: string; count: number }>) => entries.map((entry) => `${mdText(entry.name, 60)} (${entry.count})`).join(', ') || 'none recorded';
    const lines: string[] = [`# Issue ${mdText(issue.shortId)}: ${mdText(issue.title)}`, '', '## Issue'];
    lines.push(`- Type ${mdText(issue.type)}, status ${mdText(issue.status)}, priority ${mdText(issue.priority) || 'none'}${issue.isHandled === null ? '' : issue.isHandled ? ', handled' : ', unhandled'}`);
    if (issue.subtitle) lines.push(`- ${mdText(issue.subtitle, 300)}`);
    if (issue.screenName || issue.culprit) lines.push(`- Screen ${mdText(issue.screenName) || 'unknown'}; culprit ${mdText(issue.culprit) || 'unknown'}`);
    lines.push(`- First seen ${issue.firstSeen}, last seen ${issue.lastSeen}`);
    lines.push(`- ${issue.eventCount} events in total, ${issue.events24h} in the last 24 hours; ${result.trend.last7Days} in the last 7 days against ${result.trend.previous7Days} in the 7 days before`);

    lines.push('', '## Who is affected');
    lines.push(`- ${issue.userCount} users`);
    lines.push(`- App versions: ${counts(result.affected.versions)}`);
    lines.push(`- Devices: ${counts(result.affected.devices)}`);
    lines.push(`- OS versions (from the ${result.affected.osVersionsFromOccurrences} most recent occurrences): ${counts(result.affected.osVersions)}`);

    lines.push('', '## Stack', '', ...mdStack(result.stack.frames, 60), '');

    const common = result.commonLeadUp;
    lines.push('## What users were doing before');
    lines.push(`- Sampled sessions: ${common.sessionsSampled}. Listed below is what appears in the ${LEAD_UP_SECONDS} seconds before the issue in more than half of them.`);
    lines.push(`- Screens: ${common.screens.map((screen) => `${mdText(screen.name, 60)} (${screen.sessions} of ${common.sessionsSampled})`).join(', ') || 'none in common'}`);
    lines.push(`- Event types: ${common.eventTypes.map((entry) => `${entry.type} (${entry.sessions} of ${common.sessionsSampled})`).join(', ') || 'none in common'}`);
    lines.push(`- Events: ${common.events.map((entry) => `${entry.type} ${mdText(entry.name, 60)} (${entry.sessions} of ${common.sessionsSampled})`).join(', ') || 'none in common'}`);

    lines.push('', '## Evidence');
    for (const example of result.examples) {
        lines.push(`### Session ${mdText(example.sessionId)} (${mdText(example.appVersion) || 'unknown version'}, ${mdText(example.deviceModel) || 'unknown device'}), event stream ${example.eventStream}`);
        lines.push(...mdList(example.leadUp.map(mdEventLine), `- No events in the ${LEAD_UP_SECONDS} seconds before.`));
    }
    if (result.examples.length === 0) lines.push('- No example session could be read.');

    lines.push('', '## Open questions');
    lines.push(...result.openQuestions.map((question) => `- ${mdText(question, 300)}`));

    lines.push('', '## Links');
    lines.push(`- Issue: ${issue.link}`);
    for (const example of result.examples) lines.push(`- Session ${mdText(example.sessionId)}: ${example.link}`);
    return lines.join('\n');
}

export const getIssueContextTool = defineTool({
    name: 'get_issue_context',
    title: 'Issue context',
    description:
        'Everything needed to explain one issue (a crash, ANR or error group), in one call: what it is, first and last seen, counts and trend, affected versions, devices and OS, '
        + `the stack (at most 60 frames, as stored: not symbolicated), and for up to ${ISSUE_CONTEXT_EXAMPLES} example sessions the timeline of the ${LEAD_UP_SECONDS} seconds before it. `
        + 'Examples are picked by a stable hash from the most recent occurrences, not by severity. commonLeadUp lists the screens and events present in more than half of the sampled lead-ups (it states how many were sampled). '
        + `Includes the same content as a markdown brief. Found by fixed rules, no model: causes are for you to work out. Costs 3 credits. ${UNTRUSTED_CONTENT_NOTE}`,
    inputSchema: z.strictObject({ issueId: z.uuid().describe('Issue id, from list_issues, get_project_health or find_friction.') }),
    outputSchema: issueContextOutput,
    requiredScope: 'issues:read',
    credits: () => 3,
    argKinds: { issueId: 'issue' },
    maxDbRoundTrips: 6,
    renderMarkdown: renderIssueMarkdown,
    async handler(args, ctx, deps) {
        const issue = await deps.data.getIssue(ctx, args.issueId);
        if (!issue) throw notFound();

        // Up to three sessions, the earliest-hashing first: a stable choice that
        // does not favour the newest or the worst.
        const firstOccurrence = new Map<string, (typeof issue.recentOccurrences)[number]>();
        for (const occurrence of issue.recentOccurrences) {
            if (!firstOccurrence.has(occurrence.sessionId)) firstOccurrence.set(occurrence.sessionId, occurrence);
        }
        for (const sample of issue.sampleSessions) {
            if (!firstOccurrence.has(sample.sessionId)) firstOccurrence.set(sample.sessionId, { ...sample, osVersion: null });
        }
        const hashOf = (sessionId: string) => createHash('sha256').update(sessionId).digest('hex');
        const picked = [...firstOccurrence.values()]
            .sort((a, b) => hashOf(a.sessionId).localeCompare(hashOf(b.sessionId)))
            .slice(0, ISSUE_CONTEXT_EXAMPLES);
        // Only the event files around each occurrence: the lead-up is all that is shown.
        const aroundMs = new Map(picked.map((occurrence) => [occurrence.sessionId, occurrence.occurredAtMs]));
        const bundles = picked.length > 0 ? await deps.data.getSessionBundles(ctx, picked.map((occurrence) => occurrence.sessionId), { aroundMs }) : [];
        const bundleById = new Map(bundles.map((bundle) => [bundle.session.id, bundle]));

        const examplesAt = (maxLeadUpEvents: number) => picked.flatMap((occurrence) => {
            const bundle = bundleById.get(occurrence.sessionId);
            if (!bundle) return [];
            const leadUp = leadUpBefore(bundle.timeline, occurrence.occurredAtMs, LEAD_UP_SECONDS, maxLeadUpEvents);
            return [{
                sessionId: occurrence.sessionId,
                occurredAt: new Date(occurrence.occurredAtMs).toISOString(),
                atSeconds: leadUp.atSeconds,
                appVersion: occurrence.appVersion,
                deviceModel: occurrence.deviceModel,
                eventStream: bundle.timeline.eventStream,
                leadUp: leadUp.events,
                leadUpDropped: leadUp.dropped,
                link: deps.links.session(occurrence.sessionId, occurrence.occurredAtMs),
            }];
        });
        const examples = examplesAt(SIZE_STEPS[0].leadUpEvents);

        const today = deps.now().getTime();
        const dayOf = (offsetDays: number) => new Date(today - offsetDays * DAY_MS).toISOString().slice(0, 10);
        const sumBetween = (fromDay: string, toDay: string) =>
            issue.dailyEvents.filter((entry) => entry.day > fromDay && entry.day <= toDay).reduce((sum, entry) => sum + entry.count, 0);

        const osCounts = new Map<string, number>();
        for (const occurrence of issue.recentOccurrences) {
            if (occurrence.osVersion) osCounts.set(occurrence.osVersion, (osCounts.get(occurrence.osVersion) ?? 0) + 1);
        }

        const openQuestions: string[] = [`${FRAMES_UNAVAILABLE_REASON} What was on screen is not shown.`];
        if (issue.stackTrace) openQuestions.push('The stack trace is as stored and not symbolicated.');
        else openQuestions.push('No stack trace is stored for this issue.');
        if (examples.length === 0) openQuestions.push('No session of this issue could be read (deleted or past retention), so the lead-up is unknown.');
        else if (examples.length < ISSUE_CONTEXT_EXAMPLES) openQuestions.push(`Only ${examples.length} example session could be read, so "common" lead-up rests on very few sessions.`);
        const withoutStream = examples.filter((example) => example.eventStream !== 'ok').length;
        if (withoutStream > 0) openQuestions.push(`${withoutStream} of the example sessions have no complete recorded event stream; their lead-up shows only crash, ANR and error rows and stored custom events.`);
        openQuestions.push(`The lead-up covers ${LEAD_UP_SECONDS} seconds and ${examples.length} sampled sessions; it does not show what all affected sessions did.`);
        openQuestions.push('OS versions are counted over the most recent occurrences only; versions and devices are counted over all of them.');

        const build = (step: (typeof SIZE_STEPS)[number]) => {
            const stepExamples = step === SIZE_STEPS[0] ? examples : examplesAt(step.leadUpEvents);
            return {
                issue: {
                    ...toIssueSummaryOutput(issue, deps.links),
                    projectId: issue.projectId,
                    environment: issue.environment,
                    componentName: issue.componentName,
                },
                trend: {
                    last7Days: sumBetween(dayOf(7), dayOf(0)),
                    previous7Days: sumBetween(dayOf(14), dayOf(7)),
                    daily: issue.dailyEvents.map((entry) => ({ day: entry.day, count: entry.count })),
                },
                affected: {
                    versions: issue.affectedVersions.map((entry) => ({ name: entry.name, count: entry.count })),
                    devices: issue.affectedDevices.map((entry) => ({ name: entry.name, count: entry.count })),
                    osVersions: [...osCounts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, 10),
                    osVersionsFromOccurrences: issue.recentOccurrences.length,
                },
                stack: capStack(issue.stackTrace, step.stackFrames),
                examples: stepExamples,
                // What the lead-ups share is worked out from the fullest ones, whatever is shown.
                commonLeadUp: computeCommonLeadUp(examples.map((example) => example.leadUp)),
                openQuestions,
            };
        };
        const size = (candidate: ReturnType<typeof build>) =>
            Buffer.byteLength(JSON.stringify(candidate), 'utf8')
            + Buffer.byteLength(renderIssueMarkdown({ ...candidate, markdown: '', meta: { tookMs: 0, credits: 0, truncated: false, cached: false } } as unknown as IssueContextResult), 'utf8');
        let data = build(SIZE_STEPS[0]);
        for (const step of SIZE_STEPS.slice(1)) {
            if (size(data) <= ISSUE_CONTEXT_BYTE_TARGET) break;
            data = build(step);
        }
        return { data };
    },
});
