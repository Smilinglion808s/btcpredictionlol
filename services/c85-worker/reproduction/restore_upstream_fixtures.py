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
    # The R5_LAB_MANAGER package itself is not part of the recovery archives;
    # the byte-identical copy the archived C42 build consumed is used instead.
    "t5_hot_calibration_ledger": ("t5_hot_calibration_ledger.csv", ""),
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


KIT = Path(os.environ.get("C85_ARTIFACT_DIR", "/tmp/c85/kit"))
C42_INPUTS = "vault_work/legacy_c42/C42_MATURATION_CONSENSUS_R1/inputs"
ANCESTOR = UPX / "ancestor" / "data"
REF_COLUMNS = (
    "direct_probability_green",
    "primary_proposal",
    "primary_probability_correct",
    "primary_directional_rank",
    "primary_prediction",
)


def build_reference_packet() -> None:
    """upstream_packet.parquet + the two columns C42 parity reads.

    `expansion_selected_prediction` comes from the R4.3 hot-calibration ledger and
    `opportunity` from the C37 ledger — both are the exact copies the archived C42
    build consumed, taken from that package's own `inputs/` directory.
    """
    packet = pd.read_parquet(KIT / "fixtures" / "upstream_packet.parquet")
    packet["ts"] = pd.to_datetime(packet.ts, utc=True)
    base = UPX / "upstream" / C42_INPUTS
    hot = pd.read_csv(base / "t5_hot_calibration_ledger.csv", parse_dates=["ts"])
    c37 = pd.read_csv(base / "c37_shadow_ledger.csv", parse_dates=["ts"])
    for frame in (hot, c37):
        frame["ts"] = pd.to_datetime(frame.ts, utc=True)
    merged = packet.merge(
        hot[["ts", "expansion_selected_prediction"]], on="ts", how="left"
    ).merge(c37[["ts", "opportunity"]], on="ts", how="left")
    target = OUT.parent / "upstream_packet.parquet"
    merged.to_parquet(target, index=False)
    print(f"upstream_packet.parquet: {len(merged)} rows")


def build_c51_reference_tail() -> None:
    """Last 900 rows of the recovered C51 grid joined to the archived ledger."""
    frame = pd.read_parquet(ANCESTOR / "c51_training_frame.parquet")
    if "ts" not in frame.columns:
        frame = frame.reset_index()
    frame["ts"] = pd.to_datetime(frame["ts"], utc=True)
    ledger = pd.read_csv(
        ANCESTOR / "C51_TARGET_NATIVE_REBASE_R1_LEDGER.csv.gz", parse_dates=["ts"]
    )
    ledger["ts"] = pd.to_datetime(ledger.ts, utc=True)
    tail = (
        frame.merge(ledger[["ts", *REF_COLUMNS]], on="ts", how="inner")
        .sort_values("ts")
        .tail(900)
        .rename(columns={name: f"ref_{name}" for name in REF_COLUMNS})
    )
    tail.to_parquet(OUT.parent / "c51_reference_tail.parquet", index=False)
    print(f"c51_reference_tail.parquet: {len(tail)} rows -> {tail.ts.max()}")


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    missing: list[str] = []
    for name, (basename, fragment) in LEDGERS.items():
        try:
            source = find(basename, fragment)
        except FileNotFoundError:
            # A ledger absent from the recovery archives is a real gap, not a
            # crash: record it and let the remaining fixtures rebuild so the
            # parity suite can still gate everything that IS recoverable.
            missing.append(name)
            print(f"{name}: MISSING from {UPX} (fixture not built)")
            continue
        frame = pd.read_csv(source, parse_dates=["ts"])
        frame.to_parquet(OUT / f"{name}.parquet", index=False)
        print(f"{name}: {len(frame)} rows <- {source}")

    manifest = {}
    for producer in PRODUCERS:
        try:
            path = find(producer)
        except FileNotFoundError:
            missing.append(producer)
            print(f"{producer}: MISSING from {UPX} (not pinned)")
            continue
        manifest[producer] = {
            "path": str(path.relative_to(UPX)),
            "bytes": path.stat().st_size,
            "sha256": sha256(path),
        }
    if missing:
        (OUT / "MISSING.json").write_text(json.dumps(sorted(missing), indent=2))
    elif (OUT / "MISSING.json").exists():
        (OUT / "MISSING.json").unlink()
    (OUT / "UPSTREAM_RESOLVED.json").write_text(json.dumps(manifest, indent=2, sort_keys=True))
    print(f"UPSTREAM_RESOLVED.json: {len(manifest)} producers pinned")

    build_reference_packet()
    build_c51_reference_tail()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
