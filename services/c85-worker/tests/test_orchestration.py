"""Boundary-orchestration tests.

SCOPE LABEL — READ FIRST
========================
These are **supplied-feature orchestration tests**. They drive
`BoundaryOrchestrator` with a deterministic in-test packet source that hands the
already-computed feature/validity/expert fields straight to the chain. They
prove the *sequence and durability* of one target: ordering, restart-resume
parity, duplicate suppression, settlement cutoffs, deadline handling and commit
semantics.

They are **not** raw-input live parity. No live producer for the nine leaf
outputs exists yet (`src/experts/leaf.py::LeafExperts.evaluate` passes through
already-computed upstream fields), so raw-input parity cannot be tested here and
is deliberately absent rather than faked. The production wiring uses
`UnavailablePacketSource`, and `test_production_default_fails_closed` asserts
that a boundary with no live producer becomes an explicit MISSED row.
"""
from __future__ import annotations

import asyncio
import copy
import sys
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.orchestration import (
    event_admitted,  # noqa: E402
    BoundaryOrchestrator,
    RawPacketUnavailable,
    TargetInputs,
    UnavailablePacketSource,
)
from src.scheduler import RunTiming  # noqa: E402
from src.state import C85State  # noqa: E402
from src.tickers import (  # noqa: E402
    KalshiTickerResolver,
    StaticTickerResolver,
    TickerResolutionError,
    candidates,
)

NS = 1_000_000_000
START = datetime(2026, 9, 1, 0, 0, tzinfo=timezone.utc)


# --- doubles ---------------------------------------------------------------
def bundle(order: list[str], coefficient: list[float], intercept: float) -> dict[str, Any]:
    n = len(order)
    return {
        "feature_order": order,
        "imputation": [0.0] * n,
        "center": [0.0] * n,
        "scale": [1.0] * n,
        "coefficient": coefficient,
        "intercept": intercept,
    }


@dataclass
class FakeHead:
    as_of: Any
    bundle: dict[str, Any]


class FakeArtifacts:
    feature_order_sha256 = "sha-test"

    def __init__(self, *, have_meta: bool = True) -> None:
        self.have_meta = have_meta

    def head_for(self, kind: str, target_open: datetime) -> FakeHead | None:
        if kind == "C71_DIRECTION":
            return FakeHead(target_open.date(), bundle(["d0"], [4.0], 0.0))
        if not self.have_meta:
            return None
        return FakeHead(target_open.date(), bundle(["m0", "LONG_logit"], [3.0, 0.5], 0.0))


class FakeStore:
    """Records every durable call so the tests can assert exact semantics."""

    def __init__(self, settlements: list[dict[str, Any]] | None = None) -> None:
        self.settlements = settlements or []
        self.commits: list[dict[str, Any]] = []
        self.dispatch_commits: list[dict[str, Any]] = []
        self.missed: list[tuple[Any, str, str]] = []
        self.consumed: list[list[str]] = []
        self.checkpoints: list[dict[str, Any]] = []
        self.seq = 0
        # failure injection
        self.fail_commit: str | None = None       # None | "reject" | "raise"
        self.lose_response = False                # commit lands, response lost
        self.lease_ok = True

    def unconsumed_settlements(self, since: Any = None) -> list[dict[str, Any]]:
        return list(self.settlements)

    def verify_lease(self, **_: Any) -> dict[str, Any]:
        return {"ok": self.lease_ok, "lease": {"owner_id": "w1", "fence": 1}}

    def committed_identity(self) -> dict[str, Any] | None:
        return self.checkpoints[-1] if self.checkpoints else None

    def _record(self, decision, state, outbox):
        self.seq += 1
        self.commits.append(
            {
                "identity": decision.identity,
                "status": decision.status,
                "final_side": decision.final_side,
                "published_at": None,
                "outbox": outbox,
            }
        )
        if state is not None:
            snapshot = copy.deepcopy(state.to_dict())
            snapshot["checkpoint_seq"] = self.seq
            snapshot["state_sha256"] = state.sha256()
            self.checkpoints.append(snapshot)
        return {"ok": True, "target_id": f"tid-{len(self.commits)}",
                "checkpoint": {"checkpoint_seq": self.seq}}

    def commit_decision(self, decision, *, published_at=None, state=None,
                        stage="READY", outbox=None):
        if self.fail_commit == "reject":
            return {"ok": False, "error": "immutable_published_decision"}
        if self.fail_commit == "raise":
            raise RuntimeError("connection reset")
        result = self._record(decision, state, outbox)
        self.commits[-1]["published_at"] = published_at
        if self.lose_response:
            raise RuntimeError("response lost after commit")
        return result

    def commit_dispatch_result(self, decision, *, published_at=None):
        self.dispatch_commits.append(
            {"identity": decision.identity, "status": decision.status,
             "published_at": published_at}
        )
        return {"ok": True}

    def consume_settlements(self, ids, state=None, stage="READY"):
        self.consumed.append(list(ids))
        return {"consumed": len(ids)}

    def mark_missed(self, ticker, target_open, reason):
        self.missed.append((ticker, target_open.isoformat(), reason))



