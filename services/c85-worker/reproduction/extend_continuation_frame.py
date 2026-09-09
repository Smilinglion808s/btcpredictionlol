"""Extend the saved c85-reconstruction-r1 continuation frame with new rows.

Takes the persisted replay-input frame (the exact rows already consumed by the
committed generation) and the freshly rebuilt FULL-ORIGIN frame, verifies that
they agree everywhere they overlap, and appends only the genuinely new
15-minute targets.

Nothing is imputed or recomputed for already-committed positions: the saved
frame stays the position authority, so an extension can never silently move a
row the head has already scored. The only value copied back is the label of the
last saved target, which was still unsettled when that frame was written and is
now available from the newer source archives.

Environment:
    C85_LC_SAVED     saved continuation_frame.pkl (position authority)
    C85_LC_REBUILT   september_full_origin_frame.pkl (full 2026-01-01 origin)
    C85_LC_OUT       output directory
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

SAVED = Path(os.environ["C85_LC_SAVED"])
REBUILT = Path(os.environ["C85_LC_REBUILT"])
OUT = Path(os.environ["C85_LC_OUT"])
STEP = pd.Timedelta(minutes=15)
# Rolling series recomputed from the same full origin under a different process
# reproduce to floating-point noise, not bitwise. Anything above this on an
# already-committed row is a real disagreement and stops the extension.
TOLERANCE = 1e-6


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def read(path: Path) -> pd.DataFrame:
    frame = pd.read_parquet(path) if path.suffix == ".parquet" else pd.read_pickle(path)
    return frame.sort_values("target_ts").reset_index(drop=True)


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    saved = read(SAVED)
    rebuilt = read(REBUILT)

    if list(saved.columns) != list(rebuilt.columns):
        missing = [c for c in saved.columns if c not in rebuilt.columns]
        extra = [c for c in rebuilt.columns if c not in saved.columns]
        raise SystemExit(f"schema mismatch: missing={missing[:10]} extra={extra[:10]}")

    overlap = len(saved)
    if len(rebuilt) < overlap:
        raise SystemExit(
            f"rebuilt frame has {len(rebuilt)} rows, fewer than the saved {overlap}")
    if not saved.target_ts.equals(rebuilt.target_ts.iloc[:overlap]):
        raise SystemExit("timestamp keys of the saved and rebuilt frames disagree")

    selected = [c for c in lc.FEATURE_COLUMNS if c in saved.columns] \
        if hasattr(lc, "FEATURE_COLUMNS") else None
    compare = selected or [c for c in saved.columns
                           if pd.api.types.is_numeric_dtype(saved[c])]
    worst = {"column": None, "max_abs": 0.0, "position": None}
    disagreements = []
    for column in compare:
        left = pd.to_numeric(saved[column], errors="coerce").to_numpy(dtype="float64")
        right = pd.to_numeric(rebuilt[column].iloc[:overlap], errors="coerce") \
            .to_numpy(dtype="float64")
        mask = np.isfinite(left) & np.isfinite(right)
        if (np.isfinite(left) != np.isfinite(right)).any():
            disagreements.append({"column": column, "kind": "missingness"})
            continue
        if not mask.any():
            continue
        diff = np.abs(left[mask] - right[mask])
        index = int(np.argmax(diff))
        if float(diff[index]) > worst["max_abs"]:
            worst = {"column": column, "max_abs": float(diff[index]),
                     "position": int(np.flatnonzero(mask)[index])}
        if float(diff[index]) > TOLERANCE:
            disagreements.append({"column": column, "kind": "value",
                                  "max_abs": float(diff[index])})

    new = rebuilt.iloc[overlap:].copy()
    expected = pd.date_range(saved.target_ts.iloc[-1] + STEP, periods=len(new), freq=STEP)
    if len(new) and not np.array_equal(new.target_ts.to_numpy(), expected.to_numpy()):
        raise SystemExit("new rows are not on the contiguous 15-minute grid")

    # Settle the previously-open last saved target from the newer source.
    saved = saved.copy()
    last_label = rebuilt.binance_label.iloc[overlap - 1]
    saved.loc[saved.index[-1], "binance_label"] = last_label

    extended = pd.concat([saved, new], ignore_index=True)
    out = OUT / "continuation_frame_extended.pkl"
    extended.to_pickle(out)

    report = {
        "saved": {"path": str(SAVED), "sha256": sha256(SAVED), "rows": int(overlap),
                  "last_target": saved.target_ts.iloc[-1].isoformat()},
        "rebuilt": {"path": str(REBUILT), "sha256": sha256(REBUILT),
                    "rows": int(len(rebuilt)),
                    "last_target": rebuilt.target_ts.iloc[-1].isoformat()},
        "overlap_columns_compared": len(compare),
        "overlap_worst_difference": worst,
        "overlap_disagreements": disagreements,
        "new_rows": int(len(new)),
        "new_window": [new.target_ts.iloc[0].isoformat(),
                       new.target_ts.iloc[-1].isoformat()] if len(new) else None,
        "settled_last_saved_target": {
            "ts": saved.target_ts.iloc[-1].isoformat(),
            "label": None if pd.isna(last_label) else float(last_label),
        },
        "extended": {"path": str(out), "rows": int(len(extended)),
                     "sha256": sha256(out),
                     "last_target": extended.target_ts.iloc[-1].isoformat()},
        "runtime": {"python": sys.version.split()[0], "pandas": pd.__version__,
                    "numpy": np.__version__},
    }
    (OUT / "continuation_frame_extended.json").write_text(json.dumps(report, indent=1))
    print(json.dumps({k: v for k, v in report.items()
                      if k != "overlap_disagreements"} | {
        "overlap_disagreements": disagreements[:10],
        "overlap_disagreement_count": len(disagreements)}, indent=1), flush=True)
    return 1 if disagreements else 0


if __name__ == "__main__":
    raise SystemExit(main())
