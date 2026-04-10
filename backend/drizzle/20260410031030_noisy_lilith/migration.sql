ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "last_client_event_at" timestamp;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "last_client_foreground_at" timestamp;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "last_client_background_at" timestamp;
