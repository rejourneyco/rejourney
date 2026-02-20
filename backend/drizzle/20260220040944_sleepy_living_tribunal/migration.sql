ALTER TABLE "teams" ADD COLUMN "retention_tier" integer DEFAULT 0 NOT NULL;
INSERT INTO retention_policies (tier, retention_days) VALUES (6, null) ON CONFLICT DO NOTHING;