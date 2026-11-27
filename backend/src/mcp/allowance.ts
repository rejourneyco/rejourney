/**
 * Which allowance a call counts against, its billing period and its limits.
 *
 * Pure: everything comes from the team row the access check already read, so
 * no extra query and no Stripe call. Same rules as the replay allowance:
 *  - a team with a Stripe subscription has its own allowance, per Stripe
 *    billing period (falling back to 30-day cycles from the anchor);
 *  - a free team shares one allowance with every other free team of the same
 *    owner, per UTC calendar month, so extra free teams do not add credits.
 */

export const FREE_TIER_MCP_CREDITS = 300;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface McpTeamBilling {
    teamId: string;
    ownerUserId: string;
    hasSubscription: boolean;
    /** From the plan, copied onto the team row by the API. */
    creditLimit: number | null;
    /** Null until the API has synced the plan once. */
    limitsSyncedAt: Date | null;
    planName: string | null;
    billingCycleAnchor: Date | null;
    stripePeriodStart: Date | null;
    stripePeriodEnd: Date | null;
    paymentFailedAt: Date | null;
}

export interface McpAllowance {
    /** "team:<id>" or "owner:<user id>". */
    scopeKey: string;
    /** Period id, unique within the scope: YYYY-MM-DD of the period start, or YYYY-MM for calendar months. */
    period: string;
    periodStart: Date;
    periodEnd: Date;
    /** Null means unlimited. */
    creditLimit: number | null;
    planName: string;
    /** Calls per user per minute. */
    perMinute: number;
    /** The team's last payment failed: calls that cost credits are refused, as ingest is. */
    paymentFailed: boolean;
}

/** Calls per user per minute, by the size of the plan's allowance. */
export function mcpRateLimitPerMinute(creditLimit: number | null): number {
    if (creditLimit === null) return 120;
    if (creditLimit <= 300) return 10;
    if (creditLimit <= 2_000) return 20;
    if (creditLimit <= 6_000) return 30;
    if (creditLimit <= 20_000) return 60;
    return 120;
}

function ymd(date: Date): string {
    return date.toISOString().slice(0, 10);
}

export function resolveAllowance(team: McpTeamBilling, now: Date): McpAllowance {
    let creditLimit: number | null;
    if (team.limitsSyncedAt) {
        creditLimit = team.creditLimit;
    } else {
        // Never synced: the consent step syncs before any grant exists, so this
        // is a safety net only. Free teams get the free allowance; a paid team
        // is not blocked by a missing sync.
        creditLimit = team.hasSubscription ? null : FREE_TIER_MCP_CREDITS;
    }
    const planName = team.planName ?? (team.hasSubscription ? 'Paid' : 'Free');

    if (!team.hasSubscription) {
        const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
        const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
        return {
            scopeKey: `owner:${team.ownerUserId}`,
            period: start.toISOString().slice(0, 7),
            periodStart: start,
            periodEnd: end,
            creditLimit,
            planName,
            perMinute: mcpRateLimitPerMinute(creditLimit),
            paymentFailed: false,
        };
    }

    let start: Date;
    let end: Date;
    if (team.stripePeriodStart && team.stripePeriodEnd && now >= team.stripePeriodStart && now < team.stripePeriodEnd) {
        start = team.stripePeriodStart;
        end = team.stripePeriodEnd;
    } else if (team.billingCycleAnchor) {
        const cycles = Math.floor((now.getTime() - team.billingCycleAnchor.getTime()) / (30 * DAY_MS));
        start = new Date(team.billingCycleAnchor.getTime() + cycles * 30 * DAY_MS);
        end = new Date(start.getTime() + 30 * DAY_MS);
    } else {
        start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
        end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    }
    return {
        scopeKey: `team:${team.teamId}`,
        period: ymd(start),
        periodStart: start,
        periodEnd: end,
        creditLimit,
        planName,
        perMinute: mcpRateLimitPerMinute(creditLimit),
        paymentFailed: team.paymentFailedAt !== null,
    };
}
