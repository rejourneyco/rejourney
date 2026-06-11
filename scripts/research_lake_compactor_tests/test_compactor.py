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
        "quality": {"quality_tier": "usable", "pii_scan": "passed", "ui_frame_count": 1},
        "interactions": [
            {"index": 0, "kind": "tap", "elapsed_ms_bucket": 500, "funnel_transition": "cart_add", "screen_key": "screen", "target_key": "target"}
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


@pytest.mark.skipif(pq is None, reason="pyarrow is not installed")
def test_parquet_bytes_round_trips():
    pa = pytest.importorskip("pyarrow")
    payload = compactor.parquet_bytes([
        {"sample_key": "a", "sample_date": "2026-06-11", "platform": "ios", "converted": True}
    ])
    table = pq.read_table(source=pa.BufferReader(payload))
    assert table.num_rows == 1
    assert table.column("sample_key").to_pylist() == ["a"]
