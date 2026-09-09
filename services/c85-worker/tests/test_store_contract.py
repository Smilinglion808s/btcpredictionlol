"""Sequence-handling contract tests against a faithful backend double.

The double is not a mock of ``C85Store``: it re-implements the parts of
``c85_append_checkpoint`` / ``c85_commit_decision`` / ``c85_consume_settlements``
that the worker's correctness depends on —

* ``expected_parent_seq`` is validated against the stored head and a mismatch
  raises, exactly as the plpgsql ``RAISE`` surfaces as a 409;
* checkpoints are append-only and monotonic;
* the assigned ``checkpoint_seq`` is returned inside ``checkpoint``;
* settlements are consumed at most once.

Real production proof still requires the deployed endpoint; this covers the
worker side of the contract, which is where the stale-parent defect lived.
"""
from __future__ import annotations

import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.backend import BackendError  # noqa: E402
from src.engine import Decision  # noqa: E402
from src.state import C85State  # noqa: E402
from src.store import C85Store  # noqa: E402

T0 = datetime(2026, 9, 1, 0, 0, tzinfo=timezone.utc)


class FakeBackend:
    """Contract-faithful stand-in for the signed ops endpoint."""

    def __init__(self) -> None:
        self.checkpoints: list[dict] = []
        self.targets: dict[str, dict] = {}
        self.consumed: set[str] = set()
        self.fail_next: str | None = None
        self.lose_next_response = False
        self.calls: list[str] = []

    # -- helpers ---------------------------------------------------------
    @property
    def head_seq(self) -> int:
        return self.checkpoints[-1]["checkpoint_seq"] if self.checkpoints else 0

    def _append(self, checkpoint: dict) -> dict:
        expected = checkpoint.get("expected_parent_seq")
        if expected is not None and int(expected) != self.head_seq:
            raise BackendError(
                409, f"stale parent checkpoint: expected {expected}, head {self.head_seq}"
            )
        row = {**checkpoint, "checkpoint_seq": self.head_seq + 1}
        self.checkpoints.append(row)
        return row

    # -- transport -------------------------------------------------------
    def call(self, op: str, **kwargs):
        self.calls.append(op)
        if self.fail_next == op:
            self.fail_next = None
            raise BackendError(500, f"{op} exploded")

        if op == "checkpoint.latest":
            return {"checkpoint": self.checkpoints[-1] if self.checkpoints else None}
        if op == "state.bootstrap":
            return {"checkpoint": self.checkpoints[-1] if self.checkpoints else None}
        if op == "checkpoint.append":
            return {"ok": True, "checkpoint": self._append(kwargs["checkpoint"])}
        if op == "decision.commit":
            target = kwargs["target"]
            key = f"{target['ticker']}|{target['target_open_utc']}"
            created = key not in self.targets
            self.targets[key] = target
            checkpoint = None
            if kwargs.get("checkpoint"):
                checkpoint = self._append(kwargs["checkpoint"])
            response = {
                "ok": True,
                "target_id": key,
                "created": created,
                "checkpoint": checkpoint,
            }
            if self.lose_next_response:
                self.lose_next_response = False
                raise BackendError(0, "connection reset after write landed")
            return response
        if op == "settlements.consume":
            fresh = [i for i in kwargs["settlement_ids"] if i not in self.consumed]
            self.consumed.update(fresh)
            checkpoint = None
            if kwargs.get("checkpoint"):
                checkpoint = self._append(kwargs["checkpoint"])
            return {"ok": True, "consumed": fresh, "checkpoint": checkpoint}
        if op == "settlements.pending":
            return {"settlements": []}
        if op == "lease.acquire":
            return {"lease": {"granted": True, "owner_id": "w1", "fence": 1}}
        raise AssertionError(f"unexpected op {op}")


def _decision(minute: int) -> Decision:
    open_utc = T0 + timedelta(minutes=minute)
    d = Decision(ticker=f"KX-{minute}", target_open=open_utc)
    d.timing = {"target_open_ns": str(int(open_utc.timestamp() * 1_000_000_000))}
    return d


