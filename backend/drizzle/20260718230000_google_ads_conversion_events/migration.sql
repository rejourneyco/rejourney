ALTER TABLE "users"
    ADD COLUMN IF NOT EXISTS "google_ads_consent_granted_at" timestamp,
    ADD COLUMN IF NOT EXISTS "google_ads_consent_version" varchar(32),
    ADD COLUMN IF NOT EXISTS "signup_completed_at" timestamp;

ALTER TABLE "otp_tokens"
    ADD COLUMN IF NOT EXISTS "google_ads_attribution" jsonb,
    ADD COLUMN IF NOT EXISTS "google_ads_consent_granted_at" timestamp,
    ADD COLUMN IF NOT EXISTS "google_ads_consent_version" varchar(32);

CREATE TABLE IF NOT EXISTS "google_ads_conversion_events" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "event_name" varchar(64) NOT NULL,
    "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "team_id" uuid REFERENCES "teams"("id") ON DELETE SET NULL,
    "project_id" uuid REFERENCES "projects"("id") ON DELETE SET NULL,
    "transaction_id" varchar(255) NOT NULL,
    "event_source" varchar(32) DEFAULT 'OTHER' NOT NULL,
    "occurred_at" timestamp NOT NULL,
    "value_cents" integer,
    "currency" varchar(3),
    "consent_granted" boolean DEFAULT false NOT NULL,
    "status" varchar(32) DEFAULT 'pending' NOT NULL,
    "attempts" integer DEFAULT 0 NOT NULL,
    "next_attempt_at" timestamp DEFAULT now() NOT NULL,
    "last_attempt_at" timestamp,
    "accepted_at" timestamp,
    "processed_at" timestamp,
    "google_request_id" varchar(255),
    "last_error" text,
    "diagnostics" jsonb,
    "metadata" jsonb,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "google_ads_conversion_events_transaction_id_unique"
    ON "google_ads_conversion_events" ("transaction_id");
CREATE INDEX IF NOT EXISTS "google_ads_conversion_events_delivery_idx"
    ON "google_ads_conversion_events" ("status", "next_attempt_at");
CREATE INDEX IF NOT EXISTS "google_ads_conversion_events_user_event_idx"
    ON "google_ads_conversion_events" ("user_id", "event_name", "occurred_at");
CREATE INDEX IF NOT EXISTS "google_ads_conversion_events_request_idx"
    ON "google_ads_conversion_events" ("google_request_id");
