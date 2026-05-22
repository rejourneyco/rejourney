CREATE TABLE IF NOT EXISTS rejourney.api_endpoint_daily_rollups
(
    project_id UUID,
    date Date,
    endpoint LowCardinality(String),
    region LowCardinality(String),
    status_code UInt16,
    total_calls UInt64,
    total_errors UInt64,
    sum_latency_ms UInt64,
    updated_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = SummingMergeTree((total_calls, total_errors, sum_latency_ms))
PARTITION BY toYYYYMM(date)
ORDER BY (project_id, date, endpoint, region, status_code);

CREATE MATERIALIZED VIEW IF NOT EXISTS rejourney.api_endpoint_daily_rollups_mv
TO rejourney.api_endpoint_daily_rollups
AS
SELECT
    project_id,
    event_date AS date,
    endpoint,
    region,
    status_code,
    toUInt64(count()) AS total_calls,
    toUInt64(countIf(is_error = 1)) AS total_errors,
    toUInt64(sum(duration_ms)) AS sum_latency_ms,
    max(inserted_at) AS updated_at
FROM rejourney.api_endpoint_request_events
GROUP BY
    project_id,
    date,
    endpoint,
    region,
    status_code;
