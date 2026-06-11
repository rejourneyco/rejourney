#!/usr/bin/env python3
"""Compact Rejourney research-lake JSON/JSONL samples into Parquet tables."""

from __future__ import annotations

import datetime as dt
import gzip
import io
import json
import os
import re
import uuid
from collections import defaultdict
from typing import Any, Iterable


RAW_LAKES = ("interaction", "behavioral_outcomes")
COMMON_SESSION_FIELDS = (
    "source_lake",
    "project_key",
    "sample_key",
    "sample_date",
    "platform",
    "app_version_bucket",
    "sdk_version_bucket",
    "duration_seconds_bucket",
    "retention_days",
    "quality_tier",
)
COMMON_EVENT_FIELDS = (
    "source_lake",
    "project_key",
    "sample_key",
    "sample_date",
    "platform",
    "event_index",
    "elapsed_ms_bucket",
    "event_family",
    "event_kind",
    "funnel_transition",
    "screen_key",
)
COMMON_LABEL_FIELDS = (
    "source_lake",
    "project_key",
    "sample_key",
    "sample_date",
    "platform",
    "label_family",
    "is_conversion_session",
    "max_funnel_stage_reached",
    "conversion_revenue_bucket",
    "lifecycle_events_present",
    "has_api_failure",
    "has_stability_failure",
    "abandoned_after_paywall",
    "abandoned_after_checkout",
)


def env(name: str, default: str | None = None) -> str | None:
    value = os.getenv(name)
    return value if value not in ("", None) else default


def normalize_prefix(value: str) -> str:
    return value.strip("/")


def safe_partition_value(value: Any, fallback: str = "unknown") -> str:
    raw = str(value or fallback).strip().lower()
    raw = re.sub(r"[^a-z0-9_.=-]+", "_", raw)
    return raw[:80] or fallback


def read_json_bytes(data: bytes) -> dict[str, Any]:
    return json.loads(data.decode("utf-8"))


def read_jsonl_gzip_bytes(data: bytes) -> list[dict[str, Any]]:
    with gzip.GzipFile(fileobj=io.BytesIO(data), mode="rb") as gz:
        text = gz.read().decode("utf-8")
    return [json.loads(line) for line in text.splitlines() if line.strip()]


def sample_files_from_manifest(manifest: dict[str, Any]) -> dict[str, str]:
    files = manifest.get("files")
    return files if isinstance(files, dict) else {}


def flatten_session_fact(source_lake: str, manifest: dict[str, Any], quality: dict[str, Any]) -> dict[str, Any]:
    metrics = manifest.get("metrics") if isinstance(manifest.get("metrics"), dict) else {}
    visitor = manifest.get("visitor_context") if isinstance(manifest.get("visitor_context"), dict) else {}
    source = manifest.get("source") if isinstance(manifest.get("source"), dict) else {}
    labels = manifest.get("labels") if isinstance(manifest.get("labels"), dict) else {}
    return {
        "source_lake": source_lake,
        "project_key": manifest.get("project_key"),
        "sample_key": manifest.get("sample_key"),
        "sample_date": manifest.get("sample_date"),
        "platform": manifest.get("platform") or "unknown",
        "app_version_bucket": manifest.get("app_version_bucket"),
        "sdk_version_bucket": manifest.get("sdk_version_bucket"),
        "duration_seconds_bucket": manifest.get("duration_seconds_bucket"),
        "retention_days": manifest.get("retention_days"),
        "quality_tier": quality.get("quality_tier"),
        "source_reason": source.get("reason"),
        "has_visual_source": source.get("has_visual_source"),
        "is_bounced": visitor.get("is_bounced"),
        "screens_visited_count": visitor.get("screens_visited_count"),
        "total_events": metrics.get("total_events"),
        "touch_count": metrics.get("touch_count"),
        "scroll_count": metrics.get("scroll_count"),
        "gesture_count": metrics.get("gesture_count"),
        "input_count": metrics.get("input_count"),
        "rage_tap_count": metrics.get("rage_tap_count"),
        "dead_tap_count": metrics.get("dead_tap_count"),
        "api_total_count": metrics.get("api_total_count"),
        "api_error_count": metrics.get("api_error_count"),
        "api_avg_response_ms_bucket": metrics.get("api_avg_response_ms_bucket"),
        "crash_count": metrics.get("crash_count"),
        "anr_count": metrics.get("anr_count"),
        "error_count": metrics.get("error_count"),
        "max_funnel_stage_reached": labels.get("max_funnel_stage_reached"),
        "is_conversion_session": labels.get("is_conversion_session"),
    }


