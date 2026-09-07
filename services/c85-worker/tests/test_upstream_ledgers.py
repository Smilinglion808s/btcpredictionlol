"""Integrity checks for the recovered upstream leaf ledgers.

These fixtures are historical intermediates used ONLY for stage-by-stage parity
of a transcribed producer. Replaying them is never evidence that a producer was
ported (see experts/leaf.py).
"""
from __future__ import annotations

import json
from pathlib import Path

import pandas as pd
import pytest

ROOT = Path(__file__).resolve().parents[1]
UPSTREAM = ROOT / "evaluation-fixtures" / "upstream"

EXPECTED = {
    "fee_coverage_shadow_ledger": (19780, "2026-02-06 23:00:00+00:00", "2026-08-31 23:45:00+00:00"),
    "selected_shadow_ledger__c30_c70_lab_manager_r2_output": (
        19780, "2026-02-06 23:00:00+00:00", "2026-08-31 23:45:00+00:00"),
    "selected_shadow_ledger__t0_t5_win_containment_deep_dive_r1_output": (
        19780, "2026-02-06 23:00:00+00:00", "2026-08-31 23:45:00+00:00"),
    "fixed_floor_shadow_ledger": (19780, "2026-02-06 23:00:00+00:00", "2026-08-31 23:45:00+00:00"),
    "t5_hot_calibration_ledger": (26124, "2025-12-01 00:00:00+00:00", "2026-08-31 22:30:00+00:00"),
    "t5_book_day4h_r4_1_rows": (26124, "2025-12-01 00:00:00+00:00", "2026-08-31 22:30:00+00:00"),
}


@pytest.mark.parametrize("name", sorted(EXPECTED))
def test_ledger_shape_and_window(name: str) -> None:
    path = UPSTREAM / f"{name}.parquet"
    assert path.exists(), f"missing recovered ledger fixture: {path}"
    frame = pd.read_parquet(path)
    rows, start, end = EXPECTED[name]
    assert len(frame) == rows
    ts = pd.to_datetime(frame["ts"], utc=True)
    assert str(ts.min()) == start
    assert str(ts.max()) == end


def test_resolved_manifest_covers_every_producer() -> None:
    manifest = json.loads((UPSTREAM / "UPSTREAM_RESOLVED.json").read_text())
    producers = [k for k in manifest if k.endswith(".py")]
    assert sorted(producers) == sorted(
        [
            "c30_c70_lab_manager_r2.py",
            "c37_balanced_maturation_r1.py",
            "evaluate_external_direction_r1.py",
            "htf_structure_r4_refine.py",
            "r5_lab_manager.py",
            "t0_t5_fee_coverage_frontier_r1.py",
            "t0_t5_win_containment_deep_dive_r1.py",
        ]
    )
    for entry in manifest.values():
        assert len(entry["sha256"]) == 64
        assert entry["bytes"] > 0


def test_no_leaf_dependency_claims_missing_artifacts() -> None:
    import sys

    sys.path.insert(0, str(ROOT / "src"))
    from experts.dependencies import LEAF_DEPENDENCIES  # noqa: PLC0415

    for dep in LEAF_DEPENDENCIES:
        assert dep.status == "UNPORTED", dep.summary()
        assert not dep.missing_artifacts, dep.summary()
        assert dep.source_modules, dep.key
