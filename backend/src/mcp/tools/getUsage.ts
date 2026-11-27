import { z } from 'zod';
import { outputMetaSchema } from '../output/emit.js';
import { out } from '../output/fields.js';
import { defineTool } from './types.js';

export const getUsageTool = defineTool({
    name: 'get_usage',
    title: 'MCP usage',
    description: 'Shows the MCP credit allowance for this team: credits used, credits remaining, when the allowance resets, and how fast recent calls on this connection were answered. Free.',
    inputSchema: z.strictObject({}),
    outputSchema: z.strictObject({
        creditsUsed: z.number(),
        /** Null when the allowance is unlimited. */
        creditsLimit: z.number().nullable(),
        creditsRemaining: z.number().nullable(),
        unlimited: z.boolean(),
        periodStart: out.timestamp(),
        resetsAt: out.timestamp(),
        /** Server response times of this connection's most recent calls; null until there are some. */
        responseTime: z
            .strictObject({
                calls: z.number(),
                p50Ms: z.number(),
                p95Ms: z.number(),
            })
            .nullable(),
        meta: outputMetaSchema,
    }),
    requiredScope: null,
    credits: () => 0,
    argKinds: {},
    maxDbRoundTrips: 1,
    async handler(_args, ctx, deps) {
        const [usage, responseTimes] = await Promise.all([
            deps.usage.getUsage(ctx),
            deps.usage.getResponseTimes?.(ctx) ?? null,
        ]);
        const used = Math.max(0, Math.floor(usage.creditsUsed));
        const limit = usage.creditsLimit === null ? null : Math.max(0, Math.floor(usage.creditsLimit));
        return {
            data: {
                creditsUsed: used,
                creditsLimit: limit,
                creditsRemaining: limit === null ? null : Math.max(0, limit - used),
                unlimited: limit === null,
                periodStart: usage.periodStart.toISOString(),
                resetsAt: usage.periodEnd.toISOString(),
                responseTime: responseTimes
                    ? { calls: responseTimes.calls, p50Ms: responseTimes.p50Ms, p95Ms: responseTimes.p95Ms }
                    : null,
            },
        };
    },
});
