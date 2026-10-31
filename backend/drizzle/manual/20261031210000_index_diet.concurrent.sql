-- Index diet for sessions / recording_artifacts / research + retention tables.
-- Expand/contract step for drizzle/20261031210000_index_diet/migration.sql.
--
-- Run BY HAND with psql directly against the PostgreSQL writer (CNPG primary),
-- never through PgBouncer and never inside BEGIN/COMMIT: CREATE/DROP/REINDEX
-- ... CONCURRENTLY refuse to run in a transaction block and must keep one server
-- session for every build phase. Run it ONE STATEMENT AT A TIME (copy each block)
-- or as a whole file with ON_ERROR_STOP; every statement is idempotent, so the
-- file can be re-run after an interruption.
--
--   ssh ... 'kubectl exec -i -n rejourney postgres-local-N -c postgres -- \
--       psql -X -U postgres -d rejourney' < 20261031210000_index_diet.concurrent.sql
--
-- Safe order: (1) build/confirm every replacement, (2) only then drop what it
-- replaces, (3) table reloption, (4) REINDEX the bloated survivors. Push the app
-- release afterwards; its migration then finds every index already in its final
-- state and is a catalog-only no-op.
--
-- None of these statements changes a query result: indexes only change plans.
-- Verification was done on prod 2026-10-31 (PostgreSQL 18.4) with read-only
-- EXPLAIN (no ANALYZE on large tables), pg_indexes / pg_stat_user_indexes, a
-- 4-minute idx_scan delta sample and a 3-minute pg_stat_statements call delta.
-- Prod free disk at that time: 233 GB of 451 GB.

\set ON_ERROR_STOP on

SET lock_timeout = '5s';
-- GIN and multi-GB btree builds take hours on the 34 GB sessions heap.
SET statement_timeout = 0;
-- Session-local; the pod has a 16 GiB limit with shared_buffers = 4 GB.
SET maintenance_work_mem = '512MB';

-- ---------------------------------------------------------------------------
-- Builds and rebuilds wait for in-flight transactions, so they run without a
-- lock timeout; check pg_stat_activity for long transactions before starting.
SET lock_timeout = 0;

-- 1. Replacements first.
-- ---------------------------------------------------------------------------

-- 1a. recording_artifacts_created_at_idx already exists on prod (4.4 GB,
-- "btree (created_at DESC)"); this is a no-op there and gives self-hosted
-- databases the index that replaces recording_artifacts_created_status_endpoint_idx.
SELECT 'DROP INDEX CONCURRENTLY public.recording_artifacts_created_at_idx;'
FROM pg_index
WHERE indexrelid = to_regclass('public.recording_artifacts_created_at_idx')
  AND NOT indisvalid
\gexec
CREATE INDEX CONCURRENTLY IF NOT EXISTS recording_artifacts_created_at_idx
    ON public.recording_artifacts (created_at DESC);

-- 1b. recording_artifacts_kind_ready_covering_idx already exists on prod
-- (11 GB); no-op there. It replaces recording_artifacts_session_ready_endpoint_idx.
SELECT 'DROP INDEX CONCURRENTLY public.recording_artifacts_kind_ready_covering_idx;'
FROM pg_index
WHERE indexrelid = to_regclass('public.recording_artifacts_kind_ready_covering_idx')
  AND NOT indisvalid
\gexec
CREATE INDEX CONCURRENTLY IF NOT EXISTS recording_artifacts_kind_ready_covering_idx
    ON public.recording_artifacts (session_id, kind)
    INCLUDE (size_bytes, endpoint_id)
    WHERE status = 'ready';

