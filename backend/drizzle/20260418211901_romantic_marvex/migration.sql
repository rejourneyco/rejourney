CREATE INDEX "ingest_jobs_monitoring_idx" ON "ingest_jobs" ("status","kind","next_run_at","created_at") WHERE "status" IN ('pending', 'processing', 'dlq', 'failed');--> statement-breakpoint
CREATE INDEX "recording_artifacts_created_status_endpoint_idx" ON "recording_artifacts" ("created_at","status","kind","endpoint_id");--> statement-breakpoint
CREATE INDEX "recording_artifacts_upload_completed_at_idx" ON "recording_artifacts" ("upload_completed_at","kind","endpoint_id","created_at") WHERE "upload_completed_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "recording_artifacts_pending_stalled_idx" ON "recording_artifacts" ("kind","created_at","endpoint_id") WHERE "status" = 'pending' AND "upload_completed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "recording_artifacts_session_ready_endpoint_idx" ON "recording_artifacts" ("session_id","endpoint_id") WHERE "status" = 'ready';--> statement-breakpoint
CREATE INDEX "recording_artifacts_failed_recent_idx" ON "recording_artifacts" ("status","created_at","kind","endpoint_id") WHERE "status" IN ('abandoned', 'failed');--> statement-breakpoint
CREATE INDEX "sessions_seed_started_at_idx" ON "sessions" ("started_at","id");