def _store() -> tuple[C85Store, FakeBackend]:
    backend = FakeBackend()
    return C85Store(backend, worker_id="w1"), backend


def test_two_successive_commits_advance_parent_sequence():
    store, backend = _store()
    state = C85State()

    store.commit_decision(_decision(0), state=state, outbox=None)
    assert state.checkpoint_seq == 1 and store.last_seq == 1

    # The regression: without adopting seq 1, this second write would be sent
    # with expected_parent_seq=0 and rejected as a stale parent.
    store.commit_decision(_decision(15), state=state, outbox=None)
    assert state.checkpoint_seq == 2 and store.last_seq == 2
    assert [c["checkpoint_seq"] for c in backend.checkpoints] == [1, 2]


def test_settlement_consume_sequence_is_adopted():
    store, backend = _store()
    state = C85State()
    store.commit_decision(_decision(0), state=state)
    store.consume_settlements(["s-1"], state=state)
    assert state.checkpoint_seq == 2 and store.last_seq == 2
    # Next commit must use the settlement checkpoint as its parent.
    store.commit_decision(_decision(15), state=state)
    assert store.last_seq == 3
    # Exactly-once: a repeat consumes nothing new.
    res = store.consume_settlements(["s-1"], state=state)
    assert res["consumed"] == []


def test_restart_between_targets_resumes_from_stored_head():
    store, backend = _store()
    state = C85State()
    store.commit_decision(_decision(0), state=state)
    store.consume_settlements(["s-1"], state=state)

    fresh = C85Store(backend, worker_id="w1")  # process restart, empty memory
    restored, row = fresh.restore_state()
    assert row["checkpoint_seq"] == 2 and fresh.last_seq == 2
    fresh.commit_decision(_decision(15), state=restored)
    assert fresh.last_seq == 3


def test_stale_parent_is_rejected_not_silently_accepted():
    store, backend = _store()
    state = C85State()
    store.commit_decision(_decision(0), state=state)
    store._last_seq = 0  # simulate the old defect
    with pytest.raises(BackendError) as err:
        store.commit_decision(_decision(15), state=state)
    assert err.value.status == 409


def test_lost_response_leaves_write_landed_and_is_reconcilable():
    store, backend = _store()
    state = C85State()
    backend.lose_next_response = True
    with pytest.raises(BackendError):
        store.commit_decision(_decision(0), state=state)
    # The write DID land; local memory has not advanced.
    assert backend.head_seq == 1 and store.last_seq == 0
    row = store.committed_identity()
    assert row["checkpoint_seq"] == 1 and store.last_seq == 1


def test_malformed_and_missing_sequence_responses_are_refused():
    store, backend = _store()
    state = C85State()

    class Silent(FakeBackend):
        def call(self, op, **kwargs):
            if op == "decision.commit":
                return {"ok": True, "target_id": "x", "checkpoint": None}
            return super().call(op, **kwargs)

    quiet = C85Store(Silent(), worker_id="w1")
    with pytest.raises(BackendError, match="C85_MISSING_CHECKPOINT_SEQ"):
        quiet.commit_decision(_decision(0), state=state)

    class Nonsense(FakeBackend):
        def call(self, op, **kwargs):
            if op == "decision.commit":
                return None
            return super().call(op, **kwargs)

    broken = C85Store(Nonsense(), worker_id="w1")
    with pytest.raises(BackendError, match="C85_MALFORMED_COMMIT_RESPONSE"):
        broken.commit_decision(_decision(0), state=state)


def test_rejected_commit_does_not_advance_local_sequence():
    store, backend = _store()
    state = C85State()
    store.commit_decision(_decision(0), state=state)

    class Rejecting(FakeBackend):
        def call(self, op, **kwargs):
            if op == "decision.commit":
                return {"ok": False, "error": "immutable_published_decision"}
            return super().call(op, **kwargs)

    rejecting = C85Store(Rejecting(), worker_id="w1")
    rejecting._last_seq = 1
    with pytest.raises(BackendError, match="C85_MALFORMED_COMMIT_RESPONSE"):
        rejecting.commit_decision(_decision(15), state=state)
    assert rejecting.last_seq == 1
