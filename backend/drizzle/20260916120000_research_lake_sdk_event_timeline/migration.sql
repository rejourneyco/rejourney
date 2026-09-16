-- Research lake SDK event timeline tracking.
--
-- Each exported research sample now carries an SDK event timeline file. These
-- nullable columns record, per export job, when that timeline was written and
-- how complete its source artifacts were. All statements are additive.

SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE "research_extraction_jobs" ADD COLUMN IF NOT EXISTS "sdk_event_timeline_at" timestamp;
--> statement-breakpoint
ALTER TABLE "research_extraction_jobs" ADD COLUMN IF NOT EXISTS "sdk_event_timeline" varchar(16);
--> statement-breakpoint
ALTER TABLE "research_extraction_jobs" ADD COLUMN IF NOT EXISTS "sdk_event_count" integer;
--> statement-breakpoint
ALTER TABLE "research_extraction_jobs" ADD COLUMN IF NOT EXISTS "sdk_event_artifact_count" integer;
--> statement-breakpoint
ALTER TABLE "research_extraction_jobs" ADD COLUMN IF NOT EXISTS "sdk_event_artifact_missing_count" integer;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "research_extraction_jobs_sdk_event_timeline_pending_idx"
    ON "research_extraction_jobs" ("session_id")
    WHERE "status" = 'exported' AND "sdk_event_timeline_at" IS NULL AND "lake_type" IN ('interaction', 'behavioral_outcomes');
