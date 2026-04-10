CREATE TABLE IF NOT EXISTS "session_backup_queue" (
	"session_id" varchar(64) PRIMARY KEY NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_retry_at" timestamp,
	"claimed_by" varchar(255),
	"claimed_at" timestamp,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $migrate$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM pg_constraint c
		JOIN pg_class rel ON rel.oid = c.conrelid
		JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
		WHERE nsp.nspname = 'public'
			AND rel.relname = 'session_backup_queue'
			AND c.conname = 'session_backup_queue_session_id_sessions_id_fk'
	) THEN
		ALTER TABLE "session_backup_queue" ADD CONSTRAINT "session_backup_queue_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END
$migrate$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "session_backup_queue_claim_idx" ON "session_backup_queue" ("status","next_retry_at","created_at","session_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "session_backup_queue_stale_idx" ON "session_backup_queue" ("status","claimed_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ingest_jobs_session_idx" ON "ingest_jobs" ("session_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sessions_backup_ready_started_idx" ON "sessions" ("status","started_at","id");
