"""A split head/rank pair is fatal: no dispatch, no further boundaries.

`ChainCommitError` means the fitted head advanced while the positional rank
window did not. That cannot be undone in place, so the orchestrator must stop
dead: the already-durable decision stays as written, nothing is dispatched, and
every later boundary is refused until an operator restores a verified paired
generation and releases the halt explicitly.

COVERAGE QUALIFICATION: these tests exercise the orchestrator's halt, dispatch
suppression and duplicate-reconciliation *decisions* with a stubbed chain. They
do NOT prove that a real restored head+rank pair replays the already-durable
missing target in production; that operation is exercised separately by the
September continuation replay, which restores the real paired generation from
private storage and compares an uninterrupted run against a mid-block restart.
"""
from __future__ import annotations

import asyncio
import dataclasses
import sys
from datetime import timedelta
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import test_orchestration as to  # noqa: E402

from src.experts import ChainCommitError  # noqa: E402
from src.scheduler import RunTiming  # noqa: E402
from src.state import C85State  # noqa: E402

NS = to.NS


class SplittingUpdate:
    """Head commits, rank refuses — the one unrecoverable ordering."""

    def __init__(self) -> None:
        self.head_advanced = False
        self.rank_advanced = False
        self.rolled_back = False

    def commit(self) -> None:
        self.head_advanced = True
        raise ChainCommitError("rank window refused after the head advanced")

    def rollback(self) -> None:
        self.rolled_back = True


class GoodUpdate:
    def __init__(self) -> None:
        self.commits = 0
        self.rolled_back = 0

    def commit(self) -> None:
        self.commits += 1

    def rollback(self) -> None:
        self.rolled_back += 1


def _attach(orchestrator, target, update):
    """TargetInputs is frozen: swap in a copy carrying the pending update."""

    key = target.isoformat()
    rows = orchestrator.packet_source.rows
    rows[key] = dataclasses.replace(rows[key], pending_update=update)
    return update


def _run(orchestrator, state, target):
    timing = RunTiming(target_open_ns=int(target.timestamp() * NS))
    return asyncio.run(orchestrator.run_target(state, target, timing))


def _case(count: int = 3):
    gateway = to.FakeGateway()
    targets, orchestrator, store = to.build_case(count, gateway=gateway)
    return targets, orchestrator, store, gateway


def test_split_pair_stops_the_run_and_dispatches_nothing():
    targets, orchestrator, store, gateway = _case()
    split = _attach(orchestrator, targets[0], SplittingUpdate())
    state = C85State()

    first = _run(orchestrator, state, targets[0])
    assert first.status == "CHAIN_INCONSISTENT"
    assert first.committed is True                       # the decision IS durable
    assert "C85_CHAIN_STATE_INCONSISTENT" in first.blocker
    assert gateway.sent == []                            # zero dispatch
    assert split.head_advanced is True
    commits_after_failure = len(store.commits)

    # Every later boundary is refused outright: no packet, no decision, no send.
    second = _run(orchestrator, state, targets[1])
    assert second.status == "HALTED"
    assert second.decision is None
    assert len(store.commits) == commits_after_failure
    assert gateway.sent == []


def test_clear_chain_halt_requires_a_named_restored_generation():
    targets, orchestrator, store, gateway = _case()
    _attach(orchestrator, targets[0], SplittingUpdate())
    state = C85State()
    _run(orchestrator, state, targets[0])

    with pytest.raises(ValueError):
        orchestrator.clear_chain_halt(restored_generation="")
    assert orchestrator.chain_halt is not None
    assert _run(orchestrator, state, targets[1]).status == "HALTED"


def test_recovery_reconciles_the_durable_target_without_a_duplicate_row():
    """After a verified paired restore the SAME target is reprocessed once.

    The durable decision already exists, so recovery must recognise it
    (`DUPLICATE`) rather than log a second row, and must not advance the
    restored head/rank pair for it a second time.
    """

    targets, orchestrator, store, gateway = _case()
    _attach(orchestrator, targets[0], SplittingUpdate())
    state = C85State()
    first = _run(orchestrator, state, targets[0])
    assert first.status == "CHAIN_INCONSISTENT"
    commits = len(store.commits)

    # Operator restores the last verified pair (head and rank back on the
    # previous generation) and names it when releasing the halt.
    orchestrator.clear_chain_halt(restored_generation="gen-000000023424-f82da280c891")
    assert orchestrator.chain_halt is None

    replay = _attach(orchestrator, targets[0], GoodUpdate())
    repeat = _run(orchestrator, state, targets[0])
    assert repeat.status == "DUPLICATE"
    assert len(store.commits) == commits          # no duplicate durable decision
    # The duplicate short-circuit happens BEFORE a packet is built, so the
    # restored pair is not advanced a second time here; re-deriving that one
    # target is the continuation replay's job, against the restored generation.
    assert replay.commits == 0
    assert gateway.sent == []

    # And the run continues normally from the next target.
    nxt = _attach(orchestrator, targets[1], GoodUpdate())
    outcome = _run(orchestrator, state, targets[1])
    assert outcome.status in {"LOGGED", "PUBLISHED", "COMMITTED", "ABSTAIN"}
    assert nxt.commits == 1
