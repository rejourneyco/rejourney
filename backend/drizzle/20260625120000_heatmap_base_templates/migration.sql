CREATE TABLE IF NOT EXISTS "heatmap_base_templates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE cascade,
  "screen_name" text NOT NULL,
  "platform_scope" varchar(20) DEFAULT 'all' NOT NULL,
  "app_version_scope" varchar(120) DEFAULT 'all' NOT NULL,
  "source_session_id" varchar(64) REFERENCES "sessions"("id") ON DELETE set null,
  "source_timestamp_ms" bigint NOT NULL,
  "image_s3_object_key" text NOT NULL,
  "image_endpoint_id" varchar(255),
  "image_size_bytes" integer,
  "page_width" integer,
  "page_height" integer,
  "viewport_width" integer,
  "viewport_height" integer,
  "created_by_user_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "updated_by_user_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "heatmap_base_templates_scope_unique"
  ON "heatmap_base_templates" ("project_id", "screen_name", "platform_scope", "app_version_scope");

CREATE INDEX IF NOT EXISTS "heatmap_base_templates_project_screen_idx"
  ON "heatmap_base_templates" ("project_id", "screen_name");

CREATE INDEX IF NOT EXISTS "heatmap_base_templates_source_session_idx"
  ON "heatmap_base_templates" ("source_session_id");
