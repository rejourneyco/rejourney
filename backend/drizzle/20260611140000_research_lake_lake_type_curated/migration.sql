ALTER TABLE "research_extraction_jobs"
ADD COLUMN IF NOT EXISTS "lake_type" varchar(32) DEFAULT 'interaction' NOT NULL;
--> statement-breakpoint

UPDATE "research_extraction_jobs"
SET "lake_type" = 'interaction'
WHERE "lake_type" IS NULL;
--> statement-breakpoint

DROP INDEX IF EXISTS "research_extraction_jobs_session_unique";
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "research_extraction_jobs_session_lake_unique"
ON "research_extraction_jobs" ("session_id", "lake_type");
--> statement-breakpoint

DROP INDEX IF EXISTS "research_extraction_jobs_claim_idx";
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "research_extraction_jobs_claim_idx"
ON "research_extraction_jobs" ("lake_type", "status", "next_retry_at", "due_at", "session_id");
--> statement-breakpoint

DROP INDEX IF EXISTS "research_extraction_jobs_project_status_idx";
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "research_extraction_jobs_project_status_idx"
ON "research_extraction_jobs" ("project_id", "lake_type", "status", "due_at");
