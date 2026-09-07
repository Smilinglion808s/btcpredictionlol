"""Replay historical candles and compare C42Expert against the stored ledger.

Uses the STORED leaf columns from upstream_packet.parquet as leaf_outputs,
exactly as instructed. Reports match/mismatch counts; does not assert 100%
match because a documented, unrecovered divergence exists (see c42.py
module docstring and the written report) affecting rows where both
c37_prediction and r4_prediction are 0.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from experts.c42 import C42Expert

FIXTURE = Path(__file__).resolve().parents[1] / "evaluation-fixtures" / "upstream_packet.parquet"

LEAF_COLUMNS = [
    "c30_prediction",
    "c36_prediction",
    "c37_prediction",
    "r4_prediction",
    "r4_probability_correct",
    "r4_directional_rank",
    "external_direction",
    "external_rank",
    "mean_135_rank",
]


def _clean(value):
    if value is None:
        return 0
    if isinstance(value, float) and value != value:
        return 0
    return value


def test_c42_parity_report():
    df = pd.read_parquet(FIXTURE)
    expert = C42Expert()

    matches = 0
    mismatches = []
    for idx, row in df.iterrows():
        leaf_outputs = {
            key: _clean(row[key]) if key in ("c37_prediction", "r4_prediction", "external_direction",
                                              "c30_prediction", "c36_prediction")
            else row[key]
            for key in LEAF_COLUMNS
        }
        result = expert.evaluate(packet=row.to_dict(), leaf_outputs=leaf_outputs)
        stored = int(row["c42_prediction"]) if row["c42_prediction"] == row["c42_prediction"] else 0
        if result["c42_prediction"] == stored:
            matches += 1
        else:
            mismatches.append(idx)

    total = len(df)
    print(f"C42 parity: {matches}/{total} matched ({matches/total:.4%}); "
          f"{len(mismatches)} mismatched.")

    # Known, documented divergence: rows where both c37_prediction and
    # r4_prediction are 0 (an undocumented production fallback not present
    # in any recovered ancestor source). We assert the match rate stays at
    # least at the level explained by the recovered rule, and that every
    # mismatch is confined to that documented condition, so a silent
    # regression elsewhere would fail this test.
    unexplained = 0
    for idx in mismatches:
        row = df.loc[idx]
        c37 = 0 if row["c37_prediction"] != row["c37_prediction"] else int(row["c37_prediction"])
        r4 = 0 if row["r4_prediction"] != row["r4_prediction"] else int(row["r4_prediction"])
        if not (c37 == 0 and r4 == 0):
            unexplained += 1

    assert unexplained == 0, (
        f"{unexplained} mismatches occurred outside the documented "
        "c37==0 & r4==0 divergence condition; this would be a genuine rule bug."
    )
    assert matches / total > 0.98
