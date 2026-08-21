-- Expand step for the 20260820210000_database_read_path_indexes migration.
--
-- Run this file with psql directly against the PostgreSQL writer before pushing
-- the application/package version. Do not use PgBouncer transaction pooling:
-- CREATE INDEX CONCURRENTLY cannot run inside a transaction block and must keep
-- one server session for all build phases.
--
-- Safe order:
--   1. Restore the latest production backup into an isolated database and run
--      the normal migration/test suite there.
--   2. Run this file on the production writer during a lower-write window.
--   3. Verify the row at the bottom reports indisvalid=t and indisready=t.
--   4. Push the version bump. The journal migration recognizes the prebuilt
--      indexes, performs only catalog-only reloptions, and is
--      stamped by the normal deployment job before application rollout.

\set ON_ERROR_STOP on

SET lock_timeout = '5s';
SET statement_timeout = '2h';

-- IF NOT EXISTS does not repair a named invalid concurrent index, so fail before
-- it can hide an interrupted earlier build.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_index
        WHERE indexrelid = to_regclass('public.retention_deletion_log_completed_finished_idx')
          AND (NOT indisvalid OR NOT indisready)
    ) THEN
        RAISE EXCEPTION 'An invalid read-path index exists. Drop that index CONCURRENTLY, then rerun this file.';
    END IF;
END
$$;

CREATE INDEX CONCURRENTLY IF NOT EXISTS "retention_deletion_log_completed_finished_idx"
    ON "retention_deletion_log" ("finished_at")
    WHERE "status" = 'completed' AND "finished_at" IS NOT NULL;

SELECT
    indexrelid::regclass AS index_name,
    indisvalid,
    indisready
FROM pg_index
WHERE indexrelid = 'public.retention_deletion_log_completed_finished_idx'::regclass
ORDER BY indexrelid::regclass::text;

RESET lock_timeout;
RESET statement_timeout;
