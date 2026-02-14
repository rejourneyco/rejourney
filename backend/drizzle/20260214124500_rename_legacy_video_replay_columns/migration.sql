DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'sessions'
          AND column_name = 'segment_count'
    ) THEN
        ALTER TABLE "sessions" RENAME COLUMN "segment_count" TO "replay_segment_count";
    END IF;
END
$$;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'sessions'
          AND column_name = 'video_storage_bytes'
    ) THEN
        ALTER TABLE "sessions" RENAME COLUMN "video_storage_bytes" TO "replay_storage_bytes";
    END IF;
END
$$;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname = 'recording_artifacts_video_idx'
    ) THEN
        ALTER INDEX "recording_artifacts_video_idx" RENAME TO "recording_artifacts_kind_idx";
    END IF;
END
$$;
