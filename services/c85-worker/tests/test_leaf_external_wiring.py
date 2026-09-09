"""The external leaf pair is computed by the real head, never supplied.

Properties pinned here, each one a production-bypass that was possible before:

* production (`allow_supplied=False`, the default) uses `long_context_head` and
  ignores a probability supplied on the packet, even a conflicting one;
* with no head, production fails closed and cannot claim a computation from a
  packet probability;
* a target's committed output is immutable: an identical retry is idempotent,
  a conflicting retry raises and carries the original - direction and rank can
  never be mixed across two beliefs about one target;
* a leaf evaluation that fails after the pair is prepared commits nothing, so
  the positional rank window keeps no phantom row;
* a row the head could not score advances the window (it is a real row of the
  original series); a row that was never acquired is rejected instead.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.experts.direction_contract import (  # noqa: E402
    ACQUISITION_FAILED,
    MODEL_NO_PROBABILITY,
    RANK_MINIMUM,
    AcquisitionFailure,
    LongContextLeafProducer,
    RetryConflict,
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


def _packet(key: int, probability: float | None = None, *, complete: bool = True, **extra):
    packet = dict(OTHER_KEYS) if complete else {}
    packet["target_ms"] = key
    if probability is not None:
        # A *raw* input the head reads. Named apart from the supplied output.
        packet["raw_probability"] = probability
    packet.update(extra)
    return packet


def _head(packet):
    return packet.get("raw_probability")


def _production_leaf(producer=None):
    return LeafExperts(
        long_context=producer or LongContextLeafProducer(),
        long_context_head=_head,
        # explicit, even though it is the default, because it is the point
        allow_supplied=False,
    )


def test_allow_supplied_defaults_to_false():
    assert LeafExperts().allow_supplied is False


def test_supplied_probability_cannot_override_production_inference():
    leaf = _production_leaf()
    for i in range(RANK_MINIMUM + 1):
        leaf.evaluate(_packet(i, 0.4 + (i % 5) * 0.01))

    # The head says 0.9 (green); the packet claims 0.1 (red) and a finished
    # pair. Production must follow the head and ignore both claims.
    out = leaf.evaluate(_packet(
        99_999, 0.9,
        external_probability_green=0.1,
        external_direction=-1,
        external_rank=0.0,
    ))
    assert out["external_probability_green"] == 0.9
    assert out["external_direction"] == 1
    assert out["external_rank"] == pytest.approx(1.0)


def test_production_without_a_head_cannot_use_a_packet_probability():
    leaf = LeafExperts(long_context=LongContextLeafProducer(), long_context_head=None)
    with pytest.raises(MissingUpstreamSignalError) as excinfo:
        leaf.evaluate(_packet(
            1, external_probability_green=0.9, external_direction=1, external_rank=0.99
        ))
    message = str(excinfo.value)
    assert "external_direction" in message and "external_rank" in message


def test_supplied_mode_is_opt_in_and_stays_available_for_replay():
    leaf = LeafExperts(
        long_context=LongContextLeafProducer(), long_context_head=None, allow_supplied=True
    )
    out = leaf.evaluate(_packet(1, external_probability_green=0.9))
    assert out["external_direction"] == 1


def test_failed_evaluation_commits_no_rank_state():
    producer = LongContextLeafProducer()
    leaf = _production_leaf(producer)
    incomplete = _packet(1, 0.8, complete=False)
    with pytest.raises(MissingUpstreamSignalError):
        leaf.evaluate(incomplete)
    assert producer.rank_state.position == 0
    assert producer.last_key is None

    # The same target can then be evaluated for real, at position 0.
    leaf.evaluate(_packet(1, 0.8))
    assert producer.rank_state.position == 1


def test_identical_retry_is_idempotent_and_conflicting_retry_is_rejected():
    producer = LongContextLeafProducer()
    leaf = _production_leaf(producer)
    first = leaf.evaluate(_packet(7, 0.8))
    again = leaf.evaluate(_packet(7, 0.8))
    assert again == first
    assert producer.rank_state.position == 1, "a retry must not advance the window"

    with pytest.raises(RetryConflict) as excinfo:
        leaf.evaluate(_packet(7, 0.2))
    assert excinfo.value.original["external_probability_green"] == 0.8
    assert producer.rank_state.position == 1
    # And the committed output is unchanged.
    assert leaf.evaluate(_packet(7, 0.8)) == first


def test_conflict_detection_survives_serialisation():
    producer = LongContextLeafProducer()
    leaf = _production_leaf(producer)
    first = leaf.evaluate(_packet(7, 0.8))

    restored = LongContextLeafProducer.from_dict(producer.to_dict())
    resumed = _production_leaf(restored)
    assert resumed.evaluate(_packet(7, 0.8)) == first
    with pytest.raises(RetryConflict):
        resumed.evaluate(_packet(7, 0.2))


def test_unscored_row_advances_the_window_but_an_unacquired_one_does_not():
    producer = LongContextLeafProducer()
    leaf = _production_leaf(producer)

    # The head ran and produced nothing: a real row of the original series.
    out = leaf.evaluate(_packet(1))
    assert out["external_direction"] == 0
    assert out["external_rank"] != out["external_rank"]  # NaN
    assert producer.rank_state.position == 1

    # Never processed at all: not a row, and it must not shift later ranks.
    with pytest.raises(AcquisitionFailure):
        producer.prepare(2, None, status=ACQUISITION_FAILED)
    assert producer.rank_state.position == 1

    # And the two statuses are recorded distinctly.
    assert producer.last_output["external_status"] == MODEL_NO_PROBABILITY


def test_restart_from_serialised_state_continues_the_same_series():
    values = [0.3 + (i % 11) * 0.02 for i in range(RANK_MINIMUM + 40)]

    uninterrupted = _production_leaf()
    straight = [uninterrupted.evaluate(_packet(i, v)) for i, v in enumerate(values)]

    split = RANK_MINIMUM + 10
    first = _production_leaf()
    for i, v in enumerate(values[:split]):
        first.evaluate(_packet(i, v))
    resumed = _production_leaf(
        LongContextLeafProducer.from_dict(first.long_context.to_dict())
    )
    tail = [resumed.evaluate(_packet(i, values[i])) for i in range(split, len(values))]

    for expected, got in zip(straight[split:], tail):
        assert got["external_direction"] == expected["external_direction"]
        assert got["external_rank"] == pytest.approx(expected["external_rank"], nan_ok=True)


def test_prepare_defers_the_commit_to_the_caller():
    producer = LongContextLeafProducer()
    leaf = _production_leaf(producer)
    result, update = leaf.prepare(_packet(1, 0.8))
    assert result["external_direction"] == 1
    assert producer.rank_state.position == 0, "prepare must not mutate"
    update.commit()
    assert producer.rank_state.position == 1
    update.commit()  # idempotent
    assert producer.rank_state.position == 1
