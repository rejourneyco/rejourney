# Research Lake Catch-up Runbook

Use this after deploying the fair research-lake worker claim changes.

## Why Projects Can Look Missing

The production research lake can have many active projects while only a few show
interaction-lake exports. Interaction exports are eligible only for replay-backed
sessions with enough events and readable visual artifacts. Before the fair-claim
change, old high-volume project backlogs could monopolize the worker.

## One-time Catch-up Order

1. Deploy the backend worker and migration.
2. Let the new `research_extraction_jobs_fair_claim_idx` index finish creating.
3. Confirm stuck `processing` jobs are older than the worker deadline, then let
   the worker's stale-job recovery reclaim them or manually mark them retryable.
4. Temporarily increase worker catch-up capacity:
   - `RESEARCH_LAKE_BATCH_SIZE`
   - `RESEARCH_LAKE_CONCURRENCY`
   - `RESEARCH_LAKE_MAX_RUNTIME_MS`
5. Run manual worker jobs until pending interaction jobs are low and projects
   with recent replay sessions have either exports or clear reject reasons.
6. Compact curated parquet in bounded date chunks instead of running the full
   120-day scan.

## Bounded Compaction

The compactor supports these optional controls:

- `RESEARCH_LAKE_COMPACTOR_DATE`: compact exactly one raw sample date.
- `RESEARCH_LAKE_COMPACTOR_DATE_START`: first raw sample date to compact.
- `RESEARCH_LAKE_COMPACTOR_DATE_END`: last raw sample date to compact.
- `RESEARCH_LAKE_COMPACTOR_MAX_DATES`: maximum number of date partitions to
  process in one run.

For catch-up, prefer recent or known-exported interaction dates first, then walk
older dates in small batches. This avoids six-hour job deadline failures while
still rewriting complete date partitions.

## Sanity Checks

Check these after each catch-up wave:

- Active projects vs projects with sessions in the last 7/30 days.
- Projects with interaction `exported`, `pending`, and `rejected` jobs.
- Top interaction reject reasons.
- Raw exported dates vs curated parquet dates.
- Current compactor job duration and whether it exits before the deadline.
