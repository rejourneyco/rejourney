import importlib.util
from pathlib import Path

import pytest

try:
    import pyarrow.parquet as pq
except Exception:  # pragma: no cover - local env may not have pyarrow.
    pq = None


ROOT = Path(__file__).resolve().parents[2]
COMPACTOR_PATH = ROOT / "scripts" / "research_lake_compactor" / "compactor.py"
spec = importlib.util.spec_from_file_location("research_lake_compactor", COMPACTOR_PATH)
compactor = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(compactor)


def base_manifest(lake):
    return {
        "lake": lake,
        "project_key": "project_hash",
        "sample_key": "sample_hash",
        "sample_date": "2026-06-11",
        "platform": "ios",
        "app_version_bucket": "1.2",
        "sdk_version_bucket": "1.3",
        "duration_seconds_bucket": 90,
        "retention_days": 30,
        "source": {"has_visual_source": lake == "interaction"},
        "visitor_context": {"is_bounced": False, "screens_visited_count": 2},
        "metrics": {
            "total_events": 3,
            "touch_count": 1,
            "api_total_count": 2,
            "api_error_count": 1,
            "crash_count": 0,
            "anr_count": 0,
            "error_count": 1,
        },
        "labels": {
            "is_conversion_session": True,
            "max_funnel_stage_reached": "purchase",
            "conversion_revenue_bucket": 150,
        },
    }


def test_interaction_sample_builds_ui_and_combined_rows():
    sample = {
        "manifest": base_manifest("interaction"),
        "quality": {
            "quality_tier": "usable",
            "pii_scan": "passed",
            "ui_frame_count": 1,
            "capture_profile": {
                "hierarchy": {
                    "cadence_mode": "every_other_visual_frame",
                    "alignment": "screenshot_frame_aligned",
                    "observed_median_interval_ms": 1000,
                    "observed_snapshot_count": 12,
                    "hierarchy_screenshot_alignment_ratio": 0.86,
                    "screenshot_hierarchy_coverage_ratio": 0.82,
                    "alignment_threshold_ratio": 0.8,
                    "alignment_tolerance_ms": 500,
                },
                "rrweb": {
                    "replay_basis": "snapshot_plus_incremental",
                    "full_snapshot_count": 1,
                    "mutation_count": 14,
                    "dom_skeleton_element_count": 240,
                    "viewport_missing_count": 0,
                    "page_missing_count": 0,
                },
                "masking": {
                    "text_input_masking_policy": "secure_only",
                    "image_video_masking_policy": "all",
                    "screenshot_pixels_post_redaction": True,
                    "hierarchy_masked_element_count": 3,
                    "hierarchy_masked_input_count": 2,
                    "hierarchy_media_surface_count": 1,
                    "hierarchy_keyboard_or_system_element_count": 1,
                    "rrweb_masked_element_count": 4,
                    "rrweb_masked_input_value_count": 2,
                    "rrweb_masked_media_attribute_count": 1,
                    "rrweb_media_surface_count": 1,
                },
            },
        },
        "interactions": [
            {
                "index": 0,
                "kind": "tap",
                "elapsed_ms_bucket": 500,
                "funnel_transition": "cart_add",
                "screen_key": "screen",
                "target_key": "target",
                "x_norm_bucket": 125,
                "y_norm_bucket": 750,
                "x_cell": 8,
                "y_cell": 96,
                "touch_grid_columns": 64,
                "touch_grid_rows": 128,
                "screen_orientation": "portrait",
                "screen_form_factor": "phone",
                "viewport_source": "event",
            }
        ],
        "ui_frames": [{"frame_key": "frame", "source_kind": "screenshots", "source_index": 0}],
        "ui_skeleton": [{"element_key": "element", "screen_key": "screen", "role": "cta_cart_add"}],
    }

    rows = compactor.rows_from_sample("interaction", sample)

    assert rows[("interaction", "session_fact")]
    assert rows[("interaction", "event_fact")]
    assert rows[("interaction", "ui_frame_fact")]
    assert rows[("interaction", "ui_skeleton_fact")]
    assert rows[("combined", "session_fact")]
    assert rows[("combined", "event_fact")]
    assert rows[("interaction", "event_fact")][0]["x_cell"] == 8
    assert rows[("interaction", "quality_fact")][0]["hierarchy_cadence_mode"] == "every_other_visual_frame"
    assert rows[("interaction", "quality_fact")][0]["hierarchy_alignment"] == "screenshot_frame_aligned"
    assert rows[("interaction", "quality_fact")][0]["hierarchy_observed_median_interval_ms"] == 1000
    assert rows[("interaction", "quality_fact")][0]["hierarchy_screenshot_alignment_ratio"] == 0.86
    assert rows[("interaction", "quality_fact")][0]["screenshot_hierarchy_coverage_ratio"] == 0.82
    assert rows[("interaction", "quality_fact")][0]["hierarchy_alignment_threshold_ratio"] == 0.8
    assert rows[("interaction", "quality_fact")][0]["hierarchy_alignment_tolerance_ms"] == 500
    assert rows[("interaction", "quality_fact")][0]["rrweb_replay_basis"] == "snapshot_plus_incremental"
    assert rows[("interaction", "quality_fact")][0]["rrweb_full_snapshot_count"] == 1
    assert rows[("interaction", "quality_fact")][0]["rrweb_mutation_count"] == 14
    assert rows[("interaction", "quality_fact")][0]["rrweb_dom_skeleton_element_count"] == 240
    assert rows[("interaction", "quality_fact")][0]["text_input_masking_policy"] == "secure_only"
    assert rows[("interaction", "quality_fact")][0]["image_video_masking_policy"] == "all"
    assert rows[("interaction", "quality_fact")][0]["screenshot_pixels_post_redaction"] is True
    assert rows[("interaction", "quality_fact")][0]["hierarchy_media_surface_count"] == 1
    assert rows[("interaction", "quality_fact")][0]["hierarchy_keyboard_or_system_element_count"] == 1
    assert rows[("interaction", "quality_fact")][0]["rrweb_masked_input_value_count"] == 2
    assert rows[("interaction", "quality_fact")][0]["rrweb_media_surface_count"] == 1
    assert rows[("combined", "event_fact")][0]["y_cell"] == 96
    assert rows[("combined", "event_fact")][0]["touch_grid_rows"] == 128
    assert rows[("combined", "event_fact")][0]["screen_form_factor"] == "phone"
    assert rows[("combined", "event_fact")][0]["viewport_source"] == "event"


