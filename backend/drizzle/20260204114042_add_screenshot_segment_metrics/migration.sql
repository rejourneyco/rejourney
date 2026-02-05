-- Add screenshot segment metrics columns to session_metrics
-- These columns track screenshot-based capture (iOS SDK) separately from video

ALTER TABLE "session_metrics" ADD COLUMN IF NOT EXISTS "screenshot_segment_count" integer DEFAULT 0;
ALTER TABLE "session_metrics" ADD COLUMN IF NOT EXISTS "screenshot_total_bytes" bigint DEFAULT 0;

-- Create index for efficient querying by screenshot segment count
CREATE INDEX IF NOT EXISTS "session_metrics_screenshot_segment_count_idx" ON "session_metrics" ("screenshot_segment_count");
