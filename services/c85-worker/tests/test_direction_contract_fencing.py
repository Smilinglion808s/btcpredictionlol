"""Correction tests for the two-phase rank/leaf contract.

These are SYNTHETIC state tests: they use fabricated probability sequences to
exercise preparation, fencing and rollback. They do not assert anything about
the original model's values; archived parity stays in
``test_direction_contract.py``.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.experts.direction_contract import (  # noqa: E402
    MODEL_NO_PROBABILITY,
    LongContextLeafProducer,
    RankStateError,
    RetryConflict,
    RollingRankState,
    StateFenceError,
)


def _snapshot(state) -> str:
    return json.dumps(state.to_dict(), sort_keys=True)


def _seeded_state(rows: int, lookback: int = 8, minimum: int = 3) -> RollingRankState:
    state = RollingRankState(lookback=lookback, minimum=minimum)
    rng = np.random.default_rng(11)
    for key in range(rows):
        value = float(rng.random())
        # every fourth row carries no value, so the positional window is sparse
        state.observe(key, np.nan if key % 4 == 3 else value)
    return state


# -- prepare must not mutate, including once pruning is active ---------------


@pytest.mark.parametrize("rows", [4, 9, 25, 60])
def test_prepare_leaves_state_byte_identical(rows: int) -> None:
    state = _seeded_state(rows)
    before = _snapshot(state)
    for value in (0.0, 0.25, float("nan"), 0.99):
        state.prepare(rows + 100, value)
    assert _snapshot(state) == before


def test_prepare_does_not_prune_expired_entries() -> None:
    # rows far beyond the lookback: the naive implementation pruned here.
    state = _seeded_state(60, lookback=8, minimum=3)
    before = _snapshot(state)
    update = state.prepare(1_000, 0.5)
    assert _snapshot(state) == before
    # the rank still honours the positional window even though nothing was cut
    live = state._live_values(state.position)
    assert len(live) <= state.lookback
    assert np.isfinite(update.rank)


def test_prepared_rank_matches_committed_rank() -> None:
    state = _seeded_state(40)
    prepared = state.prepare(1_000, 0.42)
    assert prepared.commit() == pytest.approx(prepared.rank, nan_ok=True)


def test_whole_chain_evaluation_failure_leaves_no_trace() -> None:
    producer = LongContextLeafProducer(
        rank_state=_seeded_state(40, lookback=8, minimum=3)
    )
    before = _snapshot(producer.rank_state)
    before_producer = json.dumps(producer.to_dict(), sort_keys=True)
    update = producer.prepare(1_000, 0.71)
    try:
        raise RuntimeError("downstream leaf rejected the packet")
    except RuntimeError:
        pass
    assert _snapshot(producer.rank_state) == before
    assert json.dumps(producer.to_dict(), sort_keys=True) == before_producer
    assert update.committed is False


# -- commit-time validation --------------------------------------------------


def test_competing_updates_for_same_target_fence_the_loser() -> None:
    producer = LongContextLeafProducer(
        rank_state=_seeded_state(40, lookback=8, minimum=3)
    )
    first = producer.prepare(1_000, 0.80)
    second = producer.prepare(1_000, 0.80)
    first.commit()
    with pytest.raises(StateFenceError):
        second.commit()


def test_stale_update_after_a_later_target_is_rejected() -> None:
    producer = LongContextLeafProducer(
        rank_state=_seeded_state(40, lookback=8, minimum=3)
    )
    stale = producer.prepare(1_000, 0.80)
    producer.observe(1_000, 0.80)
    producer.observe(1_001, 0.20)
    with pytest.raises(StateFenceError):
        stale.commit()


def test_reversed_commit_order_is_rejected() -> None:
    state = _seeded_state(40, lookback=8, minimum=3)
    state.observe(1_000, 0.3)
    with pytest.raises(RankStateError):
        state.prepare(999, 0.3)


def test_conflicting_retry_surfaces_original_output() -> None:
    producer = LongContextLeafProducer(
        rank_state=_seeded_state(40, lookback=8, minimum=3)
    )
    original = producer.observe(1_000, 0.80)
    with pytest.raises(RetryConflict) as excinfo:
        producer.prepare(1_000, 0.60)
    assert excinfo.value.original["external_probability_green"] == original[
        "external_probability_green"
    ]


def test_identical_retry_is_idempotent_and_applies_nothing() -> None:
    producer = LongContextLeafProducer(
        rank_state=_seeded_state(40, lookback=8, minimum=3)
    )
    first = producer.observe(1_000, 0.80)
    before = _snapshot(producer.rank_state)
    second = producer.prepare(1_000, 0.80).commit()
    assert first == second
    assert _snapshot(producer.rank_state) == before


def test_retry_after_exception_reproduces_the_same_rank() -> None:
    producer = LongContextLeafProducer(
        rank_state=_seeded_state(40, lookback=8, minimum=3)
    )
    failed = producer.prepare(1_000, 0.65)
    # simulate an inference/persistence exception between prepare and commit
    retried = producer.prepare(1_000, 0.65)
    assert retried.output["external_rank"] == pytest.approx(
        failed.output["external_rank"], nan_ok=True
    )
    committed = retried.commit()
    assert committed["external_rank"] == pytest.approx(
        failed.output["external_rank"], nan_ok=True
    )
    with pytest.raises(StateFenceError):
        failed.commit()


def test_missing_probability_row_still_advances_the_window() -> None:
    producer = LongContextLeafProducer(
        rank_state=_seeded_state(10, lookback=8, minimum=3)
    )
    position = producer.rank_state.position
    producer.observe(1_000, None, status=MODEL_NO_PROBABILITY)
    assert producer.rank_state.position == position + 1
    assert producer.last_output["external_direction"] == 0


def test_version_round_trips_through_serialisation() -> None:
    producer = LongContextLeafProducer(
        rank_state=_seeded_state(12, lookback=8, minimum=3)
    )
    producer.observe(1_000, 0.55)
    restored = LongContextLeafProducer.from_dict(json.loads(json.dumps(producer.to_dict())))
    assert restored.version == producer.version
    assert restored.rank_state.version == producer.rank_state.version
    stale = producer.prepare(1_001, 0.44)
    producer.observe(1_001, 0.44)
    with pytest.raises(StateFenceError):
        stale.commit()
