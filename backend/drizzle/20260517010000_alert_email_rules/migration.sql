ALTER TABLE "alert_settings"
  ADD COLUMN IF NOT EXISTS "email_rules" jsonb DEFAULT '[]'::jsonb NOT NULL;