class FakeGateway:
    def __init__(self) -> None:
        self.sent: list[dict[str, Any]] = []

    async def publish(self, payload: dict[str, Any]) -> dict[str, Any]:
        self.sent.append(payload)
        return {"ok": True, "status": 200}


class SuppliedFeaturePacketSource:
    """TEST-ONLY. Hands pre-computed fields to the chain; not live inference."""

    def __init__(self, rows: dict[str, TargetInputs], missing: set[str] | None = None) -> None:
        self.rows = rows
        self.missing = missing or set()

    def build(self, target_open: datetime, freeze_ns: int) -> TargetInputs:
        key = target_open.isoformat()
        if key in self.missing:
            raise RawPacketUnavailable(f"binance_spot window incomplete for {key}")
        return self.rows[key]


def inputs_for(index: int, *, structure_valid: bool = True) -> TargetInputs:
    swing = ((index * 37) % 100) / 100.0 - 0.5
    return TargetInputs(
        direction_features={"d0": swing},
        meta_features_without_aux={"m0": ((index * 53) % 100) / 100.0 - 0.5},
        auxiliary_outputs={"LONG_logit": 0.1 * ((index % 7) - 3)},
        validity={
            "binance_complete": True,
            "anchor_valid": True,
            "cm_valid": True,
            "source_ok": True,
            "auxiliary_valid": True,
            "structure_valid": structure_valid,
            "market_q1": index % 4 == 0,
        },
        c54_prediction=1 if index % 3 == 0 else -1,
        market_q1=index % 4 == 0,
        last_yes_price=0.4 + 0.02 * (index % 10),
        aux_fit_month="202608",
        source={"source_hash": f"h{index}"},
    )


def build_case(count: int, *, gateway: FakeGateway | None = None, store: FakeStore | None = None):
    targets = [START + timedelta(minutes=15 * i) for i in range(count)]
    rows = {t.isoformat(): inputs_for(i) for i, t in enumerate(targets)}
    store = store or FakeStore()
    orchestrator = BoundaryOrchestrator(
        artifacts=FakeArtifacts(),
        store=store,
        gateway=gateway,
        packet_source=SuppliedFeaturePacketSource(rows),
        ticker_resolver=StaticTickerResolver({t.isoformat(): f"KXBTC15M-{i}" for i, t in enumerate(targets)}),
        allow_dispatch=gateway is not None,
        clock_ns=lambda: int(START.timestamp() * NS),  # always inside the ceiling
    )
    return targets, orchestrator, store


def run_all(orchestrator, state, targets):
    outcomes = []
    for target in targets:
        timing = RunTiming(target_open_ns=int(target.timestamp() * NS))
        outcomes.append(asyncio.run(orchestrator.run_target(state, target, timing)))
    return outcomes


