ALTER TABLE "projects" RENAME COLUMN "replay_sample_rate" TO "healthy_replays_promoted";--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "healthy_replays_promoted" SET DEFAULT 0.05;