def quality_fact(source_lake: str, manifest: dict[str, Any], quality: dict[str, Any], warnings: list[str]) -> dict[str, Any]:
    return {
        "source_lake": source_lake,
        "project_key": manifest.get("project_key"),
        "sample_key": manifest.get("sample_key"),
        "sample_date": manifest.get("sample_date"),
        "platform": manifest.get("platform") or "unknown",
        "quality_tier": quality.get("quality_tier"),
        "pii_scan": quality.get("pii_scan"),
        "source_artifact_count": quality.get("source_artifact_count"),
        "interaction_event_count": quality.get("interaction_event_count") or quality.get("event_count"),
        "ui_frame_count": quality.get("ui_frame_count"),
        "ui_skeleton_element_count": quality.get("ui_skeleton_element_count"),
        "compaction_warnings": warnings,
    }


def event_fact_rows(source_lake: str, manifest: dict[str, Any], rows: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for row in rows:
        event_family = row.get("event_family")
        if not event_family:
            event_family = "funnel" if row.get("funnel_transition") else row.get("kind") or "event"
        out.append({
            "source_lake": source_lake,
            "project_key": manifest.get("project_key"),
            "sample_key": manifest.get("sample_key"),
            "sample_date": manifest.get("sample_date"),
            "platform": manifest.get("platform") or "unknown",
            "event_index": row.get("event_index", row.get("index")),
            "elapsed_ms_bucket": row.get("elapsed_ms_bucket"),
            "event_family": event_family,
            "event_kind": row.get("event_kind", row.get("kind")),
            "funnel_transition": row.get("funnel_transition"),
            "screen_key": row.get("screen_key"),
            "target_key": row.get("target_key"),
            "input_modality": row.get("input_modality"),
            "cart_value_bucket": row.get("cart_value_bucket"),
            "item_count_bucket": row.get("item_count_bucket", row.get("item_count_change")),
            "currency": row.get("currency"),
            "product_key": row.get("product_key"),
            "plan_key": row.get("plan_key"),
            "price_key": row.get("price_key"),
            "event_shape_key": row.get("event_shape_key"),
        })
    return out


def label_rows(source_lake: str, manifest: dict[str, Any], labels: dict[str, Any]) -> list[dict[str, Any]]:
    return [{
        "source_lake": source_lake,
        "project_key": manifest.get("project_key"),
        "sample_key": manifest.get("sample_key"),
        "sample_date": manifest.get("sample_date"),
        "platform": manifest.get("platform") or "unknown",
        "label_family": "all",
        "is_conversion_session": labels.get("is_conversion_session"),
        "max_funnel_stage_reached": labels.get("max_funnel_stage_reached"),
        "conversion_revenue_bucket": labels.get("conversion_revenue_bucket"),
        "lifecycle_events_present": labels.get("lifecycle_events_present"),
        "has_api_failure": labels.get("has_api_failure"),
        "has_stability_failure": labels.get("has_stability_failure"),
        "abandoned_after_paywall": labels.get("abandoned_after_paywall"),
        "abandoned_after_checkout": labels.get("abandoned_after_checkout"),
    }]


def common_rows(rows: Iterable[dict[str, Any]], fields: tuple[str, ...]) -> list[dict[str, Any]]:
    return [{key: row.get(key) for key in fields} for row in rows]


def rows_from_sample(source_lake: str, sample: dict[str, Any]) -> dict[tuple[str, str], list[dict[str, Any]]]:
    manifest = sample.get("manifest") or {}
    quality = sample.get("quality") or {}
    warnings = list(sample.get("warnings") or [])
    rows: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)

    if not manifest:
        return rows

    session_row = flatten_session_fact(source_lake, manifest, quality)
    rows[(source_lake, "session_fact")].append(session_row)
    rows[(source_lake, "quality_fact")].append(quality_fact(source_lake, manifest, quality, warnings))
    rows[("combined", "session_fact")].append({key: session_row.get(key) for key in COMMON_SESSION_FIELDS})

    if source_lake == "interaction":
        interactions = sample.get("interactions") or []
        ui_frames = sample.get("ui_frames") or []
        ui_skeleton = sample.get("ui_skeleton") or []
        events = event_fact_rows(source_lake, manifest, interactions)
        rows[(source_lake, "event_fact")].extend(events)
        rows[("combined", "event_fact")].extend(common_rows(events, COMMON_EVENT_FIELDS))
        for frame in ui_frames:
            frame_row = dict(frame)
            frame_row.update({
                "source_lake": source_lake,
                "project_key": manifest.get("project_key"),
                "sample_key": manifest.get("sample_key"),
                "sample_date": manifest.get("sample_date"),
                "platform": manifest.get("platform") or "unknown",
            })
            rows[(source_lake, "ui_frame_fact")].append(frame_row)
        for element in ui_skeleton:
            element_row = dict(element)
            element_row.update({
                "source_lake": source_lake,
                "project_key": manifest.get("project_key"),
                "sample_key": manifest.get("sample_key"),
                "sample_date": manifest.get("sample_date"),
                "platform": manifest.get("platform") or "unknown",
            })
            rows[(source_lake, "ui_skeleton_fact")].append(element_row)
        labels_rows = label_rows(source_lake, manifest, manifest.get("labels") or {})
        rows[(source_lake, "training_labels")].extend(labels_rows)
        rows[("combined", "training_labels")].extend(common_rows(labels_rows, COMMON_LABEL_FIELDS))
    else:
        events = event_fact_rows(source_lake, manifest, sample.get("events") or [])
        metrics = sample.get("session_metrics") or {}
        labels = sample.get("labels") or manifest.get("labels") or {}
        rows[(source_lake, "event_fact")].extend(events)
        rows[("combined", "event_fact")].extend(common_rows(events, COMMON_EVENT_FIELDS))
        labels_rows = label_rows(source_lake, manifest, labels)
        rows[(source_lake, "training_labels")].extend(labels_rows)
        rows[("combined", "training_labels")].extend(common_rows(labels_rows, COMMON_LABEL_FIELDS))
        rows[(source_lake, "stability_fact")].append({
            "source_lake": source_lake,
            "project_key": manifest.get("project_key"),
            "sample_key": manifest.get("sample_key"),
            "sample_date": manifest.get("sample_date"),
            "platform": manifest.get("platform") or "unknown",
            "crash_count": metrics.get("crash_count"),
            "anr_count": metrics.get("anr_count"),
            "error_count": metrics.get("error_count"),
            "rage_tap_count": metrics.get("rage_tap_count"),
            "dead_tap_count": metrics.get("dead_tap_count"),
            "has_stability_failure": labels.get("has_stability_failure"),
        })
        rows[(source_lake, "network_fact")].append({
            "source_lake": source_lake,
            "project_key": manifest.get("project_key"),
            "sample_key": manifest.get("sample_key"),
            "sample_date": manifest.get("sample_date"),
            "platform": manifest.get("platform") or "unknown",
            "api_total_count": metrics.get("api_total_count"),
            "api_success_count": metrics.get("api_success_count"),
            "api_error_count": metrics.get("api_error_count"),
            "api_avg_response_ms_bucket": metrics.get("api_avg_response_ms_bucket"),
            "network_type": metrics.get("network_type"),
            "cellular_generation": metrics.get("cellular_generation"),
            "is_constrained": metrics.get("is_constrained"),
            "is_expensive": metrics.get("is_expensive"),
        })

    return rows


