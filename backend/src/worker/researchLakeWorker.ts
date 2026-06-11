/**
 * Research Lake Worker
 *
 * Builds anonymized interaction-lake artifacts before raw replay/session identity
 * reaches its retention deadline. Disabled unless RESEARCH_LAKE_ENABLED=true.
 */

import { config } from '../config.js';
import { logger } from '../logger.js';
import { pingWorker, type WorkerMetric } from '../services/monitoring.js';

type ResearchLakeCycleSummary = {
    seeded: number;
    attempted: number;
    exported: number;
    rejected: number;
    failed: number;
    recoveredStaleProcessing: number;
    byLake: Record<'interaction' | 'behavioral_outcomes', {
        seeded: number;
        attempted: number;
        exported: number;
        rejected: number;
        failed: number;
    }>;
};

type ResearchLakeRuntime = {
    pool: { end: () => Promise<void> };
    runResearchLakeExtractionCycle: () => Promise<ResearchLakeCycleSummary>;
};

let runtime: Promise<ResearchLakeRuntime> | null = null;

async function loadRuntime(): Promise<ResearchLakeRuntime> {
    if (!runtime) {
        runtime = Promise.all([
            import('../db/client.js'),
            import('../services/researchLake.js'),
        ]).then(([dbClient, researchLake]) => ({
            pool: dbClient.pool,
            runResearchLakeExtractionCycle: researchLake.runResearchLakeExtractionCycle,
        }));
    }
    return runtime;
}

async function closeRuntimePool(): Promise<void> {
    if (!runtime) return;
    const loaded = await runtime;
    await loaded.pool.end();
}

async function runResearchLakeExtractionCycle(): Promise<ResearchLakeCycleSummary | null> {
    if (!config.RESEARCH_LAKE_ENABLED) {
        logger.info('Research lake disabled; skipping extraction cycle');
        return null;
    }
    const loaded = await loadRuntime();
    const summary = await loaded.runResearchLakeExtractionCycle();

    const extraMetrics: WorkerMetric[] = [
        {
            name: 'rejourney_research_lake_seeded_jobs_total',
            help: 'Total jobs seeded in the current research lake run',
            value: summary.seeded,
        },
        {
            name: 'rejourney_research_lake_attempted_jobs_total',
            help: 'Total jobs attempted in the current research lake run',
            value: summary.attempted,
        },
        {
            name: 'rejourney_research_lake_exported_jobs_total',
            help: 'Total jobs successfully exported to the research lake',
            value: summary.exported,
        },
        {
            name: 'rejourney_research_lake_rejected_jobs_total',
            help: 'Total jobs rejected due to PII/quality in the current research lake run',
            value: summary.rejected,
        },
        {
            name: 'rejourney_research_lake_failed_jobs_total',
            help: 'Total jobs that failed extraction in the current research lake run',
            value: summary.failed,
        },
        {
            name: 'rejourney_research_lake_recovered_stale_processing_jobs_total',
            help: 'Total stale processing jobs recovered in the current research lake run',
            value: summary.recoveredStaleProcessing,
        },
    ];
    for (const [lakeType, lane] of Object.entries(summary.byLake)) {
        const metricLakeType = lakeType.replace(/[^a-z0-9_]/g, '_');
        extraMetrics.push(
            {
                name: `rejourney_research_lake_${metricLakeType}_seeded_jobs_total`,
                help: `Total ${lakeType} jobs seeded in the current research lake run`,
                value: lane.seeded,
            },
            {
                name: `rejourney_research_lake_${metricLakeType}_attempted_jobs_total`,
                help: `Total ${lakeType} jobs attempted in the current research lake run`,
                value: lane.attempted,
            },
            {
                name: `rejourney_research_lake_${metricLakeType}_exported_jobs_total`,
                help: `Total ${lakeType} jobs successfully exported in the current research lake run`,
                value: lane.exported,
            },
            {
                name: `rejourney_research_lake_${metricLakeType}_rejected_jobs_total`,
                help: `Total ${lakeType} jobs rejected in the current research lake run`,
                value: lane.rejected,
            },
            {
                name: `rejourney_research_lake_${metricLakeType}_failed_jobs_total`,
                help: `Total ${lakeType} jobs that failed extraction in the current research lake run`,
                value: lane.failed,
            },
        );
    }

    await pingWorker(
        'researchLakeWorker',
        'up',
        `seeded=${summary.seeded},attempted=${summary.attempted},exported=${summary.exported},rejected=${summary.rejected},failed=${summary.failed},recovered=${summary.recoveredStaleProcessing}`,
        undefined,
        extraMetrics,
    );

    return summary;
}

function parseFlag(name: string): boolean {
    return process.argv.includes(name);
}

const runOnce = parseFlag('--once');
const RUN_INTERVAL_MS = 10 * 60 * 1000;
let isRunning = true;

async function shutdown(signal: string): Promise<void> {
    logger.info({ signal }, 'Research lake worker shutting down...');
    isRunning = false;
    await closeRuntimePool();
    process.exit(0);
}

process.on('SIGTERM', () => {
    shutdown('SIGTERM').catch((err) => {
        logger.error({ err }, 'Failed to shut down research lake worker on SIGTERM');
        process.exit(1);
    });
});

process.on('SIGINT', () => {
    shutdown('SIGINT').catch((err) => {
        logger.error({ err }, 'Failed to shut down research lake worker on SIGINT');
        process.exit(1);
    });
});

async function runLoop(): Promise<void> {
    while (isRunning) {
        await runResearchLakeExtractionCycle().catch(async (err) => {
            logger.error({ err }, 'Research lake extraction cycle failed');
            await pingWorker('researchLakeWorker', 'down', err instanceof Error ? err.message : String(err)).catch(() => {});
        });
        await new Promise((resolve) => setTimeout(resolve, RUN_INTERVAL_MS));
    }
}

logger.info({ runOnce }, 'Research lake worker started');

if (runOnce) {
    runResearchLakeExtractionCycle()
        .then(async () => {
            await closeRuntimePool();
            process.exit(0);
        })
        .catch(async (err) => {
            logger.error({ err }, 'Research lake worker fatal error');
            await pingWorker('researchLakeWorker', 'down', err instanceof Error ? err.message : String(err)).catch(() => {});
            await closeRuntimePool().catch(() => {});
            process.exit(1);
        });
} else {
    runLoop().catch(async (err) => {
        logger.error({ err }, 'Research lake worker fatal error');
        await pingWorker('researchLakeWorker', 'down', err instanceof Error ? err.message : String(err)).catch(() => {});
        await closeRuntimePool().catch(() => {});
        process.exit(1);
    });
}
