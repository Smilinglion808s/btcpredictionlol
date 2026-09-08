"""Online-state parity against the batch reference.

The live worker evaluates one target at a time; the recovered reference
evaluates the whole history in one pass. This test drives the worker's
incremental `RankFamily` and `DeteriorationState` over the kit's original policy
fixtures and requires an EXACT match with the reference's rank, count, weak and
consumed-cutoff columns, plus the published 19,487 / 6,794 / 4,083 / 2,711 /
+1,372 totals.

It also asserts checkpoint round-tripping: serialising the state mid-stream and
restoring it must continue to produce identical decisions, which is what makes
restart-resume safe.

Run from services/c85-worker with the kit's artifacts available:

    C85_ARTIFACT_DIR=/path/to/kit python -m pytest tests -q
"""
from __future__ import annotations

import math
import os
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.engine import confirmed_extension_side  # noqa: E402
from src.state import C85State, DeteriorationState, RankFamily  # noqa: E402

REPO_FIXTURES = Path(__file__).resolve().parents[1] / "evaluation-fixtures"
ARTIFACTS = Path(os.environ.get(
    "C85_ARTIFACT_DIR",
    str(Path(__file__).resolve().parents[1] / "evaluation-fixtures" / "cache" / "kit"),
))
FIXTURES = ARTIFACTS / "fixtures"
if not (FIXTURES / "policy_frame.parquet").exists():
    # Installed, in-repo copy of the kit fixtures (default, so these parity
    # tests always run instead of silently skipping).
    FIXTURES = REPO_FIXTURES

pytestmark = pytest.mark.skipif(
    not (FIXTURES / "policy_frame.parquet").exists(),
    reason="kit fixtures not mounted; set C85_ARTIFACT_DIR",
)



@pytest.fixture(scope="module")
def frame() -> pd.DataFrame:
    return pd.read_parquet(FIXTURES / "policy_frame.parquet")


def test_admission_rank_matches_reference(frame: pd.DataFrame) -> None:
    family = RankFamily()
    probability = frame["C85_probability_correct"].to_numpy(float)
    proposal = frame["C85_proposal"].to_numpy(int)
    for i, (p, side) in enumerate(zip(probability, proposal)):
        eligible = side in (-1, 1) and math.isfinite(p)
        rank, _count = family.observe(p if eligible else None, side, eligible=eligible)
        expected = frame["C85_rank"].iloc[i]
        if rank is None:
            assert not np.isfinite(expected), i
        else:
            assert rank == pytest.approx(expected, abs=0, rel=0), i


def test_filter_rank_and_weak_match_reference(frame: pd.DataFrame) -> None:
    family = RankFamily()
    base = frame["C85_base_prediction"].to_numpy(int)
    proposal = frame["C85_proposal"].to_numpy(int)
    probability = frame["C85_probability_correct"].to_numpy(float)
    structure = frame["structure_valid"].to_numpy(bool)
    for i in range(len(frame)):
        confidence = (
            probability[i] if base[i] == proposal[i] else 1 - probability[i]
        )
        rank, _count = family.observe(
            confidence, base[i], eligible=(base[i] != 0 and structure[i])
        )
        expected = frame["C85_filter_rank"].iloc[i]
        if rank is None:
            assert not np.isfinite(expected), i
        else:
            assert rank == pytest.approx(expected, abs=0, rel=0), i


def test_deterioration_stream_matches_reference(frame: pd.DataFrame) -> None:
    """Pooled EWMA state, exactly-once settlement consumption and the weak flag."""
    state = DeteriorationState()
    base = frame["C85_base_prediction"].to_numpy(int)
    label = frame["label"].to_numpy()
    structure = frame["structure_valid"].to_numpy(bool)
    ts_ns = frame["ts"].astype("int64").to_numpy()
    settle_ns = frame["settlement_ts"].astype("int64").to_numpy()

    for i in range(len(frame)):
        decision_ns = int(ts_ns[i]) + 5_000_000_000
        identity = f"row{i}"
        if base[i] != 0:
            state.register_base_call(identity, int(base[i]), decision_ns)
            state.attach_settlement(identity, int(label[i]), int(settle_ns[i]))
        state.consume_settlements(decision_ns)
        gate = state.evaluate()
        weak = bool(base[i] != 0 and structure[i] and not gate["warm"] and not gate["keep"])
        assert weak == bool(frame["C85_weak"].iloc[i]), i
        assert gate["latest_available_ns"] == int(frame["C85_latest_state_ns"].iloc[i]), i
        assert gate["latest_available_ns"] < decision_ns, i


