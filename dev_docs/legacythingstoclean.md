# Legacy Things to Clean Up

Items that are safe to leave in place for now but should be removed in a future maintenance window.

---

## 1. `replay_promoted*` columns in `sessions` table

The old replay-promotion columns (`replay_promoted`, `replay_promoted_at`, etc.) are still physically present in the schema but are no longer read or written by any application code. The migration that cleared the data runs at deploy time but defers the physical `ALTER TABLE DROP COLUMN` to avoid locking the table under load.

**To drop:** run during a quiet maintenance window after confirming no long-running queries touch the `sessions` table:
```sql
ALTER TABLE sessions DROP COLUMN IF EXISTS replay_promoted;
ALTER TABLE sessions DROP COLUMN IF EXISTS replay_promoted_at;
-- (check schema.ts for the full list of columns to drop)
```

---

## 2. MP4 support from ingest & API

MP4 upload is not currently wired up end-to-end — only screenshot mode is supported. The ingest routes and API stubs for MP4 exist but are unused. Clean up once the feature is either committed to or permanently dropped.

---

## 3. `ingest_jobs` table (BullMQ migration complete — 2026-05-02)

**Background:** Artifact job dispatch was migrated from a Postgres poll loop (`ingest_jobs` table) to BullMQ Redis queues (`rj-ingest-artifacts`, `rj-replay-artifacts`). As of 2026-05-02, the `ingest_jobs` table is no longer written to by any application code. Existing rows are historical only.

**Current state:**
- ~19.7M `done` rows, ~48K `failed`, ~4K `dlq` — all historical
- 0 new rows being added
- Table is still referenced in `db/schema.ts` (as `ingestJobs`) but that's the only active code reference

**To drop (safe after ~7 days of stable BullMQ operation to confirm no regressions):**

1. Verify no active rows: `SELECT status, count(*) FROM ingest_jobs WHERE status IN ('pending','processing') GROUP BY status;` → should return 0 rows
2. Remove `ingestJobs` from `backend/src/db/schema.ts`
3. Remove `ingestJobs` from `backend/src/db/client.ts` exports
4. Write a Drizzle migration: `DROP TABLE ingest_jobs;`
5. Run `npm run db:generate` and deploy

**Also remove at the same time:**
- `backend/src/worker/workerDefinitions.ts` — the old poll-worker factory (unused after BullMQ)
- `backend/src/worker/startArtifactWorker.ts` — the old poll-based worker starter (unused after BullMQ)
- Any remaining `ingest_jobs` references in `session-backup-retention-internals.md` (retention logic still references old table in docs; code already queries `recording_artifacts` directly)

---

## 4. Old monitoring references to `ingest_jobs`

`dev_docs/session-backup-retention-internals.md` still mentions `ingest_jobs` rows as part of the retention/purge flow. Confirm the retention worker actually queries the right tables after `ingest_jobs` is dropped, then update that doc.
