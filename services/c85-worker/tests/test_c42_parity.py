"""Replay historical candles and compare C42Expert against the stored ledger.

Uses the STORED leaf columns from upstream_packet.parquet as leaf_outputs,
including `expansion_selected_prediction` (the frozen R4.3 expansion-selected
T+5 output that `apply_composite` actually reads). Parity is exact: any
mismatch is a regression.
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
    "expansion_selected_prediction",
    "r4_probability_correct",
    "r4_directional_rank",
    "external_direction",
    "external_rank",
    "mean_135_rank",
]

DIRECTION_COLUMNS = (
    "c30_prediction",
    "c36_prediction",
    "c37_prediction",
    "r4_prediction",
    "external_direction",
)


def _clean(value):
    if value is None:
        return 0
    if isinstance(value, float) and value != value:
        return 0
    return value


def test_c42_matches_reference_exactly():
    df = pd.read_parquet(FIXTURE)
    expert = C42Expert()

    matches = 0
    mismatches = []
    for idx, row in df.iterrows():
        leaf_outputs = {
            key: _clean(row[key]) if key in DIRECTION_COLUMNS else row[key]
            for key in LEAF_COLUMNS
        }
        result = expert.evaluate(packet=row.to_dict(), leaf_outputs=leaf_outputs)
        stored = int(row["c42_prediction"]) if row["c42_prediction"] == row["c42_prediction"] else 0
        if result["c42_prediction"] == stored:
            matches += 1
        else:
            mismatches.append((idx, row.get("ts")))

    total = len(df)
    assert total == 19_487, total
    assert not mismatches, (
        f"C42 parity: {matches}/{total} matched; first mismatches: {mismatches[:5]}"
    )


def test_wrong_r4_column_would_regress():
    """Guards the corrected input mapping.

    Reading `r4_prediction` instead of `expansion_selected_prediction`
    reproduces the historical 287-row divergence; this test pins that the two
    columns are genuinely different so the mapping cannot silently revert.
    """
    df = pd.read_parquet(FIXTURE)
    core = df["c37_prediction"].fillna(0).astype(int)
    r43 = df["expansion_selected_prediction"].fillna(0).astype(int)
    r4 = df["r4_prediction"].fillna(0).astype(int)
    ext = df["external_direction"].fillna(0).astype(int)

    def compose(expansion):
        admitted = (core == 0) & (expansion != 0) & (expansion == ext)
        return admitted.map({True: 1, False: 0}) * expansion + (~admitted) * core

    stored = df["c42_prediction"].fillna(0).astype(int)
    assert int(stored.ne(compose(r43)).sum()) == 0
    assert int(stored.ne(compose(r4)).sum()) == 287