# --- tests ------------------------------------------------------------------
def test_chronological_boundaries_produce_decisions_and_checkpoints():
    targets, orchestrator, store = build_case(12)
    state = C85State()
    outcomes = run_all(orchestrator, state, targets)

    assert [o.status for o in outcomes] == ["ABSTAIN"] * 12 or all(
        o.status in ("ABSTAIN", "PUBLISHED") for o in outcomes
    )
    assert len(store.commits) == 12
    assert len(store.checkpoints) == 12  # decision + checkpoint in one transaction
    assert state.last_processed_target_utc == targets[-1].isoformat()


def test_restart_resume_matches_uninterrupted_run():
    """Same inputs, mid-run restart from the durable checkpoint -> identical
    decisions and identical resulting state."""
    targets, orchestrator, _ = build_case(20)
    uninterrupted = C85State()
    a = run_all(orchestrator, uninterrupted, targets)

    targets, orchestrator_b, store_b = build_case(20)
    first = C85State()
    run_all(orchestrator_b, first, targets[:9])
    # restart: only the durable checkpoint survives
    restored = C85State.from_dict(store_b.checkpoints[-1])
    b_tail = run_all(orchestrator_b, restored, targets[9:])

    assert [o.decision.final_side for o in a[9:]] == [o.decision.final_side for o in b_tail]
    assert [o.decision.probability_correct for o in a[9:]] == [
        o.decision.probability_correct for o in b_tail
    ]
    assert [o.decision.admission_rank for o in a[9:]] == [
        o.decision.admission_rank for o in b_tail
    ]
    assert restored.sha256() == uninterrupted.sha256()
    # no duplicate dispatch: the pre-restart targets are not re-emitted
    assert len(store_b.commits) == 20


def test_duplicate_target_and_retry_are_suppressed():
    targets, orchestrator, store = build_case(3)
    state = C85State()
    run_all(orchestrator, state, targets)
    before = state.sha256()

    repeat = run_all(orchestrator, state, targets[-1:])[0]
    assert repeat.status == "DUPLICATE"
    assert repeat.committed is False
    assert state.sha256() == before          # state mutated exactly once
    assert len(store.commits) == 3           # no second row, no second outbox


def test_missing_raw_input_becomes_an_explicit_missed_row():
    targets = [START + timedelta(minutes=15 * i) for i in range(2)]
    rows = {t.isoformat(): inputs_for(i) for i, t in enumerate(targets)}
    store = FakeStore()
    orchestrator = BoundaryOrchestrator(
        artifacts=FakeArtifacts(),
        store=store,
        gateway=None,
        packet_source=SuppliedFeaturePacketSource(rows, missing={targets[1].isoformat()}),
        ticker_resolver=StaticTickerResolver({t.isoformat(): "KXBTC15M-X" for t in targets}),
        clock_ns=lambda: int(START.timestamp() * NS),
    )
    state = C85State()
    outcomes = run_all(orchestrator, state, targets)
    assert outcomes[1].status == "MISSED"
    assert "C85_RAW_PACKET_UNAVAILABLE" in outcomes[1].blocker
    assert len(store.commits) == 1
    # a missing input is never counted as an abstention
    assert store.missed[0][2].startswith("C85_RAW_PACKET_UNAVAILABLE")


def test_production_default_fails_closed():
    source = UnavailablePacketSource()
    with pytest.raises(RawPacketUnavailable) as excinfo:
        source.build(START, int(START.timestamp() * NS))
    assert "leaf.py" in str(excinfo.value)


def test_no_applicable_fit_abstains_without_stale_weights():
    targets = [START]
    store = FakeStore()
    orchestrator = BoundaryOrchestrator(
        artifacts=FakeArtifacts(have_meta=False),
        store=store,
        gateway=None,
        packet_source=SuppliedFeaturePacketSource({START.isoformat(): inputs_for(0)}),
        ticker_resolver=StaticTickerResolver({START.isoformat(): "KXBTC15M-0"}),
        clock_ns=lambda: int(START.timestamp() * NS),
    )
    outcome = run_all(orchestrator, C85State(), targets)[0]
    assert outcome.decision.status == "INVALID"
    assert outcome.decision.status_reason == "C85_NO_APPLICABLE_FIT"
    assert outcome.decision.final_side == 0


