import { z } from 'zod';
import { outputMetaSchema } from '../output/emit.js';
import { notFound } from '../errors.js';
import { out } from '../output/fields.js';
import { capStack } from '../stack.js';
import { stackOutput } from './common.js';
import { issueSummaryOutput, toIssueSummaryOutput } from './issueOutput.js';
import { UNTRUSTED_CONTENT_NOTE, defineTool } from './types.js';

const nameCount = z.strictObject({ name: out.text(100), count: z.number() });

export const getIssueTool = defineTool({
    name: 'get_issue',
    title: 'Issue details',
    description:
        'One issue: what it is, how often and for how many users, a sample stack trace (at most 60 frames, as stored: not symbolicated), '
        + `the app versions and devices affected, and sample sessions with dashboard links. Costs 1 credit. ${UNTRUSTED_CONTENT_NOTE}`,
    inputSchema: z.strictObject({ issueId: z.uuid().describe('Issue id, from list_issues or get_project_health.') }),
    outputSchema: z.strictObject({
        issue: issueSummaryOutput.extend({
            projectId: out.id(),
            environment: out.text(50).nullable(),
            componentName: out.text(255).nullable(),
            stack: stackOutput,
            sampleDevice: z.strictObject({
                model: out.text(100).nullable(),
                osVersion: out.text(50).nullable(),
                appVersion: out.text(50).nullable(),
            }),
            affectedVersions: z.array(nameCount),
            affectedDevices: z.array(nameCount),
            sampleSessions: z.array(
                z.strictObject({
                    sessionId: out.id(),
                    occurredAt: out.timestamp(),
                    appVersion: out.text(50).nullable(),
                    deviceModel: out.text(100).nullable(),
                    /** Opens the replay at the moment of the occurrence. */
                    link: out.link(),
                }),
            ),
        }),
        meta: outputMetaSchema,
    }),
    requiredScope: 'issues:read',
    credits: () => 1,
    argKinds: { issueId: 'issue' },
    maxDbRoundTrips: 4,
    async handler(args, ctx, deps) {
        const issue = await deps.data.getIssue(ctx, args.issueId);
        if (!issue) throw notFound();
        return {
            data: {
                issue: {
                    ...toIssueSummaryOutput(issue, deps.links),
                    projectId: issue.projectId,
                    environment: issue.environment,
                    componentName: issue.componentName,
                    stack: capStack(issue.stackTrace),
                    sampleDevice: { ...issue.sampleDevice },
                    affectedVersions: issue.affectedVersions.map((entry) => ({ name: entry.name, count: entry.count })),
                    affectedDevices: issue.affectedDevices.map((entry) => ({ name: entry.name, count: entry.count })),
                    sampleSessions: issue.sampleSessions.map((sample) => ({
                        sessionId: sample.sessionId,
                        occurredAt: new Date(sample.occurredAtMs).toISOString(),
                        appVersion: sample.appVersion,
                        deviceModel: sample.deviceModel,
                        link: deps.links.session(sample.sessionId, sample.occurredAtMs),
                    })),
                },
            },
        };
    },
});
