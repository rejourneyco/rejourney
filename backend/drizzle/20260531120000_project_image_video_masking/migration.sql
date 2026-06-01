ALTER TABLE "projects"
  ADD COLUMN IF NOT EXISTS "image_video_masking" varchar(32) DEFAULT 'none' NOT NULL;--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'projects_image_video_masking_check'
  ) THEN
    ALTER TABLE "projects"
      ADD CONSTRAINT "projects_image_video_masking_check"
      CHECK ("image_video_masking" IN ('none', 'all'));
  END IF;
END $$;
