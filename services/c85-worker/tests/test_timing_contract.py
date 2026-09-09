"""Measured-timing contract tests.

SCOPE LABEL — these reuse the supplied-feature harness from
`test_orchestration.py`. They assert what the worker RECORDS about time, not
raw-input parity:

* the scheduler's actual freeze instant survives (it is never overwritten with
  the theoretical T+5s rule),
* the model input cutoff is stored separately from any measurement,
* build / send / acknowledgement instants are all persisted,
* publication offset and deadline_met derive from the gateway ACK, and a
  post-deadline acknowledgement is not published,
* `CUTOFF_DEADLINE_CONFLICT_MS` is labelled configured, never measured.
"""
from __future__ import annotations

import asyncio
import sys
from datetime import timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.config import (  # noqa: E402
    CUTOFF_DEADLINE_CONFLICT_MS,
    FEATURE_INPUT_CUTOFF_MS,
    PUBLICATION_DEADLINE_MS,
)
from src.orchestration import BoundaryOrchestrator  # noqa: E402
from src.scheduler import RunTiming  # noqa: E402
from src.state import C85State  # noqa: E402
from tests.test_orchestration import (  # noqa: E402
    NS,
    START,
    FakeArtifacts,
    FakeGateway,
    FakeStore,
    SuppliedFeaturePacketSource,
    inputs_for,
)
from src.tickers import StaticTickerResolver  # noqa: E402

MS = 1_000_000


class Clock:
    def __init__(self, start_ns: int) -> None:
        self.now = start_ns

    def __call__(self) -> int:
        self.now += 1 * MS  # every reading advances 1 ms
        return self.now


def _warm_state() -> C85State:
    """Rank families primed so the policy can actually make a directional call."""
    state = C85State()
    for side in (1, -1):
        for _ in range(200):
            state.admission_ranks.queues[side].append(0.0)
            state.filter_ranks.queues[side].append(0.0)
    return state


def _case(clock, *, gateway=None, slow_gateway_ms: int = 0):
    target = START
    store = FakeStore()
    if gateway is not None and slow_gateway_ms:
        original = gateway.publish

        async def slow(payload):
            clock.now += slow_gateway_ms * MS
            return await original(payload)

        gateway.publish = slow  # type: ignore[method-assign]
    orchestrator = BoundaryOrchestrator(
        artifacts=FakeArtifacts(),
        store=store,
        gateway=gateway,
        packet_source=SuppliedFeaturePacketSource({target.isoformat(): inputs_for(0)}),
        ticker_resolver=StaticTickerResolver({target.isoformat(): "KXBTC15M-0"}),
        allow_dispatch=gateway is not None,
        clock_ns=clock,
    )
    return target, orchestrator, store


def test_scheduler_freeze_is_preserved_and_cutoff_kept_separate():
    target_ns = int(START.timestamp() * NS)
    clock = Clock(target_ns + 5_050 * MS)  # woke 50 ms after the cutoff
    target, orchestrator, store = _case(clock)
    actual_freeze = target_ns + 5_012 * MS
    timing = RunTiming(target_open_ns=target_ns, packet_freeze_ns=actual_freeze)

    outcome = asyncio.run(orchestrator.run_target(C85State(), target, timing))
    t = outcome.decision.timing

    assert timing.packet_freeze_ns == actual_freeze  # not overwritten
    assert t["packet_freeze_ns"] == str(actual_freeze)
    assert t["model_input_cutoff_ns"] == str(target_ns + FEATURE_INPUT_CUTOFF_MS * MS)
    assert t["feature_input_cutoff_ns"] == str(target_ns + FEATURE_INPUT_CUTOFF_MS * MS)
    # build start/complete are real readings taken around the packet build
    assert int(t["packet_build_started_ns"]) >= target_ns + 5_050 * MS
    assert int(t["packet_build_complete_ns"]) > int(t["packet_build_started_ns"])
    assert int(t["compute_started_ns"]) <= int(t["packet_build_started_ns"])
    assert t["configured_cutoff_deadline_conflict_ms"] == CUTOFF_DEADLINE_CONFLICT_MS
    measured = t["feed_watermarks"]["measured"]
    assert measured["packet_freeze_ns"] == str(actual_freeze)


def test_publication_offset_and_deadline_met_come_from_the_ack():
    target_ns = int(START.timestamp() * NS)
    clock = Clock(target_ns + 1_000 * MS)  # comfortably early
    gateway = FakeGateway()
    target, orchestrator, store = _case(clock, gateway=gateway, slow_gateway_ms=40)
    timing = RunTiming(target_open_ns=target_ns, packet_freeze_ns=target_ns + 5_000 * MS)

    outcome = asyncio.run(orchestrator.run_target(_warm_state(), target, timing))
    assert outcome.decision.is_directional, "harness must exercise the dispatch path"
    t = outcome.decision.timing
    ack = int(t["dispatch_ack_ns"])
    send = int(t["dispatch_started_ns"])
    assert ack - send >= 40 * MS  # the real send latency, not a constant
    assert t["publication_offset_ms"] == (ack - target_ns) / 1e6
    assert t["deadline_met"] is (ack < target_ns + PUBLICATION_DEADLINE_MS * MS)
    assert store.dispatch_commits[-1]["status"] == outcome.decision.status


def test_acknowledgement_after_the_ceiling_is_not_published():
    target_ns = int(START.timestamp() * NS)
    clock = Clock(target_ns + 4_900 * MS)
    gateway = FakeGateway()
    target, orchestrator, store = _case(clock, gateway=gateway, slow_gateway_ms=500)
    timing = RunTiming(target_open_ns=target_ns, packet_freeze_ns=target_ns + 4_900 * MS)

    outcome = asyncio.run(orchestrator.run_target(_warm_state(), target, timing))
    assert outcome.decision.is_directional
    assert outcome.accepted is False
    assert outcome.decision.status == "EXPIRED"
    assert "ACCEPTED_AFTER_DEADLINE" in outcome.decision.status_reason
    # No back-dating: nothing is stamped as published.
    assert store.dispatch_commits[-1]["published_at"] is None
    assert outcome.decision.timing["deadline_met"] is False


def test_deadline_passed_before_dispatch_records_timing_and_no_outbox_send():
    target_ns = int(START.timestamp() * NS)
    clock = Clock(target_ns + PUBLICATION_DEADLINE_MS * MS + 10 * MS)
    gateway = FakeGateway()
    target, orchestrator, store = _case(clock, gateway=gateway)
    timing = RunTiming(target_open_ns=target_ns, packet_freeze_ns=target_ns + 5_000 * MS)

    outcome = asyncio.run(orchestrator.run_target(_warm_state(), target, timing))
    assert gateway.sent == []
    assert outcome.dispatched is False
    assert outcome.decision.is_directional
    assert outcome.decision.status == "EXPIRED"
    # An expired directional decision enqueues NO outbox row at all, and the
    # single durable write already carries the EXPIRED status — there is no
    # second dispatch write because nothing was ever sent.
    assert store.commits[-1]["outbox"] is None
    assert store.commits[-1]["published_at"] is None
    assert store.dispatch_commits == []
    assert outcome.decision.timing["dispatch_ack_ns"] is None
