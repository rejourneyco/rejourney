CREATE INDEX "sessions_visitor_identity_started_idx"
    ON "sessions" (
        "project_id",
        coalesce("device_id", "anonymous_hash", "user_display_id"),
        "started_at",
        "id"
    );
