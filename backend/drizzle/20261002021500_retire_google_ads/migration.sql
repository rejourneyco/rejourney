-- Stage retirement before rolling application processes. Removing these columns
-- here would break older auth SELECTs during a rolling deploy. The matching
-- backend/scripts/sql/removeRetiredGoogleAds.sql performs the destructive step
-- after rollout; infra verifies that no older API-image processes remain.
DO $$
DECLARE
    retired record;
BEGIN
    FOR retired IN
        SELECT table_name, column_name
        FROM (VALUES
            ('users', 'google_ads_attribution'),
            ('users', 'google_ads_consent_granted_at'),
            ('users', 'google_ads_consent_version'),
            ('otp_tokens', 'google_ads_attribution'),
            ('otp_tokens', 'google_ads_consent_granted_at'),
            ('otp_tokens', 'google_ads_consent_version')
        ) AS retired_columns(table_name, column_name)
    LOOP
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public'
                AND table_name = retired.table_name
                AND column_name = retired.column_name
        ) THEN
            EXECUTE format(
                'COMMENT ON COLUMN public.%I.%I IS %L',
                retired.table_name,
                retired.column_name,
                'Retired in 4.1.114; remove with removeRetiredGoogleAds.sql after older application processes stop.'
            );
        END IF;
    END LOOP;
    IF to_regclass('public.google_ads_conversion_events') IS NOT NULL THEN
        COMMENT ON TABLE public.google_ads_conversion_events IS
            'Retired in 4.1.114; remove with removeRetiredGoogleAds.sql after application rollout.';
    END IF;
END $$;
