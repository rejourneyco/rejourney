-- Drop unused nullable session timestamp columns.
-- Replay availability is still tracked by sessions.replay_available.
ALTER TABLE "sessions" DROP COLUMN IF EXISTS "replay_available_at";--> statement-breakpoint
ALTER TABLE "sessions" DROP COLUMN IF EXISTS "last_client_event_at";--> statement-breakpoint
ALTER TABLE "sessions" DROP COLUMN IF EXISTS "last_client_foreground_at";--> statement-breakpoint
ALTER TABLE "sessions" DROP COLUMN IF EXISTS "last_client_background_at";
