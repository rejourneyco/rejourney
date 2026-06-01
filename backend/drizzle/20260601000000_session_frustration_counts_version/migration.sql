ALTER TABLE "session_metrics"
  ADD COLUMN IF NOT EXISTS "frustration_counts_version" integer DEFAULT 0 NOT NULL;
