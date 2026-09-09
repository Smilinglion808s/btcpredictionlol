"""Extend the T+5 forward bridge and rebuild the reliability ledger.

Chain reconstructed here (all recovered code, unchanged rules):

    live t45_pf_predictions / t10_bridge_predictions exports
      -> upload/t45-priceflow-q375-<end>.csv, upload/t10-bridge-r1-<end>.csv
      -> t5_precision_lab.load_frame(include_forward=True)
      -> t5_reliability_r2.main()
      -> t5_precision_output/t5_reliability_r2_rows.csv

The frozen exports stop at 2026-08-31T22:30Z, which is the single reason the
whole downstream R4 / R5 chain could not advance into September.  The only
edits applied to the recovered producers are the two export path constants and
`FORWARD_END`, each recorded by `audited_patch`.

Nothing is imputed: September rows that the live tables have not settled keep a
missing label and are therefore ineligible exactly as the original rules
require.  This is reconstruction output (`c85-reconstruction-r1`), not archive
parity; the archived prefix is compared and reported, never overwritten in the
durable cache.

Usage:
    python extend_t5_forward_bridge.py \
        --stage-root /tmp/c85stage/c85root \
        --t45-export /tmp/exports/t45.csv \
        --t10-export /tmp/exports/t10.csv \
        --end 2026-09-09T00:00:00Z
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from audited_patch import load_patched  # noqa: E402

FROZEN_T45 = "t45-priceflow-q375-2026-08-31.csv"
FROZEN_T10 = "t10-bridge-r1-2026-08-31.csv"
LEDGER = Path("t5_precision_output") / "t5_reliability_r2_rows.csv"


def _write_extension(export: Path, destination: Path, end: pd.Timestamp) -> dict:
    frame = pd.read_csv(export)
    ts = pd.to_datetime(frame.target_ts, utc=True)
    frame = frame[ts < end].copy()
    frame = frame.sort_values("target_ts").reset_index(drop=True)
    destination.write_text(frame.to_csv(index=False))
    kept = pd.to_datetime(frame.target_ts, utc=True)
    return {
        "source": str(export),
        "destination": str(destination),
        "rows": int(len(frame)),
        "first_target": kept.min().isoformat(),
        "latest_target": kept.max().isoformat(),
    }


def _prefix_report(frozen: Path, produced: pd.DataFrame, key: str = "ts") -> dict:
    reference = pd.read_csv(frozen, parse_dates=[key])
    reference[key] = pd.to_datetime(reference[key], utc=True)
    produced = produced.copy()
    produced[key] = pd.to_datetime(produced[key], utc=True)
    boundary = reference[key].max()
    candidate = produced[produced[key] <= boundary].reset_index(drop=True)
    report: dict = {
        "reference_rows": int(len(reference)),
        "candidate_prefix_rows": int(len(candidate)),
        "reference_end": boundary.isoformat(),
        "timestamp_keys_identical": bool(
            len(candidate) == len(reference) and reference[key].equals(candidate[key])
        ),
        "columns_identical": list(reference.columns) == list(candidate.columns),
        "differences": {},
    }
    if not (report["timestamp_keys_identical"] and report["columns_identical"]):
        return report
    for column in reference.columns:
        if column == key:
            continue
        left, right = reference[column], candidate[column]
        if left.dtype.kind == "f" or right.dtype.kind == "f":
            a = pd.to_numeric(left, errors="coerce").to_numpy(float)
            b = pd.to_numeric(right, errors="coerce").to_numpy(float)
            mask_equal = bool((np.isnan(a) == np.isnan(b)).all())
            both = ~np.isnan(a) & ~np.isnan(b)
            delta = float(np.max(np.abs(a[both] - b[both]))) if both.any() else 0.0
            if delta != 0.0 or not mask_equal:
                report["differences"][column] = {
                    "max_abs_difference": delta,
                    "missingness_identical": mask_equal,
                    "changed_rows": int(
                        (np.isnan(a) != np.isnan(b)).sum() + (both & (a != b)).sum()
                    ),
                }
        else:
            unequal = left.astype(str) != right.astype(str)
            if bool(unequal.any()):
                report["differences"][column] = {"changed_rows": int(unequal.sum())}
    report["prefix_identical"] = not report["differences"]
    return report


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--stage-root", required=True, type=Path)
    parser.add_argument("--t45-export", required=True, type=Path)
    parser.add_argument("--t10-export", required=True, type=Path)
    parser.add_argument("--end", required=True)
    parser.add_argument("--audit-out", type=Path, default=None)
    args = parser.parse_args()

    root: Path = args.stage_root.resolve()
    end = pd.Timestamp(args.end)
    if end.tzinfo is None:
        raise SystemExit("--end must carry an explicit UTC offset")
    if (end.minute % 15) or end.second or end.microsecond:
        raise SystemExit("--end must fall on an absolute quarter-hour boundary")
    stamp = end.strftime("%Y-%m-%d")

    upload = root / "upload"
    t45_destination = upload / f"t45-priceflow-q375-{stamp}.csv"
    t10_destination = upload / f"t10-bridge-r1-{stamp}.csv"
    exports = {
        "t45": _write_extension(args.t45_export, t45_destination, end),
        "t10": _write_extension(args.t10_export, t10_destination, end),
    }

    for name, frozen in (("t45", FROZEN_T45), ("t10", FROZEN_T10)):
        source = pd.read_csv(upload / frozen, usecols=["target_ts"], parse_dates=["target_ts"])
        produced = pd.read_csv(
            upload / (t45_destination.name if name == "t45" else t10_destination.name),
            usecols=["target_ts"],
            parse_dates=["target_ts"],
        )
        boundary = pd.to_datetime(source.target_ts, utc=True).max()
        kept = pd.to_datetime(produced.target_ts, utc=True)
        prefix = sorted(kept[kept <= boundary])
        reference = sorted(pd.to_datetime(source.target_ts, utc=True))
        exports[name]["frozen_prefix_keys_identical"] = prefix == reference
        exports[name]["frozen_prefix_end"] = boundary.isoformat()

    frozen_ledger = root / LEDGER
    backup = frozen_ledger.with_suffix(".frozen.csv")
    if frozen_ledger.exists() and not backup.exists():
        backup.write_bytes(frozen_ledger.read_bytes())

    lab = load_patched(
        root / "t5_precision_lab.py",
        "t5_precision_lab",
        {
            "T45_FORWARD": f'ROOT / "upload" / "{t45_destination.name}"',
            "T10_FORWARD": f'ROOT / "upload" / "{t10_destination.name}"',
            "FORWARD_END": f'pd.Timestamp("{end.isoformat()}")',
        },
    )
    sys.path.insert(0, str(root))
    import t5_reliability_r2 as reliability  # noqa: E402

    reliability.main()

    produced = pd.read_csv(frozen_ledger, parse_dates=["ts"])
    produced["ts"] = pd.to_datetime(produced.ts, utc=True)
    audit = {
        "identity": "c85-reconstruction-r1::T5_RELIABILITY_R2_EXTENSION",
        "lineage": "RECONSTRUCTION",
        "inherits_archived_performance": False,
        "requested_end_exclusive": end.isoformat(),
        "exports": exports,
        "lab_patch": lab.audit(),
        "ledger_rows": int(len(produced)),
        "ledger_first_target": produced.ts.min().isoformat(),
        "ledger_latest_target": produced.ts.max().isoformat(),
        "ledger_quarter_hour_aligned": bool(
            ((produced.ts.dt.minute % 15) == 0).all()
            and (produced.ts.dt.second == 0).all()
            and (produced.ts.dt.microsecond == 0).all()
        ),
        "ledger_strictly_increasing": bool(produced.ts.is_monotonic_increasing and produced.ts.is_unique),
        "ledger_missing_quarter_hours": int(
            len(pd.date_range(produced.ts.min(), produced.ts.max(), freq="15min")) - len(produced)
        ),
        "september_rows": int((produced.ts >= pd.Timestamp("2026-09-01T00:00:00Z")).sum()),
        "september_labelled_rows": int(
            ((produced.ts >= pd.Timestamp("2026-09-01T00:00:00Z")) & produced.label.notna()).sum()
        ),
    }
    if backup.exists():
        audit["frozen_prefix"] = _prefix_report(backup, produced)

    text = json.dumps(audit, indent=2)
    print(text)
    if args.audit_out:
        args.audit_out.write_text(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
