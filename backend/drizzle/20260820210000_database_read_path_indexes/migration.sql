SET lock_timeout = '5s';
--> statement-breakpoint
SET statement_timeout = '15min';
--> statement-breakpoint

-- Production builds these indexes first with
-- drizzle/manual/database-read-path-indexes-concurrent.sql. On small local and
-- self-hosted databases the conditional ordinary CREATE INDEX operations keep the
-- migration journal and schema fully self-contained. Refuse a blocking build on
-- a relation at or above 1 GiB if the concurrent prebuild was skipped.
DO $$
DECLARE
    retention_log_bytes bigint;
BEGIN
    IF to_regclass('public.retention_deletion_log') IS NOT NULL THEN
        retention_log_bytes := pg_total_relation_size('public.retention_deletion_log'::regclass);
    END IF;

    IF to_regclass('public.retention_deletion_log_completed_finished_idx') IS NOT NULL
       AND EXISTS (
           SELECT 1
           FROM pg_index
           WHERE indexrelid = to_regclass('public.retention_deletion_log_completed_finished_idx')
             AND (NOT indisvalid OR NOT indisready)
       ) THEN
        RAISE EXCEPTION 'retention_deletion_log_completed_finished_idx exists but is invalid; DROP INDEX CONCURRENTLY and rerun the manual concurrent build';
    END IF;

    IF to_regclass('public.retention_deletion_log_completed_finished_idx') IS NULL THEN
        IF COALESCE(retention_log_bytes, 0) >= 1073741824 THEN
            RAISE EXCEPTION 'retention_deletion_log is % bytes; run drizzle/manual/database-read-path-indexes-concurrent.sql directly on the writer before deploying this migration', retention_log_bytes;
        END IF;
        EXECUTE $index$
            CREATE INDEX IF NOT EXISTS "retention_deletion_log_completed_finished_idx"
                ON "retention_deletion_log" ("finished_at")
                WHERE "status" = 'completed' AND "finished_at" IS NOT NULL
        $index$;
    END IF;
END
$$;
--> statement-breakpoint

-- Default 20% thresholds are too coarse for multi-million-row worker tables.
-- These catalog-only reloptions do not rewrite rows or change the data shape.
ALTER TABLE "retention_deletion_log" SET (
    autovacuum_vacuum_scale_factor = 0.02,
    autovacuum_analyze_scale_factor = 0.01,
    autovacuum_vacuum_cost_delay = 2
);
--> statement-breakpoint
ALTER TABLE "research_extraction_jobs" SET (
    autovacuum_vacuum_scale_factor = 0.02,
    autovacuum_analyze_scale_factor = 0.01,
    autovacuum_vacuum_cost_delay = 2
);
--> statement-breakpoint
RESET lock_timeout;
--> statement-breakpoint
RESET statement_timeout;
