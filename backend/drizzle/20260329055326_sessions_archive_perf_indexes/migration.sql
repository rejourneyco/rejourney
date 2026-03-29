CREATE INDEX "ingest_jobs_session_pending_idx" ON "ingest_jobs" ("session_id") WHERE "status" IN ('pending', 'processing');--> statement-breakpoint
CREATE INDEX "sessions_archive_replay_idx" ON "sessions" ("project_id","started_at") WHERE "replay_available" = true;--> statement-breakpoint
CREATE INDEX "sessions_project_device_started_idx" ON "sessions" ("project_id","device_id","started_at");