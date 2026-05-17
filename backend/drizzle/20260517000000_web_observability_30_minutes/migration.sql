ALTER TABLE "projects"
  DROP CONSTRAINT IF EXISTS "projects_web_max_observability_minutes_check";--> statement-breakpoint

ALTER TABLE "projects"
  ALTER COLUMN "web_max_observability_minutes" SET DEFAULT 30;--> statement-breakpoint

UPDATE "projects"
SET "web_max_observability_minutes" = 30
WHERE "web_max_observability_minutes" = 10;--> statement-breakpoint

ALTER TABLE "projects"
  ADD CONSTRAINT "projects_web_max_observability_minutes_check"
  CHECK ("web_max_observability_minutes" BETWEEN 1 AND 30);
