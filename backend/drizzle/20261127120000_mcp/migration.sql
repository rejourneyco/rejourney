-- MCP (AI client access). Additive only: new columns with defaults and new tables.

ALTER TABLE teams ADD COLUMN IF NOT EXISTS mcp_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE teams ADD COLUMN IF NOT EXISTS mcp_mask_identifiers boolean NOT NULL DEFAULT false;
ALTER TABLE teams ADD COLUMN IF NOT EXISTS mcp_credit_limit integer;
ALTER TABLE teams ADD COLUMN IF NOT EXISTS mcp_plan_name varchar(64);
ALTER TABLE teams ADD COLUMN IF NOT EXISTS mcp_limits_synced_at timestamp;

CREATE TABLE IF NOT EXISTS mcp_oauth_records (
    model varchar(40) NOT NULL,
    key varchar(256) NOT NULL,
    payload jsonb NOT NULL,
    grant_id varchar(128),
    uid varchar(128),
    user_code varchar(128),
    expires_at timestamp,
    consumed_at timestamp,
    created_at timestamp NOT NULL DEFAULT now(),
    PRIMARY KEY (model, key)
);
CREATE INDEX IF NOT EXISTS mcp_oauth_records_grant_idx ON mcp_oauth_records (grant_id) WHERE grant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS mcp_oauth_records_uid_idx ON mcp_oauth_records (model, uid) WHERE uid IS NOT NULL;
CREATE INDEX IF NOT EXISTS mcp_oauth_records_expires_idx ON mcp_oauth_records (expires_at) WHERE expires_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS mcp_grants (
    grant_id varchar(128) PRIMARY KEY,
    client_id text NOT NULL,
    client_name varchar(255),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    project_ids uuid[] NOT NULL,
    scopes text[] NOT NULL,
    created_at timestamp NOT NULL DEFAULT now(),
    last_used_at timestamp,
    revoked_at timestamp,
    revoked_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS mcp_grants_team_idx ON mcp_grants (team_id, created_at);
CREATE INDEX IF NOT EXISTS mcp_grants_user_idx ON mcp_grants (user_id);

CREATE TABLE IF NOT EXISTS mcp_call_log (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    grant_id varchar(128),
    user_id uuid,
    tool varchar(64) NOT NULL,
    credits integer NOT NULL DEFAULT 0,
    bytes integer NOT NULL DEFAULT 0,
    outcome varchar(32) NOT NULL,
    duration_ms integer NOT NULL DEFAULT 0,
    period varchar(10) NOT NULL,
    created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mcp_call_log_team_created_idx ON mcp_call_log (team_id, created_at);
CREATE INDEX IF NOT EXISTS mcp_call_log_grant_period_idx ON mcp_call_log (grant_id, period);
CREATE INDEX IF NOT EXISTS mcp_call_log_created_idx ON mcp_call_log (created_at);

CREATE TABLE IF NOT EXISTS mcp_usage_periods (
    scope_key varchar(80) NOT NULL,
    period varchar(10) NOT NULL,
    credits integer NOT NULL DEFAULT 0,
    calls integer NOT NULL DEFAULT 0,
    bytes bigint NOT NULL DEFAULT 0,
    alerted_percent integer NOT NULL DEFAULT 0,
    updated_at timestamp NOT NULL DEFAULT now(),
    PRIMARY KEY (scope_key, period)
);

-- The MCP server connects as its own role (created by the database operator
-- from the infra repo, not here). When that role exists, give it exactly what
-- the tools read and what metering writes. Nothing else: no users, sessions
-- tokens, OTP codes, API keys, audit logs or billing tables.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rejourney_mcp') THEN
        GRANT USAGE ON SCHEMA public TO rejourney_mcp;
        GRANT SELECT ON teams, team_members, projects, sessions, session_metrics, crashes, anrs, errors,
            issues, recording_artifacts, storage_endpoints
            TO rejourney_mcp;
        GRANT SELECT ON mcp_oauth_records TO rejourney_mcp;
        GRANT SELECT, UPDATE ON mcp_grants TO rejourney_mcp;
        GRANT SELECT, INSERT ON mcp_call_log TO rejourney_mcp;
        GRANT SELECT, INSERT, UPDATE ON mcp_usage_periods TO rejourney_mcp;
    END IF;
END
$$;
