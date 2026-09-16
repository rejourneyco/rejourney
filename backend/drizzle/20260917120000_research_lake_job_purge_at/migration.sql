-- Research lake export ordering and claim ownership.
--
-- purge_at records when a job's source recording is expected to disappear so
-- claims can export the soonest-to-expire sessions first. claimed_by records
-- the pod that claimed a row for diagnostics. Both are nullable and additive.

SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE "research_extraction_jobs" ADD COLUMN IF NOT EXISTS "purge_at" timestamp;
--> statement-breakpoint
ALTER TABLE "research_extraction_jobs" ADD COLUMN IF NOT EXISTS "claimed_by" varchar(64);
