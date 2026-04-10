ALTER TABLE "session_backup_log" ADD COLUMN IF NOT EXISTS "high_quality" boolean;--> statement-breakpoint
ALTER TABLE "session_backup_log" ADD COLUMN IF NOT EXISTS "quality_tier" varchar(32);--> statement-breakpoint
ALTER TABLE "session_backup_log" ADD COLUMN IF NOT EXISTS "quality_reason" jsonb;--> statement-breakpoint
ALTER TABLE "session_backup_log" ADD COLUMN IF NOT EXISTS "quality_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "session_backup_log" ADD COLUMN IF NOT EXISTS "quality_rule_version" integer;--> statement-breakpoint
ALTER TABLE "session_backup_log" ADD COLUMN IF NOT EXISTS "actual_r2_artifact_count" integer;--> statement-breakpoint
ALTER TABLE "session_backup_log" ADD COLUMN IF NOT EXISTS "actual_r2_object_count" integer;--> statement-breakpoint
ALTER TABLE "session_backup_log" ADD COLUMN IF NOT EXISTS "manifest_present" boolean;
