import { z } from 'zod';
import { outputMetaSchema } from '../output/emit.js';
import { notFound } from '../errors.js';
import { out } from '../output/fields.js';
import { cappedCountOutput, projectIdInput, rangeOutput, resolveTimeRange, timeRangeInput, toCappedCount, toRangeOutput } from './common.js';
import { issueSummaryOutput, toIssueSummaryOutput } from './issueOutput.js';
import { UNTRUSTED_CONTENT_NOTE, defineTool } from './types.js';

export const getProjectHealthTool = defineTool({
    name: 'get_project_health',
    title: 'Project health',
    description:
        'Stability summary for one project over a time range: sessions, crash-free session rate, crash, ANR and error counts, and the top issues. '
        + 'A count marked capped stopped at its limit and is a floor, not the total: use a shorter range, or summarize_faults for a breakdown of crashes, ANRs or errors. '
        + `Costs 1 credit. ${UNTRUSTED_CONTENT_NOTE}`,
    inputSchema: z.strictObject({ projectId: projectIdInput, ...timeRangeInput }),
    outputSchema: z.strictObject({
        projectId: out.id(),
        range: rangeOutput,
        /** Sessions counted. When capped, the rates below describe the most recent sessions in the range only. */
        sessions: cappedCountOutput,
        sessionsWithCrash: z.number(),
        sessionsWithAnr: z.number(),
        sessionsWithError: z.number(),
        /** 0 to 1; null when there were no sessions. */
        crashFreeSessionRate: z.number().nullable(),
        crashes: cappedCountOutput,
        anrs: cappedCountOutput,
        errors: cappedCountOutput,
        topIssues: z.array(issueSummaryOutput.extend({ eventsInRange: z.number() })),
        meta: outputMetaSchema,
    }),
    requiredScope: 'sessions:read',
    credits: () => 1,
    argKinds: { projectId: 'project', from: 'neutral', to: 'neutral' },
    maxDbRoundTrips: 3,
    validate(args, env) {
        resolveTimeRange(args, env.now);
    },
    async handler(args, ctx, deps) {
        const range = resolveTimeRange(args, deps.now());
        const health = await deps.data.getProjectHealth(ctx, { projectId: args.projectId, range });
        if (!health) throw notFound();
        return {
            data: {
                projectId: health.projectId,
                range: toRangeOutput(range),
                sessions: toCappedCount(health.sessions),
                sessionsWithCrash: health.sessionsWithCrash,
                sessionsWithAnr: health.sessionsWithAnr,
                sessionsWithError: health.sessionsWithError,
                crashFreeSessionRate: health.crashFreeSessionRate,
                crashes: toCappedCount(health.crashes),
                anrs: toCappedCount(health.anrs),
                errors: toCappedCount(health.errors),
                topIssues: health.topIssues.map((issue) => ({ ...toIssueSummaryOutput(issue, deps.links), eventsInRange: issue.eventsInRange })),
            },
        };
    },
});