-- 1c. sessions_events_path_idx replaces sessions_events_idx (GIN jsonb_ops,
-- 25 GB, 42 scans lifetime, 0 in the 4-minute sample). Verification: the only
-- operator applied to sessions.events anywhere (backend/src, backend/scripts,
-- rejourney-infra) is @> containment in routes/sessions.ts (custom-event filter
-- ~440/448, checkout/purchase funnel ~507-518 and ~658-670); every other use is
-- jsonb_array_elements / jsonb_array_length / jsonb_typeof / || append, which
-- never use an index. No ?, ?|, ?&, @?, @@ or <@ on events. jsonb_path_ops
-- supports @> (plus @? / @@), produces the same rows after heap recheck, and is
-- typically far smaller than jsonb_ops.
SELECT 'DROP INDEX CONCURRENTLY public.sessions_events_path_idx;'
FROM pg_index
WHERE indexrelid = to_regclass('public.sessions_events_path_idx')
  AND NOT indisvalid
\gexec
CREATE INDEX CONCURRENTLY IF NOT EXISTS sessions_events_path_idx
    ON public.sessions USING gin (events jsonb_path_ops);

-- Every replacement must be valid and ready before anything is dropped.
DO $$
DECLARE
    missing text;
BEGIN
    SELECT string_agg(name, ', ')
    INTO missing
    FROM unnest(ARRAY[
        'public.recording_artifacts_created_at_idx',
        'public.recording_artifacts_kind_ready_covering_idx',
        'public.recording_artifacts_kind_idx',
        'public.recording_artifacts_failed_recent_idx',
        'public.sessions_events_path_idx',
        'public.sessions_status_idx',
        'public.sessions_project_started_status_idx',
        'public.sessions_retention_due_idx',
        'public.research_extraction_jobs_fair_claim_idx',
        'public.research_extraction_jobs_project_status_idx'
    ]) AS name
    WHERE NOT EXISTS (
        SELECT 1 FROM pg_index
        WHERE indexrelid = to_regclass(name) AND indisvalid AND indisready
    );
    IF missing IS NOT NULL THEN
        RAISE EXCEPTION 'Replacement index(es) missing or invalid: %. Fix before dropping anything.', missing;
    END IF;
END
$$;

-- ---------------------------------------------------------------------------
SET lock_timeout = '5s';

-- 2. Contract: drop redundant / unused indexes.
-- ---------------------------------------------------------------------------

-- recording_artifacts_created_status_endpoint_idx: btree (created_at, status,
-- kind, endpoint_id), 25 GB. Every created_at-window query plans elsewhere today:
--   exporters.yaml by_status (2h) + created_recent (1h) -> recording_artifacts_created_at_idx
--   exporters stalled, monitoring.ts stale replay, recoverStalePendingReplayArtifacts,
--     abandon-pending sweep (ingestArtifactLifecycle ~776/~851, custom plans) -> pending_stalled_idx
--   exporters failed_recent -> failed_recent_idx (index only)
--   exporters completed_recent / upload_latency -> upload_completed_at_idx
--   repairMissingSessionsFromIngestJobs (7d) -> parallel seq scan
-- None needs it as a covering index (all read heap-only columns). Its live
-- idx_scan growth (~34 per 3 min) matches planner get_actual_variable_range
-- probes for created_at range estimates, which move to created_at_idx after the
-- drop; no executed plan in the EXPLAIN sweep referenced it.
DROP INDEX CONCURRENTLY IF EXISTS public.recording_artifacts_created_status_endpoint_idx;

-- recording_artifacts_session_id_idx: btree (session_id), 1.9 GB. Exact key
-- duplicate of recording_artifacts_session_evidence_idx (session_id) INCLUDE (...)
-- on prod, and a strict prefix of kind_idx (session_id, kind) everywhere (plus
-- session_status_idx (session_id, status) on migrated databases). The FK cascade
-- from sessions and every session_id lookup can use any of those.
DROP INDEX CONCURRENTLY IF EXISTS public.recording_artifacts_session_id_idx;

