ALTER TABLE "sessions"
  ADD COLUMN IF NOT EXISTS "replay_quota_billing_exhausted" boolean DEFAULT false NOT NULL;
