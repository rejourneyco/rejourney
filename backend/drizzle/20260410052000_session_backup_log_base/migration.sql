CREATE TABLE IF NOT EXISTS "session_backup_log" (
	"session_id" varchar(64) PRIMARY KEY NOT NULL,
	"backed_up_at" timestamp with time zone DEFAULT now() NOT NULL,
	"r2_key_prefix" text NOT NULL,
	"artifact_count" integer DEFAULT 0 NOT NULL,
	"total_bytes" bigint DEFAULT 0 NOT NULL,
	"planned_artifact_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "session_backup_log_backed_up_at_idx" ON "session_backup_log" ("backed_up_at");