-- recording_artifacts_session_ready_endpoint_idx: btree (session_id, endpoint_id)
-- WHERE status = 'ready', 1 GB, 0 scans in the sample. kind_ready_covering_idx has
-- the identical predicate, the same leading key and endpoint_id in INCLUDE, so it
-- serves the same lookups (index-only) for one session's handful of rows.
DROP INDEX CONCURRENTLY IF EXISTS public.recording_artifacts_session_ready_endpoint_idx;

-- recording_artifacts_failed_abandoned_idx: btree (created_at DESC) WHERE status IN
-- ('abandoned','failed'), 0 scans lifetime. Same predicate as failed_recent_idx
-- (status, created_at, kind, endpoint_id), which the exporter uses index-only.
DROP INDEX CONCURRENTLY IF EXISTS public.recording_artifacts_failed_abandoned_idx;

-- sessions_reconciliation_activity_idx: btree (last_ingest_activity_at) WHERE
-- status IN ('processing','pending'), 613 MB for ~163 live rows. reconcileDueSessions
-- (sessionReconciliation.ts ~364) cannot use it because its OR branch on
-- replay_available has no activity bound; EXPLAIN of the exact query (custom
-- plan) uses sessions_status_idx. No other query filters on last_ingest_activity_at.
-- Dropping it also makes the 300M+ last_ingest_activity_at/updated_at activity
-- updates HOT-eligible: it is the only index on either column.
DROP INDEX CONCURRENTLY IF EXISTS public.sessions_reconciliation_activity_idx;

-- sessions_status_ended_at_id_idx: btree (status, ended_at, id), 968 MB, 8 scans
-- lifetime, last 2026-09-16. No code or infra query ranges over or orders by
-- ended_at; status lookups use sessions_status_idx / backup_ready_started_idx.
DROP INDEX CONCURRENTLY IF EXISTS public.sessions_status_ended_at_id_idx;

-- sessions_retention_eligible_idx: partial status NOT IN ('deleted','completed'),
-- 698 MB, 0 scans lifetime. The retention worker uses sessions_retention_due_idx
-- (status IN ('ready','completed')); schema.ts already documents the swap.
DROP INDEX CONCURRENTLY IF EXISTS public.sessions_retention_eligible_idx;

-- sessions_project_started_idx: btree (project_id, started_at), 2.1 GB, 0 scans in
-- the sample, last 2026-09-16. Strict column prefix of
-- sessions_project_started_status_idx (project_id, started_at, status) (verified
-- column order in pg_indexes), which also backs the projects FK.
DROP INDEX CONCURRENTLY IF EXISTS public.sessions_project_started_idx;

-- sessions_events_idx: replaced by sessions_events_path_idx (1c).
DROP INDEX CONCURRENTLY IF EXISTS public.sessions_events_idx;

-- research_extraction_jobs_claim_idx: (lake_type, status, next_retry_at, due_at,
-- session_id), 1.2 GB, last scan 2026-08-21. The only query it was built for is
-- the V1 FIFO claim (researchLake.ts buildFifoClaimResearchJobsSql); its EXPLAIN on
-- prod (custom plan, interaction and behavioral_outcomes) uses
-- research_extraction_jobs_project_status_idx. The fair claim uses fair_claim_idx;
-- V2 claims use the v2_* partial indexes.
DROP INDEX CONCURRENTLY IF EXISTS public.research_extraction_jobs_claim_idx;

-- retention_deletion_log_run_id_idx: btree (run_id), 32 MB, 1 scan lifetime.
-- run_id is written by retentionAudit.ts but never read in a WHERE/JOIN.
DROP INDEX CONCURRENTLY IF EXISTS public.retention_deletion_log_run_id_idx;

-- Kept deliberately (not dropped):
--   research_capture_decisions_project_tier_idx: the only project_id-leading index
--     on that table, so it serves the ON DELETE CASCADE from projects.
--   sessions_smart_capture_status_started_idx: routes/sessions.ts ~488 filters on a
--     user-chosen status and internalIssueDetection.ts ~308 on <> 'discarded', so a
--     partial WHERE smart_capture_status = 'pending' index would not cover them.

