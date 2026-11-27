/**
 * Hourly MCP upkeep, run by the API (which has SMTP and the main database
 * role), never by the MCP server:
 *  - delete sign-in records past their expiry;
 *  - delete call-log rows older than 90 days;
 *  - email team admins when an allowance passes 80% and 100%, once each per period.
 *
 * Every step is bounded and idempotent, so several API pods running it at
 * once only repeat cheap work; the alert flag is claimed with a conditional
 * update, so each email goes out once.
 */

import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { mcpUsagePeriods, teamMembers, teams, users } from '../db/schema.js';
import { logger } from '../logger.js';
import { FREE_TIER_MCP_CREDITS, resolveAllowance } from '../mcp/allowance.js';
import { sendMcpUsageWarningEmail } from './mcpEmails.js';
import { getMcpOAuth } from './mcpOAuth.js';

const CALL_LOG_RETENTION_DAYS = 90;
const DELETE_BATCH = 10_000;
const MAX_BATCHES = 20;
const INTERVAL_MS = 60 * 60 * 1000;

let timer: NodeJS.Timeout | null = null;

async function deleteOldCallLog(): Promise<number> {
    let total = 0;
    for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
        const result = await db.execute(sql`
            delete from mcp_call_log where id in (
                select id from mcp_call_log
                where created_at < now() - make_interval(days => ${CALL_LOG_RETENTION_DAYS})
                limit ${DELETE_BATCH}
            )
        `);
        const count = Number((result as { rowCount?: number }).rowCount ?? 0);
        total += count;
        if (count < DELETE_BATCH) break;
    }
    return total;
}

async function adminEmails(teamIds: string[]): Promise<string[]> {
    if (teamIds.length === 0) return [];
    const rows = await db
        .select({ email: users.email })
        .from(teamMembers)
        .innerJoin(users, eq(users.id, teamMembers.userId))
        .where(and(inArray(teamMembers.teamId, teamIds), inArray(teamMembers.role, ['owner', 'admin'])));
    return [...new Set(rows.map((row) => row.email).filter(Boolean))];
}

/** Sends 80% and 100% emails for allowances that crossed them since the last run. */
export async function sendMcpUsageAlerts(now = new Date()): Promise<number> {
    const rows = await db
        .select()
        .from(mcpUsagePeriods)
        .where(and(
            lt(mcpUsagePeriods.alertedPercent, 100),
            gte(mcpUsagePeriods.updatedAt, new Date(now.getTime() - 3 * INTERVAL_MS)),
        ))
        .limit(500);
    let sent = 0;
    for (const row of rows) {
        const [kind, id] = row.scopeKey.split(':');
        if (!id) continue;
        const scopeTeams = kind === 'team'
            ? await db.select().from(teams).where(eq(teams.id, id)).limit(1)
            : await db.select().from(teams).where(and(eq(teams.ownerUserId, id), sql`${teams.stripeSubscriptionId} is null`)).limit(50);
        const team = scopeTeams[0];
        if (!team) continue;
        const allowance = resolveAllowance({
            teamId: team.id,
            ownerUserId: team.ownerUserId,
            hasSubscription: Boolean(team.stripeSubscriptionId),
            creditLimit: team.mcpCreditLimit ?? (kind === 'owner' ? FREE_TIER_MCP_CREDITS : null),
            limitsSyncedAt: team.mcpLimitsSyncedAt ?? null,
            planName: team.mcpPlanName ?? null,
            billingCycleAnchor: team.billingCycleAnchor ?? null,
            stripePeriodStart: team.stripeCurrentPeriodStart ?? null,
            stripePeriodEnd: team.stripeCurrentPeriodEnd ?? null,
            paymentFailedAt: team.paymentFailedAt ?? null,
        }, now);
        const limit = allowance.creditLimit;
        // Only the current period alerts, and only for limited allowances.
        if (limit === null || limit <= 0 || allowance.scopeKey !== row.scopeKey || allowance.period !== row.period) continue;
        const percent = (row.credits / limit) * 100;
        const threshold: 80 | 100 | null = percent >= 100 ? 100 : percent >= 80 ? 80 : null;
        if (threshold === null || row.alertedPercent >= threshold) continue;

        // Claim the alert first, so a second pod does not send it too.
        const claimed = await db
            .update(mcpUsagePeriods)
            .set({ alertedPercent: threshold })
            .where(and(
                eq(mcpUsagePeriods.scopeKey, row.scopeKey),
                eq(mcpUsagePeriods.period, row.period),
                lt(mcpUsagePeriods.alertedPercent, threshold),
            ))
            .returning({ scopeKey: mcpUsagePeriods.scopeKey });
        if (claimed.length === 0) continue;

        const recipients = await adminEmails(scopeTeams.map((entry) => entry.id));
        await sendMcpUsageWarningEmail({
            to: recipients,
            teamName: scopeTeams.length > 1 ? `${team.name ?? 'Your team'} and your other free teams` : team.name ?? 'Your team',
            percent: threshold,
            used: row.credits,
            limit,
            resetsAt: allowance.periodEnd,
        });
        sent += 1;
    }
    return sent;
}

export async function runMcpHousekeeping(): Promise<void> {
    const oauth = getMcpOAuth();
    if (!oauth) return;
    try {
        const expired = await oauth.store.deleteExpired();
        const oldCalls = await deleteOldCallLog();
        const alerts = await sendMcpUsageAlerts();
        if (expired || oldCalls || alerts) logger.info({ expired, oldCalls, alerts }, 'MCP housekeeping');
    } catch (err) {
        logger.error({ err }, 'MCP housekeeping failed');
    }
}

export function startMcpHousekeeping(): void {
    if (timer || !getMcpOAuth()) return;
    // Spread pods out so they do not all run at the same minute.
    const firstRunMs = 5 * 60 * 1000 + Math.floor(Math.random() * 10 * 60 * 1000);
    timer = setTimeout(function tick() {
        void runMcpHousekeeping().finally(() => {
            timer = setTimeout(tick, INTERVAL_MS);
            timer.unref?.();
        });
    }, firstRunMs);
    timer.unref?.();
}

export function stopMcpHousekeeping(): void {
    if (timer) clearTimeout(timer);
    timer = null;
}
