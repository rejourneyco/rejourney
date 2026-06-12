#!/usr/bin/env python3
"""Validate and reshape research-lake rows before model training."""

from __future__ import annotations

import argparse
import gzip
import json
from pathlib import Path
from typing import Any, Iterable


GRID_ENCODERS = {
    "screenshot_grid_cnn",
    "screenshot_grid_transformer",
}
HIERARCHY_ENCODERS = {
    "mobile_hierarchy_encoder",
    "ui_hierarchy_encoder",
}
RRWEB_ENCODERS = {
    "rrweb_dom_encoder",
}
RRWEB_EVENT_KINDS = {
    "full_snapshot",
    "meta",
    "mutation",
    "scroll",
    "viewport_resize",
    "incremental",
    "event",
}
GRID_FIELDS = ("luma_grid", "edge_grid", "color_grid")


class ResearchLakeValidationError(ValueError):
    """Raised when a row cannot be safely consumed by training code."""


def encoder_family(row: dict[str, Any]) -> str:
    encoder = row.get("recommended_encoder")
    source_kind = row.get("source_kind")
    if encoder in GRID_ENCODERS or source_kind == "screenshots":
        return "visual_grid"
    if encoder in HIERARCHY_ENCODERS or source_kind == "hierarchy":
        return "mobile_hierarchy"
    if encoder in RRWEB_ENCODERS or source_kind == "rrweb":
        return "web_dom"
    return "unknown"


def reshape_visual_grid(row: dict[str, Any], field: str) -> list[list[int]]:
    columns = _positive_int(row.get("grid_columns"), "grid_columns")
    rows = _positive_int(row.get("grid_rows"), "grid_rows")
    values = row.get(field)
    if not isinstance(values, list):
        raise ResearchLakeValidationError(f"{field} must be a list")
    expected = columns * rows
    if len(values) != expected:
        raise ResearchLakeValidationError(f"{field} has {len(values)} cells, expected {expected}")
    return [values[offset:offset + columns] for offset in range(0, expected, columns)]


def validate_ui_frame(row: dict[str, Any]) -> None:
    family = encoder_family(row)
    if family == "visual_grid":
        columns = _positive_int(row.get("grid_columns"), "grid_columns")
        rows = _positive_int(row.get("grid_rows"), "grid_rows")
        expected = columns * rows
        for field in GRID_FIELDS:
            values = row.get(field)
            if not isinstance(values, list):
                raise ResearchLakeValidationError(f"{field} must be a list")
            if len(values) != expected:
                raise ResearchLakeValidationError(f"{field} has {len(values)} cells, expected {expected}")
        return

    if family == "mobile_hierarchy":
        if "hierarchy_snapshot_sparse" not in row:
            raise ResearchLakeValidationError("hierarchy_snapshot_sparse is required")
        if not row.get("hierarchy_capture_cadence"):
            raise ResearchLakeValidationError("hierarchy_capture_cadence is required")
        if not row.get("hierarchy_capture_alignment"):
            raise ResearchLakeValidationError("hierarchy_capture_alignment is required")
        return

    if family == "web_dom":
        event_kind = row.get("rrweb_event_kind")
        if event_kind not in RRWEB_EVENT_KINDS:
            raise ResearchLakeValidationError(f"unsupported rrweb_event_kind: {event_kind}")
        return

    raise ResearchLakeValidationError("unknown encoder family")


def iter_jsonl(path: Path) -> Iterable[dict[str, Any]]:
    opener = gzip.open if path.suffix == ".gz" else open
    with opener(path, "rt", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, start=1):
            if not line.strip():
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError as exc:
                raise ResearchLakeValidationError(f"{path}:{line_number}: invalid JSON") from exc
            if not isinstance(row, dict):
                raise ResearchLakeValidationError(f"{path}:{line_number}: row must be an object")
            yield row


def validate_file(path: Path) -> int:
    count = 0
    for row in iter_jsonl(path):
        validate_ui_frame(row)
        count += 1
    return count


def _positive_int(value: Any, field: str) -> int:
    if not isinstance(value, int) or value <= 0:
        raise ResearchLakeValidationError(f"{field} must be a positive integer")
    return value


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("paths", nargs="+", type=Path)
    args = parser.parse_args()

    total = 0
    for path in args.paths:
        total += validate_file(path)
    print(json.dumps({"rows": total}, sort_keys=True))


if __name__ == "__main__":
    main()
