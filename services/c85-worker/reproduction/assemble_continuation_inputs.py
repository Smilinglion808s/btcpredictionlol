"""Assemble and validate the resumable c85-reconstruction-r1 replay inputs.

Combines the stored full-origin frame (positions 0..23327, the exact frame the
31 bootstrap fits consumed) with the newly rebuilt full-origin September rows
(positions 23328..23423), and validates BEFORE any fitting:

* timestamp keys line up on the 15-minute grid with no gap or duplicate,
* the rebuilt frame reproduces the stored frame's schema,
* the metric columns of the new rows equal the canonical full-origin parquet,
* the previously unsettled 2026-09-01T00:00Z target gets its real label,
* every one of the 324 selected features is present on the new rows.

Nothing is imputed. A missing or disagreeing input is reported, not filled.
"""
from __future__ import annotations

import hashlib
import json
import os
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.experts import long_context as lc  # noqa: E402

STORED = Path(os.environ["C85_LC_STORED"])          # long_context_features.pkl
REBUILT = Path(os.environ["C85_LC_REBUILT"])        # september_full_origin_frame.pkl
METRICS = Path(os.environ["C85_LC_METRIC_PARQUET"])  # canonical metric slice
OUT = Path(os.environ["C85_LC_OUT"])
START = int(os.environ.get("C85_LC_START", "23328"))
COUNT = int(os.environ.get("C85_LC_COUNT", "96"))
STEP = pd.Timedelta(minutes=15)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    read = (lambda path: pd.read_parquet(path) if path.suffix == ".parquet"
            else pd.read_pickle(path))
    stored = read(STORED)
    rebuilt = read(REBUILT)
    report: dict[str, object] = {
        "stored": {"path": str(STORED), "sha256": sha256(STORED), "rows": int(len(stored))},
        "rebuilt": {"path": str(REBUILT), "sha256": sha256(REBUILT), "rows": int(len(rebuilt))},
    }

    if list(stored.columns) != list(rebuilt.columns):
        missing = [c for c in stored.columns if c not in rebuilt.columns]
        extra = [c for c in rebuilt.columns if c not in stored.columns]
        raise SystemExit(f"schema mismatch: missing={missing[:10]} extra={extra[:10]}")
    report["schema_columns"] = int(len(stored.columns))

    stored = stored.sort_values("target_ts").reset_index(drop=True)
    rebuilt = rebuilt.sort_values("target_ts").reset_index(drop=True)

    # Timestamp keys: the stored frame is the position authority.
    if len(stored) != START:
        raise SystemExit(f"stored frame has {len(stored)} rows, expected {START}")
    overlap = min(len(stored), len(rebuilt))
    if not stored.target_ts.iloc[:overlap].equals(rebuilt.target_ts.iloc[:overlap]):
        raise SystemExit("timestamp keys of stored and rebuilt frames disagree")
    tail = rebuilt.iloc[START:START + COUNT].copy()
    if len(tail) != COUNT:
        raise SystemExit(f"rebuilt frame supplies {len(tail)} continuation rows, need {COUNT}")
    expected = pd.date_range(stored.target_ts.iloc[-1] + STEP, periods=COUNT, freq=STEP)
    if not np.array_equal(tail.target_ts.to_numpy(), expected.to_numpy()):
        raise SystemExit("continuation timestamps are not the contiguous 15-minute grid")
    report["continuation_window"] = [tail.target_ts.iloc[0].isoformat(),
                                     tail.target_ts.iloc[-1].isoformat()]

    # The 2026-09-01T00:00Z target was unsettled: its label lives on the next row.
    stored_label = stored.binance_label.iloc[-1]
    real_label = rebuilt.binance_label.iloc[START - 1]
    report["settlement_of_last_stored_target"] = {
        "ts": stored.target_ts.iloc[-1].isoformat(),
        "stored_label": None if pd.isna(stored_label) else float(stored_label),
        "rebuilt_label": None if pd.isna(real_label) else float(real_label),
    }
    if not np.isfinite(real_label):
        raise SystemExit("the 2026-09-01T00:00Z label is not available in the rebuilt frame")
    stored = stored.copy()
    stored.loc[stored.index[-1], "binance_label"] = float(real_label)

    # Canonical metric slice comparison (same full origin, different runtime).
    canonical = pd.read_parquet(METRICS)
    if "target_ts" not in canonical.columns:
        canonical = canonical.reset_index()
    canonical["target_ts"] = pd.to_datetime(canonical.target_ts, utc=True)
    canonical = canonical.sort_values("target_ts").reset_index(drop=True)
    joined = tail.merge(canonical, on="target_ts", how="inner", suffixes=("", "_canon"))
    metric_columns = [c for c in tail.columns
                      if c.startswith("metric_") and f"{c}_canon" in joined.columns
                      and not pd.api.types.is_datetime64_any_dtype(tail[c])]
    # `metric_ts` is a timestamp and is excluded from the model inputs; it is
    # compared as an instant, never as a number.
    datetime_columns = [c for c in tail.columns
                        if c.startswith("metric_") and f"{c}_canon" in joined.columns
                        and pd.api.types.is_datetime64_any_dtype(tail[c])]
    datetime_equal = {
        c: bool(pd.to_datetime(joined[c], utc=True)
                .equals(pd.to_datetime(joined[f"{c}_canon"], utc=True)))
        for c in datetime_columns
    }
    checks = []
    worst = 0.0
    for column in metric_columns:
        left = pd.to_numeric(joined[column], errors="coerce").to_numpy(float)
        right = pd.to_numeric(joined[f"{column}_canon"], errors="coerce").to_numpy(float)
        mask_equal = bool(np.array_equal(np.isnan(left), np.isnan(right)))
        both = np.isfinite(left) & np.isfinite(right)
        diff = float(np.max(np.abs(left[both] - right[both]))) if both.any() else 0.0
        worst = max(worst, diff)
        checks.append({"column": column, "nan_masks_equal": mask_equal, "max_abs_diff": diff})
    report["metric_canonical_check"] = {
        "compared_rows": int(len(joined)),
        "compared_columns": len(metric_columns),
        "max_abs_diff": worst,
        "nan_mask_mismatches": [c["column"] for c in checks if not c["nan_masks_equal"]],
        "worst_columns": sorted(checks, key=lambda c: -c["max_abs_diff"])[:5],
        "timestamp_columns_equal": datetime_equal,
    }

    combined = pd.concat([stored, tail], ignore_index=True)
    prepared = lc.prepare_external_frame(combined)
    features = lc.feature_columns(list(prepared.columns))
    report["selected_features"] = len(features)
    block = prepared.iloc[START:START + COUNT]
    values = block[features].to_numpy(float)
    report["continuation_feature_completeness"] = {
        "rows": int(len(block)),
        "columns": len(features),
        "finite_cells": int(np.isfinite(values).sum()),
        "nan_cells": int((~np.isfinite(values)).sum()),
        "all_nan_columns": [features[i] for i in range(len(features))
                            if not np.isfinite(values[:, i]).any()],
        "labels_finite": int(np.isfinite(block.label.to_numpy(float)).sum()),
    }

    out = OUT / "continuation_frame.pkl"
    combined.to_pickle(out)
    report["combined_frame"] = {
        "path": str(out), "rows": int(len(combined)),
        "columns": int(len(combined.columns)), "sha256": sha256(out),
        "first_ts": combined.target_ts.iloc[0].isoformat(),
        "last_ts": combined.target_ts.iloc[-1].isoformat(),
    }
    report["runtime"] = {"python": sys.version.split()[0], "pandas": pd.__version__,
                         "numpy": np.__version__}
    (OUT / "continuation_inputs_report.json").write_text(json.dumps(report, indent=1))
    print(json.dumps(report, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
