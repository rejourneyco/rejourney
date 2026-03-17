ALTER TABLE "project_usage" ADD COLUMN "successful_recordings" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "successful_recording_counted_at" timestamp;
--> statement-breakpoint
UPDATE "sessions" AS s
SET "successful_recording_counted_at" = COALESCE(s."replay_promoted_at", s."ended_at", s."updated_at", s."created_at")
WHERE s."successful_recording_counted_at" IS NULL
  AND (
    COALESCE(s."replay_promoted", false) = true
    OR EXISTS (
      SELECT 1
      FROM "session_metrics" AS sm
      WHERE sm."session_id" = s."id"
        AND COALESCE(sm."screenshot_segment_count", 0) > 0
    )
  );
--> statement-breakpoint
WITH successful_sessions AS (
    SELECT
        s."project_id" AS project_id,
        CASE
            WHEN t."billing_cycle_anchor" IS NULL THEN TO_CHAR(DATE_TRUNC('month', s."started_at"), 'YYYY-MM')
            ELSE TO_CHAR(
                (
                    t."billing_cycle_anchor"
                    + (
                        FLOOR(EXTRACT(EPOCH FROM (s."started_at" - t."billing_cycle_anchor")) / 2592000)::int
                        * INTERVAL '30 day'
                    )
                )::date,
                'YYYY-MM-DD'
            )
        END AS period,
        COUNT(*)::int AS successful_recordings
    FROM "sessions" AS s
    INNER JOIN "projects" AS p
        ON p."id" = s."project_id"
    INNER JOIN "teams" AS t
        ON t."id" = p."team_id"
    LEFT JOIN "session_metrics" AS sm
        ON sm."session_id" = s."id"
    WHERE COALESCE(sm."screenshot_segment_count", 0) > 0
       OR COALESCE(s."replay_promoted", false) = true
    GROUP BY 1, 2
)
INSERT INTO "project_usage" ("project_id", "period", "successful_recordings", "storage_bytes", "requests", "quota_version")
SELECT
    project_id,
    period,
    successful_recordings,
    0,
    0,
    1
FROM successful_sessions
ON CONFLICT ("project_id", "period", "quota_version")
DO UPDATE SET
    "successful_recordings" = EXCLUDED."successful_recordings",
    "updated_at" = NOW();