def partition_parts(table: str, row: dict[str, Any]) -> list[str]:
    date = safe_partition_value(row.get("sample_date"), "unknown_date")
    platform = safe_partition_value(row.get("platform"), "unknown")
    if table == "event_fact":
        return [f"date={date}", f"event_family={safe_partition_value(row.get('event_family'), 'event')}"]
    if table == "training_labels":
        return [f"date={date}", f"label_family={safe_partition_value(row.get('label_family'), 'all')}"]
    if table in {"session_fact", "ui_frame_fact", "ui_skeleton_fact", "stability_fact", "network_fact"}:
        return [f"date={date}", f"platform={platform}"]
    return [f"date={date}"]


def group_rows_by_output(rows: dict[tuple[str, str], list[dict[str, Any]]]) -> dict[tuple[str, str, tuple[str, ...]], list[dict[str, Any]]]:
    grouped: dict[tuple[str, str, tuple[str, ...]], list[dict[str, Any]]] = defaultdict(list)
    for (source_lake, table), table_rows in rows.items():
        for row in table_rows:
            grouped[(source_lake, table, tuple(partition_parts(table, row)))].append(row)
    return grouped


def parquet_bytes(rows: list[dict[str, Any]]) -> bytes:
    import pyarrow as pa
    import pyarrow.parquet as pq

    table = pa.Table.from_pylist(rows)
    sink = pa.BufferOutputStream()
    pq.write_table(table, sink, compression="zstd")
    return sink.getvalue().to_pybytes()


