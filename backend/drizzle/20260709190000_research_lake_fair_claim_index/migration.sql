CREATE INDEX IF NOT EXISTS "research_extraction_jobs_fair_claim_idx"
ON "research_extraction_jobs" ("lake_type", "status", "project_id", "due_at", "created_at");
