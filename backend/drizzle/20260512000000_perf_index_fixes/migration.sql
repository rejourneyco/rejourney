-- Issue 4: drop the anonymous_hash index — 0 lifetime scans, covered by
-- sessions_visitor_identity_started_idx for all real query patterns.
DROP INDEX IF EXISTS "sessions_anonymous_hash_idx";
--> statement-breakpoint

-- Issue 5: partial composite index for the retention-worker cursor scan.
-- The current plan uses sessions_seed_started_at_idx and discards ~282K rows
-- per 500-row page. This index lets Postgres seek directly to
-- (retention_tier, started_at) on the already-filtered eligible subset.
CREATE INDEX IF NOT EXISTS "sessions_retention_eligible_idx"
ON "sessions" ("retention_tier", "started_at", "id")
WHERE "recording_deleted" = false
  AND "status" NOT IN ('deleted', 'completed');
--> statement-breakpoint

-- Issue 6: storage_endpoints has no index on project_id — 115M seq scans on
-- a 3-row table. Trivial today but becomes a real scan as endpoints grow.
CREATE INDEX IF NOT EXISTS "storage_endpoints_project_id_idx"
ON "storage_endpoints" ("project_id")
WHERE "active" = true;