def s3_client():
    import boto3
    from botocore.config import Config

    endpoint = env("RESEARCH_LAKE_ENDPOINT")
    return boto3.client(
        "s3",
        endpoint_url=endpoint,
        region_name=env("RESEARCH_LAKE_REGION", "us-east-1"),
        aws_access_key_id=env("RESEARCH_LAKE_ACCESS_KEY_ID"),
        aws_secret_access_key=env("RESEARCH_LAKE_SECRET_ACCESS_KEY"),
        config=Config(s3={"addressing_style": "path"}),
    )


def list_keys(client, bucket: str, prefix: str) -> Iterable[str]:
    token = None
    while True:
        kwargs = {"Bucket": bucket, "Prefix": prefix}
        if token:
            kwargs["ContinuationToken"] = token
        response = client.list_objects_v2(**kwargs)
        for item in response.get("Contents", []):
            yield item["Key"]
        if not response.get("IsTruncated"):
            return
        token = response.get("NextContinuationToken")


def get_object_bytes(client, bucket: str, key: str) -> bytes:
    return client.get_object(Bucket=bucket, Key=key)["Body"].read()


def load_sample_from_s3(client, bucket: str, manifest_key: str, source_lake: str) -> dict[str, Any]:
    sample_prefix = manifest_key.rsplit("/", 1)[0]
    manifest = read_json_bytes(get_object_bytes(client, bucket, manifest_key))
    files = sample_files_from_manifest(manifest)
    sample: dict[str, Any] = {"manifest": manifest, "warnings": []}

    def optional_json(name: str, relative: str) -> None:
        key = files.get(name) or f"{sample_prefix}/{relative}"
        try:
            sample[name] = read_json_bytes(get_object_bytes(client, bucket, key))
        except Exception as exc:  # noqa: BLE001 - compactor records partial sample quality.
            sample["warnings"].append(f"missing_{name}:{type(exc).__name__}")

    def optional_jsonl_gz(name: str, relative: str) -> None:
        key = files.get(name) or f"{sample_prefix}/{relative}"
        try:
            sample[name] = read_jsonl_gzip_bytes(get_object_bytes(client, bucket, key))
        except Exception as exc:  # noqa: BLE001
            sample["warnings"].append(f"missing_{name}:{type(exc).__name__}")

    optional_json("quality", "quality.json")
    if source_lake == "interaction":
        optional_jsonl_gz("interactions", "interactions.jsonl.gz")
        optional_jsonl_gz("ui_frames", "ui_frames.jsonl.gz")
        optional_jsonl_gz("ui_skeleton", "ui_skeleton.jsonl.gz")
    else:
        optional_jsonl_gz("events", "events.jsonl.gz")
        optional_json("session_metrics", "session_metrics.json")
        optional_json("labels", "labels.json")

    return sample


