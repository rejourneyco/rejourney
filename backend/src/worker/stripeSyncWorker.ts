/**
 * Stripe Sync Worker
 *
 * One-shot worker that reconciles all team billing state against Stripe.
 * Designed to run as a Kubernetes CronJob (every hour).
 *
 * Exit codes:
 *   0 — reconciliation completed (even if some teams had errors)
 *   1 — fatal error (Stripe not configured, DB unreachable, etc.)
 *
 * Safe to run at any time:
 *   - Teams already in sync → zero DB writes, read-only
 *   - Teams with desynced anchor → migrates project_usage period keys in a
 *     transaction without losing any session counts
 */

import { pool } from '../db/client.js';
import { logger } from '../logger.js';
import { pingWorker } from '../services/monitoring.js';
import { reconcileAllActiveTeams } from '../services/stripeSync.js';

logger.info('Stripe sync worker starting');

reconcileAllActiveTeams()
    .then(async (report) => {
        const durationMs = report.completedAt.getTime() - report.startedAt.getTime();

        logger.info({
            runId: report.runId,
            totalTeams: report.totalTeams,
            okCount: report.okCount,
            fixedCount: report.fixedCount,
            skippedCount: report.skippedCount,
            errorCount: report.errorCount,
            durationMs,
        }, 'Stripe sync worker complete');

        // Log corrections at a glance
        const fixed = report.results.filter(r => r.status === 'fixed');
        if (fixed.length > 0) {
            for (const result of fixed) {
                logger.info({
                    teamId: result.teamId,
                    corrections: result.corrections,
                }, 'Stripe sync: team corrected');
            }
        }

        const errors = report.results.filter(r => r.status === 'error');
        if (errors.length > 0) {
            for (const result of errors) {
                logger.error({
                    teamId: result.teamId,
                    error: result.error,
                }, 'Stripe sync: team error');
            }
        }

        const message = `fixed=${report.fixedCount},errors=${report.errorCount},total=${report.totalTeams},ms=${durationMs}`;
        await pingWorker('stripeSyncWorker', 'up', message).catch(() => {});

        await pool.end();
        process.exit(0);
    })
    .catch(async (err) => {
        logger.error({ err }, 'Stripe sync worker fatal error');
        await pingWorker('stripeSyncWorker', 'down', String(err?.message ?? err)).catch(() => {});
        await pool.end().catch(() => {});
        process.exit(1);
    });
