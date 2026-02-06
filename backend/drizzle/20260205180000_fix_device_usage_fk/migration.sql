-- Fix device_usage table: drop UUID FK to dead device_registrations,
-- change device_id to varchar(64) for SHA-256 fingerprints,
-- add project_id for proper scoping.
--
-- Background: The active auth flow uses SHA-256 device fingerprints (64 hex chars)
-- but device_usage.device_id was a uuid FK → device_registrations.id.
-- A UUID guard in recording.ts silently skipped all non-UUID device IDs,
-- making device usage tracking completely non-functional.

-- 1. Drop the existing primary key and FK constraint
ALTER TABLE "device_usage" DROP CONSTRAINT IF EXISTS "device_usage_pkey";
ALTER TABLE "device_usage" DROP CONSTRAINT IF EXISTS "device_usage_device_id_device_registrations_id_fk";

-- 2. Change device_id from uuid to varchar(64)
ALTER TABLE "device_usage" ALTER COLUMN "device_id" TYPE varchar(64) USING "device_id"::varchar(64);

-- 3. Add project_id column (not null with FK to projects)
ALTER TABLE "device_usage" ADD COLUMN "project_id" uuid;
UPDATE "device_usage" SET "project_id" = (SELECT "id" FROM "projects" LIMIT 1) WHERE "project_id" IS NULL;
ALTER TABLE "device_usage" ALTER COLUMN "project_id" SET NOT NULL;
ALTER TABLE "device_usage" ADD CONSTRAINT "device_usage_project_id_projects_id_fk"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;

-- 4. Create new composite primary key (device_id, project_id, period)
ALTER TABLE "device_usage" ADD CONSTRAINT "device_usage_pkey"
    PRIMARY KEY ("device_id", "project_id", "period");

-- 5. Add index on project_id for efficient per-project queries
CREATE INDEX IF NOT EXISTS "device_usage_project_idx" ON "device_usage" ("project_id");

-- 6. Drop the dead device_registrations table (ECDSA auth was removed)
DROP TABLE IF EXISTS "device_registrations" CASCADE;
