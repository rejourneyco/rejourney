-- Custom occurrence rules were exported from production before this migration.
-- Stability email now uses product-owned rising-trend thresholds with a
-- project-level rolling seven-day cap. Leak scan settings and API endpoint
-- exclusions remain project-configurable.

ALTER TABLE "alert_settings"
  DROP COLUMN IF EXISTS "crash_alerts_enabled",
  DROP COLUMN IF EXISTS "anr_alerts_enabled",
  DROP COLUMN IF EXISTS "error_spike_alerts_enabled",
  DROP COLUMN IF EXISTS "api_degradation_alerts_enabled",
  DROP COLUMN IF EXISTS "error_spike_threshold_percent",
  DROP COLUMN IF EXISTS "api_degradation_threshold_percent",
  DROP COLUMN IF EXISTS "api_latency_threshold_ms",
  DROP COLUMN IF EXISTS "email_rules";
