-- Event payloads can exceed the 2 GiB limit of a 32-bit cumulative counter.
-- Bound both lock acquisition and the table rewrite; leave the old schema intact
-- if a busy / slower database requires a separately scheduled migration.
-- Large production tables can first use the infra repo's
-- scripts/k8s/upgrade-session-event-bytes.py for a live-write-mirrored copy.
SET LOCAL lock_timeout = '250ms';
SET LOCAL statement_timeout = '5s';
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'session_metrics'
      AND column_name = 'events_size_bytes' AND data_type = 'integer'
  ) THEN
    ALTER TABLE public.session_metrics
      ALTER COLUMN events_size_bytes TYPE bigint;
  END IF;
END $$;