def test_settlements_are_consumed_only_when_strictly_before_the_decision_cutoff():
    targets, orchestrator, store = build_case(3)
    state = C85State()
    # a base call from an earlier target, awaiting settlement
    identity = "OLD|2026-08-31T23:45:00+00:00"
    state.deterioration.register_base_call(identity, 1, int(START.timestamp() * NS) - NS)

    decision_ns = int(targets[0].timestamp() * NS) + 5 * NS
    # late: settles exactly at the cutoff -> must NOT be consumed at target 0
    store.settlements = [
        {"identity": identity, "label": 1, "settlement_ns": decision_ns}
    ]
    first = run_all(orchestrator, state, targets[:1])[0]
    assert first.settlements_consumed == []
    assert state.deterioration.count == 0

    # by the next target the same settlement is strictly in the past
    second = run_all(orchestrator, state, targets[1:2])[0]
    assert second.settlements_consumed == [identity]
    assert state.deterioration.count == 1
    assert store.consumed[-1] == [identity]
    # exactly once: a third target does not re-consume it
    run_all(orchestrator, state, targets[2:3])
    assert state.deterioration.count == 1


def test_missed_publication_deadline_records_expired_and_never_dispatches():
    targets = [START]
    store, gateway = FakeStore(), FakeGateway()
    late_ns = int(START.timestamp() * NS) + 9 * NS  # T+9s, past the T+5s ceiling
    forced = inputs_for(0)
    orchestrator = BoundaryOrchestrator(
        artifacts=FakeArtifacts(),
        store=store,
        gateway=gateway,
        packet_source=SuppliedFeaturePacketSource({START.isoformat(): forced}),
        ticker_resolver=StaticTickerResolver({START.isoformat(): "KXBTC15M-0"}),
        allow_dispatch=True,
        clock_ns=lambda: late_ns,
    )
    outcome = run_all(orchestrator, C85State(), targets)[0]
    assert gateway.sent == []                      # no late webhook, ever
    assert outcome.dispatched is False
    assert store.commits[0]["published_at"] is None  # the row still exists
    # a directional call that misses the ceiling is EXPIRED, not silently on time
    if outcome.decision.base_side != 0 and outcome.decision.final_side != 0:
        assert outcome.decision.status == "EXPIRED"


def test_feature_cutoff_is_the_model_rule_not_the_deadline_minus_budget():
    """The T+5 stage admits events in [T, T+5s). It is NOT shortened by the
    compute budget: an earlier revision truncated inputs to T+3.8s, which
    silently changes the model."""
    from src.config import (
        COMPUTE_BUDGET_MS,
        CUTOFF_DEADLINE_CONFLICT_MS,
        FEATURE_INPUT_CUTOFF_MS,
        PUBLICATION_DEADLINE_MS,
    )

    t = int(START.timestamp() * NS)
    assert FEATURE_INPUT_CUTOFF_MS == 5000
    assert BoundaryOrchestrator.input_cutoff_ns(t) == t + FEATURE_INPUT_CUTOFF_MS * 1_000_000
    assert BoundaryOrchestrator.input_cutoff_ns(t) != t + (
        PUBLICATION_DEADLINE_MS - COMPUTE_BUDGET_MS
    ) * 1_000_000
    assert BoundaryOrchestrator.publication_deadline_ns(t) == t + PUBLICATION_DEADLINE_MS * 1_000_000

    # an event at T+4.2s is INSIDE the original window (the 3.8s cut dropped it)
    assert event_admitted(t + 4_200 * 1_000_000, t)
    assert event_admitted(t + 4_999_999_999, t)
    # the bound is exclusive, and nothing before T is admitted
    assert not event_admitted(t + 5_000 * 1_000_000, t)
    assert not event_admitted(t + 6_000 * 1_000_000, t)
    assert not event_admitted(t - 1, t)

    # and the conflict is reported, not resolved by moving either clock
    assert CUTOFF_DEADLINE_CONFLICT_MS == COMPUTE_BUDGET_MS > 0
    assert BoundaryOrchestrator.cutoff_conflict_ms() == CUTOFF_DEADLINE_CONFLICT_MS


