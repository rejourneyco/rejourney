ALTER TABLE "ingest_jobs" ADD COLUMN "started_at" timestamp;--> statement-breakpoint
ALTER TABLE "ingest_jobs" ADD COLUMN "completed_at" timestamp;--> statement-breakpoint
ALTER TABLE "ingest_jobs" ADD COLUMN "worker_id" varchar(255);--> statement-breakpoint
ALTER TABLE "recording_artifacts" ADD COLUMN "client_upload_id" varchar(255);--> statement-breakpoint
ALTER TABLE "recording_artifacts" ADD COLUMN "declared_size_bytes" integer;--> statement-breakpoint
ALTER TABLE "recording_artifacts" ADD COLUMN "upload_completed_at" timestamp;--> statement-breakpoint
ALTER TABLE "recording_artifacts" ADD COLUMN "verified_at" timestamp;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "explicit_ended_at" timestamp;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "finalized_at" timestamp;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "last_ingest_activity_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "close_source" varchar(32);--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "replay_available" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "replay_available_at" timestamp;--> statement-breakpoint
UPDATE "sessions"
SET "last_ingest_activity_at" = COALESCE("updated_at", "ended_at", "started_at", NOW());--> statement-breakpoint
UPDATE "sessions" s
SET
  "replay_available" = true,
  "replay_available_at" = COALESCE(
    (
      SELECT MIN(ra."ready_at")
      FROM "recording_artifacts" ra
      WHERE ra."session_id" = s."id"
        AND ra."kind" = 'screenshots'
        AND ra."ready_at" IS NOT NULL
    ),
    s."replay_promoted_at",
    s."ended_at",
    s."started_at",
    s."created_at"
  )
WHERE COALESCE(s."replay_available", false) = false
  AND (
    COALESCE(s."replay_segment_count", 0) > 0
    OR EXISTS (
      SELECT 1
      FROM "session_metrics" sm
      WHERE sm."session_id" = s."id"
        AND COALESCE(sm."screenshot_segment_count", 0) > 0
    )
    OR EXISTS (
      SELECT 1
      FROM "recording_artifacts" ra
      WHERE ra."session_id" = s."id"
        AND ra."kind" = 'screenshots'
        AND ra."ready_at" IS NOT NULL
    )
  );--> statement-breakpoint
ALTER TABLE "sessions" DROP COLUMN "successful_recording_counted_at";--> statement-breakpoint
ALTER TABLE "project_usage" DROP COLUMN "successful_recordings";--> statement-breakpoint
WITH ranked_jobs AS (
  SELECT
    ctid,
    ROW_NUMBER() OVER (
      PARTITION BY "artifact_id"
      ORDER BY
        CASE "status"
          WHEN 'done' THEN 0
          WHEN 'processing' THEN 1
          WHEN 'pending' THEN 2
          WHEN 'dlq' THEN 3
          WHEN 'failed' THEN 4
          ELSE 5
        END,
        "updated_at" DESC NULLS LAST,
        "created_at" DESC NULLS LAST,
        "id" DESC
    ) AS rn
  FROM "ingest_jobs"
  WHERE "artifact_id" IS NOT NULL
)
DELETE FROM "ingest_jobs" ij
USING ranked_jobs r
WHERE ij.ctid = r.ctid
  AND r.rn > 1;--> statement-breakpoint
CREATE UNIQUE INDEX "ingest_jobs_artifact_id_unique" ON "ingest_jobs" ("artifact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "recording_artifacts_client_upload_id_unique" ON "recording_artifacts" ("client_upload_id");--> statement-breakpoint
CREATE INDEX "sessions_replay_available_idx" ON "sessions" ("replay_available","started_at");
