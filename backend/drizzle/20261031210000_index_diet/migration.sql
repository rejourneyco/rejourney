SET lock_timeout = '5s';
--> statement-breakpoint
SET statement_timeout = '15min';
--> statement-breakpoint

-- Index diet. Production runs drizzle/manual/20261031210000_index_diet.concurrent.sql
-- on the writer first (concurrent builds, drops and reindexes), so on production
-- every statement below is a catalog-only no-op: the replacements already exist,
-- the dropped names are already gone and the reloption is already set.
--
-- Small local / self-hosted databases get the same final shape here with
-- ordinary statements. Replacements are built before anything they replace is
-- dropped. A blocking build is refused on a relation at or above 1 GiB; run the
-- manual concurrent file on the writer instead, then rerun the deploy.
-- Indexes only change plans, never query results.
DO $$
DECLARE
    target record;
BEGIN
    FOR target IN
        SELECT *
        FROM (VALUES
            (1, 'recording_artifacts_created_at_idx', 'public.recording_artifacts',
                'CREATE INDEX IF NOT EXISTS "recording_artifacts_created_at_idx" ON "recording_artifacts" ("created_at" DESC)'),
            (2, 'recording_artifacts_kind_ready_covering_idx', 'public.recording_artifacts',
                'CREATE INDEX IF NOT EXISTS "recording_artifacts_kind_ready_covering_idx" ON "recording_artifacts" ("session_id", "kind") INCLUDE ("size_bytes", "endpoint_id") WHERE "status" = ''ready'''),
            (3, 'sessions_events_path_idx', 'public.sessions',
                'CREATE INDEX IF NOT EXISTS "sessions_events_path_idx" ON "sessions" USING gin ("events" jsonb_path_ops)')
        ) AS t(ord, index_name, relation_name, create_sql)
        ORDER BY ord
    LOOP
        IF to_regclass('public.' || target.index_name) IS NOT NULL THEN
            IF EXISTS (
                SELECT 1
                FROM pg_index
                WHERE indexrelid = to_regclass('public.' || target.index_name)
                  AND (NOT indisvalid OR NOT indisready)
            ) THEN
                RAISE EXCEPTION '% exists but is invalid; DROP INDEX CONCURRENTLY and rerun drizzle/manual/20261031210000_index_diet.concurrent.sql', target.index_name;
            END IF;
            CONTINUE;
        END IF;

        IF to_regclass(target.relation_name) IS NOT NULL
           AND pg_total_relation_size(to_regclass(target.relation_name)) >= 1073741824 THEN
            RAISE EXCEPTION '% is % bytes; run drizzle/manual/20261031210000_index_diet.concurrent.sql directly on the writer before deploying this migration',
                target.relation_name, pg_total_relation_size(to_regclass(target.relation_name));
        END IF;

        EXECUTE target.create_sql;
    END LOOP;
END
$$;
--> statement-breakpoint

-- Redundant or unused (see the manual file for the production verification).
DROP INDEX IF EXISTS "recording_artifacts_created_status_endpoint_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "recording_artifacts_session_id_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "recording_artifacts_session_ready_endpoint_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "recording_artifacts_failed_abandoned_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "sessions_reconciliation_activity_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "sessions_status_ended_at_id_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "sessions_retention_eligible_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "sessions_project_started_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "sessions_events_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "research_extraction_jobs_claim_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "retention_deletion_log_run_id_idx";
--> statement-breakpoint

-- Free space per page lets last_ingest_activity_at / updated_at updates stay HOT
-- now that no index covers those columns. Skip the ALTER (and its lock) when the
-- manual step already set it.
DO $$
BEGIN
    IF to_regclass('public.sessions') IS NOT NULL
       AND NOT EXISTS (
           SELECT 1
           FROM pg_class
           WHERE oid = 'public.sessions'::regclass
             AND 'fillfactor=85' = ANY (COALESCE(reloptions, ARRAY[]::text[]))
       ) THEN
        ALTER TABLE "sessions" SET (fillfactor = 85);
    END IF;
END
$$;
--> statement-breakpoint
RESET lock_timeout;
--> statement-breakpoint
RESET statement_timeout;
