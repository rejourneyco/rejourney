import { z } from 'zod';
import { outputMetaSchema } from '../output/emit.js';
import { decodeCursor, encodeCursor } from '../data/cursor.js';
import { notFound } from '../errors.js';
import { out } from '../output/fields.js';
import { cappedCountOutput, projectIdInput, rangeOutput, resolveTimeRange, timeRangeInput, toCappedCount, toRangeOutput } from './common.js';
import { issueSummaryOutput, toIssueSummaryOutput } from './issueOutput.js';
import { UNTRUSTED_CONTENT_NOTE, defineTool } from './types.js';

export const ISSUE_PAGE_SIZE = 25;
export const ISSUE_TYPES = ['error', 'crash', 'anr', 'rage_tap'] as const;
export const ISSUE_STATUSES = ['unresolved', 'resolved', 'ignored', 'ongoing'] as const;

const cursorShape = z.strictObject({
    t: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}$/),
    id: z.uuid(),
});

export const listIssuesTool = defineTool({
    name: 'list_issues',
    title: 'List issues',
    description:
        `Grouped crashes, ANRs, errors and rage taps for one project, most recently seen first, ${ISSUE_PAGE_SIZE} per page. `
        + `The time range selects issues last seen inside it. Costs 1 credit. ${UNTRUSTED_CONTENT_NOTE}`,
    inputSchema: z.strictObject({
        projectId: projectIdInput,
        ...timeRangeInput,
        type: z.enum(ISSUE_TYPES).optional(),
        status: z.enum(ISSUE_STATUSES).optional(),
        cursor: z.string().max(600).optional().describe('nextCursor from the previous page. Keep every other argument the same.'),
    }),
    outputSchema: z.strictObject({
        range: rangeOutput,
        total: cappedCountOutput,
        issues: z.array(issueSummaryOutput),
        nextCursor: out.cursor().nullable(),
        meta: outputMetaSchema,
    }),
    requiredScope: 'issues:read',
    credits: () => 1,
    argKinds: { projectId: 'project', from: 'neutral', to: 'neutral', type: 'neutral', status: 'neutral', cursor: 'neutral' },
    maxDbRoundTrips: 3,
    validate(args, env) {
        resolveTimeRange(args, env.now);
        if (args.cursor !== undefined) decodeCursor(args.cursor, cursorShape);
    },
    async handler(args, ctx, deps) {
        const range = resolveTimeRange(args, deps.now());
        const after = args.cursor === undefined ? undefined : decodeCursor(args.cursor, cursorShape);
        const page = await deps.data.listIssues(
            ctx,
            { projectId: args.projectId, range, type: args.type, status: args.status },
            { limit: ISSUE_PAGE_SIZE, after: after ? { lastSeenKey: after.t, id: after.id } : undefined },
        );
        if (!page) throw notFound();

        const cursorAfter = (kept: number): string | null => {
            if (kept >= page.issues.length && !page.hasMore) return null;
            if (kept === 0) return args.cursor ?? null;
            const last = page.keys[kept - 1];
            return encodeCursor({ t: last.lastSeenKey, id: last.id });
        };
        return {
            data: {
                range: toRangeOutput(range),
                total: toCappedCount(page.total),
                issues: page.issues.map((issue) => toIssueSummaryOutput(issue, deps.links)),
                nextCursor: cursorAfter(page.issues.length),
            },
            paging: { listKey: 'issues', cursorAfter },
        };
    },
});
