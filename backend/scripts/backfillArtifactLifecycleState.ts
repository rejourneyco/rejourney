import { logger } from '../src/logger.js';
import { backfillArtifactDrivenLifecycleState } from '../src/services/sessionReconciliation.js';

async function main() {
  logger.info('Starting manual artifact lifecycle backfill');
  await backfillArtifactDrivenLifecycleState();
  logger.info('Manual artifact lifecycle backfill completed');
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    logger.error({ err }, 'Manual artifact lifecycle backfill failed');
    process.exit(1);
  });
