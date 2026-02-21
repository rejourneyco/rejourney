import { runDailyRollup } from './src/jobs/statsAggregator.js';

async function main() {
    console.log("Starting test rollup");
    await runDailyRollup(new Date('2026-02-18T12:00:00Z'));
    console.log("Done");
    process.exit(0);
}
main().catch(console.error);
