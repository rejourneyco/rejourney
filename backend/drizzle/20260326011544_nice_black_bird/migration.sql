SET lock_timeout = '5s';--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "sessions" DROP COLUMN IF EXISTS "replay_promoted";
  ALTER TABLE "sessions" DROP COLUMN IF EXISTS "replay_promoted_reason";
  ALTER TABLE "sessions" DROP COLUMN IF EXISTS "replay_promoted_at";
  ALTER TABLE "sessions" DROP COLUMN IF EXISTS "replay_promotion_score";
EXCEPTION
  WHEN lock_not_available OR deadlock_detected THEN
    RAISE NOTICE 'Skipping replay legacy column cleanup for now because the sessions table is busy.';
END
$$;
