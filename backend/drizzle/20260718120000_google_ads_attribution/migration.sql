SET lock_timeout = '5s';
--> statement-breakpoint

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "google_ads_attribution" jsonb;
