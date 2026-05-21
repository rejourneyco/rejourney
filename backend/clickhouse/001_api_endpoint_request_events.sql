CREATE DATABASE IF NOT EXISTS rejourney;

CREATE TABLE IF NOT EXISTS rejourney.api_endpoint_request_events
(
    project_id UUID,
    event_date Date,
    event_time DateTime64(3, 'UTC'),
    session_id String,
    artifact_id String,
    event_index UInt32,
    method LowCardinality(String),
    path String,
    endpoint String,
    region LowCardinality(String),
    status_code UInt16,
    is_error UInt8,
    duration_ms UInt32,
    source LowCardinality(String) DEFAULT 'event_artifact',
    schema_version UInt16 DEFAULT 1,
    inserted_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(event_date)
ORDER BY (project_id, event_date, endpoint, region, artifact_id, event_index)
TTL event_date + INTERVAL 400 DAY DELETE
SETTINGS index_granularity = 8192;

