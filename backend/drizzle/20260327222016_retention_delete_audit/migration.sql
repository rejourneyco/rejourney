CREATE TABLE "retention_deletion_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"run_id" varchar(128) NOT NULL,
	"scope" varchar(32) NOT NULL,
	"status" varchar(20) NOT NULL,
	"trigger" varchar(64),
	"session_id" varchar(64),
	"project_id" uuid,
	"team_id" uuid,
	"storage_prefix" text NOT NULL,
	"planned_artifact_row_count" integer DEFAULT 0 NOT NULL,
	"planned_artifact_bytes" bigint DEFAULT 0 NOT NULL,
	"planned_ingest_job_count" integer DEFAULT 0 NOT NULL,
	"deleted_artifact_row_count" integer DEFAULT 0 NOT NULL,
	"deleted_ingest_job_count" integer DEFAULT 0 NOT NULL,
	"deleted_object_count" integer DEFAULT 0 NOT NULL,
	"deleted_bytes" bigint DEFAULT 0 NOT NULL,
	"storage_missing" boolean DEFAULT false NOT NULL,
	"cache_key_count" integer DEFAULT 0 NOT NULL,
	"details" jsonb DEFAULT '{}' NOT NULL,
	"error_text" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "retention_run_lock" (
	"lock_name" text PRIMARY KEY,
	"owner_id" text NOT NULL,
	"acquired_at" timestamp DEFAULT now() NOT NULL,
	"heartbeat_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "retention_deletion_log_run_id_idx" ON "retention_deletion_log" ("run_id");--> statement-breakpoint
CREATE INDEX "retention_deletion_log_scope_idx" ON "retention_deletion_log" ("scope","started_at");--> statement-breakpoint
CREATE INDEX "retention_deletion_log_session_id_idx" ON "retention_deletion_log" ("session_id");