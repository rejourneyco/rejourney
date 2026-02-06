-- Add dead tap tracking columns across all stats tables
-- Dead taps: user tapped an element that looks interactive but cannot respond

ALTER TABLE "session_metrics" ADD COLUMN IF NOT EXISTS "dead_tap_count" integer DEFAULT 0 NOT NULL;

ALTER TABLE "app_all_time_stats" ADD COLUMN IF NOT EXISTS "total_dead_taps" bigint DEFAULT 0;

ALTER TABLE "app_daily_stats" ADD COLUMN IF NOT EXISTS "total_dead_taps" integer DEFAULT 0 NOT NULL;
