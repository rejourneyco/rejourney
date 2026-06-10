ALTER TABLE "sessions"
ADD COLUMN IF NOT EXISTS "identity_scrubbed_at" timestamp,
ADD COLUMN IF NOT EXISTS "identity_scrub_version" integer,
ADD COLUMN IF NOT EXISTS "raw_events_deleted_at" timestamp;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "sessions_identity_scrub_due_idx"
ON "sessions" ("started_at", "id")
WHERE "identity_scrubbed_at" IS NULL;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "research_extraction_jobs" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "session_id" varchar(64) NOT NULL,
    "project_id" uuid NOT NULL,
    "team_id" uuid NOT NULL,
    "due_at" timestamp NOT NULL,
    "status" varchar(32) DEFAULT 'pending' NOT NULL,
    "attempts" integer DEFAULT 0 NOT NULL,
    "next_retry_at" timestamp,
    "lake_path" text,
    "quality_tier" varchar(32),
    "reject_reason" text,
    "source_artifact_count" integer DEFAULT 0 NOT NULL,
    "interaction_event_count" integer DEFAULT 0 NOT NULL,
    "ui_frame_count" integer DEFAULT 0 NOT NULL,
    "ui_skeleton_element_count" integer DEFAULT 0 NOT NULL,
    "anonymization_version" integer DEFAULT 1 NOT NULL,
    "schema_version" integer DEFAULT 1 NOT NULL,
    "processed_at" timestamp,
    "last_error" text,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

DO $$ BEGIN
    ALTER TABLE "research_extraction_jobs"
    ADD CONSTRAINT "research_extraction_jobs_session_id_sessions_id_fk"
    FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

DO $$ BEGIN
    ALTER TABLE "research_extraction_jobs"
    ADD CONSTRAINT "research_extraction_jobs_project_id_projects_id_fk"
    FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

DO $$ BEGIN
    ALTER TABLE "research_extraction_jobs"
    ADD CONSTRAINT "research_extraction_jobs_team_id_teams_id_fk"
    FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "research_extraction_jobs_session_unique"
ON "research_extraction_jobs" ("session_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "research_extraction_jobs_claim_idx"
ON "research_extraction_jobs" ("status", "next_retry_at", "due_at", "session_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "research_extraction_jobs_project_status_idx"
ON "research_extraction_jobs" ("project_id", "status", "due_at");
