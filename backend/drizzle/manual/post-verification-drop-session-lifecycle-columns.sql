-- Post-verification cleanup: drop deprecated session lifecycle columns.
--
-- Run manually (or via a new Drizzle migration) ONLY after you have confirmed
-- the new lifecycle behaves correctly in your environment. In the same change,
-- remove the matching fields from backend/src/db/schema.ts (sessions table)
-- so the codebase stays aligned with the database.
--
-- PostgreSQL:

-- ALTER TABLE "sessions" DROP COLUMN IF EXISTS "explicit_ended_at";
-- ALTER TABLE "sessions" DROP COLUMN IF EXISTS "finalized_at";
-- ALTER TABLE "sessions" DROP COLUMN IF EXISTS "close_source";
-- ALTER TABLE "sessions" DROP COLUMN IF EXISTS "replay_available_at";
-- ALTER TABLE "sessions" DROP COLUMN IF EXISTS "last_client_event_at";
-- ALTER TABLE "sessions" DROP COLUMN IF EXISTS "last_client_foreground_at";
-- ALTER TABLE "sessions" DROP COLUMN IF EXISTS "last_client_background_at";


----MUST FIRST DELETE REFENCES FORM OTHER JOBS!!!!!