def test_full_chain_reproduces_published_totals(frame: pd.DataFrame) -> None:
    admission = RankFamily()
    filters = RankFamily()
    det = DeteriorationState()
    probability = frame["C85_probability_correct"].to_numpy(float)
    proposal = frame["C85_proposal"].to_numpy(int)
    structure = frame["structure_valid"].to_numpy(bool)
    market_q1 = frame["market_q1"].to_numpy(bool)
    c54 = frame["c54_prediction"].to_numpy(int)
    price = frame["last_yes_price"].to_numpy(float)
    core_valid = frame["core_valid"].to_numpy(bool)
    label = frame["label"].to_numpy()
    ts_ns = frame["ts"].astype("int64").to_numpy()
    settle_ns = frame["settlement_ts"].astype("int64").to_numpy()

    final = np.zeros(len(frame), dtype=int)
    for i in range(len(frame)):
        decision_ns = int(ts_ns[i]) + 5_000_000_000
        eligible = core_valid[i] and proposal[i] in (-1, 1) and math.isfinite(probability[i])
        rank, _ = admission.observe(
            probability[i] if eligible else None, proposal[i], eligible=eligible
        )
        threshold = 0.50 if proposal[i] == 1 else 0.70
        core = (
            int(proposal[i])
            if (core_valid[i] and rank is not None and rank >= threshold)
            else 0
        )
        base, _fired = confirmed_extension_side(
            core, bool(market_q1[i]), int(c54[i]),
            float(price[i]) if math.isfinite(price[i]) else None,
        )
        assert base == int(frame["C85_base_prediction"].iloc[i]), i

        identity = f"row{i}"
        if base != 0:
            det.register_base_call(identity, base, decision_ns)
            det.attach_settlement(identity, int(label[i]), int(settle_ns[i]))
        det.consume_settlements(decision_ns)
        gate = det.evaluate()
        weak = bool(base != 0 and structure[i] and not gate["warm"] and not gate["keep"])

        confidence = probability[i] if base == proposal[i] else 1 - probability[i]
        f_rank, _ = filters.observe(
            confidence, base, eligible=(base != 0 and structure[i])
        )
        # NaN rank < 0.40 must be False.
        rank_below = f_rank is not None and f_rank < 0.40
        final[i] = base if (structure[i] and not (weak and rank_below)) else 0

    np.testing.assert_array_equal(final, frame["C85_prediction"].to_numpy(int))
    calls = int((final != 0).sum())
    wins = int(((final != 0) & (final == label)).sum())
    assert (len(frame), calls, wins, calls - wins) == (19487, 6794, 4083, 2711)
    assert wins - (calls - wins) == 1372


def test_checkpoint_roundtrip_is_lossless(frame: pd.DataFrame) -> None:
    """Serialise mid-stream, restore, and continue with identical output."""
    probability = frame["C85_probability_correct"].to_numpy(float)
    proposal = frame["C85_proposal"].to_numpy(int)
    split = 9000

    straight = RankFamily()
    resumed = RankFamily()
    state = C85State(admission_ranks=resumed)

    out_a, out_b = [], []
    for i in range(len(frame)):
        p, side = probability[i], int(proposal[i])
        eligible = side in (-1, 1) and math.isfinite(p)
        out_a.append(straight.observe(p if eligible else None, side, eligible=eligible)[0])
        if i == split:
            restored = C85State.from_dict(state.to_dict())
            assert restored.sha256() == state.sha256()
            state = restored
        out_b.append(
            state.admission_ranks.observe(p if eligible else None, side, eligible=eligible)[0]
        )
    assert out_a == out_b
