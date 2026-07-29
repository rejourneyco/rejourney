#!/usr/bin/env python3
"""Compact Rejourney research-lake JSON/JSONL samples into Parquet tables."""

from __future__ import annotations

import datetime as dt
import gc
import gzip
import io
import json
import os
import re
import uuid
from collections import defaultdict
from typing import Any, Iterable


V1_RAW_LAKES = ("interaction", "behavioral_outcomes", "revenue_outcomes")
V2_RAW_LAKES = ("interaction", "behavioral_outcomes", "forward_outcomes")
RAW_LAKES = V1_RAW_LAKES
TABLE_CHUNK_ROW_LIMITS = {
    # Raster feature-grid rows can contain 3 dense grid arrays. Keep these
    # row groups intentionally small so catch-up compactions do not OOM.
    "ui_frame_fact": 250,
    "ui_skeleton_fact": 2000,
}
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
    "target_key",
    "x_norm_bucket",
    "y_norm_bucket",
    "x_cell",
    "y_cell",
    "touch_grid_columns",
    "touch_grid_rows",
    "screen_orientation",
    "screen_form_factor",
    "viewport_source",
    "input_modality",
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
    "purchased_product_keys",
    "has_api_failure",
    "has_stability_failure",
    "has_rage_or_dead_tap",
    "abandoned_after_paywall",
    "abandoned_after_checkout",
)
REVENUE_OUTCOME_FIELDS = (
    "source_lake",
    "project_key",
    "sample_date",
    "provider",
    "currency",
    "attribution_scope",
    "revenue_observation_grain",
    "session_attribution_available",
    "gross_revenue_bucket",
    "refund_revenue_bucket",
    "fee_revenue_bucket",
    "net_revenue_abs_bucket",
    "net_revenue_direction",
    "transaction_count_bucket",
    "refund_count_bucket",
    "subscriber_count_bucket",
    "trial_count_bucket",
    "subscription_start_count_bucket",
    "cancellation_count_bucket",
    "conversion_count_bucket",
    "previous_day_net_revenue_abs_bucket",
    "previous_day_net_revenue_direction",
    "net_revenue_delta_abs_bucket",
    "net_revenue_delta_direction",
    "trailing_7d_net_revenue_abs_bucket",
    "trailing_7d_net_revenue_direction",
    "previous_7d_net_revenue_abs_bucket",
    "previous_7d_net_revenue_direction",
    "trailing_7d_net_revenue_delta_abs_bucket",
    "trailing_7d_net_revenue_delta_direction",
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


def dataset_role_for_row(row: dict[str, Any]) -> str | None:
    has_v2_capture_fields = "capture_tier" in row or "evaluation_quarantined" in row
    if not has_v2_capture_fields:
        return None
    if bool(row.get("evaluation_quarantined")):
        return "quarantined"
    capture_tier = row.get("capture_tier")
    if capture_tier == "spine":
        return "evaluation"
    if capture_tier in {"uniform", "selected", "metadata_only"}:
        return "general"
    return "unclassified"


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
    row = {
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
    if int(manifest.get("schema_version", 1)) >= 2:
        row.update({
            "schema_version": manifest.get("schema_version"),
            "release_id": manifest.get("release_id"),
            "traffic_scale_bucket": manifest.get("traffic_scale_bucket"),
            "traffic_scale_window_days": manifest.get("traffic_scale_window_days"),
            "traffic_scale_observed_days": manifest.get("traffic_scale_observed_days"),
            "traffic_scale_provenance": manifest.get("traffic_scale_provenance"),
            "session_end_taxonomy": (manifest.get("lifecycle") or {}).get("session_end_taxonomy"),
            "session_end_confidence": (manifest.get("lifecycle") or {}).get("confidence"),
            "capture_tier": (manifest.get("capture") or {}).get("capture_tier"),
            "evaluation_quarantined": bool((manifest.get("capture") or {}).get("evaluation_quarantined")),
        })
    return row


def quality_fact(source_lake: str, manifest: dict[str, Any], quality: dict[str, Any], warnings: list[str]) -> dict[str, Any]:
    capture_profile = quality.get("capture_profile") if isinstance(quality.get("capture_profile"), dict) else manifest.get("capture_profile")
    hierarchy_profile = capture_profile.get("hierarchy") if isinstance(capture_profile, dict) and isinstance(capture_profile.get("hierarchy"), dict) else {}
    rrweb_profile = capture_profile.get("rrweb") if isinstance(capture_profile, dict) and isinstance(capture_profile.get("rrweb"), dict) else {}
    masking_profile = capture_profile.get("masking") if isinstance(capture_profile, dict) and isinstance(capture_profile.get("masking"), dict) else {}
    row = {
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
        "screenshot_frame_count": quality.get("screenshot_frame_count"),
        "hierarchy_snapshot_frame_count": quality.get("hierarchy_snapshot_frame_count"),
        "rrweb_event_frame_count": quality.get("rrweb_event_frame_count"),
        "ui_skeleton_element_count": quality.get("ui_skeleton_element_count"),
        "coordinate_event_count": quality.get("coordinate_event_count"),
        "coordinate_missing_count": quality.get("coordinate_missing_count"),
        "viewport_missing_count": quality.get("viewport_missing_count"),
        "visual_modality_counts": quality.get("visual_modality_counts"),
        "recommended_encoder_counts": quality.get("recommended_encoder_counts"),
        "grid_shape_counts": quality.get("grid_shape_counts"),
        "feature_grid_status_counts": quality.get("feature_grid_status_counts"),
        "viewport_source_counts": quality.get("viewport_source_counts"),
        "hierarchy_cadence_mode": hierarchy_profile.get("cadence_mode"),
        "hierarchy_alignment": hierarchy_profile.get("alignment"),
        "hierarchy_observed_median_interval_ms": hierarchy_profile.get("observed_median_interval_ms"),
        "hierarchy_observed_snapshot_count": hierarchy_profile.get("observed_snapshot_count"),
        "hierarchy_screenshot_alignment_ratio": hierarchy_profile.get("hierarchy_screenshot_alignment_ratio"),
        "screenshot_hierarchy_coverage_ratio": hierarchy_profile.get("screenshot_hierarchy_coverage_ratio"),
        "hierarchy_alignment_threshold_ratio": hierarchy_profile.get("alignment_threshold_ratio"),
        "hierarchy_alignment_tolerance_ms": hierarchy_profile.get("alignment_tolerance_ms"),
        "rrweb_replay_basis": rrweb_profile.get("replay_basis"),
        "rrweb_full_snapshot_count": rrweb_profile.get("full_snapshot_count"),
        "rrweb_mutation_count": rrweb_profile.get("mutation_count"),
        "rrweb_dom_skeleton_element_count": rrweb_profile.get("dom_skeleton_element_count"),
        "rrweb_viewport_missing_count": rrweb_profile.get("viewport_missing_count"),
        "rrweb_page_missing_count": rrweb_profile.get("page_missing_count"),
        "text_input_masking_policy": masking_profile.get("text_input_masking_policy"),
        "image_video_masking_policy": masking_profile.get("image_video_masking_policy"),
        "screenshot_pixels_post_redaction": masking_profile.get("screenshot_pixels_post_redaction"),
        "hierarchy_masked_element_count": masking_profile.get("hierarchy_masked_element_count"),
        "hierarchy_masked_input_count": masking_profile.get("hierarchy_masked_input_count"),
        "hierarchy_media_surface_count": masking_profile.get("hierarchy_media_surface_count"),
        "hierarchy_keyboard_or_system_element_count": masking_profile.get("hierarchy_keyboard_or_system_element_count"),
        "rrweb_masked_element_count": masking_profile.get("rrweb_masked_element_count"),
        "rrweb_masked_input_value_count": masking_profile.get("rrweb_masked_input_value_count"),
        "rrweb_masked_media_attribute_count": masking_profile.get("rrweb_masked_media_attribute_count"),
        "rrweb_media_surface_count": masking_profile.get("rrweb_media_surface_count"),
        "compaction_warnings": warnings,
    }
    if int(manifest.get("schema_version", 1)) >= 2:
        row.update({
            "schema_version": manifest.get("schema_version"),
            "provenance": quality.get("provenance") or manifest.get("provenance"),
            "capture_tier": (manifest.get("capture") or {}).get("capture_tier"),
            "evaluation_quarantined": bool((manifest.get("capture") or {}).get("evaluation_quarantined")),
        })
    return row


def event_fact_rows(source_lake: str, manifest: dict[str, Any], rows: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for row in rows:
        event_family = row.get("event_family")
        if not event_family:
            event_family = "funnel" if row.get("funnel_transition") else row.get("kind") or "event"
        event_row = {
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
            "x_norm_bucket": row.get("x_norm_bucket"),
            "y_norm_bucket": row.get("y_norm_bucket"),
            "x_cell": row.get("x_cell"),
            "y_cell": row.get("y_cell"),
            "touch_grid_columns": row.get("touch_grid_columns"),
            "touch_grid_rows": row.get("touch_grid_rows"),
            "screen_orientation": row.get("screen_orientation"),
            "screen_form_factor": row.get("screen_form_factor"),
            "viewport_source": row.get("viewport_source"),
            "input_modality": row.get("input_modality"),
            "cart_value_bucket": row.get("cart_value_bucket"),
            "item_count_bucket": row.get("item_count_bucket", row.get("item_count_change")),
            "currency": row.get("currency"),
            "product_key": row.get("product_key"),
            "plan_key": row.get("plan_key"),
            "price_key": row.get("price_key"),
            "event_shape_key": row.get("event_shape_key"),
        }
        if int(manifest.get("schema_version", 1)) >= 2:
            capture = manifest.get("capture") if isinstance(manifest.get("capture"), dict) else {}
            event_row.update({
                "elapsed_ms": row.get("elapsed_ms"),
                "input_to_next_frame_ms_bucket": row.get("input_to_next_frame_ms_bucket"),
                "input_to_dom_mutation_ms_bucket": row.get("input_to_dom_mutation_ms_bucket"),
                "main_thread_blocked": row.get("main_thread_blocked"),
                "capture_tier": capture.get("capture_tier"),
                "evaluation_quarantined": bool(capture.get("evaluation_quarantined")),
            })
        out.append(event_row)
    return out


def label_rows(source_lake: str, manifest: dict[str, Any], labels: dict[str, Any]) -> list[dict[str, Any]]:
    row = {
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
        "purchased_product_keys": labels.get("purchased_product_keys"),
        "has_api_failure": labels.get("has_api_failure"),
        "has_stability_failure": labels.get("has_stability_failure"),
        "has_rage_or_dead_tap": labels.get("has_rage_or_dead_tap"),
        "abandoned_after_paywall": labels.get("abandoned_after_paywall"),
        "abandoned_after_checkout": labels.get("abandoned_after_checkout"),
    }
    if int(manifest.get("schema_version", 1)) >= 2:
        row.update({
            "capture_tier": (manifest.get("capture") or {}).get("capture_tier"),
            "evaluation_quarantined": bool((manifest.get("capture") or {}).get("evaluation_quarantined")),
        })
    return [row]


def revenue_outcome_row(source_lake: str, manifest: dict[str, Any], daily_revenue: dict[str, Any]) -> dict[str, Any]:
    row = {key: daily_revenue.get(key) for key in REVENUE_OUTCOME_FIELDS}
    row.update({
        "source_lake": source_lake,
        "project_key": manifest.get("project_key") or daily_revenue.get("project_key"),
        "sample_date": manifest.get("sample_date") or daily_revenue.get("sample_date"),
        "provider": manifest.get("provider") or daily_revenue.get("provider") or "unknown",
        "currency": manifest.get("currency") or daily_revenue.get("currency") or "unknown",
        "attribution_scope": daily_revenue.get("attribution_scope") or "project_day",
        "revenue_observation_grain": daily_revenue.get("revenue_observation_grain") or "project_provider_currency_day",
        "session_attribution_available": bool(daily_revenue.get("session_attribution_available")),
    })
    return row


def common_rows(rows: Iterable[dict[str, Any]], fields: tuple[str, ...]) -> list[dict[str, Any]]:
    return [{key: row.get(key) for key in fields} for row in rows]


def common_rows_for_manifest(rows: Iterable[dict[str, Any]], fields: tuple[str, ...], manifest: dict[str, Any]) -> list[dict[str, Any]]:
    output = common_rows(rows, fields)
    if int(manifest.get("schema_version", 1)) >= 2:
        capture = manifest.get("capture") if isinstance(manifest.get("capture"), dict) else {}
        for row in output:
            row.update({
                "capture_tier": capture.get("capture_tier"),
                "evaluation_quarantined": bool(capture.get("evaluation_quarantined")),
            })
    return output


def rows_from_sample(source_lake: str, sample: dict[str, Any]) -> dict[tuple[str, str], list[dict[str, Any]]]:
    manifest = sample.get("manifest") or {}
    quality = sample.get("quality") or {}
    warnings = list(sample.get("warnings") or [])
    rows: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)

    if not manifest:
        return rows

    if source_lake == "revenue_outcomes":
        daily_revenue = sample.get("daily_revenue") or {}
        if daily_revenue:
            rows[(source_lake, "daily_revenue_fact")].append(revenue_outcome_row(source_lake, manifest, daily_revenue))
        return rows

    if source_lake == "forward_outcomes":
        outcomes = sample.get("outcomes") or {}
        if outcomes:
            row = dict(outcomes)
            row.update({
                "source_lake": source_lake,
                "project_key": manifest.get("project_key"),
                "sample_key": manifest.get("sample_key"),
                "sample_date": manifest.get("sample_date"),
                "platform": manifest.get("platform") or "unknown",
                "release_id": manifest.get("release_id"),
                "capture_tier": (manifest.get("capture") or {}).get("capture_tier"),
                "evaluation_quarantined": bool((manifest.get("capture") or {}).get("evaluation_quarantined")),
            })
            rows[(source_lake, "forward_outcome_fact")].append(row)
        return rows

    session_row = flatten_session_fact(source_lake, manifest, quality)
    rows[(source_lake, "session_fact")].append(session_row)
    rows[(source_lake, "quality_fact")].append(quality_fact(source_lake, manifest, quality, warnings))
    rows[("combined", "session_fact")].extend(common_rows_for_manifest([session_row], COMMON_SESSION_FIELDS, manifest))

    capture = manifest.get("capture") if isinstance(manifest.get("capture"), dict) else {}
    if capture:
        capture_row = dict(capture)
        capture_row.update({
            "source_lake": source_lake,
            "project_key": manifest.get("project_key"),
            "sample_key": manifest.get("sample_key"),
            "sample_date": manifest.get("sample_date"),
            "platform": manifest.get("platform") or "unknown",
        })
        rows[(source_lake, "capture_fact")].append(capture_row)

    if manifest.get("release_id"):
        rows[(source_lake, "release_observation_fact")].append({
            "source_lake": source_lake,
            "project_key": manifest.get("project_key"),
            "sample_key": manifest.get("sample_key"),
            "sample_date": manifest.get("sample_date"),
            "platform": manifest.get("platform") or "unknown",
            "release_id": manifest.get("release_id"),
            "capture_tier": capture.get("capture_tier"),
            "evaluation_quarantined": bool(capture.get("evaluation_quarantined")),
        })

    if source_lake == "interaction":
        interactions = sample.get("interactions") or []
        ui_frames = sample.get("ui_frames") or []
        ui_skeleton = sample.get("ui_skeleton") or []
        screen_versions = sample.get("screen_versions") or []
        flow_edges = sample.get("flow_edges") or []
        frame_index = sample.get("frame_index") or []
        events = event_fact_rows(source_lake, manifest, interactions)
        rows[(source_lake, "event_fact")].extend(events)
        rows[("combined", "event_fact")].extend(common_rows_for_manifest(events, COMMON_EVENT_FIELDS, manifest))
        for frame in ui_frames:
            frame_row = dict(frame)
            frame_row.update({
                "source_lake": source_lake,
                "project_key": manifest.get("project_key"),
                "sample_key": manifest.get("sample_key"),
                "sample_date": manifest.get("sample_date"),
                "platform": manifest.get("platform") or "unknown",
            })
            if int(manifest.get("schema_version", 1)) >= 2:
                frame_row.update({
                    "capture_tier": capture.get("capture_tier"),
                    "evaluation_quarantined": bool(capture.get("evaluation_quarantined")),
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
            if int(manifest.get("schema_version", 1)) >= 2:
                element_row.update({
                    "capture_tier": capture.get("capture_tier"),
                    "evaluation_quarantined": bool(capture.get("evaluation_quarantined")),
                })
            rows[(source_lake, "ui_skeleton_fact")].append(element_row)
        for version in screen_versions:
            version_row = dict(version)
            version_row.update({
                "source_lake": source_lake,
                "project_key": manifest.get("project_key"),
                "sample_key": manifest.get("sample_key"),
                "sample_date": manifest.get("sample_date"),
                "platform": manifest.get("platform") or "unknown",
            })
            version_row.update({
                "capture_tier": capture.get("capture_tier"),
                "evaluation_quarantined": bool(capture.get("evaluation_quarantined")),
            })
            rows[(source_lake, "screen_version_fact")].append(version_row)
        for edge in flow_edges:
            edge_row = dict(edge)
            edge_row.update({
                "source_lake": source_lake,
                "project_key": manifest.get("project_key"),
                "sample_key": manifest.get("sample_key"),
                "sample_date": manifest.get("sample_date"),
                "platform": manifest.get("platform") or "unknown",
            })
            edge_row.update({
                "capture_tier": capture.get("capture_tier"),
                "evaluation_quarantined": bool(capture.get("evaluation_quarantined")),
            })
            rows[(source_lake, "flow_edge_fact")].append(edge_row)
        for media_reference in frame_index:
            media_row = dict(media_reference)
            media_row.update({
                "source_lake": source_lake,
                "project_key": manifest.get("project_key"),
                "sample_key": manifest.get("sample_key"),
                "sample_date": manifest.get("sample_date"),
                "platform": manifest.get("platform") or "unknown",
                "capture_tier": capture.get("capture_tier"),
                "evaluation_quarantined": bool(capture.get("evaluation_quarantined")),
            })
            rows[(source_lake, "media_reference_fact")].append(media_row)
        labels_rows = label_rows(source_lake, manifest, manifest.get("labels") or {})
        rows[(source_lake, "training_labels")].extend(labels_rows)
        rows[("combined", "training_labels")].extend(common_rows_for_manifest(labels_rows, COMMON_LABEL_FIELDS, manifest))
    else:
        events = event_fact_rows(source_lake, manifest, sample.get("events") or [])
        metrics = sample.get("session_metrics") or {}
        labels = sample.get("labels") or manifest.get("labels") or {}
        rows[(source_lake, "event_fact")].extend(events)
        rows[("combined", "event_fact")].extend(common_rows_for_manifest(events, COMMON_EVENT_FIELDS, manifest))
        labels_rows = label_rows(source_lake, manifest, labels)
        rows[(source_lake, "training_labels")].extend(labels_rows)
        rows[("combined", "training_labels")].extend(common_rows_for_manifest(labels_rows, COMMON_LABEL_FIELDS, manifest))
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
        if int(manifest.get("schema_version", 1)) >= 2:
            for table in ("stability_fact", "network_fact"):
                rows[(source_lake, table)][-1].update({
                    "capture_tier": capture.get("capture_tier"),
                    "evaluation_quarantined": bool(capture.get("evaluation_quarantined")),
                })

    return rows


def partition_parts(table: str, row: dict[str, Any]) -> list[str]:
    date = safe_partition_value(row.get("sample_date"), "unknown_date")
    platform = safe_partition_value(row.get("platform"), "unknown")
    dataset_role = dataset_role_for_row(row)
    role_partition = [f"dataset_role={dataset_role}"] if dataset_role else []
    if table == "event_fact":
        return [*role_partition, f"date={date}", f"event_family={safe_partition_value(row.get('event_family'), 'event')}"]
    if table == "daily_revenue_fact":
        provider = safe_partition_value(row.get("provider"), "unknown")
        currency = safe_partition_value(row.get("currency"), "unknown")
        return [*role_partition, f"date={date}", f"provider={provider}", f"currency={currency}"]
    if table == "training_labels":
        return [*role_partition, f"date={date}", f"label_family={safe_partition_value(row.get('label_family'), 'all')}"]
    if table in {"session_fact", "ui_frame_fact", "ui_skeleton_fact", "stability_fact", "network_fact", "capture_fact", "screen_version_fact", "flow_edge_fact", "media_reference_fact", "release_observation_fact", "forward_outcome_fact"}:
        return [*role_partition, f"date={date}", f"platform={platform}"]
    return [*role_partition, f"date={date}"]


def group_rows_by_output(rows: dict[tuple[str, str], list[dict[str, Any]]]) -> dict[tuple[str, str, tuple[str, ...]], list[dict[str, Any]]]:
    grouped: dict[tuple[str, str, tuple[str, ...]], list[dict[str, Any]]] = defaultdict(list)
    for (source_lake, table), table_rows in rows.items():
        for row in table_rows:
            dataset_role = dataset_role_for_row(row)
            if dataset_role:
                row["dataset_role"] = dataset_role
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


def list_common_prefixes(client, bucket: str, prefix: str) -> Iterable[str]:
    token = None
    while True:
        kwargs = {"Bucket": bucket, "Prefix": prefix, "Delimiter": "/"}
        if token:
            kwargs["ContinuationToken"] = token
        response = client.list_objects_v2(**kwargs)
        for item in response.get("CommonPrefixes", []):
            value = item.get("Prefix")
            if value:
                yield value
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
        if int(manifest.get("schema_version", 1)) >= 2:
            optional_jsonl_gz("screen_versions", "screen_versions.jsonl.gz")
            optional_jsonl_gz("flow_edges", "flow_edges.jsonl.gz")
            optional_jsonl_gz("frame_index", "frame_index.jsonl.gz")
    elif source_lake == "behavioral_outcomes":
        optional_jsonl_gz("events", "events.jsonl.gz")
        optional_json("session_metrics", "session_metrics.json")
        optional_json("labels", "labels.json")
    elif source_lake == "forward_outcomes":
        optional_json("outcomes", "outcomes.json")
    else:
        optional_json("daily_revenue", "daily_revenue.json")

    return sample


def date_allowed(
    manifest_key: str,
    explicit_date: str | None,
    min_date: str | None,
    max_date: str | None = None,
) -> bool:
    date = manifest_date(manifest_key)
    if not date:
        return False
    if explicit_date:
        return date == explicit_date
    if min_date:
        if date < min_date:
            return False
    if max_date:
        if date > max_date:
            return False
    return True


def manifest_date(manifest_key: str) -> str | None:
    match = re.search(r"/date=([0-9]{4}-[0-9]{2}-[0-9]{2})/", manifest_key)
    return match.group(1) if match else None


def manifest_project_key(manifest_key: str) -> str | None:
    match = re.search(r"/project_key=([^/]+)/", manifest_key)
    return match.group(1) if match else None


def traffic_scale_bucket(observed_sessions_30d: int) -> str:
    if observed_sessions_30d < 1_000:
        return "under_1k"
    if observed_sessions_30d < 10_000:
        return "1k_10k"
    if observed_sessions_30d < 100_000:
        return "10k_100k"
    if observed_sessions_30d < 1_000_000:
        return "100k_1m"
    return "1m_plus"


def project_traffic_scale_by_key(
    keys_by_date: dict[str, dict[str, list[str]]],
    observation_end_date: str,
    window_days: int = 30,
) -> dict[str, dict[str, Any]]:
    end = dt.date.fromisoformat(observation_end_date)
    start = end - dt.timedelta(days=max(1, window_days) - 1)
    samples_by_project: dict[str, set[str]] = defaultdict(set)
    dates_by_project: dict[str, set[str]] = defaultdict(set)

    # Behavioral exports provide a much less biased scale signal than the visual
    # sample while keeping project metadata out of the transactional database.
    for sample_date, keys_by_lake in keys_by_date.items():
        parsed_date = dt.date.fromisoformat(sample_date)
        if parsed_date < start or parsed_date > end:
            continue
        for key in keys_by_lake.get("behavioral_outcomes", []):
            project_key = manifest_project_key(key)
            if project_key:
                samples_by_project[project_key].add(key.rsplit("/manifest.json", 1)[0])
                dates_by_project[project_key].add(sample_date)

    return {
        project_key: {
            "traffic_scale_bucket": traffic_scale_bucket(len(sample_keys)),
            "traffic_scale_window_days": window_days,
            "traffic_scale_observed_days": len(dates_by_project[project_key]),
            "traffic_scale_provenance": "derived_from_v2_behavioral_exports",
        }
        for project_key, sample_keys in samples_by_project.items()
    }


def eligible_manifest_keys_by_date(
    keys: Iterable[str],
    explicit_date: str | None,
    min_date: str | None,
    max_date: str | None = None,
) -> dict[str, list[str]]:
    by_date: dict[str, list[str]] = defaultdict(list)
    for key in keys:
        if not key.endswith("/manifest.json") or not date_allowed(key, explicit_date, min_date, max_date):
            continue
        date = manifest_date(key)
        if date:
            by_date[date].append(key)
    return by_date


def selected_compaction_dates(keys_by_date: dict[str, Any], max_dates: int, date_order: str = "oldest") -> list[str]:
    dates = sorted(keys_by_date)
    if max_dates > 0:
        if date_order == "newest":
            return dates[-max_dates:]
        return dates[:max_dates]
    return dates


def table_chunk_rows(table: str, default_chunk_rows: int) -> int:
    return max(1, min(default_chunk_rows, TABLE_CHUNK_ROW_LIMITS.get(table, default_chunk_rows)))


def date_range(start_date: str, end_date: str) -> list[str]:
    start = dt.date.fromisoformat(start_date)
    end = dt.date.fromisoformat(end_date)
    if end < start:
        return []
    days = (end - start).days
    return [(start + dt.timedelta(days=offset)).isoformat() for offset in range(days + 1)]


def discover_manifest_keys_by_date(
    client,
    bucket: str,
    raw_prefix: str,
    candidate_dates: Iterable[str],
    raw_lakes: tuple[str, ...] = RAW_LAKES,
) -> tuple[dict[str, dict[str, list[str]]], dict[str, int]]:
    keys_by_date: dict[str, dict[str, list[str]]] = defaultdict(lambda: {source_lake: [] for source_lake in raw_lakes})
    discovered_by_lake = {source_lake: 0 for source_lake in raw_lakes}
    dates = list(candidate_dates)

    for source_lake in raw_lakes:
        lake_prefix = f"{raw_prefix}/lake={source_lake}/"
        project_prefixes = list(list_common_prefixes(client, bucket, lake_prefix))
        for project_prefix in project_prefixes:
            for date in dates:
                date_prefix = f"{project_prefix}date={date}/"
                for key in list_keys(client, bucket, date_prefix):
                    if not key.endswith("/manifest.json"):
                        continue
                    keys_by_date[date][source_lake].append(key)
                    discovered_by_lake[source_lake] += 1

    return keys_by_date, discovered_by_lake


def delete_prefix(client, bucket: str, prefix: str) -> None:
    keys = list(list_keys(client, bucket, prefix))
    for i in range(0, len(keys), 1000):
        chunk = keys[i:i + 1000]
        if chunk:
            client.delete_objects(Bucket=bucket, Delete={"Objects": [{"Key": key} for key in chunk]})


def output_partition_prefix(curated_prefix: str, source_lake: str, table: str, partitions: tuple[str, ...]) -> str:
    return "/".join([
        normalize_prefix(curated_prefix),
        f"source_lake={source_lake}",
        f"table={table}",
        *partitions,
    ])


def put_parquet_part(client, bucket: str, partition_prefix: str, run_id: str, part_index: int, rows: list[dict[str, Any]]) -> None:
    key = f"{partition_prefix}/part-{run_id}-{part_index:05d}.parquet"
    client.put_object(
        Bucket=bucket,
        Key=key,
        Body=parquet_bytes(rows),
        ContentType="application/vnd.apache.parquet",
    )


def write_grouped_parquet_to_s3(client, bucket: str, curated_prefix: str, grouped: dict[tuple[str, str, tuple[str, ...]], list[dict[str, Any]]]) -> None:
    run_id = uuid.uuid4().hex
    for (source_lake, table, partitions), rows in grouped.items():
        if not rows:
            continue
        partition_prefix = output_partition_prefix(curated_prefix, source_lake, table, partitions)
        delete_prefix(client, bucket, f"{partition_prefix}/")
        put_parquet_part(client, bucket, partition_prefix, run_id, 0, rows)


def write_manifest_keys_chunked_to_s3(
    client,
    bucket: str,
    curated_prefix: str,
    keys_by_lake: dict[str, list[str]],
    chunk_rows: int,
    raw_lakes: tuple[str, ...] = RAW_LAKES,
    traffic_scale_by_project: dict[str, dict[str, Any]] | None = None,
) -> tuple[int, int]:
    run_id = uuid.uuid4().hex
    buffers: dict[tuple[str, str, tuple[str, ...]], list[dict[str, Any]]] = defaultdict(list)
    deleted_prefixes: set[str] = set()
    part_counts: dict[tuple[str, str, tuple[str, ...]], int] = defaultdict(int)
    total_rows = 0

    def flush(group_key: tuple[str, str, tuple[str, ...]]) -> None:
        nonlocal total_rows
        rows = buffers[group_key]
        if not rows:
            return
        source_lake, table, partitions = group_key
        partition_prefix = output_partition_prefix(curated_prefix, source_lake, table, partitions)
        if partition_prefix not in deleted_prefixes:
            delete_prefix(client, bucket, f"{partition_prefix}/")
            deleted_prefixes.add(partition_prefix)
        part_index = part_counts[group_key]
        put_parquet_part(client, bucket, partition_prefix, run_id, part_index, rows)
        part_counts[group_key] += 1
        total_rows += len(rows)
        buffers[group_key] = []
        gc.collect()

    for source_lake in raw_lakes:
        for key in keys_by_lake.get(source_lake, []):
            sample = load_sample_from_s3(client, bucket, key, source_lake)
            manifest = sample.get("manifest") or {}
            if int(manifest.get("schema_version", 1)) >= 2 and traffic_scale_by_project:
                project_key = manifest_project_key(key)
                manifest.update(traffic_scale_by_project.get(project_key or "", {}))
            grouped = group_rows_by_output(rows_from_sample(source_lake, sample))
            for group_key, rows in grouped.items():
                buffers[group_key].extend(rows)
                if len(buffers[group_key]) >= table_chunk_rows(group_key[1], chunk_rows):
                    flush(group_key)

    for group_key in list(buffers):
        flush(group_key)

    return sum(part_counts.values()), total_rows


def main() -> None:
    bucket = env("RESEARCH_LAKE_BUCKET")
    if not bucket:
        raise SystemExit("RESEARCH_LAKE_BUCKET is required")

    raw_prefix = normalize_prefix(env("RESEARCH_LAKE_PREFIX", "v1") or "v1")
    curated_prefix = normalize_prefix(env("RESEARCH_LAKE_CURATED_PREFIX", "v1_curated") or "v1_curated")
    schema_version = int(env("RESEARCH_LAKE_SCHEMA_VERSION", "1") or "1")
    raw_lakes = V2_RAW_LAKES if schema_version >= 2 else V1_RAW_LAKES
    explicit_date = env("RESEARCH_LAKE_COMPACTOR_DATE")
    explicit_date_start = env("RESEARCH_LAKE_COMPACTOR_DATE_START")
    explicit_date_end = env("RESEARCH_LAKE_COMPACTOR_DATE_END")
    # Raw partitions use the session date, not the export date. Retention-time
    # exports can therefore land today under date partitions weeks earlier.
    lookback_days = int(env("RESEARCH_LAKE_COMPACTOR_LOOKBACK_DAYS", "120") or "120")
    max_samples = int(env("RESEARCH_LAKE_COMPACTOR_MAX_SAMPLES", "5000") or "5000")
    max_dates = int(env("RESEARCH_LAKE_COMPACTOR_MAX_DATES", "0") or "0")
    date_order = (env("RESEARCH_LAKE_COMPACTOR_DATE_ORDER", "oldest") or "oldest").lower()
    if date_order not in {"oldest", "newest"}:
        raise SystemExit("RESEARCH_LAKE_COMPACTOR_DATE_ORDER must be 'oldest' or 'newest'")
    chunk_rows = max(1, int(env("RESEARCH_LAKE_COMPACTOR_CHUNK_ROWS", "10000") or "10000"))
    min_date = None
    max_date = explicit_date_end
    if explicit_date:
        min_date = None
        max_date = None
    elif explicit_date_start:
        min_date = explicit_date_start
    elif lookback_days > 0:
        min_date = (dt.datetime.now(dt.timezone.utc).date() - dt.timedelta(days=lookback_days)).isoformat()

    client = s3_client()
    skipped_dates: dict[str, dict[str, int]] = {}
    deferred_dates: list[str] = []
    if explicit_date:
        candidate_dates = [explicit_date]
    else:
        end_date = max_date or dt.datetime.now(dt.timezone.utc).date().isoformat()
        candidate_dates = date_range(min_date, end_date) if min_date else []

    keys_by_date, discovered_by_lake = discover_manifest_keys_by_date(
        client,
        bucket,
        raw_prefix,
        candidate_dates,
        raw_lakes,
    )
    traffic_scale_by_project = (
        project_traffic_scale_by_key(keys_by_date, max(candidate_dates), 30)
        if schema_version >= 2 and candidate_dates
        else {}
    )

    loaded_by_lake = {source_lake: 0 for source_lake in raw_lakes}
    processed_dates = 0
    total_row_groups = 0
    total_rows = 0

    dates_to_process = selected_compaction_dates(keys_by_date, max_dates, date_order)
    selected_date_set = set(dates_to_process)
    deferred_dates = [date for date in sorted(keys_by_date) if date not in selected_date_set]

    for date in dates_to_process:
        oversized = {
            source_lake: len(keys)
            for source_lake, keys in keys_by_date[date].items()
            if max_samples > 0 and len(keys) > max_samples
        }
        if oversized:
            skipped_dates[date] = oversized
            continue

        date_row_groups, date_rows = write_manifest_keys_chunked_to_s3(
            client,
            bucket,
            curated_prefix,
            keys_by_date[date],
            chunk_rows,
            raw_lakes,
            traffic_scale_by_project,
        )
        for source_lake in raw_lakes:
            loaded_by_lake[source_lake] += len(keys_by_date[date][source_lake])
        processed_dates += 1
        total_row_groups += date_row_groups
        total_rows += date_rows

    print(json.dumps({
        "chunk_rows": chunk_rows,
        "date_order": date_order,
        "date_partitions_processed": processed_dates,
        "date_partitions_skipped": len(skipped_dates),
        "date_partitions_deferred": len(deferred_dates),
        "samples_loaded": sum(loaded_by_lake.values()),
        "samples_discovered_by_lake": discovered_by_lake,
        "samples_loaded_by_lake": loaded_by_lake,
        "row_groups": total_row_groups,
        "rows": total_rows,
        "skipped_dates": skipped_dates,
        "deferred_dates": deferred_dates,
        "curated_prefix": curated_prefix,
        "schema_version": schema_version,
    }, sort_keys=True))


if __name__ == "__main__":
    main()
