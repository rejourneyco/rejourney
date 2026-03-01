ALTER TABLE "sessions" ADD COLUMN "events" jsonb DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "metadata" jsonb DEFAULT '{}' NOT NULL;--> statement-breakpoint
CREATE INDEX "sessions_events_idx" ON "sessions" USING gin ("events");--> statement-breakpoint
CREATE INDEX "sessions_metadata_idx" ON "sessions" USING gin ("metadata");