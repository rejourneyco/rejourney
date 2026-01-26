CREATE TABLE "abuse_signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"device_id" uuid,
	"session_id" varchar(64),
	"signal_type" varchar(50) NOT NULL,
	"severity" varchar(20) NOT NULL,
	"metadata" json,
	"detected_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alert_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"project_id" uuid NOT NULL,
	"alert_type" varchar(50) NOT NULL,
	"fingerprint" varchar(255),
	"recipient_count" integer DEFAULT 1 NOT NULL,
	"sent_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alert_recipients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alert_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"project_id" uuid NOT NULL,
	"crash_alerts_enabled" boolean DEFAULT true NOT NULL,
	"anr_alerts_enabled" boolean DEFAULT true NOT NULL,
	"error_spike_alerts_enabled" boolean DEFAULT true NOT NULL,
	"api_degradation_alerts_enabled" boolean DEFAULT true NOT NULL,
	"error_spike_threshold_percent" integer DEFAULT 50,
	"api_degradation_threshold_percent" integer DEFAULT 100,
	"api_latency_threshold_ms" integer DEFAULT 3000,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "anrs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"session_id" varchar(64),
	"project_id" uuid NOT NULL,
	"timestamp" timestamp NOT NULL,
	"duration_ms" integer NOT NULL,
	"thread_state" text,
	"s3_object_key" text,
	"device_metadata" json,
	"status" varchar(20) DEFAULT 'open' NOT NULL,
	"occurrence_count" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_endpoint_daily_stats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"project_id" uuid NOT NULL,
	"date" date NOT NULL,
	"endpoint" text NOT NULL,
	"region" varchar(50) DEFAULT 'unknown' NOT NULL,
	"total_calls" bigint DEFAULT 0 NOT NULL,
	"total_errors" bigint DEFAULT 0 NOT NULL,
	"sum_latency_ms" bigint DEFAULT 0 NOT NULL,
	"p50_latency_ms" integer,
	"p90_latency_ms" integer,
	"p99_latency_ms" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"project_id" uuid NOT NULL,
	"hashed_key" varchar(255) NOT NULL,
	"name" varchar(255),
	"masked_key" varchar(50) NOT NULL,
	"scopes" text[] DEFAULT ARRAY['ingest']::text[],
	"last_used_at" timestamp,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_all_time_stats" (
	"project_id" uuid PRIMARY KEY,
	"total_sessions" bigint DEFAULT 0,
	"total_users" bigint DEFAULT 0,
	"total_events" bigint DEFAULT 0,
	"total_errors" bigint DEFAULT 0,
	"avg_session_duration_seconds" double precision DEFAULT 0,
	"avg_interaction_score" double precision DEFAULT 0,
	"avg_ux_score" double precision DEFAULT 0,
	"avg_api_error_rate" double precision DEFAULT 0,
	"total_rage_taps" bigint DEFAULT 0,
	"total_bouncers" bigint DEFAULT 0,
	"total_casuals" bigint DEFAULT 0,
	"total_explorers" bigint DEFAULT 0,
	"total_loyalists" bigint DEFAULT 0,
	"total_touches" bigint DEFAULT 0,
	"total_scrolls" bigint DEFAULT 0,
	"total_gestures" bigint DEFAULT 0,
	"total_interactions" bigint DEFAULT 0,
	"device_model_breakdown" json DEFAULT '{}',
	"os_version_breakdown" json DEFAULT '{}',
	"platform_breakdown" json DEFAULT '{}',
	"app_version_breakdown" json DEFAULT '{}',
	"screen_view_breakdown" json DEFAULT '{}',
	"screen_transition_breakdown" json DEFAULT '{}',
	"entry_screen_breakdown" json DEFAULT '{}',
	"exit_screen_breakdown" json DEFAULT '{}',
	"geo_country_breakdown" json DEFAULT '{}',
	"unique_user_count" bigint DEFAULT 0,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_daily_stats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"project_id" uuid NOT NULL,
	"date" date NOT NULL,
	"total_sessions" integer DEFAULT 0 NOT NULL,
	"completed_sessions" integer DEFAULT 0 NOT NULL,
	"avg_duration_seconds" double precision,
	"avg_interaction_score" double precision,
	"avg_ux_score" double precision,
	"avg_api_error_rate" double precision,
	"avg_api_response_ms" double precision,
	"p50_duration" double precision,
	"p90_duration" double precision,
	"p50_interaction_score" double precision,
	"p90_interaction_score" double precision,
	"total_errors" integer DEFAULT 0 NOT NULL,
	"total_rage_taps" integer DEFAULT 0 NOT NULL,
	"total_crashes" integer DEFAULT 0 NOT NULL,
	"total_anrs" integer DEFAULT 0 NOT NULL,
	"total_bouncers" integer DEFAULT 0 NOT NULL,
	"total_casuals" integer DEFAULT 0 NOT NULL,
	"total_explorers" integer DEFAULT 0 NOT NULL,
	"total_loyalists" integer DEFAULT 0 NOT NULL,
	"total_touches" integer DEFAULT 0 NOT NULL,
	"total_scrolls" integer DEFAULT 0 NOT NULL,
	"total_gestures" integer DEFAULT 0 NOT NULL,
	"total_interactions" integer DEFAULT 0 NOT NULL,
	"device_model_breakdown" json DEFAULT '{}',
	"os_version_breakdown" json DEFAULT '{}',
	"platform_breakdown" json DEFAULT '{}',
	"app_version_breakdown" json DEFAULT '{}',
	"screen_view_breakdown" json DEFAULT '{}',
	"screen_transition_breakdown" json DEFAULT '{}',
	"entry_screen_breakdown" json DEFAULT '{}',
	"exit_screen_breakdown" json DEFAULT '{}',
	"geo_country_breakdown" json DEFAULT '{}',
	"unique_user_count" integer DEFAULT 0 NOT NULL,
	"unique_user_ids" json DEFAULT '[]'
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" uuid,
	"team_id" uuid,
	"action" varchar(100) NOT NULL,
	"target_type" varchar(50),
	"target_id" varchar(100),
	"previous_value" json,
	"new_value" json,
	"ip_address" varchar(45),
	"user_agent" text,
	"metadata" json,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"team_id" uuid,
	"user_id" uuid,
	"type" varchar(50) NOT NULL,
	"period" varchar(10) NOT NULL,
	"metadata" json,
	"sent_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"team_id" uuid NOT NULL,
	"period" varchar(10) NOT NULL,
	"sessions" integer DEFAULT 0 NOT NULL,
	"storage_bytes" bigint DEFAULT 0 NOT NULL,
	"requests" integer DEFAULT 0 NOT NULL,
	"amount_cents" integer,
	"quota_version" integer DEFAULT 1 NOT NULL,
	"computed_at" timestamp,
	"invoice_status" varchar(20),
	"invoice_url" text
);
--> statement-breakpoint
CREATE TABLE "crashes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"session_id" varchar(64),
	"project_id" uuid NOT NULL,
	"timestamp" timestamp NOT NULL,
	"exception_name" varchar(255) NOT NULL,
	"reason" text,
	"stack_trace" text,
	"fingerprint" varchar(64),
	"s3_object_key" text,
	"device_metadata" json,
	"status" varchar(20) DEFAULT 'open' NOT NULL,
	"occurrence_count" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device_registrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"device_credential_id" varchar(255) NOT NULL UNIQUE,
	"project_id" uuid NOT NULL,
	"bundle_id" varchar(255) NOT NULL,
	"package_name" varchar(255),
	"platform" varchar(20) NOT NULL,
	"sdk_version" varchar(50) NOT NULL,
	"device_public_key" text NOT NULL,
	"device_label" varchar(255),
	"registered_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	"revoked_at" timestamp,
	"revoke_reason" varchar(255)
);
--> statement-breakpoint
CREATE TABLE "device_trust_scores" (
	"device_id" uuid PRIMARY KEY,
	"score" double precision DEFAULT 1 NOT NULL,
	"flags" json DEFAULT '{}',
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device_usage" (
	"device_id" uuid,
	"period" date,
	"bytes_uploaded" bigint DEFAULT 0 NOT NULL,
	"minutes_recorded" integer DEFAULT 0 NOT NULL,
	"sessions_started" integer DEFAULT 0 NOT NULL,
	"request_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "device_usage_pkey" PRIMARY KEY("device_id","period")
);
--> statement-breakpoint
CREATE TABLE "email_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"project_id" uuid NOT NULL,
	"recipient_email" varchar(255) NOT NULL,
	"recipient_name" varchar(255),
	"alert_type" varchar(50) NOT NULL,
	"subject" varchar(500) NOT NULL,
	"issue_title" varchar(500),
	"issue_id" uuid,
	"status" varchar(20) DEFAULT 'sent' NOT NULL,
	"error_message" text,
	"sent_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "errors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"session_id" varchar(64),
	"project_id" uuid NOT NULL,
	"timestamp" timestamp NOT NULL,
	"error_type" varchar(50) NOT NULL,
	"error_name" varchar(255) NOT NULL,
	"message" text NOT NULL,
	"stack" text,
	"screen_name" varchar(255),
	"component_name" varchar(255),
	"device_model" varchar(100),
	"os_version" varchar(50),
	"app_version" varchar(50),
	"fingerprint" varchar(64),
	"occurrence_count" integer DEFAULT 1 NOT NULL,
	"status" varchar(20) DEFAULT 'open' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingest_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"project_id" uuid NOT NULL,
	"session_id" varchar(64),
	"artifact_id" uuid,
	"kind" varchar(50),
	"payload_ref" text,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_run_at" timestamp,
	"error_msg" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issue_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"issue_id" uuid NOT NULL,
	"session_id" varchar(64),
	"timestamp" timestamp NOT NULL,
	"screen_name" varchar(255),
	"user_id" varchar(255),
	"device_model" varchar(100),
	"os_version" varchar(50),
	"app_version" varchar(50),
	"error_message" text,
	"stack_trace" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"project_id" uuid NOT NULL,
	"short_id" varchar(50) NOT NULL,
	"fingerprint" varchar(255) NOT NULL,
	"issue_type" varchar(20) DEFAULT 'error' NOT NULL,
	"title" varchar(500) NOT NULL,
	"subtitle" text,
	"culprit" varchar(500),
	"screen_name" varchar(255),
	"component_name" varchar(255),
	"status" varchar(20) DEFAULT 'unresolved' NOT NULL,
	"is_handled" boolean DEFAULT true,
	"assignee_id" uuid,
	"priority" varchar(20) DEFAULT 'medium',
	"environment" varchar(50),
	"first_seen" timestamp DEFAULT now() NOT NULL,
	"last_seen" timestamp DEFAULT now() NOT NULL,
	"event_count" bigint DEFAULT 1 NOT NULL,
	"user_count" integer DEFAULT 1 NOT NULL,
	"events_24h" integer DEFAULT 0 NOT NULL,
	"events_90d" integer DEFAULT 0 NOT NULL,
	"sample_session_id" varchar(64),
	"sample_stack_trace" text,
	"sample_device_model" varchar(100),
	"sample_os_version" varchar(50),
	"sample_app_version" varchar(50),
	"daily_events" json DEFAULT '{}',
	"affected_versions" json DEFAULT '{}',
	"affected_devices" json DEFAULT '{}',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "otp_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" uuid,
	"email" varchar(255) NOT NULL,
	"code_hash" varchar(255) NOT NULL,
	"expires_at" timestamp NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_funnel_stats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"project_id" uuid NOT NULL,
	"funnel_path" text[] NOT NULL,
	"target_screen" varchar(255) NOT NULL,
	"confidence" double precision DEFAULT 0 NOT NULL,
	"sample_size" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"project_id" uuid NOT NULL,
	"period" varchar(10) NOT NULL,
	"sessions" integer DEFAULT 0 NOT NULL,
	"storage_bytes" bigint DEFAULT 0 NOT NULL,
	"requests" integer DEFAULT 0 NOT NULL,
	"quota_version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"team_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"platform" varchar(50),
	"bundle_id" varchar(255),
	"package_name" varchar(255),
	"web_domain" varchar(255),
	"public_key" varchar(64) NOT NULL,
	"sample_rate" integer DEFAULT 100 NOT NULL,
	"rejourney_enabled" boolean DEFAULT true NOT NULL,
	"recording_enabled" boolean DEFAULT true NOT NULL,
	"max_recording_minutes" integer DEFAULT 10 NOT NULL,
	"replay_sample_rate" double precision DEFAULT 0 NOT NULL,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quotas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"team_id" uuid NOT NULL,
	"plan" varchar(50),
	"session_limit" integer,
	"storage_cap" bigint,
	"request_cap" integer,
	"effective_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recording_artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"session_id" varchar(64) NOT NULL,
	"kind" varchar(50) NOT NULL,
	"s3_object_key" text NOT NULL,
	"size_bytes" integer,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"ready_at" timestamp,
	"timestamp" double precision,
	"start_time" bigint,
	"end_time" bigint,
	"frame_count" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "retention_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"tier" integer NOT NULL UNIQUE,
	"retention_days" integer NOT NULL,
	"effective_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "screen_touch_heatmaps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"project_id" uuid NOT NULL,
	"screen_name" varchar(255) NOT NULL,
	"date" date NOT NULL,
	"touch_buckets" json DEFAULT '{}',
	"rage_tap_buckets" json DEFAULT '{}',
	"total_touches" integer DEFAULT 0 NOT NULL,
	"total_rage_taps" integer DEFAULT 0 NOT NULL,
	"sample_session_id" varchar(64),
	"screen_first_seen_ms" bigint,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"session_id" varchar(64) NOT NULL UNIQUE,
	"total_events" integer DEFAULT 0 NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"touch_count" integer DEFAULT 0 NOT NULL,
	"scroll_count" integer DEFAULT 0 NOT NULL,
	"gesture_count" integer DEFAULT 0 NOT NULL,
	"input_count" integer DEFAULT 0 NOT NULL,
	"api_success_count" integer DEFAULT 0 NOT NULL,
	"api_error_count" integer DEFAULT 0 NOT NULL,
	"api_total_count" integer DEFAULT 0 NOT NULL,
	"api_avg_response_ms" double precision DEFAULT 0 NOT NULL,
	"rage_tap_count" integer DEFAULT 0 NOT NULL,
	"screens_visited" text[] DEFAULT ARRAY[]::text[],
	"interaction_score" double precision DEFAULT 0 NOT NULL,
	"exploration_score" double precision DEFAULT 0 NOT NULL,
	"ux_score" double precision DEFAULT 0 NOT NULL,
	"events_size_bytes" integer DEFAULT 0 NOT NULL,
	"custom_event_count" integer DEFAULT 0 NOT NULL,
	"crash_count" integer DEFAULT 0 NOT NULL,
	"anr_count" integer DEFAULT 0 NOT NULL,
	"app_startup_time_ms" double precision,
	"network_type" varchar(20),
	"cellular_generation" varchar(10),
	"is_constrained" boolean DEFAULT false,
	"is_expensive" boolean DEFAULT false,
	"sdk_upload_success_count" integer DEFAULT 0,
	"sdk_upload_failure_count" integer DEFAULT 0,
	"sdk_retry_attempt_count" integer DEFAULT 0,
	"sdk_circuit_breaker_open_count" integer DEFAULT 0,
	"sdk_memory_eviction_count" integer DEFAULT 0,
	"sdk_offline_persist_count" integer DEFAULT 0,
	"sdk_upload_success_rate" double precision,
	"sdk_avg_upload_duration_ms" double precision,
	"sdk_total_bytes_uploaded" bigint,
	"sdk_total_bytes_evicted" bigint,
	"video_segment_count" integer DEFAULT 0,
	"video_total_bytes" bigint DEFAULT 0,
	"hierarchy_snapshot_count" integer DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" varchar(64) PRIMARY KEY,
	"project_id" uuid NOT NULL,
	"device_id" varchar(255),
	"platform" varchar(20),
	"app_version" varchar(50),
	"device_model" varchar(100),
	"os_version" text,
	"sdk_version" text,
	"user_display_id" varchar(255),
	"anonymous_hash" varchar(255),
	"anonymous_display_id" varchar(255),
	"started_at" timestamp DEFAULT now() NOT NULL,
	"ended_at" timestamp,
	"duration_seconds" integer,
	"background_time_seconds" integer DEFAULT 0,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"retention_tier" integer DEFAULT 1 NOT NULL,
	"retention_days" integer DEFAULT 7 NOT NULL,
	"recording_deleted" boolean DEFAULT false NOT NULL,
	"recording_deleted_at" timestamp,
	"is_replay_expired" boolean DEFAULT false NOT NULL,
	"replay_promoted" boolean DEFAULT false NOT NULL,
	"replay_promoted_reason" varchar(50),
	"replay_promoted_at" timestamp,
	"geo_city" varchar(100),
	"geo_region" varchar(100),
	"geo_country" varchar(100),
	"geo_country_code" varchar(10),
	"geo_latitude" double precision,
	"geo_longitude" double precision,
	"geo_timezone" varchar(100),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"segment_count" integer DEFAULT 0,
	"video_storage_bytes" bigint DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE "storage_endpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"project_id" uuid,
	"endpoint_url" text NOT NULL,
	"bucket" varchar(255) NOT NULL,
	"region" varchar(50),
	"access_key_id" varchar(255),
	"key_ref" varchar(255),
	"role_arn" varchar(255),
	"kms_key_id" varchar(255),
	"priority" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"shadow" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stripe_webhook_events" (
	"id" varchar(255) PRIMARY KEY,
	"type" varchar(100) NOT NULL,
	"processed_at" timestamp DEFAULT now() NOT NULL,
	"metadata" json
);
--> statement-breakpoint
CREATE TABLE "team_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"team_id" uuid NOT NULL,
	"email" varchar(255) NOT NULL,
	"role" varchar(50) DEFAULT 'member' NOT NULL,
	"token" varchar(64) NOT NULL UNIQUE,
	"invited_by" uuid NOT NULL,
	"expires_at" timestamp NOT NULL,
	"accepted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"team_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" varchar(50) DEFAULT 'member' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"owner_user_id" uuid NOT NULL,
	"name" varchar(255),
	"stripe_customer_id" varchar(255),
	"stripe_payment_method_id" varchar(255),
	"stripe_subscription_id" varchar(255),
	"stripe_price_id" varchar(255),
	"billing_email" varchar(255),
	"billing_cycle_anchor" timestamp,
	"payment_failed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ui_workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"workspace_key" text DEFAULT 'default' NOT NULL,
	"tabs" json NOT NULL,
	"active_tab_id" text,
	"recently_closed" json DEFAULT '[]' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" uuid NOT NULL,
	"token" varchar(255) NOT NULL UNIQUE,
	"user_agent" text,
	"ip_address" varchar(45),
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"email" varchar(255) NOT NULL UNIQUE,
	"display_name" varchar(255),
	"avatar_url" text,
	"auth_provider" varchar(50),
	"provider_user_id" varchar(255),
	"roles" text[] DEFAULT ARRAY['user']::text[],
	"last_data_export_at" timestamp,
	"registration_ip" varchar(45),
	"registration_user_agent" text,
	"registration_timezone" varchar(100),
	"browser_fingerprint" varchar(64),
	"screen_resolution" varchar(20),
	"language_preference" varchar(50),
	"registration_platform" varchar(50),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "abuse_signals_device_idx" ON "abuse_signals" ("device_id","detected_at");--> statement-breakpoint
