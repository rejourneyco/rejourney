import gzip
import importlib.util
import json
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[2]
READER_PATH = ROOT / "scripts" / "research_lake_training_reader.py"
spec = importlib.util.spec_from_file_location("research_lake_training_reader", READER_PATH)
reader = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(reader)


def screenshot_row(columns=64, rows=128):
    cells = columns * rows
    return {
        "source_kind": "screenshots",
        "recommended_encoder": "screenshot_grid_cnn",
        "grid_columns": columns,
        "grid_rows": rows,
        "luma_grid": [0] * cells,
        "edge_grid": [1] * cells,
        "color_grid": [2] * cells,
    }


def test_validates_variable_screenshot_shapes():
    reader.validate_ui_frame(screenshot_row(64, 128))
    reader.validate_ui_frame(screenshot_row(128, 64))
    reader.validate_ui_frame(screenshot_row(96, 128))
    reader.validate_ui_frame(screenshot_row(128, 96))


def test_rejects_bad_grid_lengths():
    row = screenshot_row()
    row["edge_grid"] = [1]

    with pytest.raises(reader.ResearchLakeValidationError, match="edge_grid"):
        reader.validate_ui_frame(row)


def test_reshapes_grid_using_row_dimensions():
    row = screenshot_row(4, 2)
    row["luma_grid"] = list(range(8))

    assert reader.reshape_visual_grid(row, "luma_grid") == [[0, 1, 2, 3], [4, 5, 6, 7]]


def test_accepts_sparse_hierarchy_rows_with_cadence_and_alignment():
    reader.validate_ui_frame({
        "source_kind": "hierarchy",
        "recommended_encoder": "mobile_hierarchy_encoder",
        "hierarchy_snapshot_sparse": True,
        "hierarchy_capture_cadence": "per_visual_frame",
        "hierarchy_capture_alignment": "screenshot_frame_aligned",
    })


def test_rejects_hierarchy_rows_without_cadence():
    with pytest.raises(reader.ResearchLakeValidationError, match="hierarchy_capture_cadence"):
        reader.validate_ui_frame({
            "source_kind": "hierarchy",
            "recommended_encoder": "mobile_hierarchy_encoder",
            "hierarchy_snapshot_sparse": False,
            "hierarchy_capture_alignment": "screenshot_frame_aligned",
        })


def test_accepts_rrweb_event_kinds_and_rejects_unknown_kind():
    for kind in reader.RRWEB_EVENT_KINDS:
        reader.validate_ui_frame({
            "source_kind": "rrweb",
            "recommended_encoder": "rrweb_dom_encoder",
            "rrweb_event_kind": kind,
        })

    with pytest.raises(reader.ResearchLakeValidationError, match="unsupported rrweb_event_kind"):
        reader.validate_ui_frame({
            "source_kind": "rrweb",
            "recommended_encoder": "rrweb_dom_encoder",
            "rrweb_event_kind": "raw_dom_dump",
        })


def test_validate_file_reads_jsonl_and_gzip(tmp_path):
    plain = tmp_path / "ui_frames.jsonl"
    gzipped = tmp_path / "ui_frames.jsonl.gz"
    row = screenshot_row(4, 2)
    payload = json.dumps(row) + "\n"
    plain.write_text(payload, encoding="utf-8")
    with gzip.open(gzipped, "wt", encoding="utf-8") as handle:
        handle.write(payload)

    assert reader.validate_file(plain) == 1
    assert reader.validate_file(gzipped) == 1
