"""Parity replay of the C54 primary-regime-router against historical ledger.

Replays every candle in evaluation-fixtures/upstream_packet.parquet through
``C54Expert.evaluate``, feeding it the STORED ``c42_prediction`` /
``c51_prediction`` columns as the "upstream" dict (per the task: C54's live
interface accepts upstream predictions rather than computing them), and
compares the resulting ``c54_prediction`` against the stored
``c54_prediction`` column.

Run:

    cd services/c85-worker && python -m pytest tests/test_c54_parity.py -q
"""
from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.experts.c54 import C54Expert  # noqa: E402

FIXTURE = Path(__file__).resolve().parents[1] / "evaluation-fixtures" / "upstream_packet.parquet"

pytestmark = pytest.mark.skipif(
    not FIXTURE.exists(), reason=f"fixture not found: {FIXTURE}"
)


def test_c54_primary_regime_router_matches_historical_ledger():
    df = pd.read_parquet(FIXTURE)
    required = {"ts", "c42_prediction", "c51_prediction", "c54_prediction"}
    missing = required - set(df.columns)
    assert not missing, f"fixture missing required columns: {missing}"

    expert = C54Expert()
    computed = []
    errors = []
    for row in df.itertuples(index=False):
        row_d = row._asdict()
        packet = {"ts": row_d["ts"]}
        upstream = {
            "c42_prediction": row_d["c42_prediction"],
            "c51_prediction": row_d["c51_prediction"],
        }
        try:
            result = expert.evaluate(packet, upstream)
            computed.append(result["c54_prediction"])
        except Exception as exc:  # noqa: BLE001 - we want to count/report, not crash the loop
            errors.append((row_d["ts"], str(exc)))
            computed.append(None)

    df = df.reset_index(drop=True)
    df["c54_prediction_computed"] = computed

    assert not errors, f"{len(errors)} rows raised during evaluate(); first few: {errors[:5]}"

    matches = (df["c54_prediction_computed"] == df["c54_prediction"]).sum()
    mismatches = len(df) - matches
    mismatch_rows = df.loc[df["c54_prediction_computed"] != df["c54_prediction"]]

    print(
        f"C54 parity: {matches}/{len(df)} matched, {mismatches} mismatched "
        f"(rows checked: {len(df)})"
    )
    if mismatches:
        print(mismatch_rows[["ts", "c42_prediction", "c51_prediction",
                              "c54_prediction", "c54_prediction_computed"]].head(20))

    assert mismatches == 0, f"{mismatches} C54 parity mismatches out of {len(df)} rows"