def test_packet_source_receives_the_full_five_second_cutoff():
    seen: list[int] = []

    class Recording(SuppliedFeaturePacketSource):
        def build(self, target_open, cutoff_ns):
            seen.append(cutoff_ns)
            return super().build(target_open, cutoff_ns)

    store = FakeStore()
    orchestrator = BoundaryOrchestrator(
        artifacts=FakeArtifacts(),
        store=store,
        gateway=None,
        packet_source=Recording({START.isoformat(): inputs_for(0)}),
        ticker_resolver=StaticTickerResolver({START.isoformat(): "KXBTC15M-0"}),
        clock_ns=lambda: int(START.timestamp() * NS),
    )
    run_all(orchestrator, C85State(), [START])
    assert seen == [int(START.timestamp() * NS) + 5_000 * 1_000_000]


# --- transaction semantics ---------------------------------------------------
def test_failed_commit_leaves_authoritative_state_untouched():
    targets, orchestrator, store = build_case(2)
    state = C85State()
    run_all(orchestrator, state, targets[:1])
    before = state.sha256()
    before_last = state.last_processed_target_utc

    store.fail_commit = "reject"
    outcome = run_all(orchestrator, state, targets[1:2])[0]
    assert outcome.status == "COMMIT_FAILED"
    assert outcome.committed is False and outcome.state_promoted is False
    assert state.sha256() == before
    assert state.last_processed_target_utc == before_last

    # the retry is NOT suppressed, and now succeeds
    store.fail_commit = None
    retry = run_all(orchestrator, state, targets[1:2])[0]
    assert retry.committed is True
    assert state.last_processed_target_utc == targets[1].isoformat()


def test_committed_but_response_lost_is_reconciled_not_re_evaluated():
    targets, orchestrator, store = build_case(2)
    state = C85State()
    run_all(orchestrator, state, targets[:1])

    store.lose_response = True
    outcome = run_all(orchestrator, state, targets[1:2])[0]
    # the write landed; reconciliation reads committed identity and promotes
    assert outcome.committed is True
    assert state.last_processed_target_utc == targets[1].isoformat()
    assert len(store.commits) == 2  # not written twice

    store.lose_response = False
    again = run_all(orchestrator, state, targets[1:2])[0]
    assert again.status == "DUPLICATE"
    assert len(store.commits) == 2


def test_unconfirmable_commit_does_not_promote_state():
    targets, orchestrator, store = build_case(1)
    state = C85State()
    store.fail_commit = "raise"
    outcome = run_all(orchestrator, state, targets)[0]
    assert outcome.status == "COMMIT_FAILED"
    assert "C85_COMMIT_UNCONFIRMED" in outcome.blocker
    assert state.last_processed_target_utc is None
    assert store.commits == []


def test_restart_after_failed_commit_continues_from_last_durable_state():
    targets, orchestrator, store = build_case(6)
    state = C85State()
    run_all(orchestrator, state, targets[:3])
    store.fail_commit = "raise"
    run_all(orchestrator, state, targets[3:4])
    store.fail_commit = None

    restored = C85State.from_dict(store.checkpoints[-1])
    tail = run_all(orchestrator, restored, targets[3:])
    assert [o.committed for o in tail] == [True] * 3
    assert restored.last_processed_target_utc == targets[-1].isoformat()


def test_lease_loss_before_commit_blocks_the_write():
    targets, orchestrator, store = build_case(1)
    store.lease_ok = False
    state = C85State()
    outcome = run_all(orchestrator, state, targets)[0]
    assert outcome.status == "LEASE_LOST"
    assert store.commits == []
    assert state.last_processed_target_utc is None


# --- outbox / publication lifecycle -----------------------------------------
def _directional_case(clock_ns):
    """A forced directional decision, so the lifecycle is observable."""
    store, gateway = FakeStore(), FakeGateway()
    state = C85State()
    for side in (1, -1):
        for _ in range(200):
            state.admission_ranks.queues[side].append(0.0)
            state.filter_ranks.queues[side].append(0.0)
    orchestrator = BoundaryOrchestrator(
        artifacts=FakeArtifacts(),
        store=store,
        gateway=gateway,
        packet_source=SuppliedFeaturePacketSource({START.isoformat(): inputs_for(0)}),
        ticker_resolver=StaticTickerResolver({START.isoformat(): "KXBTC15M-0"}),
        allow_dispatch=True,
        clock_ns=clock_ns,
    )
    return orchestrator, store, gateway, state


