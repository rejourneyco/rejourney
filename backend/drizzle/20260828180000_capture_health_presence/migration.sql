DO $$
BEGIN
    -- Skip the table lock when the infra-owned additive migration has already
    -- prepared production for the new SDK. Fresh/self-hosted databases still
    -- add the same backward-compatible default.
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'session_metrics'
          AND column_name = 'capture_health_reported'
    ) THEN
        ALTER TABLE "session_metrics"
            ADD COLUMN "capture_health_reported" boolean NOT NULL DEFAULT false;
    END IF;
END $$;
