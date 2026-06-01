ALTER TABLE "project_usage"
  ADD COLUMN IF NOT EXISTS "session_replays" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "billing_usage"
  ADD COLUMN IF NOT EXISTS "session_replays" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "sessions"
  ADD COLUMN IF NOT EXISTS "replay_quota_counted_at" timestamp;
--> statement-breakpoint
ALTER TABLE "billing_notifications"
  ADD COLUMN IF NOT EXISTS "dedupe_key" text;
--> statement-breakpoint

-- Preserve the current billing ledger exactly: before this migration,
-- project_usage.sessions was the quota number shown to customers.
UPDATE "project_usage"
SET "session_replays" = "sessions"
WHERE "session_replays" = 0
  AND "sessions" <> 0;
--> statement-breakpoint
UPDATE "billing_usage"
SET "session_replays" = "sessions"
WHERE "session_replays" = 0
  AND "sessions" <> 0;
--> statement-breakpoint

-- Every pre-migration session is already represented by the preserved
-- project_usage.session_replays ledger. Mark them as counted so sessions that
-- become replay_available after deployment do not increment replay usage twice.
UPDATE "sessions"
SET "replay_quota_counted_at" = COALESCE("updated_at", "created_at", "started_at", NOW())
WHERE "replay_quota_counted_at" IS NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "sessions_replay_quota_counted_idx"
  ON "sessions" ("project_id", "replay_quota_counted_at")
  WHERE "replay_quota_counted_at" IS NOT NULL;
--> statement-breakpoint

-- Keep existing warning rows as the canonical "already sent" records without
-- failing if old duplicate rows exist. Only the oldest row gets the dedupe key.
WITH ranked_notifications AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "team_id", "period", "type"
      ORDER BY "sent_at" ASC, "id" ASC
    ) AS row_num
  FROM "billing_notifications"
  WHERE "team_id" IS NOT NULL
    AND "type" IN ('warning_80', 'limit_100')
    AND "dedupe_key" IS NULL
)
UPDATE "billing_notifications" AS bn
SET "dedupe_key" = CONCAT('team:', bn."team_id", ':period:', bn."period", ':type:', bn."type")
FROM ranked_notifications rn
WHERE bn."id" = rn."id"
  AND rn.row_num = 1;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "billing_notifications_dedupe_key_unique"
  ON "billing_notifications" ("dedupe_key")
  WHERE "dedupe_key" IS NOT NULL;
