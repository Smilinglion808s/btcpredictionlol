"""Reproduce the R5 phase-4 hot-calibration ledger from its original source.

This is the producer of the four remaining leaf fields:
``expansion_selected_prediction``, ``r4_probability_correct``,
``r4_directional_rank`` and ``r4_prediction`` — all emitted as columns of
``external_research/r5_lab_manager_output/t5_hot_calibration_ledger.csv`` by
``r5_lab_manager_phase4.py::main``.

Nothing is transcribed: the original module is imported and executed over the
reconstructed T+5 frame plus the R4.1 rows reproduced by ``repro_r4.py``.
``build_frame()`` itself enforces the frozen R4.1 prediction hash
(8fed5535...), so a drifted upstream aborts instead of silently passing.

Usage:
    ROOT=/tmp/c85root REF=<archived t5_hot_calibration_ledger.csv> \
    python3 repro_r5_phase4.py
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(os.environ.get("ROOT", "/tmp/c85root"))
REF = Path(
    os.environ.get(
        "REF",
        "/tmp/upx/upstream/vault_work/legacy_lab2/sources/"
        "R5_Lab_Manager_Research_Checkpoint_2026-09-02.zip__expanded/"
        "external_research/r5_lab_manager_output/t5_hot_calibration_ledger.csv",
    )
)

sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "external_research"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

from external_research import r5_lab_manager_phase4 as phase4  # noqa: E402

DECISION = ("r4_prediction", "precision_selected_prediction", "expansion_selected_prediction")


def main() -> int:
    phase4.main()
    produced = phase4.OUT / "t5_hot_calibration_ledger.csv"
    ref = pd.read_csv(REF, parse_dates=["ts"])
    new = pd.read_csv(produced, parse_dates=["ts"])
    print(f"rows ref={len(ref)} new={len(new)} window {ref.ts.min()} -> {ref.ts.max()}")
    assert len(ref) == len(new) and (ref.ts.values == new.ts.values).all()
    cells = dec = 0
    for col in ref.columns:
        if col not in new.columns:
            print("  MISSING COLUMN", col)
            cells += 1
            continue
        a, b = ref[col], new[col]
        if pd.api.types.is_numeric_dtype(a) and pd.api.types.is_numeric_dtype(b):
            af, bf = a.astype(float).to_numpy(), b.astype(float).to_numpy()
            n = int((~(np.isclose(af, bf, rtol=0, atol=1e-12) | (np.isnan(af) & np.isnan(bf)))).sum())
            if n:
                print(f"  MISMATCH {col}: {n} rows max|d|={np.nanmax(np.abs(af - bf)):.3e}")
        else:
            n = int((a.astype(str) != b.astype(str)).sum())
            if n:
                print(f"  MISMATCH {col}: {n} rows")
        cells += n
        if col in DECISION:
            dec += n
    print(f"  TOTAL CELL MISMATCHES: {cells}   DECISION MISMATCHES: {dec}")
    return 1 if cells else 0


if __name__ == "__main__":
    raise SystemExit(main())
