ALTER TABLE "projects"
ADD COLUMN IF NOT EXISTS "web_allowed_domains" text[];

UPDATE "projects"
SET "web_allowed_domains" = ARRAY["web_domain"]::text[]
WHERE "web_domain" IS NOT NULL
  AND "web_domain" <> ''
  AND (
    "web_allowed_domains" IS NULL
    OR cardinality("web_allowed_domains") = 0
  );

UPDATE "projects"
SET "web_allowed_domains" = ARRAY[]::text[]
WHERE "web_allowed_domains" IS NULL;

ALTER TABLE "projects"
ALTER COLUMN "web_allowed_domains" SET DEFAULT ARRAY[]::text[],
ALTER COLUMN "web_allowed_domains" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "projects_web_allowed_domains_gin_idx"
ON "projects" USING gin ("web_allowed_domains");