CREATE INDEX "abuse_signals_session_idx" ON "abuse_signals" ("session_id");--> statement-breakpoint
CREATE INDEX "abuse_signals_severity_idx" ON "abuse_signals" ("severity","detected_at");--> statement-breakpoint
CREATE INDEX "alert_history_project_type_idx" ON "alert_history" ("project_id","alert_type","sent_at");--> statement-breakpoint
CREATE INDEX "alert_history_fingerprint_idx" ON "alert_history" ("project_id","fingerprint","sent_at");--> statement-breakpoint
CREATE UNIQUE INDEX "alert_recipients_project_user_unique" ON "alert_recipients" ("project_id","user_id");--> statement-breakpoint
CREATE INDEX "alert_recipients_project_idx" ON "alert_recipients" ("project_id");--> statement-breakpoint
CREATE INDEX "anrs_project_idx" ON "anrs" ("project_id");--> statement-breakpoint
CREATE INDEX "anrs_session_idx" ON "anrs" ("session_id");--> statement-breakpoint
CREATE INDEX "anrs_status_idx" ON "anrs" ("status");--> statement-breakpoint
CREATE INDEX "anrs_timestamp_idx" ON "anrs" ("timestamp");--> statement-breakpoint
CREATE UNIQUE INDEX "api_endpoint_daily_stats_project_date_endpoint_region_unique" ON "api_endpoint_daily_stats" ("project_id","date","endpoint","region");--> statement-breakpoint
CREATE INDEX "api_endpoint_daily_stats_project_date_idx" ON "api_endpoint_daily_stats" ("project_id","date");--> statement-breakpoint
CREATE INDEX "api_endpoint_daily_stats_region_idx" ON "api_endpoint_daily_stats" ("project_id","region");--> statement-breakpoint
CREATE INDEX "api_keys_hashed_key_idx" ON "api_keys" ("hashed_key");--> statement-breakpoint
CREATE INDEX "api_keys_project_id_idx" ON "api_keys" ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "app_daily_stats_project_date_unique" ON "app_daily_stats" ("project_id","date");--> statement-breakpoint
CREATE INDEX "audit_logs_user_id_idx" ON "audit_logs" ("user_id");--> statement-breakpoint
CREATE INDEX "audit_logs_team_id_idx" ON "audit_logs" ("team_id");--> statement-breakpoint
CREATE INDEX "audit_logs_action_idx" ON "audit_logs" ("action");--> statement-breakpoint
CREATE INDEX "audit_logs_target_idx" ON "audit_logs" ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs" ("created_at");--> statement-breakpoint
CREATE INDEX "billing_notifications_team_period_idx" ON "billing_notifications" ("team_id","period");--> statement-breakpoint
CREATE INDEX "billing_notifications_user_period_idx" ON "billing_notifications" ("user_id","period");--> statement-breakpoint
CREATE INDEX "billing_notifications_type_idx" ON "billing_notifications" ("type");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_usage_team_period_unique" ON "billing_usage" ("team_id","period");--> statement-breakpoint
CREATE INDEX "crashes_project_idx" ON "crashes" ("project_id");--> statement-breakpoint
CREATE INDEX "crashes_session_idx" ON "crashes" ("session_id");--> statement-breakpoint
CREATE INDEX "crashes_status_idx" ON "crashes" ("status");--> statement-breakpoint
CREATE INDEX "crashes_timestamp_idx" ON "crashes" ("timestamp");--> statement-breakpoint
CREATE INDEX "crashes_fingerprint_idx" ON "crashes" ("fingerprint");--> statement-breakpoint
CREATE UNIQUE INDEX "device_registrations_credential_idx" ON "device_registrations" ("device_credential_id");--> statement-breakpoint
CREATE INDEX "device_registrations_project_idx" ON "device_registrations" ("project_id");--> statement-breakpoint
CREATE INDEX "device_registrations_last_seen_idx" ON "device_registrations" ("last_seen_at");--> statement-breakpoint
CREATE UNIQUE INDEX "device_registrations_project_pubkey_unique" ON "device_registrations" ("project_id","device_public_key");--> statement-breakpoint
CREATE INDEX "device_usage_period_idx" ON "device_usage" ("period");--> statement-breakpoint
CREATE INDEX "email_logs_project_idx" ON "email_logs" ("project_id","sent_at");--> statement-breakpoint
CREATE INDEX "email_logs_recipient_idx" ON "email_logs" ("project_id","recipient_email");--> statement-breakpoint
CREATE INDEX "email_logs_type_idx" ON "email_logs" ("project_id","alert_type");--> statement-breakpoint
CREATE INDEX "errors_project_idx" ON "errors" ("project_id");--> statement-breakpoint
CREATE INDEX "errors_session_idx" ON "errors" ("session_id");--> statement-breakpoint
CREATE INDEX "errors_timestamp_idx" ON "errors" ("timestamp");--> statement-breakpoint
CREATE INDEX "errors_status_idx" ON "errors" ("status");--> statement-breakpoint
CREATE INDEX "errors_fingerprint_idx" ON "errors" ("fingerprint");--> statement-breakpoint
CREATE INDEX "errors_error_type_idx" ON "errors" ("error_type");--> statement-breakpoint
CREATE INDEX "ingest_jobs_status_next_run_idx" ON "ingest_jobs" ("status","next_run_at");--> statement-breakpoint
CREATE INDEX "ingest_jobs_project_id_idx" ON "ingest_jobs" ("project_id");--> statement-breakpoint
CREATE INDEX "issue_events_issue_idx" ON "issue_events" ("issue_id","timestamp");--> statement-breakpoint
CREATE INDEX "issue_events_session_idx" ON "issue_events" ("session_id");--> statement-breakpoint
CREATE INDEX "issue_events_timestamp_idx" ON "issue_events" ("timestamp");--> statement-breakpoint
CREATE UNIQUE INDEX "issues_project_fingerprint_unique" ON "issues" ("project_id","fingerprint");--> statement-breakpoint
CREATE INDEX "issues_project_status_idx" ON "issues" ("project_id","status");--> statement-breakpoint
CREATE INDEX "issues_project_type_idx" ON "issues" ("project_id","issue_type");--> statement-breakpoint
CREATE INDEX "issues_last_seen_idx" ON "issues" ("last_seen");--> statement-breakpoint
CREATE INDEX "issues_first_seen_idx" ON "issues" ("first_seen");--> statement-breakpoint
CREATE INDEX "issues_event_count_idx" ON "issues" ("event_count");--> statement-breakpoint
CREATE INDEX "issues_assignee_idx" ON "issues" ("assignee_id");--> statement-breakpoint
CREATE INDEX "issues_priority_idx" ON "issues" ("priority");--> statement-breakpoint
CREATE INDEX "issues_short_id_idx" ON "issues" ("project_id","short_id");--> statement-breakpoint
CREATE INDEX "otp_tokens_email_idx" ON "otp_tokens" ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "project_funnel_stats_project_unique" ON "project_funnel_stats" ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_usage_project_period_version_unique" ON "project_usage" ("project_id","period","quota_version");--> statement-breakpoint
CREATE INDEX "projects_team_id_idx" ON "projects" ("team_id");--> statement-breakpoint
CREATE INDEX "projects_public_key_idx" ON "projects" ("public_key");--> statement-breakpoint
CREATE INDEX "quotas_team_id_idx" ON "quotas" ("team_id");--> statement-breakpoint
CREATE INDEX "recording_artifacts_session_id_idx" ON "recording_artifacts" ("session_id");--> statement-breakpoint
CREATE INDEX "recording_artifacts_video_idx" ON "recording_artifacts" ("session_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "screen_touch_heatmaps_unique" ON "screen_touch_heatmaps" ("project_id","screen_name","date");--> statement-breakpoint
CREATE INDEX "screen_touch_heatmaps_project_date_idx" ON "screen_touch_heatmaps" ("project_id","date");--> statement-breakpoint
CREATE INDEX "screen_touch_heatmaps_screen_idx" ON "screen_touch_heatmaps" ("project_id","screen_name");--> statement-breakpoint
CREATE INDEX "sessions_project_started_idx" ON "sessions" ("project_id","started_at");--> statement-breakpoint
CREATE INDEX "sessions_status_idx" ON "sessions" ("status");--> statement-breakpoint
CREATE INDEX "sessions_user_display_id_idx" ON "sessions" ("user_display_id");--> statement-breakpoint
CREATE INDEX "sessions_anonymous_hash_idx" ON "sessions" ("anonymous_hash");--> statement-breakpoint
CREATE INDEX "stripe_webhook_events_type_idx" ON "stripe_webhook_events" ("type");--> statement-breakpoint
CREATE INDEX "team_invitations_token_idx" ON "team_invitations" ("token");--> statement-breakpoint
CREATE INDEX "team_invitations_email_idx" ON "team_invitations" ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "team_members_team_user_unique" ON "team_members" ("team_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ui_workspaces_unique" ON "ui_workspaces" ("user_id","team_id","project_id","workspace_key");--> statement-breakpoint
CREATE INDEX "ui_workspaces_project_idx" ON "ui_workspaces" ("project_id");--> statement-breakpoint
CREATE INDEX "ui_workspaces_user_idx" ON "ui_workspaces" ("user_id");--> statement-breakpoint
CREATE INDEX "user_sessions_user_id_idx" ON "user_sessions" ("user_id");--> statement-breakpoint
CREATE INDEX "user_sessions_token_idx" ON "user_sessions" ("token");--> statement-breakpoint
ALTER TABLE "abuse_signals" ADD CONSTRAINT "abuse_signals_device_id_device_registrations_id_fkey" FOREIGN KEY ("device_id") REFERENCES "device_registrations"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "abuse_signals" ADD CONSTRAINT "abuse_signals_session_id_sessions_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "alert_history" ADD CONSTRAINT "alert_history_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "alert_recipients" ADD CONSTRAINT "alert_recipients_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "alert_recipients" ADD CONSTRAINT "alert_recipients_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "alert_settings" ADD CONSTRAINT "alert_settings_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "anrs" ADD CONSTRAINT "anrs_session_id_sessions_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "anrs" ADD CONSTRAINT "anrs_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "api_endpoint_daily_stats" ADD CONSTRAINT "api_endpoint_daily_stats_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "app_all_time_stats" ADD CONSTRAINT "app_all_time_stats_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "app_daily_stats" ADD CONSTRAINT "app_daily_stats_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_team_id_teams_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "billing_notifications" ADD CONSTRAINT "billing_notifications_team_id_teams_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "billing_notifications" ADD CONSTRAINT "billing_notifications_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "billing_usage" ADD CONSTRAINT "billing_usage_team_id_teams_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id");--> statement-breakpoint
ALTER TABLE "crashes" ADD CONSTRAINT "crashes_session_id_sessions_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "crashes" ADD CONSTRAINT "crashes_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "device_registrations" ADD CONSTRAINT "device_registrations_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "device_trust_scores" ADD CONSTRAINT "device_trust_scores_device_id_device_registrations_id_fkey" FOREIGN KEY ("device_id") REFERENCES "device_registrations"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "device_usage" ADD CONSTRAINT "device_usage_device_id_device_registrations_id_fkey" FOREIGN KEY ("device_id") REFERENCES "device_registrations"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "email_logs" ADD CONSTRAINT "email_logs_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "email_logs" ADD CONSTRAINT "email_logs_issue_id_issues_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "issues"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "errors" ADD CONSTRAINT "errors_session_id_sessions_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "errors" ADD CONSTRAINT "errors_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "ingest_jobs" ADD CONSTRAINT "ingest_jobs_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id");--> statement-breakpoint
ALTER TABLE "ingest_jobs" ADD CONSTRAINT "ingest_jobs_artifact_id_recording_artifacts_id_fkey" FOREIGN KEY ("artifact_id") REFERENCES "recording_artifacts"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "issue_events" ADD CONSTRAINT "issue_events_issue_id_issues_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "issues"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "issue_events" ADD CONSTRAINT "issue_events_session_id_sessions_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_assignee_id_users_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_sample_session_id_sessions_id_fkey" FOREIGN KEY ("sample_session_id") REFERENCES "sessions"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "otp_tokens" ADD CONSTRAINT "otp_tokens_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "project_funnel_stats" ADD CONSTRAINT "project_funnel_stats_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "project_usage" ADD CONSTRAINT "project_usage_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id");--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_team_id_teams_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id");--> statement-breakpoint
ALTER TABLE "quotas" ADD CONSTRAINT "quotas_team_id_teams_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id");--> statement-breakpoint
ALTER TABLE "recording_artifacts" ADD CONSTRAINT "recording_artifacts_session_id_sessions_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "screen_touch_heatmaps" ADD CONSTRAINT "screen_touch_heatmaps_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "session_metrics" ADD CONSTRAINT "session_metrics_session_id_sessions_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id");--> statement-breakpoint
ALTER TABLE "storage_endpoints" ADD CONSTRAINT "storage_endpoints_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id");--> statement-breakpoint
ALTER TABLE "team_invitations" ADD CONSTRAINT "team_invitations_team_id_teams_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "team_invitations" ADD CONSTRAINT "team_invitations_invited_by_users_id_fkey" FOREIGN KEY ("invited_by") REFERENCES "users"("id");--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_team_id_teams_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_owner_user_id_users_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id");--> statement-breakpoint
ALTER TABLE "ui_workspaces" ADD CONSTRAINT "ui_workspaces_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "ui_workspaces" ADD CONSTRAINT "ui_workspaces_team_id_teams_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "ui_workspaces" ADD CONSTRAINT "ui_workspaces_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;