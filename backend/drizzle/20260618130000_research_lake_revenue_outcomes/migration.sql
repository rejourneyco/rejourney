CREATE TABLE IF NOT EXISTS "research_lake_revenue_export_checkpoints" (
  "id" varchar(32) PRIMARY KEY DEFAULT 'default' NOT NULL,
  "full_backfill_started_at" timestamp,
  "full_backfill_completed_at" timestamp,
  "full_backfill_cursor_date" date,
  "full_backfill_cursor_project_id" uuid,
  "full_backfill_cursor_provider" varchar(32),
  "full_backfill_cursor_currency" varchar(12),
  "incremental_cursor_updated_at" timestamp,
  "incremental_cursor_id" uuid,
  "last_exported_at" timestamp,
  "last_error" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

INSERT INTO "research_lake_revenue_export_checkpoints" ("id")
VALUES ('default')
ON CONFLICT ("id") DO NOTHING;