def test_behavioral_sample_builds_behavioral_tables_without_ui_rows():
    manifest = base_manifest("behavioral_outcomes")
    manifest["source"] = {"reason": "observe_only", "has_visual_source": False}
    sample = {
        "manifest": manifest,
        "quality": {"quality_tier": "usable", "pii_scan": "passed", "event_count": 2},
        "events": [
            {
                "event_index": 0,
                "event_family": "funnel",
                "event_kind": "event",
                "funnel_transition": "purchase_complete",
                "screen_key": "screen",
                "product_key": "behavioral-only-product-key",
            }
        ],
        "session_metrics": {"api_total_count": 3, "api_error_count": 1, "crash_count": 0, "error_count": 1},
        "labels": {"is_conversion_session": True, "has_api_failure": True, "has_stability_failure": True},
    }

    rows = compactor.rows_from_sample("behavioral_outcomes", sample)

    assert rows[("behavioral_outcomes", "session_fact")]
    assert rows[("behavioral_outcomes", "event_fact")]
    assert rows[("behavioral_outcomes", "stability_fact")]
    assert rows[("behavioral_outcomes", "network_fact")]
    assert rows[("behavioral_outcomes", "training_labels")]
    assert ("behavioral_outcomes", "ui_frame_fact") not in rows
    assert ("behavioral_outcomes", "ui_skeleton_fact") not in rows
    assert "product_key" not in rows[("combined", "event_fact")][0]


def test_eligible_manifest_keys_are_grouped_by_complete_date_partition():
    keys = [
        "v1/lake=interaction/project_key=a/date=2026-06-10/sample_key=one/manifest.json",
        "v1/lake=interaction/project_key=a/date=2026-06-10/sample_key=one/events.jsonl.gz",
        "v1/lake=interaction/project_key=a/date=2026-06-11/sample_key=two/manifest.json",
        "v1/lake=interaction/project_key=a/date=2026-06-12/sample_key=three/manifest.json",
        "v1/lake=interaction/project_key=a/date=bad/sample_key=four/manifest.json",
    ]

    grouped = compactor.eligible_manifest_keys_by_date(keys, explicit_date=None, min_date="2026-06-11")

    assert sorted(grouped) == ["2026-06-11", "2026-06-12"]
    assert grouped["2026-06-11"] == [
        "v1/lake=interaction/project_key=a/date=2026-06-11/sample_key=two/manifest.json"
    ]


def test_chunked_writer_splits_large_partitions_without_redeleting(monkeypatch):
    class FakeClient:
        def __init__(self):
            self.deleted = []
            self.puts = []

        def put_object(self, **kwargs):
            self.puts.append(kwargs)

    client = FakeClient()

    monkeypatch.setattr(compactor, "delete_prefix", lambda _client, _bucket, prefix: client.deleted.append(prefix))
    monkeypatch.setattr(compactor, "parquet_bytes", lambda rows: f"rows={len(rows)}".encode("utf-8"))
    monkeypatch.setattr(compactor, "load_sample_from_s3", lambda _client, _bucket, key, _lake: {"key": key})

    def rows_from_sample(_lake, sample):
        return {
            ("combined", "event_fact"): [{
                "source_lake": "combined",
                "project_key": "project_hash",
                "sample_key": sample["key"],
                "sample_date": "2026-06-11",
                "platform": "ios",
                "event_index": 0,
                "event_family": "funnel",
            }]
        }

    monkeypatch.setattr(compactor, "rows_from_sample", rows_from_sample)

    row_groups, total_rows = compactor.write_manifest_keys_chunked_to_s3(
        client,
        "bucket",
        "v1_curated",
        {
            "interaction": ["sample-one", "sample-two", "sample-three"],
            "behavioral_outcomes": [],
        },
        chunk_rows=2,
    )

    assert row_groups == 2
    assert total_rows == 3
    assert client.deleted == ["v1_curated/source_lake=combined/table=event_fact/date=2026-06-11/event_family=funnel/"]
    assert len(client.puts) == 2
    assert client.puts[0]["Body"] == b"rows=2"
    assert client.puts[1]["Body"] == b"rows=1"


@pytest.mark.skipif(pq is None, reason="pyarrow is not installed")
def test_parquet_bytes_round_trips():
    pa = pytest.importorskip("pyarrow")
    payload = compactor.parquet_bytes([
        {"sample_key": "a", "sample_date": "2026-06-11", "platform": "ios", "converted": True}
    ])
    table = pq.read_table(source=pa.BufferReader(payload))
    assert table.num_rows == 1
    assert table.column("sample_key").to_pylist() == ["a"]
