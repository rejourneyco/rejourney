-- Reconciliation reads these fields for one session. Cover the aggregate so
-- immutable/completed artifacts do not force random reads of the large heap.
SET lock_timeout = '5min';
SET statement_timeout = '30min';
SELECT 'DROP INDEX CONCURRENTLY public.recording_artifacts_session_evidence_idx;'
FROM pg_index
WHERE indexrelid = to_regclass('public.recording_artifacts_session_evidence_idx')
  AND NOT indisvalid
\gexec
CREATE INDEX CONCURRENTLY IF NOT EXISTS recording_artifacts_session_evidence_idx
    ON public.recording_artifacts (session_id)
    INCLUDE (kind, status, size_bytes, declared_size_bytes, start_time, end_time,
             timestamp, ready_at, verified_at, upload_completed_at, created_at,
             event_rollup_processed_at);