-- ---------------------------------------------------------------------------
-- 3. Leave room for HOT updates on the hottest-updated table.
-- ---------------------------------------------------------------------------
-- Catalog-only, SHARE UPDATE EXCLUSIVE; applies to pages written from now on.
-- If it times out behind autovacuum, rerun this statement.
SET lock_timeout = '5s';
ALTER TABLE public.sessions SET (fillfactor = 85);

-- ---------------------------------------------------------------------------
-- The swap at the end of each rebuild briefly locks the index; a bounded wait keeps
-- queries from queueing behind it. On a timeout, drop the _ccnew leftover and retry.
SET lock_timeout = '60s';

-- 4. Rebuild bloated survivors (after the drops so HOT updates stop re-bloating).
-- ---------------------------------------------------------------------------
-- An interrupted REINDEX CONCURRENTLY leaves invalid <name>_ccnew / _ccold
-- indexes. Clear any before (re)running this section.
SELECT format('DROP INDEX CONCURRENTLY %s;', indexrelid::regclass)
FROM pg_index
WHERE NOT indisvalid
  AND indrelid IN ('public.sessions'::regclass, 'public.recording_artifacts'::regclass)
  AND indexrelid::regclass::text ~ '_cc(new|old)[0-9]*$'
\gexec

-- One REINDEX INDEX CONCURRENTLY per row, run sequentially by \gexec, skipping
-- names absent on this database (session_evidence / event_rollup_pending are
-- production-only manual indexes). Prod sizes on 2026-10-31 in the comments.
SELECT format('REINDEX INDEX CONCURRENTLY %s;', to_regclass(target.name))
FROM (VALUES
    -- recording_artifacts: 39.6M rows, 75 GB of indexes on a 20 GB heap.
    (1,  'public.recording_artifacts_created_at_idx'),            -- 4.4 GB
    (2,  'public.recording_artifacts_client_upload_id_unique'),   -- 12 GB
    (3,  'public.recording_artifacts_kind_ready_covering_idx'),   -- 11 GB
    (4,  'public.recording_artifacts_session_evidence_idx'),      -- 12 GB
    (5,  'public.recording_artifacts_upload_completed_at_idx'),   -- 4.0 GB
    -- Small partials: 333 MB for 158 live rows, 253 MB for 0, 195 MB for 742.
    (6,  'public.recording_artifacts_pending_stalled_idx'),
    (7,  'public.recording_artifacts_recoverable_idx'),
    (8,  'public.recording_artifacts_event_rollup_pending_idx'),
    -- sessions: 3.9M rows, 44 GB of indexes on a 3.4 GB heap.
    (9,  'public.sessions_seed_started_at_idx'),                  -- 2.4 GB
    (10, 'public.sessions_project_started_status_idx'),           -- 1.8 GB
    (11, 'public.sessions_pkey'),                                 -- 1.2 GB
    (12, 'public.sessions_identity_scrub_due_idx')                -- 876 MB
) AS target(ord, name)
WHERE to_regclass(target.name) IS NOT NULL
ORDER BY target.ord
\gexec

-- ---------------------------------------------------------------------------
-- 5. Verify: every remaining index valid + ready, and the final size.
-- ---------------------------------------------------------------------------
SELECT
    c.relname AS table_name,
    i.indexrelid::regclass AS index_name,
    i.indisvalid,
    i.indisready,
    pg_size_pretty(pg_relation_size(i.indexrelid)) AS size
FROM pg_index i
JOIN pg_class c ON c.oid = i.indrelid
WHERE c.relname IN ('sessions', 'recording_artifacts', 'research_extraction_jobs', 'retention_deletion_log')
ORDER BY c.relname, pg_relation_size(i.indexrelid) DESC;

SELECT reloptions FROM pg_class WHERE oid = 'public.sessions'::regclass;

RESET maintenance_work_mem;
RESET lock_timeout;
RESET statement_timeout;
