"""Rebuild `t5_book_anchored_r4_rows.csv` from the recovered producer logic.

The recovered writer is `htf_structure_r4_stress.py` (row ledger at the end of
its `main()`).  Its stress-test scaffolding — the frozen prediction hash guard,
the bootstrap reality check and the grid/regime tables — only applies to the
frozen August frame, so this runner reuses the producer's own functions for the
computation itself and skips the frozen-only reporting:

    htf.load_t5(end)            frozen inputs + September reliability ledger
    stress.prepare_features()   BOOK_SHAPE + three VWAP anchors, aligned
    stress.features_for()       BOOK_PLUS_ANCHORED_VWAP (full raw set)
    stress.fit_policy()         logit C=0.003, window 5760, minimum 1536,
                                refit 96, then coverage_controlled_policy

No parameter, feature, schedule or label rule is altered, and no value is
imputed.  Output is reconstruction output (`c85-reconstruction-r1`): the
archived prefix is compared and any difference is reported explicitly rather
than presented as parity.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

LEDGER_COLUMNS = [
    "ts",
    "label",
    "base_direction",
    "candidate_probability_correct",
    "candidate_directional_rank",
    "active_threshold",
    "trailing_coverage",
    "candidate_prediction",
    "control_prediction",
]


def _prefix_report(reference_path: Path, produced: pd.DataFrame) -> dict:
    reference = pd.read_csv(reference_path, parse_dates=["ts"])
    reference["ts"] = pd.to_datetime(reference.ts, utc=True)
    boundary = reference.ts.max()
    candidate = produced[produced.ts <= boundary].reset_index(drop=True)
    report = {
        "reference_rows": int(len(reference)),
        "candidate_prefix_rows": int(len(candidate)),
        "reference_end": boundary.isoformat(),
        "timestamp_keys_identical": bool(
            len(candidate) == len(reference) and reference.ts.equals(candidate.ts)
        ),
        "columns_identical": list(reference.columns) == list(candidate.columns),
        "differences": {},
    }
    if not (report["timestamp_keys_identical"] and report["columns_identical"]):
        return report
    for column in reference.columns:
        if column == "ts":
            continue
        a = pd.to_numeric(reference[column], errors="coerce").to_numpy(float)
        b = pd.to_numeric(candidate[column], errors="coerce").to_numpy(float)
        both = ~np.isnan(a) & ~np.isnan(b)
        delta = float(np.max(np.abs(a[both] - b[both]))) if both.any() else 0.0
        mask_equal = bool((np.isnan(a) == np.isnan(b)).all())
        if delta != 0.0 or not mask_equal:
            report["differences"][column] = {
                "max_abs_difference": delta,
                "missingness_identical": mask_equal,
                "changed_rows": int((np.isnan(a) != np.isnan(b)).sum() + (both & (a != b)).sum()),
            }
    report["prefix_identical"] = not report["differences"]
    return report


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--stage-root", required=True, type=Path)
    parser.add_argument("--end", required=True)
    parser.add_argument("--audit-out", type=Path, default=None)
    args = parser.parse_args()

    root: Path = args.stage_root.resolve()
    end = pd.Timestamp(args.end)
    if end.tzinfo is None or (end.minute % 15) or end.second:
        raise SystemExit("--end must be an absolute quarter-hour UTC timestamp")

    sys.path.insert(0, str(root))
    sys.path.insert(0, str(root / "external_research"))
    from external_research import htf_structure_r3_models as htf  # noqa: E402
    from external_research import htf_structure_r4_stress as stress  # noqa: E402

    out = root / "external_research" / "htf_structure_r3_output"
    destination = out / "t5_book_anchored_r4_rows.csv"
    reference_path = destination.with_suffix(".frozen.csv")
    if destination.exists() and not reference_path.exists():
        reference_path.write_bytes(destination.read_bytes())

    frame = htf.load_t5(end=end)
    base, raw, feature_map = stress.prepare_features(frame)
    features = stress.features_for(base, feature_map, raw)
    probability, prediction, rank, threshold, trailing, fits, first_fit = stress.fit_policy(
        frame, features
    )
    control = frame.prediction.fillna(0).to_numpy(np.int8)

    ledger = pd.DataFrame(
        {
            "ts": frame.ts,
            "label": frame.label,
            "base_direction": frame.base_direction,
            "candidate_probability_correct": probability,
            "candidate_directional_rank": rank,
            "active_threshold": threshold,
            "trailing_coverage": trailing,
            "candidate_prediction": prediction,
            "control_prediction": control,
        }
    )[LEDGER_COLUMNS]
    ledger.to_csv(destination, index=False)

    ts = pd.to_datetime(ledger.ts, utc=True)
    september = ts >= pd.Timestamp("2026-09-01T00:00:00Z")
    audit = {
        "identity": "c85-reconstruction-r1::T5_BOOK_ANCHORED_VWAP_R4_ROWS",
        "lineage": "RECONSTRUCTION",
        "inherits_archived_performance": False,
        "selected_candidate": "BOOK_PLUS_ANCHORED_VWAP",
        "parameters": {
            "c_value": 0.003,
            "window": htf.T5_WINDOW,
            "minimum": htf.T5_MINIMUM,
            "refit_every": htf.T5_REFIT,
            "feature_count": len(features),
        },
        "requested_end_exclusive": end.isoformat(),
        "rows": int(len(ledger)),
        "first_target": ts.min().isoformat(),
        "latest_target": ts.max().isoformat(),
        "fit_count": int(fits),
        "first_fit_ts": first_fit,
        "quarter_hour_aligned": bool(
            ((ts.dt.minute % 15) == 0).all() and (ts.dt.second == 0).all()
        ),
        "strictly_increasing_unique": bool(ts.is_monotonic_increasing and ts.is_unique),
        "missing_quarter_hours": int(
            len(pd.date_range(ts.min(), ts.max(), freq="15min")) - len(ledger)
        ),
        "september_rows": int(september.sum()),
        "september_calls": int((ledger.candidate_prediction[september] != 0).sum()),
        "destination": str(destination),
    }
    if reference_path.exists():
        audit["frozen_prefix"] = _prefix_report(reference_path, ledger.assign(ts=ts))

    text = json.dumps(audit, indent=2)
    print(text)
    if args.audit_out:
        args.audit_out.write_text(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
