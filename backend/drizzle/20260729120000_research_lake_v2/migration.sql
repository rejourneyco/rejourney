SET lock_timeout = '5s';
--> statement-breakpoint
SET statement_timeout = '2min';
--> statement-breakpoint

-- Build the job-table indexes separately with
-- drizzle/manual/research-lake-v2-indexes-concurrent.sql. Keeping index builds
-- out of this transactional migration avoids blocking the active V1 queue.
-- V2 remains inactive while the legacy session/lake unique index exists.

CREATE TABLE IF NOT EXISTS "research_capture_decisions" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "session_id" varchar(64) NOT NULL REFERENCES "sessions"("id") ON DELETE cascade,
    "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE cascade,
    "team_id" uuid NOT NULL REFERENCES "teams"("id") ON DELETE cascade,
    "schema_version" integer DEFAULT 2 NOT NULL,
    "policy_version" integer NOT NULL,
    "sampling_bucket" integer NOT NULL,
    "capture_tier" varchar(32) NOT NULL,
    "inclusion_probability_ppm" integer NOT NULL,
    "tier_assignment_probability_ppm" integer NOT NULL,
    "source_sample_rate_bps" integer,
    "smart_capture_status" varchar(32),
    "smart_capture_reason" varchar(120),
    "smart_capture_rule_key" varchar(64),
    "smart_capture_would_discard" boolean DEFAULT false NOT NULL,
    "preserve_visual_source" boolean DEFAULT false NOT NULL,
    "evaluation_quarantined" boolean DEFAULT false NOT NULL,
    "source_cleanup_state" varchar(32) DEFAULT 'not_required' NOT NULL,
    "source_cleanup_due_at" timestamp,
    "decided_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "research_capture_decisions_session_schema_unique"
ON "research_capture_decisions" ("session_id", "schema_version");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "research_capture_decisions_cleanup_idx"
ON "research_capture_decisions" ("schema_version", "source_cleanup_state", "source_cleanup_due_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "research_capture_decisions_project_tier_idx"
ON "research_capture_decisions" ("project_id", "schema_version", "capture_tier", "decided_at");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "research_panel_observations" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "session_id" varchar(64) NOT NULL REFERENCES "sessions"("id") ON DELETE cascade,
    "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE cascade,
    "panel_key" varchar(64),
    "started_at" timestamp NOT NULL,
    "event_families" text[] DEFAULT ARRAY[]::text[] NOT NULL,
    "revenue_amount_bucket" integer,
    "refund_count" integer DEFAULT 0 NOT NULL,
    "renewal_count" integer DEFAULT 0 NOT NULL,
    "cancellation_count" integer DEFAULT 0 NOT NULL,
    "expires_at" timestamp NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "research_panel_observations_session_unique"
ON "research_panel_observations" ("session_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "research_panel_observations_panel_started_idx"
ON "research_panel_observations" ("project_id", "panel_key", "started_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "research_panel_observations_expiry_idx"
ON "research_panel_observations" ("expires_at");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "research_release_registry" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE cascade,
    "platform" varchar(20) NOT NULL,
    "release_id" varchar(80) NOT NULL,
    "first_seen_at" timestamp NOT NULL,
    "last_seen_at" timestamp NOT NULL,
    "observed_session_count" bigint DEFAULT 0 NOT NULL,
    "adoption_10_at" timestamp,
    "adoption_25_at" timestamp,
    "adoption_50_at" timestamp,
    "adoption_75_at" timestamp,
    "adoption_90_at" timestamp,
    "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "research_release_registry_project_platform_release_unique"
ON "research_release_registry" ("project_id", "platform", "release_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "research_release_registry_project_seen_idx"
ON "research_release_registry" ("project_id", "last_seen_at");
--> statement-breakpoint

-- Drizzle wraps folder migrations in one transaction and holds locks until
-- commit. Take the brief ACCESS EXCLUSIVE lock on the active job table last so
-- no later catalog or foreign-key work can extend the write-blocking window.
-- PostgreSQL 18 adds this constant-default column without rewriting table rows.
ALTER TABLE "research_extraction_jobs"
ADD COLUMN IF NOT EXISTS "job_lane" varchar(32) DEFAULT 'retention' NOT NULL;
