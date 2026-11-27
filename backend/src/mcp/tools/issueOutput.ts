import { z } from 'zod';
import type { IssueSummary } from '../data/types.js';
import type { DashboardLinks } from '../links.js';
import { out } from '../output/fields.js';

export const issueSummaryOutput = z.strictObject({
    id: out.id(),
    shortId: out.text(50),
    type: out.text(20),
    title: out.text(300),
    subtitle: out.text(300).nullable(),
    culprit: out.text(300).nullable(),
    screenName: out.text(255).nullable(),
    status: out.text(20),
    priority: out.text(20).nullable(),
    isHandled: z.boolean().nullable(),
    firstSeen: out.timestamp(),
    lastSeen: out.timestamp(),
    /** All-time occurrences. */
    eventCount: z.number(),
    userCount: z.number(),
    events24h: z.number(),
    link: out.link(),
});

export function toIssueSummaryOutput(issue: IssueSummary, links: DashboardLinks): z.infer<typeof issueSummaryOutput> {
    return {
        id: issue.id,
        shortId: issue.shortId,
        type: issue.type,
        title: issue.title,
        subtitle: issue.subtitle,
        culprit: issue.culprit,
        screenName: issue.screenName,
        status: issue.status,
        priority: issue.priority,
        isHandled: issue.isHandled,
        firstSeen: issue.firstSeen,
        lastSeen: issue.lastSeen,
        eventCount: issue.eventCount,
        userCount: issue.userCount,
        events24h: issue.events24h,
        link: links.issue(issue.id),
    };
}
