/**
 * One-time: set bonus_sessions_billing_period for teams that have bonus_sessions > 0
 * but no period yet, so their existing bonus remains for the current cycle only.
 *
 * Run after migration: npm run db:backfill:bonus-sessions-period
 */
import { and, eq, gt, isNull } from 'drizzle-orm';
import { db } from '../src/db/client.js';
import { teams } from '../src/db/schema.js';
import { getTeamBillingPeriod } from '../src/utils/billing.js';

async function main() {
    const rows = await db
        .select({
            id: teams.id,
            bonusSessions: teams.bonusSessions,
            billingCycleAnchor: teams.billingCycleAnchor,
            bonusSessionsBillingPeriod: teams.bonusSessionsBillingPeriod,
        })
        .from(teams)
        .where(
            and(gt(teams.bonusSessions, 0), isNull(teams.bonusSessionsBillingPeriod))
        );

    console.log(`Found ${rows.length} teams with bonus_sessions > 0 and null period`);

    for (const row of rows) {
        const period = getTeamBillingPeriod(row.billingCycleAnchor ?? null);
        await db
            .update(teams)
            .set({
                bonusSessionsBillingPeriod: period,
                updatedAt: new Date(),
            })
            .where(eq(teams.id, row.id));
        console.log(`Updated team ${row.id}: bonus_sessions_billing_period=${period}`);
    }

    console.log('Done.');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
