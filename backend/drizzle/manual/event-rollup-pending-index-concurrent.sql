-- Bound the background rollup lookup to pending artifacts, in batch order.
-- The general session index also scans already-processed event artifacts.
SET lock_timeout = '5min';
SET statement_timeout = '30min';
SELECT 'DROP INDEX CONCURRENTLY public.recording_artifacts_event_rollup_pending_idx;'
FROM pg_index
WHERE indexrelid = to_regclass('public.recording_artifacts_event_rollup_pending_idx')
  AND NOT indisvalid
\gexec
CREATE INDEX CONCURRENTLY IF NOT EXISTS recording_artifacts_event_rollup_pending_idx
    ON public.recording_artifacts (session_id, created_at, id)
    WHERE status = 'ready' AND kind = 'events'
      AND event_rollup_requested_at IS NOT NULL
      AND event_rollup_processed_at IS NULL;
