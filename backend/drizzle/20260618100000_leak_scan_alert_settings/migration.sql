SET lock_timeout = '5s';
--> statement-breakpoint

ALTER TABLE "alert_settings"
  ADD COLUMN IF NOT EXISTS "leak_scan_alerts_enabled" boolean DEFAULT true NOT NULL;
