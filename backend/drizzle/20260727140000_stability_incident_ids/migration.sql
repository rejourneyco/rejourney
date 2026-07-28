ALTER TABLE "crashes" ADD COLUMN IF NOT EXISTS "incident_id" varchar(128);
ALTER TABLE "anrs" ADD COLUMN IF NOT EXISTS "incident_id" varchar(128);
ALTER TABLE "errors" ADD COLUMN IF NOT EXISTS "incident_id" varchar(128);
ALTER TABLE "errors" ADD COLUMN IF NOT EXISTS "exception_category" varchar(255);
ALTER TABLE "errors" ADD COLUMN IF NOT EXISTS "source" varchar(64);
ALTER TABLE "errors" ADD COLUMN IF NOT EXISTS "is_handled" boolean;

CREATE UNIQUE INDEX IF NOT EXISTS "crashes_project_incident_unique"
    ON "crashes" ("project_id", "incident_id")
    WHERE "incident_id" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "anrs_project_incident_unique"
    ON "anrs" ("project_id", "incident_id")
    WHERE "incident_id" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "errors_project_incident_unique"
    ON "errors" ("project_id", "incident_id")
    WHERE "incident_id" IS NOT NULL;
