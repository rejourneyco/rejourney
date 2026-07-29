/** Runs Schema V2 independently; the V1 worker remains unchanged and active. */
import { logger } from '../logger.js';
import { pingWorker, type WorkerMetric } from '../services/monitoring.js';
import type { ResearchLakeV2CycleSummary } from '../services/researchLake.js';

type Runtime = {
    pool: { end: () => Promise<void> };
    run: () => Promise<ResearchLakeV2CycleSummary>;
};

let runtime: Promise<Runtime> | null = null;

async function loadRuntime(): Promise<Runtime> {
    if (!runtime) {
        runtime = Promise.all([
            import('../db/client.js'),
            import('../services/researchLake.js'),
        ]).then(([dbClient, researchLake]) => ({
            pool: dbClient.pool,
            run: researchLake.runResearchLakeV2ExtractionCycle,
        }));
    }
    return runtime;
}

async function closeRuntime(): Promise<void> {
    if (runtime) await (await runtime).pool.end();
}

function metrics(summary: ResearchLakeV2CycleSummary): WorkerMetric[] {
    const values: WorkerMetric[] = [
        { name: 'rejourney_research_lake_v2_seeded_jobs_total', help: 'V2 jobs seeded', value: summary.seeded },
        { name: 'rejourney_research_lake_v2_attempted_jobs_total', help: 'V2 jobs attempted', value: summary.attempted },
        { name: 'rejourney_research_lake_v2_exported_jobs_total', help: 'V2 jobs exported', value: summary.exported },
        { name: 'rejourney_research_lake_v2_rejected_jobs_total', help: 'V2 jobs rejected', value: summary.rejected },
        { name: 'rejourney_research_lake_v2_failed_jobs_total', help: 'V2 jobs failed', value: summary.failed },
        { name: 'rejourney_research_lake_v2_cleaned_visual_holds_total', help: 'Expired V2 visual holds cleaned', value: summary.cleanedVisualHolds },
        { name: 'rejourney_research_lake_v2_expired_panel_rows_total', help: 'Expired V2 panel observations deleted', value: summary.expiredPanelRows },
    ];
    for (const [lake, lane] of Object.entries(summary.byLake)) {
        values.push(
            { name: `rejourney_research_lake_v2_${lake}_attempted_total`, help: `V2 ${lake} jobs attempted`, value: lane.attempted },
            { name: `rejourney_research_lake_v2_${lake}_exported_total`, help: `V2 ${lake} jobs exported`, value: lane.exported },
            { name: `rejourney_research_lake_v2_${lake}_failed_total`, help: `V2 ${lake} jobs failed`, value: lane.failed },
        );
    }
    return values;
}

async function runCycle(): Promise<ResearchLakeV2CycleSummary | null> {
    const summary = await (await loadRuntime()).run();
    await pingWorker(
        'researchLakeV2Worker',
        'up',
        `attempted=${summary.attempted},exported=${summary.exported},rejected=${summary.rejected},failed=${summary.failed}`,
        undefined,
        metrics(summary),
    );
    return summary;
}

const runOnce = process.argv.includes('--once');
let running = true;

async function shutdown(signal: string): Promise<void> {
    logger.info({ signal }, 'Research lake V2 worker shutting down');
    running = false;
    await closeRuntime();
    process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

async function main(): Promise<void> {
    if (runOnce) {
        await runCycle();
        await closeRuntime();
        return;
    }
    while (running) {
        await runCycle().catch(async (error) => {
            logger.error({ error }, 'Research lake V2 extraction cycle failed');
            await pingWorker('researchLakeV2Worker', 'down', error instanceof Error ? error.message : String(error)).catch(() => {});
        });
        await new Promise((resolve) => setTimeout(resolve, 5 * 60 * 1000));
    }
}

logger.info({ runOnce }, 'Research lake V2 worker started independently of V1');
main().catch(async (error) => {
    logger.error({ error }, 'Research lake V2 worker fatal error');
    await pingWorker('researchLakeV2Worker', 'down', error instanceof Error ? error.message : String(error)).catch(() => {});
    await closeRuntime().catch(() => {});
    process.exit(1);
});
