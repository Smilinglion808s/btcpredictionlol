"""Rebuild the (gitignored) upstream ledger fixtures from the recovered archives.

The parity fixtures under ``evaluation-fixtures/upstream/`` are large historical
intermediates that are never committed. This script regenerates them from the
expanded upstream archive so a fresh workspace can run the test suite:

    UPX=/tmp/upx python3 restore_upstream_fixtures.py

It writes one parquet per recovered ledger plus ``UPSTREAM_RESOLVED.json``,
which pins every named producer module by path, byte size and SHA-256.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path

import pandas as pd

UPX = Path(os.environ.get("UPX", "/tmp/upx"))
OUT = Path(__file__).resolve().parents[1] / "evaluation-fixtures" / "upstream"

# fixture name -> (basename of the recovered CSV, optional path fragment filter)
LEDGERS: dict[str, tuple[str, str]] = {
    "fee_coverage_shadow_ledger": ("fee_coverage_shadow_ledger.csv", ""),
    "fixed_floor_shadow_ledger": ("fixed_floor_shadow_ledger.csv", ""),
    "selected_shadow_ledger__c30_c70_lab_manager_r2_output": (
        "selected_shadow_ledger.csv", "c30_c70_lab_manager_r2_output"),
    "selected_shadow_ledger__t0_t5_win_containment_deep_dive_r1_output": (
        "selected_shadow_ledger.csv", "t0_t5_win_containment_deep_dive_r1_output"),
    "t5_hot_calibration_ledger": ("t5_hot_calibration_ledger.csv", "r5_lab_manager_output"),
    "t5_book_day4h_r4_1_rows": ("t5_book_day4h_r4_1_rows.csv", "htf_structure_r3_output"),
}

PRODUCERS = (
    "c30_c70_lab_manager_r2.py",
    "c37_balanced_maturation_r1.py",
    "evaluate_external_direction_r1.py",
    "htf_structure_r4_refine.py",
    "r5_lab_manager.py",
    "t0_t5_fee_coverage_frontier_r1.py",
    "t0_t5_win_containment_deep_dive_r1.py",
)


def find(basename: str, fragment: str = "") -> Path:
    matches = [p for p in UPX.rglob(basename) if fragment in str(p)]
    if not matches:
        raise FileNotFoundError(f"{basename} (fragment={fragment!r}) not in {UPX}")
    return sorted(matches, key=lambda p: len(str(p)))[0]


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    for name, (basename, fragment) in LEDGERS.items():
        source = find(basename, fragment)
        frame = pd.read_csv(source, parse_dates=["ts"])
        frame.to_parquet(OUT / f"{name}.parquet", index=False)
        print(f"{name}: {len(frame)} rows <- {source}")

    manifest = {}
    for producer in PRODUCERS:
        path = find(producer)
        manifest[producer] = {
            "path": str(path.relative_to(UPX)),
            "bytes": path.stat().st_size,
            "sha256": sha256(path),
        }
    (OUT / "UPSTREAM_RESOLVED.json").write_text(json.dumps(manifest, indent=2, sort_keys=True))
    print(f"UPSTREAM_RESOLVED.json: {len(manifest)} producers pinned")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
