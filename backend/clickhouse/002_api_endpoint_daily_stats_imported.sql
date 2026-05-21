CREATE TABLE IF NOT EXISTS rejourney.api_endpoint_daily_stats_imported
(
    project_id UUID,
    date Date,
    endpoint String,
    region LowCardinality(String),
    total_calls UInt64,
    total_errors UInt64,
    sum_latency_ms UInt64,
    status_code_breakdown_json String,
    p50_latency_ms Nullable(UInt32),
    p90_latency_ms Nullable(UInt32),
    p99_latency_ms Nullable(UInt32),
    imported_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(imported_at)
PARTITION BY toYYYYMM(date)
ORDER BY (project_id, date, endpoint, region)
SETTINGS index_granularity = 8192;

