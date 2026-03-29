import { logger } from '../src/logger.js';
import { backfillSessionReconciliationState } from '../src/services/sessionReconciliation.js';

async function main() {
  logger.info('Starting manual session reconciliation backfill');
  await backfillSessionReconciliationState();
  logger.info('Manual session reconciliation backfill completed');
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    logger.error({ err }, 'Manual session reconciliation backfill failed');
    process.exit(1);
  });
