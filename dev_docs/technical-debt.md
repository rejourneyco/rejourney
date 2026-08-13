# Technical Debt

Known cleanup work that is safe to defer but should remain visible to maintainers.

---

## 1. Legacy video replay compatibility

Current clients record screenshot archives or rrweb segments; they do not
produce new MP4 replay artifacts. The backend still contains read-side video
compatibility, including thumbnail extraction and the `video` visual-artifact
kind, for historical sessions. Decide on and document an end-of-support date
before removing that compatibility. Do not describe screenshot capture as the
only replay format because web sessions use rrweb.

---

## 2. Stale `ingest_jobs` references after BullMQ migration

**Background:** Artifact job dispatch was migrated from a Postgres poll loop (`ingest_jobs` table) to BullMQ Redis queues (`rj-artifact-flush`, `rj-ingest-artifacts`, `rj-replay-artifacts`, plus per-session `rj-session-event-rollup` and debounced `rj-session-effects` follow-up work). The table drop is already done by migration `20260503000000_drop_ingest_jobs`, and current application schema exports no longer include `ingestJobs`.

**Current gap:** a few non-historical helpers still mention `ingest_jobs` and should be removed or rewritten so they do not assume the old table exists:

- `k8s/exporters.yaml`
- `scripts/k8s/gen-grafana-dashboards.py`
- generated `k8s/grafana-dashboards.yaml`

**To clean up:** replace old Postgres job-count checks with BullMQ queue counts or remove the obsolete metrics entirely.

Do not remove `backend/src/worker/workerDefinitions.ts` or
`backend/src/worker/startArtifactWorker.ts`; those files are still the active
BullMQ worker definitions and starter.

---

## 3. `api_endpoint_daily_stats` compatibility shell

**Background:** API endpoint analytics moved to ClickHouse raw facts plus `api_endpoint_daily_rollups` in May 2026. The heavy Postgres `api_endpoint_daily_stats` data table was dropped by migration `20260522010000_drop_api_endpoint_daily_stats`, then recreated as an empty no-op compatibility shell so old rolling pods or old tools do not crash on `INSERT ... ON CONFLICT`.

**Current state:**
- Runtime API endpoint reads use ClickHouse, not Postgres.
- Runtime artifact processing no longer writes this Postgres table.
- The table should stay empty; a trigger returns `NULL` for legacy inserts/updates.

**To drop later:** after enough deploys that no old pod/image/tooling expects the relation name, remove any remaining schema references and write a migration:

```sql
DROP TRIGGER IF EXISTS skip_api_endpoint_daily_stats_writes ON public.api_endpoint_daily_stats;
DROP FUNCTION IF EXISTS public.skip_api_endpoint_daily_stats_writes();
DROP TABLE IF EXISTS public.api_endpoint_daily_stats;
```

---

## 4. Legacy `recording_artifacts` event-rollup checkpoint nulls

**Background:** event artifact rollup now uses two checkpoint columns on `recording_artifacts`:

- `event_rollup_requested_at`
- `event_rollup_processed_at`

New `events` artifacts set `event_rollup_requested_at` when the ingest worker marks them `ready`, then `rj-session-event-rollup` sets `event_rollup_processed_at` after applying the artifact to session metrics/timeline state.

**Current legacy shape:** old ready `events` artifacts can have both columns null because they predate the checkpointed rollup flow. That is expected. Do not interpret historical nulls as a live backlog.

**Do not broad-backfill:** setting `event_rollup_requested_at` on all old ready event artifacts would make the lifecycle sweep eligible to reprocess millions of legacy artifacts and can double-apply old session metrics.

**Allowed repair:** only run a bounded repair for a known bad deploy window where new ready event artifacts lost their rollup enqueue/checkpoint. Scope the repair by `created_at`, project/session IDs, `kind = 'events'`, `status = 'ready'`, and `event_rollup_processed_at IS NULL`.

**Optional later cleanup:** after retention has removed enough old artifact rows, consider an audit-only migration that marks ancient legacy event rows as intentionally skipped/legacy-processed. Do not do that in normal deploy, and do not use it to enqueue work.
