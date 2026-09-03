-- Visitor ledger: pseudonymous per-project visitor records that outlive the
-- per-session identity scrub on a bounded, sliding inactivity window, so a
-- returning visitor is not re-counted as a new user once their earlier
-- sessions have been scrubbed.
--
-- The ledger stores only a keyed hash (HMAC) of the visitor identifier plus
-- first/last seen timestamps and a session count. No raw device or user id.

CREATE TABLE IF NOT EXISTS "project_visitors" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
    "visitor_key" varchar(64) NOT NULL,
    "first_seen_at" timestamp NOT NULL,
    "last_seen_at" timestamp NOT NULL,
    "session_count" integer DEFAULT 1 NOT NULL,
    "expires_at" timestamp NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_visitors_project_key_unique"
    ON "project_visitors" ("project_id", "visitor_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_visitors_expires_at_idx"
    ON "project_visitors" ("expires_at", "id");
--> statement-breakpoint
DO $$
BEGIN
    -- Production infra may provision these additive columns ahead of the app
    -- release. Checking the catalog first avoids taking redundant
    -- ACCESS EXCLUSIVE locks on a hot sessions table during db-setup.
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'sessions'
          AND column_name = 'visitor_key'
    ) THEN
        ALTER TABLE "sessions" ADD COLUMN "visitor_key" varchar(64);
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'sessions'
          AND column_name = 'visitor_session_ordinal'
    ) THEN
        ALTER TABLE "sessions" ADD COLUMN "visitor_session_ordinal" integer;
    END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'teams'
          AND column_name = 'visitor_identity_retention_days'
    ) THEN
        ALTER TABLE "teams" ADD COLUMN "visitor_identity_retention_days" integer DEFAULT 90 NOT NULL;
    END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
    -- Production runs the CONCURRENTLY variant from
    -- drizzle/manual/project-visitors-session-indexes-concurrent.sql ahead of
    -- this migration; this guarded fallback covers fresh and self-hosted DBs.
    IF to_regclass('public.sessions_project_visitor_key_started_idx') IS NULL THEN
        CREATE INDEX "sessions_project_visitor_key_started_idx"
            ON "sessions" ("project_id", "visitor_key", "started_at", "id")
            WHERE "visitor_key" IS NOT NULL;
    END IF;
END $$;
