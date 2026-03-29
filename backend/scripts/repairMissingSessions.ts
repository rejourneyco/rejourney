import { logger } from '../src/logger.js';
import { repairMissingSessionsFromIngestJobs } from '../src/services/ingestSessionLifecycle.js';

function parseNumberFlag(flagName: string, fallback: number): number {
  const raw = process.argv.find((arg) => arg.startsWith(`${flagName}=`))?.split('=')[1];
  const parsed = raw ? Number.parseInt(raw, 10) : fallback;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function main() {
  const lookbackDays = parseNumberFlag('--lookbackDays', 7);
  const limit = parseNumberFlag('--limit', 200);
  const since = new Date(Date.now() - (lookbackDays * 24 * 60 * 60 * 1000));

  logger.info({
    since: since.toISOString(),
    lookbackDays,
    limit,
  }, 'Starting missing-session repair');

  const result = await repairMissingSessionsFromIngestJobs({
    since,
    limit,
    source: 'manual_repair_script',
  });

  logger.info(result, 'Missing-session repair completed');
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    logger.error({ err }, 'Missing-session repair failed');
    process.exit(1);
  });
