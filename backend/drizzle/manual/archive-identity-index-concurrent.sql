-- Exact archive search ORs session, user, device and anonymous identity. The
-- anonymous index was dropped in May; one unindexed OR arm makes the new
-- exact-ID path scan the entire project. Build without blocking ingest writes.
SET lock_timeout = '5min';
SET statement_timeout = '30min';
-- A cancelled concurrent build leaves an invalid index. Recover on retry.
SELECT 'DROP INDEX CONCURRENTLY public.sessions_anonymous_hash_idx;'
FROM pg_index
WHERE indexrelid = to_regclass('public.sessions_anonymous_hash_idx')
  AND NOT indisvalid
\gexec
CREATE INDEX CONCURRENTLY IF NOT EXISTS sessions_anonymous_hash_idx
    ON public.sessions (anonymous_hash);