def test_outbox_matches_the_signed_ops_contract_and_expires_at_the_ceiling():
    orchestrator, store, gateway, state = _directional_case(
        lambda: int(START.timestamp() * NS)
    )
    outcome = run_all(orchestrator, state, [START])[0]
    assert outcome.decision.final_side != 0
    outbox = store.commits[0]["outbox"]
    assert set(outbox) == {"dedupe_key", "payload", "expires_at"}
    assert outbox["expires_at"] == (START + timedelta(milliseconds=5000)).isoformat()
    # published only after acceptance, and only in the second write
    assert store.commits[0]["published_at"] is None
    assert store.dispatch_commits[-1]["published_at"] is not None
    assert outcome.status == "PUBLISHED" and outcome.accepted is True
    assert gateway.sent and gateway.sent[0]["side"] == outcome.decision.final_side


def test_rejected_dispatch_is_not_marked_published():
    orchestrator, store, gateway, state = _directional_case(
        lambda: int(START.timestamp() * NS)
    )

    async def reject(payload):
        gateway.sent.append(payload)
        return {"ok": False, "status": 503}

    gateway.publish = reject
    outcome = run_all(orchestrator, state, [START])[0]
    assert outcome.status == "DISPATCH_FAILED"
    assert outcome.dispatched is True and outcome.accepted is False
    assert store.dispatch_commits[-1]["published_at"] is None


def test_commit_that_crosses_the_deadline_leaves_no_dispatchable_outbox():
    late = int(START.timestamp() * NS) + 9 * NS
    orchestrator, store, gateway, state = _directional_case(lambda: late)
    outcome = run_all(orchestrator, state, [START])[0]
    assert outcome.status == "EXPIRED"
    assert store.commits[0]["outbox"] is None   # nothing to dispatch later
    assert gateway.sent == []
    assert store.commits[0]["published_at"] is None


# --- ticker resolution ------------------------------------------------------
def test_ticker_is_verified_against_market_metadata_not_guessed():
    target = datetime(2026, 9, 8, 18, 30, tzinfo=timezone.utc)
    both = candidates("KXBTC15M", target)
    assert both["open"] != both["close"]

    listed = {
        both["close"]: [
            {
                "ticker": both["close"],
                "open_time": target.isoformat(),
                "close_time": (target + timedelta(minutes=15)).isoformat(),
            }
        ],
        both["open"]: [
            {  # the neighbouring contract: right stamp shape, wrong window
                "ticker": both["open"],
                "open_time": (target - timedelta(minutes=15)).isoformat(),
                "close_time": target.isoformat(),
            }
        ],
    }
    resolver = KalshiTickerResolver("KXBTC15M", lambda t: listed.get(t, []))
    assert resolver.resolve(target) == both["close"]


def test_unlisted_interval_fails_closed_instead_of_inventing_a_contract():
    target = datetime(2026, 9, 8, 18, 30, tzinfo=timezone.utc)
    resolver = KalshiTickerResolver("KXBTC15M", lambda t: [])
    with pytest.raises(TickerResolutionError):
        resolver.resolve(target)


def test_unresolvable_ticker_becomes_a_missed_row_with_no_decision():
    store = FakeStore()
    orchestrator = BoundaryOrchestrator(
        artifacts=FakeArtifacts(),
        store=store,
        gateway=None,
        packet_source=SuppliedFeaturePacketSource({START.isoformat(): inputs_for(0)}),
        ticker_resolver=KalshiTickerResolver("KXBTC15M", lambda t: []),
        clock_ns=lambda: int(START.timestamp() * NS),
    )
    outcome = run_all(orchestrator, C85State(), [START])[0]
    assert outcome.status == "MISSED"
    assert "C85_TICKER_UNRESOLVED" in outcome.blocker
    assert store.commits == []
