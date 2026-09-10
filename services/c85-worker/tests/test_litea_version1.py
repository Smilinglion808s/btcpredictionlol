"""Version 1 (`lite-a-floor4-top10-r1`) invariants.

These are the properties that would silently change the model or leak an
execution path if they broke. Numerical parity against the supplied reference
is proven separately by `tools/litea_reference_replay.py`.
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from src.features import DIRECTION_ORDER
from src.litea.engine import Head, LiteA, digest, wrap_historical_head
from src.litea.guard import DailyFloor
from src.litea.heads import DailyHeadStore, HeadUnavailable
from src.litea.identity import BASE_MODE, EXCEPTION_RANK, MODEL_ID
from src.litea.packet import Direction60Packet, Direction60Source
from src.litea.state import Cursors, LiteAState
from src.litea.store import target_row

UTC = timezone.utc


def make_head(cutoff: datetime) -> dict:
    return wrap_historical_head(
        {
            "feature_order": list(DIRECTION_ORDER),
            "imputation": [0.0] * 60,
            "center": [0.0] * 60,
            "scale": [1.0] * 60,
            "coefficient": [0.0] * 60,
            "intercept": 0.25,
            "fit_cutoff": cutoff.isoformat(),
            "train_rows": 700,
            "train_start": (cutoff - timedelta(days=30)).isoformat(),
            "train_end": (cutoff - timedelta(minutes=15)).isoformat(),
            "max_train_settlement": (cutoff - timedelta(minutes=1)).isoformat(),
        }
    )


# -- identity ------------------------------------------------------------------
def test_composition_is_locked():
    state = LiteAState()
    assert state.engine.mode == BASE_MODE == "baseline"
    assert state.guard.exception_rank == EXCEPTION_RANK == 0.90
    assert MODEL_ID == "lite-a-floor4-top10-r1"


def test_baseline_engine_never_owns_risk():
    """`baseline` applies no floor of its own, so the guard applies it once."""
    engine = LiteA(mode=BASE_MODE)
    target = datetime(2026, 9, 10, 0, 0, tzinfo=UTC)
    out = engine.decide(
        target=target,
        ticker="T",
        features={name: 0.0 for name in DIRECTION_ORDER},
        input_valid=True,
        head=Head(make_head(datetime(2026, 9, 10, 0, 0, tzinfo=UTC))),
        observed_at=target + timedelta(seconds=5),
    )
    assert out["risk_before"] is None
    assert engine.pending == {}
    assert out["execution_enabled"] is False


# -- heads ---------------------------------------------------------------------
def test_expired_head_cannot_score_a_later_day(tmp_path: Path):
    store = DailyHeadStore(tmp_path)
    store.save(make_head(datetime(2026, 8, 31, 0, 0, tzinfo=UTC)))
    assert store.head_for(datetime(2026, 8, 31, 23, 45, tzinfo=UTC))
    with pytest.raises(HeadUnavailable):
        store.head_for(datetime(2026, 9, 1, 0, 0, tzinfo=UTC))


def test_head_gap_is_an_abstention_not_a_stale_score(tmp_path: Path):
    store = DailyHeadStore(tmp_path)
    store.save(make_head(datetime(2026, 9, 1, 0, 0, tzinfo=UTC)))
    store.save(make_head(datetime(2026, 9, 3, 0, 0, tzinfo=UTC)))
    with pytest.raises(HeadUnavailable):
        store.head_for(datetime(2026, 9, 2, 12, 0, tzinfo=UTC))


def test_conflicting_head_for_a_day_is_refused(tmp_path: Path):
    store = DailyHeadStore(tmp_path)
    cutoff = datetime(2026, 9, 1, 0, 0, tzinfo=UTC)
    store.save(make_head(cutoff))
    other = make_head(cutoff)
    other["intercept"] = 0.5
    with pytest.raises(RuntimeError):
        store.save(other)


# -- packet --------------------------------------------------------------------
class FakeStage:
    def __init__(self, features, reasons):
        self.target_ns = 0
        self.cutoff_ns = 5_000_000_000
        self.freeze_ns = 5_000_000_000
        self.reasons = list(reasons)
        self.direction_features = features


class FakePackets:
    def __init__(self, features, reasons=()):
        self.stage = FakeStage(features, reasons)

    def direction_stage(self, target, cutoff_ns, freeze_ns=None):
        return self.stage

    def _source_metadata(self, target_ns, cutoff_ns, freeze_ns):
        return {"on_time": True, "feed_watermarks": {}, "last_receipt_ns": 1}

    def _feed_blockers(self, at_ns):
        return []


def test_missing_column_blocks_the_packet_instead_of_being_filled():
    features = {name: 1.0 for name in DIRECTION_ORDER}
    features.pop(DIRECTION_ORDER[7])
    packet = Direction60Source(FakePackets(features)).build(
        datetime(2026, 9, 10, tzinfo=UTC), 0, 0
    )
    assert packet.input_valid is False
    assert packet.blockers
    assert packet.as_engine_features()[DIRECTION_ORDER[7]] is None


def test_non_finite_value_is_left_to_the_fitted_imputation():
    features = {name: 1.0 for name in DIRECTION_ORDER}
    features[DIRECTION_ORDER[0]] = float("nan")
    packet = Direction60Source(FakePackets(features)).build(
        datetime(2026, 9, 10, tzinfo=UTC), 0, 0
    )
    assert packet.input_valid is True
    assert packet.as_engine_features()[DIRECTION_ORDER[0]] is None


def test_source_blocker_marks_the_packet_unavailable():
    features = {name: 1.0 for name in DIRECTION_ORDER}
    packet = Direction60Source(FakePackets(features, ["spot window incomplete"])).build(
        datetime(2026, 9, 10, tzinfo=UTC), 0, 0
    )
    assert packet.input_valid is False


# -- paired state --------------------------------------------------------------
def _decide_once(state: LiteAState, target: datetime, head: Head) -> None:
    observed = target + timedelta(seconds=5)
    out = state.engine.decide(
        target=target,
        ticker=f"K-{target.isoformat()}",
        features={name: 0.0 for name in DIRECTION_ORDER},
        input_valid=True,
        head=head,
        observed_at=observed,
    )
    state.guard.decide(
        target=target,
        ticker=f"K-{target.isoformat()}",
        candidate=out["candidate"],
        rank=out["rank"],
        observed_at=observed,
    )


def test_paired_state_round_trip(tmp_path: Path):
    state = LiteAState()
    head = Head(make_head(datetime(2026, 9, 10, 0, 0, tzinfo=UTC)))
    _decide_once(state, datetime(2026, 9, 10, 0, 0, tzinfo=UTC), head)
    state.cursors.last_committed_target = "2026-09-10T00:00:00+00:00"
    path = tmp_path / "state.json"
    state.save(path)
    restored = LiteAState.load(path)
    assert restored.snapshot() == state.snapshot()
    assert restored.cursors.last_committed_target == "2026-09-10T00:00:00+00:00"


def test_tampered_pair_digest_is_refused(tmp_path: Path):
    state = LiteAState()
    envelope = state.snapshot()
    envelope["state"]["cursors"]["training_rows"] = 99
    with pytest.raises(ValueError):
        LiteAState.restore(envelope)


def test_half_advanced_pair_is_refused():
    """Engine ahead of the guard would mean an unrecorded exposure decision."""
    state = LiteAState()
    head = Head(make_head(datetime(2026, 9, 10, 0, 0, tzinfo=UTC)))
    target = datetime(2026, 9, 10, 0, 0, tzinfo=UTC)
    state.engine.decide(
        target=target,
        ticker="K",
        features={name: 0.0 for name in DIRECTION_ORDER},
        input_valid=True,
        head=head,
        observed_at=target + timedelta(seconds=5),
    )
    envelope = state.snapshot()
    # Re-seal so the digest itself is valid; only the pairing is wrong.
    envelope = {"sha256": digest(envelope["state"]), "state": envelope["state"]}
    with pytest.raises(ValueError, match="PAIR_INCONSISTENT"):
        LiteAState.restore(envelope)


def test_restored_state_continues_the_rank_queue(tmp_path: Path):
    state = LiteAState()
    head = Head(make_head(datetime(2026, 9, 10, 0, 0, tzinfo=UTC)))
    for minute in (0, 15, 30):
        _decide_once(state, datetime(2026, 9, 10, 0, minute, tzinfo=UTC), head)
    path = tmp_path / "s.json"
    state.save(path)
    restored = LiteAState.load(path)
    assert [len(q) for q in restored.engine.history.values()] == [
        len(q) for q in state.engine.history.values()
    ]


# -- retry safety --------------------------------------------------------------
def test_retrying_a_target_does_not_advance_rank_or_exposure():
    state = LiteAState()
    head = Head(make_head(datetime(2026, 9, 10, 0, 0, tzinfo=UTC)))
    target = datetime(2026, 9, 10, 0, 0, tzinfo=UTC)
    _decide_once(state, target, head)
    before = state.snapshot()
    _decide_once(state, target, head)  # the retry
    assert state.snapshot() == before


# -- logging shape -------------------------------------------------------------
def _row():
    target = datetime(2026, 9, 10, 0, 0, tzinfo=UTC)
    packet = Direction60Packet(
        target_open=target,
        ticker="KXBTC15M-X",
        features={name: 0.0 for name in DIRECTION_ORDER},
        input_valid=True,
        blockers=[],
        source={"feed_watermarks": {}, "last_receipt_ns": 1},
    )
    engine_output = {
        "p_yes": 0.61,
        "direction": 1,
        "candidate": 1,
        "rank": 0.71,
        "rank_count": 700,
        "reason": "CONFIDENCE_ABSTAIN",
    }
    guard_output = {"prediction": 1, "reason": "ORDINARY_CALL", "exception": False}
    return target_row(
        target_open=target,
        ticker="KXBTC15M-X",
        engine_output=engine_output,
        guard_output=guard_output,
        packet=packet,
        timing={"target_open_ns": 1, "deadline_met": True},
    )


def test_row_carries_version1_identity_and_no_execution():
    row = _row()
    assert row["model_version"] == MODEL_ID
    assert row["features"]["execution_enabled"] is False
    assert row["run_mode"] == "LIVE"


def test_row_never_zero_fills_the_c85_only_columns():
    row = _row()
    for column in (
        "probability_correct",
        "aux_long_logit",
        "aux_recent_logit",
        "deterioration_ewma16",
        "direction_fit_id",
        "meta_fit_id",
        "structure_valid",
        "cm_valid",
        "auxiliary_valid",
    ):
        assert column not in row, f"{column} must stay NULL for Version 1"


def test_row_is_json_serialisable():
    json.dumps(_row())


def test_nan_feature_is_serialised_as_null_never_zero():
    """A missing input must reach the ledger as JSON null.

    `json.dumps(..., allow_nan=False)` in the signed backend client refuses NaN,
    and zero-filling would invent an observation that never happened.
    """
    from src.litea.store import _jsonable

    cleaned = _jsonable({"a": float("nan"), "b": [float("inf"), 1.5], "c": 0.0})
    assert cleaned == {"a": None, "b": [None, 1.5], "c": 0.0}
    assert json.dumps(cleaned, allow_nan=False)


def test_checkpoint_carries_the_sealed_paired_envelope():
    """The checkpoint must be restorable without re-manufacturing its digest."""
    from src.litea.state import LiteAState
    from src.litea.store import checkpoint_payload

    state = LiteAState()
    state.cursors.last_fit_cutoff = "2026-09-08T00:00:00+00:00"
    payload = checkpoint_payload(state, next_target=None)
    envelope = payload["expert_state"]["litea_paired_envelope"]
    assert envelope["sha256"] == payload["state_sha256"]
    restored = LiteAState.restore(envelope)
    assert restored.cursors.last_fit_cutoff == "2026-09-08T00:00:00+00:00"
    assert restored.snapshot()["sha256"] == envelope["sha256"]


# --------------------------------------------------------------------------- #
# Service lifecycle: recording must not depend on scoring, and an undelivered
# decision must not stop the service forever.


class FailingStore:
    """Commits fail until `fail` is cleared."""

    def __init__(self) -> None:
        self.fail = True
        self.committed: list[str] = []

    def commit(self, row, checkpoint):
        if self.fail:
            raise RuntimeError("transport down")
        self.committed.append(row["target_open_utc"])
        return {"ok": True}


def _worker(tmp_path: Path, store, head_cutoff: datetime | None = None):
    from src.litea.heads import DailyHeadStore
    from src.litea.worker import LiteAWorker

    heads = DailyHeadStore(tmp_path / "heads")
    if head_cutoff is not None:
        heads.save(make_head(head_cutoff))
    return LiteAWorker(
        packet_source=FakePackets({}, ()),
        store=store,
        heads=heads,
        state=LiteAState(),
        state_path=tmp_path / "state.json",
        ticker_resolver=object(),
        feeds=object(),
    )


def test_expired_head_still_records_so_a_new_head_can_ever_be_fitted(tmp_path: Path):
    # An August head on a September day: scoring is blocked, but the scheduler
    # stays armed, which is what lets the midnight row be recorded at all.
    worker = _worker(tmp_path, FailingStore(), datetime(2026, 8, 31, tzinfo=timezone.utc))
    at = datetime(2026, 9, 10, 0, 0, tzinfo=timezone.utc)
    assert worker.scoring_readiness(at)[0] == "BLOCKED"
    assert worker.evaluate_readiness(at)[0] == "RECORDING_ONLY"
    assert worker.recording_blockers() == []


def test_undelivered_decision_is_queued_and_drains_without_a_boundary(tmp_path: Path):
    store = FailingStore()
    worker = _worker(tmp_path, store)
    first = {"target_open_utc": "2026-09-10T00:00:00+00:00"}
    second = {"target_open_utc": "2026-09-10T00:15:00+00:00"}

    assert worker._commit(first, {})["ok"] is False
    # The next target is still recorded rather than blocked by the failure.
    assert worker._commit(second, {})["ok"] is False
    assert len(worker.pending_targets()) == 2

    store.fail = False
    outcome = worker.reconcile_pending()
    assert outcome["ok"] and outcome["delivered"] == 2
    # Delivered in target order, and the cursor lands on the later target.
    assert store.committed == [first["target_open_utc"], second["target_open_utc"]]
    assert worker.state.cursors.last_committed_target == second["target_open_utc"]
    assert worker.pending_targets() == []


def test_a_late_delivery_never_rewinds_the_committed_cursor(tmp_path: Path):
    store = FailingStore()
    worker = _worker(tmp_path, store)
    worker.state.cursors.last_committed_target = "2026-09-10T02:00:00+00:00"
    store.fail = False
    worker._commit({"target_open_utc": "2026-09-10T00:00:00+00:00"}, {})
    worker.reconcile_pending()
    assert worker.state.cursors.last_committed_target == "2026-09-10T02:00:00+00:00"
