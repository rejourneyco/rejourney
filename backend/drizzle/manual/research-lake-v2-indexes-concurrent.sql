-- Build Research Lake V2 job indexes on production after the additive Drizzle
-- migration and before running research-lake-v2-activate.sql.
-- Run with psql directly against the PostgreSQL writer, not through PgBouncer.
-- CREATE INDEX CONCURRENTLY cannot run in a transaction block.
-- These large job-table indexes intentionally live outside the transactional
-- migration so they can be created concurrently without blocking the V1 queue.
-- Do not drop the legacy session/lake index here; old V1 pods still need it.

\set ON_ERROR_STOP on

SET lock_timeout = '5s';
SET statement_timeout = '30min';

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "research_extraction_jobs_session_lake_schema_unique"
    ON "research_extraction_jobs" ("session_id", "lake_type", "schema_version");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "research_extraction_jobs_v2_claim_idx"
    ON "research_extraction_jobs" ("lake_type", "job_lane", "status", "next_retry_at", "due_at", "session_id")
    WHERE "schema_version" = 2;

CREATE INDEX CONCURRENTLY IF NOT EXISTS "research_extraction_jobs_v2_fair_claim_idx"
    ON "research_extraction_jobs" ("lake_type", "job_lane", "status", "project_id", "due_at", "created_at")
    WHERE "schema_version" = 2;

CREATE INDEX CONCURRENTLY IF NOT EXISTS "research_extraction_jobs_v2_project_status_idx"
    ON "research_extraction_jobs" ("project_id", "lake_type", "status", "due_at")
    WHERE "schema_version" = 2;

-- If a concurrent build is interrupted, verify validity before migration:
--   SELECT indexrelid::regclass, indisvalid, indisready
--   FROM pg_index
--   WHERE indexrelid::regclass::text LIKE 'research_extraction_jobs_%';
-- Drop and rerun this file for any invalid index.
