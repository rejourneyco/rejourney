ALTER TABLE "sessions"
ADD COLUMN IF NOT EXISTS "web_referral" varchar(255);

UPDATE "sessions"
SET "web_referral" = left(
    nullif(coalesce(
        "metadata"->>'webReferral',
        "metadata"->>'webReferrerDomain',
        "metadata"->>'webAttributionSource'
    ), ''),
    255
)
WHERE "web_referral" IS NULL
  AND "metadata" IS NOT NULL
  AND (
    "metadata" ? 'webReferral'
    OR "metadata" ? 'webReferrerDomain'
    OR "metadata" ? 'webAttributionSource'
  );

CREATE INDEX IF NOT EXISTS "sessions_project_web_referral_started_idx"
ON "sessions" ("project_id", "web_referral", "started_at")
WHERE "web_referral" IS NOT NULL;
