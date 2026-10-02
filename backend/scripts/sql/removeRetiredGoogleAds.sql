-- Run after all API/worker processes have upgraded to the Ads-free release.
-- Deliberately outside pre-rollout Drizzle migrations: older auth SELECTs use these fields.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DROP TABLE IF EXISTS google_ads_conversion_events;
ALTER TABLE users
    DROP COLUMN IF EXISTS google_ads_attribution,
    DROP COLUMN IF EXISTS google_ads_consent_granted_at,
    DROP COLUMN IF EXISTS google_ads_consent_version;
ALTER TABLE otp_tokens
    DROP COLUMN IF EXISTS google_ads_attribution,
    DROP COLUMN IF EXISTS google_ads_consent_granted_at,
    DROP COLUMN IF EXISTS google_ads_consent_version;
COMMIT;