def date_allowed(manifest_key: str, explicit_date: str | None, min_date: str | None) -> bool:
    match = re.search(r"/date=([0-9]{4}-[0-9]{2}-[0-9]{2})/", manifest_key)
    if not match:
        return False
    date = match.group(1)
    if explicit_date:
        return date == explicit_date
    if min_date:
        return date >= min_date
    return True


def delete_prefix(client, bucket: str, prefix: str) -> None:
    keys = list(list_keys(client, bucket, prefix))
    for i in range(0, len(keys), 1000):
        chunk = keys[i:i + 1000]
        if chunk:
            client.delete_objects(Bucket=bucket, Delete={"Objects": [{"Key": key} for key in chunk]})


def write_grouped_parquet_to_s3(client, bucket: str, curated_prefix: str, grouped: dict[tuple[str, str, tuple[str, ...]], list[dict[str, Any]]]) -> None:
    run_id = uuid.uuid4().hex
    for (source_lake, table, partitions), rows in grouped.items():
        if not rows:
            continue
        partition_prefix = "/".join([
            normalize_prefix(curated_prefix),
            f"source_lake={source_lake}",
            f"table={table}",
            *partitions,
        ])
        delete_prefix(client, bucket, f"{partition_prefix}/")
        key = f"{partition_prefix}/part-{run_id}.parquet"
        client.put_object(
            Bucket=bucket,
            Key=key,
            Body=parquet_bytes(rows),
            ContentType="application/vnd.apache.parquet",
        )


def main() -> None:
    bucket = env("RESEARCH_LAKE_BUCKET")
    if not bucket:
        raise SystemExit("RESEARCH_LAKE_BUCKET is required")

    raw_prefix = normalize_prefix(env("RESEARCH_LAKE_PREFIX", "v1") or "v1")
    curated_prefix = normalize_prefix(env("RESEARCH_LAKE_CURATED_PREFIX", "v1_curated") or "v1_curated")
    explicit_date = env("RESEARCH_LAKE_COMPACTOR_DATE")
    lookback_days = int(env("RESEARCH_LAKE_COMPACTOR_LOOKBACK_DAYS", "2") or "2")
    max_samples = int(env("RESEARCH_LAKE_COMPACTOR_MAX_SAMPLES", "5000") or "5000")
    min_date = None
    if not explicit_date and lookback_days > 0:
        min_date = (dt.datetime.now(dt.timezone.utc).date() - dt.timedelta(days=lookback_days)).isoformat()

    client = s3_client()
    all_rows: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    loaded_by_lake = {source_lake: 0 for source_lake in RAW_LAKES}
    for source_lake in RAW_LAKES:
        prefix = f"{raw_prefix}/lake={source_lake}/"
        for key in list_keys(client, bucket, prefix):
            if loaded_by_lake[source_lake] >= max_samples:
                break
            if not key.endswith("/manifest.json") or not date_allowed(key, explicit_date, min_date):
                continue
            sample = load_sample_from_s3(client, bucket, key, source_lake)
            for table_key, rows in rows_from_sample(source_lake, sample).items():
                all_rows[table_key].extend(rows)
            loaded_by_lake[source_lake] += 1

    grouped = group_rows_by_output(all_rows)
    write_grouped_parquet_to_s3(client, bucket, curated_prefix, grouped)
    print(json.dumps({
        "samples_loaded": sum(loaded_by_lake.values()),
        "samples_loaded_by_lake": loaded_by_lake,
        "row_groups": len(grouped),
        "rows": sum(len(rows) for rows in grouped.values()),
        "curated_prefix": curated_prefix,
    }, sort_keys=True))


if __name__ == "__main__":
    main()
