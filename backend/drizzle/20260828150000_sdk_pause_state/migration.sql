DO $$
BEGIN
    -- Production infra may provision these additive columns ahead of the app
    -- release. Checking the catalog first avoids taking redundant
    -- ACCESS EXCLUSIVE locks on a hot sessions table during db-setup.
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'sessions'
          AND column_name = 'sdk_paused_at'
    ) THEN
        ALTER TABLE "sessions" ADD COLUMN "sdk_paused_at" timestamp;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'sessions'
          AND column_name = 'sdk_pause_id'
    ) THEN
        ALTER TABLE "sessions" ADD COLUMN "sdk_pause_id" varchar(64);
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'sessions'
          AND column_name = 'sdk_pause_state_updated_at'
    ) THEN
        ALTER TABLE "sessions" ADD COLUMN "sdk_pause_state_updated_at" timestamp;
    END IF;
END $$;

DO $$
BEGIN
    IF to_regclass('public.sessions_sdk_paused_started_idx') IS NULL THEN
        CREATE INDEX "sessions_sdk_paused_started_idx"
            ON "sessions" ("started_at")
            WHERE "status" IN ('processing', 'pending')
              AND "sdk_paused_at" IS NOT NULL;
    END IF;
END $$;
