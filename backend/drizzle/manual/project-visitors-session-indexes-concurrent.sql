-- Visitor ledger session index for production.
--
-- Run manually during a quiet window from psql or another tool that does not
-- wrap this file in a transaction, BEFORE applying
-- 20260902120000_project_visitors_ledger (whose guarded CREATE INDEX then
-- becomes a no-op). CREATE INDEX CONCURRENTLY is intentionally not part of
-- the normal Drizzle migration path.
--
-- The columns must already exist; add them ahead of time with:
--   ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "visitor_key" varchar(64);
--   ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "visitor_session_ordinal" integer;

SET lock_timeout = '5s';
SET statement_timeout = '30min';

CREATE INDEX CONCURRENTLY IF NOT EXISTS "sessions_project_visitor_key_started_idx"
    ON "sessions" ("project_id", "visitor_key", "started_at", "id")
    WHERE "visitor_key" IS NOT NULL;

-- If CREATE INDEX CONCURRENTLY is interrupted, PostgreSQL may leave an invalid
-- index behind. Check with:
--   SELECT indexrelid::regclass, indisvalid, indisready
--   FROM pg_index
--   WHERE indexrelid::regclass::text = 'sessions_project_visitor_key_started_idx';
-- Drop and rerun this file for any invalid index.
