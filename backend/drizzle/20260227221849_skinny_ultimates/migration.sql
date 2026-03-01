ALTER TABLE "app_all_time_stats" ADD COLUMN "custom_event_breakdown" json DEFAULT '{}';--> statement-breakpoint
ALTER TABLE "app_daily_stats" ADD COLUMN "custom_event_breakdown" json DEFAULT '{}';