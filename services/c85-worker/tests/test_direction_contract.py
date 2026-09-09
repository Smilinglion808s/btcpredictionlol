"""Contract + source-ledger parity for `external_direction` / `external_rank`.

The parity case is deliberately NOT a restatement of the implementation: it
recomputes both columns from the archived `external_probability_green` of the
original `continuous_coverage_ledger.csv` and compares against the archived
`external_direction` / `external_rank` written by the original producer.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import pytest

from src.experts.direction_contract import (
    RETAIN,
    RankStateError,
    RollingRankState,
    external_prediction,
    iter_incremental_ranks,
    rolling_rank,
    signed_direction,
)

LEDGER = Path(
    "/mnt/documents/.lovable/c85-cache/upx/upstream/vault_work/legacy_lab2/sources/"
    "T0_T5_CONTINUOUS_COVERAGE_LAB_CHECKPOINT_R1.zip__expanded/"
    "continuous_coverage_ledger.csv"
)
PARITY_REPORT = Path(__file__).resolve().parents[1] / "docs" / "direction_contract_parity.json"


# --- label contract --------------------------------------------------------

def test_signed_direction_is_signed_not_a_class_index():
    assert signed_direction(0.9) == 1
    assert signed_direction(0.1) == -1
    # exactly 0.5 -> +1, from `probability >= 0.5` in long_context_model line 288
    assert signed_direction(0.5) == 1
    assert signed_direction(float("nan")) == 0
    assert signed_direction(None) == 0
    values = signed_direction([0.4999999, 0.5, 0.5000001, float("nan")])
    assert values.tolist() == [-1, 1, 1, 0]
    assert values.dtype == np.int8
    # zero is reserved for "no probability"; a below-0.5 row is never 0
    assert 0 not in signed_direction([0.1, 0.2, 0.49]).tolist()


def test_external_prediction_applies_the_frozen_retain():
    direction = np.array([1, -1, 1], dtype=np.int8)
    rank = np.array([0.80, 0.74, np.nan])
    # retain 0.25 -> call only when rank >= 0.75
    assert external_prediction(direction, rank, RETAIN).tolist() == [1, 0, 0]


# --- rank family -----------------------------------------------------------

def test_rolling_rank_is_past_only_with_half_ties():
    values = np.array([1.0, 2.0, 2.0, 3.0])
    out = rolling_rank(values, lookback=10, minimum=2)
    assert math.isnan(out[0]) and math.isnan(out[1])
    assert out[2] == pytest.approx((1 + 0.5) / 2)   # 1.0 below, one tie
    assert out[3] == pytest.approx(3 / 3)


def test_rolling_rank_skips_non_finite_values_entirely():
    values = np.array([1.0, np.nan, 2.0, 3.0])
    out = rolling_rank(values, lookback=10, minimum=2)
    assert math.isnan(out[1])          # never ranked
    assert math.isnan(out[2])          # only ONE finite prior, below minimum
    assert out[3] == pytest.approx(1.0)


def test_incremental_matches_batch_and_survives_a_cold_restart():
    rng = np.random.default_rng(11)
    values = rng.random(600)
    keys = list(range(600))
    batch = rolling_rank(values, lookback=50, minimum=10)

    state = RollingRankState(lookback=50, minimum=10)
    first = [state.observe(k, v) for k, v in zip(keys[:400], values[:400])]

    # cold restart: serialise, drop the object, rebuild from the payload only
    payload = json.loads(json.dumps(state.to_dict()))
    del state
    resumed = RollingRankState.from_dict(payload)
    second = [resumed.observe(k, v) for k, v in zip(keys[400:], values[400:])]

    np.testing.assert_allclose(np.array(first + second), batch, equal_nan=True)


def test_repeat_submission_is_idempotent_and_backwards_is_rejected():
    state = RollingRankState(lookback=10, minimum=2)
    for key, value in enumerate([0.1, 0.2, 0.3]):
        state.observe(key, value)
    depth = len(state.window)
    again = state.observe(2, 0.3)
    assert len(state.window) == depth          # not double-counted
    assert again == state.last_rank
    with pytest.raises(RankStateError):
        state.observe(1, 0.9)


# --- source parity ---------------------------------------------------------

@pytest.mark.skipif(not LEDGER.exists(), reason="archived continuous ledger not mounted")
def test_matches_the_original_producer_output_cell_for_cell():
    import pandas as pd

    frame = (
        pd.read_csv(
            LEDGER,
            usecols=["ts", "external_probability_green", "external_direction", "external_rank"],
            parse_dates=["ts"],
        )
        .sort_values("ts")
        .reset_index(drop=True)
    )
    probability = frame.external_probability_green.to_numpy(float)

    direction = signed_direction(probability)
    archived_direction = frame.external_direction.fillna(0).to_numpy(np.int8)
    assert int((direction != archived_direction).sum()) == 0

    rank = rolling_rank(np.abs(probability - 0.5))
    archived_rank = frame.external_rank.to_numpy(float)
    assert (np.isfinite(rank) == np.isfinite(archived_rank)).all()
    both = np.isfinite(rank)
    assert float(np.max(np.abs(rank[both] - archived_rank[both]))) < 1e-12

    # and the incremental state reproduces the same column
    incremental, _ = iter_incremental_ranks(
        frame.ts.astype("int64").to_numpy(), np.abs(probability - 0.5)
    )
    np.testing.assert_allclose(incremental, rank, equal_nan=True)

    report = {
        "ledger": str(LEDGER),
        "rows": int(len(frame)),
        "coverage": [frame.ts.min().isoformat(), frame.ts.max().isoformat()],
        "direction_mismatches": 0,
        "direction_value_counts": {
            str(k): int(v) for k, v in frame.external_direction.fillna(0).astype(int).value_counts().items()
        },
        "rank_finiteness_mismatches": 0,
        "rank_max_abs_difference": float(np.max(np.abs(rank[both] - archived_rank[both]))),
        "exact_half_probability_rows": int((probability == 0.5).sum()),
    }
    PARITY_REPORT.parent.mkdir(parents=True, exist_ok=True)
    PARITY_REPORT.write_text(json.dumps(report, indent=2) + "\n")
