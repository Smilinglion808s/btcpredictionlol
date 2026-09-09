"""The external leaf pair is computed, not passed through - and fails closed.

These tests pin the three properties that matter for the wiring:

* with a probability source, `external_direction` / `external_rank` come out of
  the verified contract rather than from the packet;
* without a probability source they stay fail-closed like the other keys, and a
  supplied value cannot be accepted at all in production mode;
* the producer's state survives serialisation, so a restart continues the same
  rank series it would have produced uninterrupted.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.experts.direction_contract import (  # noqa: E402
    RANK_MINIMUM,
    LongContextLeafProducer,
)
from src.experts.leaf import LeafExperts, MissingUpstreamSignalError  # noqa: E402

OTHER_KEYS = {
    "c30_prediction": 1,
    "c36_prediction": 1,
    "c37_prediction": 1,
    "r4_prediction": 1,
    "expansion_selected_prediction": 1,
    "opportunity": 1,
    "r4_probability_correct": 0.6,
    "r4_directional_rank": 0.7,
    "mean_135_rank": 0.5,
}


def _packet(key: int, probability: float | None, **extra):
    packet = dict(OTHER_KEYS)
    packet["target_ms"] = key
    if probability is not None:
        packet["external_probability_green"] = probability
    packet.update(extra)
    return packet


def test_external_pair_is_computed_and_overrides_a_supplied_value():
    leaf = LeafExperts(long_context=LongContextLeafProducer())
    # Warm past the 960-row minimum so the rank is finite.
    for i in range(RANK_MINIMUM + 1):
        leaf.evaluate(_packet(i, 0.4 + (i % 5) * 0.01))
    out = leaf.evaluate(
        _packet(99_999, 0.9, external_direction=-1, external_rank=0.0)
    )
    assert out["external_direction"] == 1, "the supplied -1 must not win"
    assert out["external_rank"] == pytest.approx(1.0)


def test_no_probability_source_fails_closed_even_with_a_supplied_value():
    leaf = LeafExperts(long_context=None, allow_supplied=False)
    with pytest.raises(MissingUpstreamSignalError) as excinfo:
        leaf.evaluate(_packet(1, None, external_direction=1, external_rank=0.5))
    message = str(excinfo.value)
    assert "external_direction" in message and "external_rank" in message


def test_restart_from_serialised_state_continues_the_same_series():
    values = [0.3 + (i % 11) * 0.02 for i in range(RANK_MINIMUM + 40)]

    uninterrupted = LeafExperts(long_context=LongContextLeafProducer())
    straight = [uninterrupted.evaluate(_packet(i, v)) for i, v in enumerate(values)]

    split = RANK_MINIMUM + 10
    first = LeafExperts(long_context=LongContextLeafProducer())
    for i, v in enumerate(values[:split]):
        first.evaluate(_packet(i, v))
    resumed = LeafExperts(
        long_context=LongContextLeafProducer.from_dict(first.long_context.to_dict())
    )
    tail = [resumed.evaluate(_packet(i, values[i])) for i in range(split, len(values))]

    for expected, got in zip(straight[split:], tail):
        assert got["external_direction"] == expected["external_direction"]
        assert got["external_rank"] == pytest.approx(expected["external_rank"], nan_ok=True)


def test_missing_probability_rows_still_advance_the_positional_window():
    """A row without a probability is a real state, and it must consume a slot."""

    producer = LongContextLeafProducer()
    leaf = LeafExperts(long_context=producer, long_context_head=lambda packet: None)
    out = leaf.evaluate(_packet(1, None))
    assert out["external_direction"] == 0
    assert out["external_rank"] != out["external_rank"]  # NaN
    assert producer.rank_state.position == 1
