-- Read-only Postgres role for the internal Issue Detection module.
--
-- The detection-worker polls Rejourney's `sessions` table with a monotonic
-- (ended_at, id) cursor and reads supporting signals from a small fixed set
-- of tables. It must never write. See:
--   docs/integration/rejourney-input-schema.md  (in the Issue Detection repo)
--
-- Password is intentionally NOT set here — committing a password to the
-- repo would expose it. After this migration applies, an operator must run
-- once on the cluster:
--
--   kubectl exec -n rejourney postgres-local-1 -c postgres -- \
--     psql -U postgres rejourney \
--     -c "ALTER ROLE issue_detection_reader WITH PASSWORD '<from secrets manager>';"
--
-- Without a password the role exists with LOGIN but cannot connect — safe
-- default. Re-running this migration is idempotent (CREATE … IF NOT EXISTS,
-- GRANT … is idempotent in Postgres).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'issue_detection_reader') THEN
    CREATE ROLE issue_detection_reader LOGIN;
  END IF;
END
$$;

-- Connect + schema usage. CONNECT on the database is granted by the owner of
-- the database; USAGE on schema lets the role see tables at all.
GRANT CONNECT ON DATABASE rejourney TO issue_detection_reader;
GRANT USAGE   ON SCHEMA   public    TO issue_detection_reader;

-- Read-only on the input tables enumerated in rejourney-input-schema.md.
-- Adding/removing columns later is fine — column-level grants would be too
-- brittle, and the role is read-only at the transaction level (see ALTER
-- ROLE below) so it cannot mutate state regardless.
GRANT SELECT ON
  public.sessions,
  public.recording_artifacts,
  public.app_daily_stats,
  public.api_endpoint_daily_stats,
  public.screen_touch_heatmaps,
  public.errors,
  public.anrs,
  public.crashes,
  public.issues,
  public.issue_events
  TO issue_detection_reader;

-- Belt-and-braces: every transaction this role opens is read-only at the
-- Postgres level, so even an INSERT slipping through application code fails
-- with `cannot execute INSERT in a read-only transaction`. The grants above
-- only cover SELECT anyway, but this defends against future grant drift.
ALTER ROLE issue_detection_reader SET default_transaction_read_only = on;

-- Covering composite index for the detection-worker's poll query
--   SELECT … FROM sessions
--   WHERE status IN ('ready','completed') AND (ended_at, id) > ($1, $2)
--   ORDER BY ended_at, id LIMIT $3
-- Without (status, ended_at, id) Postgres would scan sessions_status_idx and
-- sort, which gets expensive as the table grows. CONCURRENTLY can't run inside
-- a transaction block; drizzle-kit wraps each migration in one, so we use a
-- regular CREATE INDEX. Locking is brief on a write-light hot path; if this
-- becomes a problem on a much larger table, build the index out-of-band first
-- and let this statement no-op via IF NOT EXISTS.
CREATE INDEX IF NOT EXISTS sessions_status_ended_at_id_idx
  ON public.sessions (status, ended_at, id);
