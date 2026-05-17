ALTER TABLE "projects"
  ADD COLUMN IF NOT EXISTS "web_max_observability_minutes" integer DEFAULT 10 NOT NULL;--> statement-breakpoint

UPDATE "projects"
SET "web_max_observability_minutes" = 10
WHERE "web_max_observability_minutes" IS NULL;--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'projects_web_max_observability_minutes_check'
  ) THEN
    ALTER TABLE "projects"
      ADD CONSTRAINT "projects_web_max_observability_minutes_check"
      CHECK ("web_max_observability_minutes" BETWEEN 1 AND 10);
  END IF;
END $$;
