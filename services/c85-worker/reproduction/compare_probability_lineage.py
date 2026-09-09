"""NO-FIT provenance check for `continuous_coverage_ledger.external_probability_green`.

Traces the archived probability column to its immediate upstream producer and
compares every archived intermediate that carries the same column, at the same
jointly finite target timestamps used by the single-block experiment at
position 6048 (2026-03-05 00:15Z .. 2026-03-06 00:00Z).

Nothing is refitted and no dataset is downloaded: this reads only files that
already exist in the recovered archive tree.

Lineage (read out of the recovered sources, not assumed):

    external_research/long_context_model.py
        model_specs(...)["ALL_HGB"] -> fit_head -> walk_forward_hgb
    net_monthly_waterfall_r1.py:main()
        freeze = T0_LONG_CONTEXT_R1_FREEZE.json    (selected_head)
        -> net_monthly_r1_output/t0_long_context_full_predictions.csv
        -> net_monthly_r1_output/net_monthly_final_selected_ledger.csv
    t0_t5_coverage_bridge_audit_r1.py  (reads the file above as `T0`)
        -> continuous_coverage_ledger.csv

Usage:  python3 compare_probability_lineage.py [--out report.json]
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
import pandas as pd

CACHE = Path("/mnt/documents/.lovable/c85-cache")
UPX = CACHE / "upx"
LAB2 = UPX / "upstream" / "vault_work" / "legacy_lab2" / "sources"

CONTINUOUS = (
    LAB2
    / "T0_T5_CONTINUOUS_COVERAGE_LAB_CHECKPOINT_R1.zip__expanded"
    / "continuous_coverage_ledger.csv"
)
CONTINUOUS_ALT = (
    LAB2
    / "T0_T5_FEE_COVERAGE_FRONTIER_R1_PACKAGE.zip__expanded"
    / "restored_checkpoint"
    / "continuous_r1"
    / "continuous_coverage_ledger.csv"
)
SELECTED = (
    LAB2
    / "NET_MONTHLY_R1_RESEARCH_PACKAGE.zip__expanded"
    / "external_research"
    / "net_monthly_r1_output"
    / "net_monthly_final_selected_ledger.csv"
)
FREEZE = (
    LAB2
    / "T0_EXTERNAL_RESOURCE_HUNT_R1_PACKAGE.zip__expanded"
    / "T0_EXTERNAL_RESOURCE_HUNT_R1"
    / "external_research"
    / "long_context_output"
    / "T0_LONG_CONTEXT_R1_FREEZE.json"
)
USER_ROWS = FREEZE.parent / "long_context_user_rows.csv"
PRODUCER = (
    LAB2
    / "T0_T5_CONTINUOUS_COVERAGE_LAB_CHECKPOINT_R1.zip__expanded"
    / "net_monthly_waterfall_r1.py"
)
BRIDGE = PRODUCER.parent / "t0_t5_coverage_bridge_audit_r1.py"
MODEL = CACHE / "c85root" / "external_research" / "long_context_model.py"

# The single-block experiment window (position 6048 of the rebuilt frame).
WINDOW = (pd.Timestamp("2026-03-05T00:15:00Z"), pd.Timestamp("2026-03-06T00:00:00Z"))
# The immediate upstream file the bridge reads; absent from every archive.
MISSING_IMMEDIATE = "external_research/net_monthly_r1_output/t0_long_context_full_predictions.csv"


def sha256_file(path: Path, chunk: int = 1 << 20) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while True:
            block = handle.read(chunk)
            if not block:
                break
            digest.update(block)
    return digest.hexdigest()


def load(path: Path) -> pd.DataFrame:
    frame = pd.read_csv(path, parse_dates=["ts"], low_memory=False)
    frame["ts"] = pd.to_datetime(frame.ts, utc=True)
    return frame


def window_slice(frame: pd.DataFrame, column: str) -> pd.Series:
    inside = frame[(frame.ts >= WINDOW[0]) & (frame.ts <= WINDOW[1])]
    return pd.Series(inside[column].to_numpy(float), index=inside.ts)


def compare(a: pd.Series, b: pd.Series) -> dict[str, object]:
    joined = pd.concat([a.rename("a"), b.rename("b")], axis=1, join="inner")
    both = np.isfinite(joined.a) & np.isfinite(joined.b)
    mask_mismatch = int((np.isfinite(joined.a) != np.isfinite(joined.b)).sum())
    delta = (joined.a[both] - joined.b[both]).abs()
    return {
        "overlap_rows": int(len(joined)),
        "jointly_finite": int(both.sum()),
        "finite_mask_mismatches": mask_mismatch,
        "max_abs_difference": float(delta.max()) if len(delta) else None,
        "bitwise_identical": bool(len(delta) and delta.max() == 0.0),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="/tmp/c85_probability_lineage.json")
    arguments = parser.parse_args()

    freeze = json.loads(FREEZE.read_text())
    report: dict[str, object] = {
        "purpose": "trace continuous_coverage_ledger.external_probability_green upstream; no fits, no downloads",
        "window": [str(WINDOW[0]), str(WINDOW[1])],
        "files": {},
        "lineage": {
            "immediate_upstream_of_continuous_ledger": MISSING_IMMEDIATE,
            "immediate_upstream_present": False,
            "producing_source": "net_monthly_waterfall_r1.py::main",
            "consumer_source": "t0_t5_coverage_bridge_audit_r1.py (T0 constant)",
            "head_selection": {
                "selected_policy": freeze["selected_policy"],
                "selected_head": freeze["selected_head"],
                "retain": freeze["retain"],
                "family": freeze["head_spec"]["family"],
                "feature_count": freeze["head_spec"]["feature_count"],
                "first_fit_ts": freeze["head_spec"]["first_fit_ts"],
                "model_timing": freeze["model_timing"],
                "external_features_sha256": freeze["external_features_sha256"],
            },
        },
        "comparisons": {},
    }

    for name, path in (
        ("continuous_coverage_ledger", CONTINUOUS),
        ("continuous_coverage_ledger__fee_coverage_copy", CONTINUOUS_ALT),
        ("net_monthly_final_selected_ledger", SELECTED),
        ("T0_LONG_CONTEXT_R1_FREEZE.json", FREEZE),
        ("long_context_user_rows.csv", USER_ROWS),
        ("net_monthly_waterfall_r1.py", PRODUCER),
        ("t0_t5_coverage_bridge_audit_r1.py", BRIDGE),
        ("long_context_model.py", MODEL),
    ):
        report["files"][name] = {
            "path": str(path),
            "exists": path.exists(),
            "bytes": path.stat().st_size if path.exists() else None,
            "sha256": sha256_file(path) if path.exists() else None,
        }

    continuous = load(CONTINUOUS)
    selected = load(SELECTED)
    alt = load(CONTINUOUS_ALT)

    reference = window_slice(continuous, "external_probability_green")
    report["comparisons"]["continuous_vs_net_monthly_selected"] = compare(
        reference, window_slice(selected, "external_probability_green")
    )
    report["comparisons"]["continuous_vs_fee_coverage_copy"] = compare(
        reference, window_slice(alt, "external_probability_green")
    )
    report["comparisons"]["continuous_vs_selected_full_history"] = compare(
        pd.Series(
            continuous.external_probability_green.to_numpy(float), index=continuous.ts
        ),
        pd.Series(
            selected.external_probability_green.to_numpy(float), index=selected.ts
        ),
    )
    report["window_reference_rows"] = int(len(reference))
    report["window_reference_finite"] = int(np.isfinite(reference).sum())
    report["window_reference_sha256"] = hashlib.sha256(
        np.ascontiguousarray(reference.to_numpy(float)).tobytes()
    ).hexdigest()

    # A ledger whose probabilities start only after the user period cannot
    # discriminate inside a March window; record that explicitly.
    user_rows = load(USER_ROWS)
    report["long_context_user_rows_window"] = {
        "first_ts": str(user_rows.ts.min()),
        "last_ts": str(user_rows.ts.max()),
        "covers_experiment_window": bool(
            (user_rows.ts <= WINDOW[1]).any() and (user_rows.ts >= WINDOW[0]).any()
        ),
    }

    Path(arguments.out).write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
