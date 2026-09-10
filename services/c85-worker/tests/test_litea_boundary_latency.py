"""Version 1 pre-boundary preparation: correctness first, latency second.

Every check here is offline. No feed, no backend, no deployment and no
execution: the store is a fake that only records what the worker asked it to
do, and the timing experiment measures the worker's own critical path with a
deliberately slow fake backend.
"""
from __future__ import annotations

import asyncio
import time
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from src.litea.worker import LEASE_SAFETY_MS, LiteAWorker, _lease_expiry_ns
from src.scheduler import RunTiming

NS = 1_000_000_000


def iso(after_s: float) -> str:
    return (datetime.now(timezone.utc) + timedelta(seconds=after_s)).isoformat()


class FakeStore:
    """Records calls and can be told how slow each remote call is."""

    def __init__(self, *, lease: dict | None = None, latency_s: float = 0.0) -> None:
        self.lease_response = lease if lease is not None else {
            "granted": True, "owner_id": "me", "expires_at": iso(60)
        }
        self.latency_s = latency_s
        self.lease_calls = 0
        self.commits: list[dict] = []
        self.missed: list[tuple[str, str]] = []

    def acquire_lease(self, ttl_seconds: int) -> dict:
        self.lease_calls += 1
        time.sleep(self.latency_s)
        return dict(self.lease_response)

    def commit(self, row, checkpoint=None, outbox=None) -> dict:
        time.sleep(self.latency_s)
        self.commits.append(row)
        return {"ok": True}

    def mark_missed(self, ticker, target, reason) -> None:
        self.missed.append((str(target), reason))


class FakeResolver:
    def unverified_label(self, target: datetime) -> str:
        return "KXBTC15M-TEST"

    def resolve(self, target: datetime) -> str:
        return "KXBTC15M-TEST"


class FakePacket:
    input_valid = False
    blockers = ["TEST_NO_FEED"]
    features: dict = {}
    source: dict = {"feed_watermarks": {}, "last_receipt_ns": None}

    def as_engine_features(self) -> dict:
        return {}


def build_worker(tmp_path, store, *, freeze_time: bool = True) -> LiteAWorker:
    worker = LiteAWorker(
        store=store,
        heads=SimpleNamespace(
            head_for=lambda target: (_ for _ in ()).throw(KeyError()),
            inventory=lambda: {},
            latest_cutoff=lambda: None,
        ),
        state=_state(),
        state_path=tmp_path / "state.json",
        ticker_resolver=FakeResolver(),
        feeds=SimpleNamespace(),
    )
    # The packet source is replaced: this suite is about the boundary path, not
    # about the 60 inputs, which have their own parity suites.
    worker.direction = SimpleNamespace(
        build=lambda *a, **k: FakePacket(),
        stage=SimpleNamespace(stale_feeds=lambda ns: []),
        blocking_reasons=lambda ns: [],
    )
    worker._record_training_row = lambda *a, **k: None  # noqa: SLF001
    return worker


def _state():
    from src.litea.state import LiteAState

    return LiteAState()


def run_boundary(worker: LiteAWorker, target: datetime):
    timing = RunTiming(target_open_ns=int(target.timestamp() * NS))
    return asyncio.run(worker.on_boundary(target, timing))


def past_target() -> datetime:
    """A target whose T+5s cutoff has already passed, so nothing is awaited."""
    now = datetime.now(timezone.utc)
    return (now - timedelta(minutes=15)).replace(second=0, microsecond=0)


# -- lease handling -----------------------------------------------------------
def test_prepared_lease_is_reused_and_not_re_acquired(tmp_path):
    store = FakeStore()
    worker = build_worker(tmp_path, store)
    target = past_target()

    asyncio.run(worker.prepare_boundary(target))
    assert store.lease_calls == 1

    outcome = run_boundary(worker, target)
    assert outcome.status != "MISSED"
    # No SECOND acquisition on the boundary path: the round trip happened
    # before T.
    assert store.lease_calls == 1
    assert outcome.timing["lease_reused"] is True
    assert outcome.timing["lease_wait_ms"] == 0


def test_denied_prepared_lease_fails_closed(tmp_path):
    store = FakeStore(lease={"granted": False, "owner_id": "other-worker"})
    worker = build_worker(tmp_path, store)
    target = past_target()

    asyncio.run(worker.prepare_boundary(target))
    outcome = run_boundary(worker, target)

    assert outcome.status == "MISSED"
    assert "other-worker" in (outcome.reason or "")
    assert store.commits == []
    assert store.missed and "LITEA_LEASE_HELD_BY:other-worker" in store.missed[0][1]


def test_expired_prepared_lease_is_re_acquired(tmp_path):
    store = FakeStore()
    worker = build_worker(tmp_path, store)
    target = past_target()

    asyncio.run(worker.prepare_boundary(target))
    # It expires inside the safety margin, so it may not be trusted.
    worker.prepared["lease"]["expires_at"] = iso(LEASE_SAFETY_MS / 1000.0 - 1)

    outcome = run_boundary(worker, target)
    assert outcome.status != "MISSED"
    assert store.lease_calls == 2
    assert outcome.timing["lease_reused"] is False


def test_prepared_lease_for_another_target_is_ignored(tmp_path):
    store = FakeStore()
    worker = build_worker(tmp_path, store)
    target = past_target()

    asyncio.run(worker.prepare_boundary(target - timedelta(minutes=15)))
    run_boundary(worker, target)
    assert store.lease_calls == 2


def test_lease_without_expiry_is_never_assumed_valid(tmp_path):
    store = FakeStore(lease={"granted": True, "owner_id": "me"})
    worker = build_worker(tmp_path, store)
    target = past_target()

    asyncio.run(worker.prepare_boundary(target))
    run_boundary(worker, target)
    assert store.lease_calls == 2


def test_lease_expiry_parsing():
    assert _lease_expiry_ns({}) is None
    assert _lease_expiry_ns({"expires_at": "not-a-time"}) is None
    parsed = _lease_expiry_ns({"expires_at": "2026-09-10T18:00:00Z"})
    assert parsed == int(
        datetime(2026, 9, 10, 18, tzinfo=timezone.utc).timestamp() * NS
    )


# -- the input window is untouched -------------------------------------------
def test_cutoff_is_still_t_plus_5s(tmp_path):
    """Preparation must not let anything freeze before the model's cutoff."""
    store = FakeStore()
    worker = build_worker(tmp_path, store)
    now = datetime.now(timezone.utc)
    target = now + timedelta(seconds=0.3)

    asyncio.run(worker.prepare_boundary(target))
    started = time.time_ns()
    outcome = run_boundary(worker, target)
    freeze_ns = outcome.timing["packet_freeze_ns"]

    cutoff_ns = int(target.timestamp() * NS) + 5 * NS
    assert freeze_ns >= cutoff_ns
    assert time.time_ns() - started >= 4 * NS  # it genuinely waited for the window


def test_preparation_reads_no_feed_and_takes_no_decision(tmp_path):
    store = FakeStore()
    worker = build_worker(tmp_path, store)
    built: list[int] = []
    worker.direction.build = lambda *a, **k: (built.append(1), FakePacket())[1]

    asyncio.run(worker.prepare_boundary(past_target()))
    assert built == []
    assert store.commits == []


# -- pending queue ------------------------------------------------------------
def test_pending_is_drained_before_the_boundary(tmp_path):
    store = FakeStore()
    worker = build_worker(tmp_path, store)
    target = past_target()
    worker._remember_pending(  # noqa: SLF001
        {"target_open_utc": (target - timedelta(minutes=15)).isoformat()}, {}
    )

    prepared = asyncio.run(worker.prepare_boundary(target))
    assert prepared["reconciled"]["delivered"] == 1
    assert worker.pending_targets() == []
    # Delivered before T, so the boundary path has nothing left to retry.
    assert len(store.commits) == 1


def test_failed_prepare_does_not_block_recording(tmp_path):
    class Broken(FakeStore):
        def acquire_lease(self, ttl_seconds: int) -> dict:
            raise RuntimeError("backend down")

    store = Broken()
    worker = build_worker(tmp_path, store)
    target = past_target()
    prepared = asyncio.run(worker.prepare_boundary(target))
    assert prepared["lease"]["granted"] is False

    # A transport failure is NOT a denial: the boundary re-acquires normally.
    store.acquire_lease = FakeStore.acquire_lease.__get__(store, Broken)
    outcome = run_boundary(worker, target)
    assert outcome.status != "MISSED"
    assert outcome.committed is True


# -- background I/O stays off the event loop ----------------------------------
def test_background_network_io_does_not_block_the_loop():
    """A slow blocking call in a thread must not stall the collector loop."""

    def blocking() -> None:
        time.sleep(0.4)

    async def scenario() -> float:
        ticks = 0

        async def collector() -> None:
            nonlocal ticks
            while True:
                await asyncio.sleep(0.01)
                ticks += 1

        task = asyncio.create_task(collector())
        await asyncio.to_thread(blocking)
        task.cancel()
        return ticks

    ticks = asyncio.run(scenario())
    # ~40 ticks are expected during the 400ms call; a blocked loop yields ~0.
    assert ticks > 20


def test_state_mutations_are_serialised(tmp_path):
    """Concurrent settlement application cannot interleave with a commit."""
    store = FakeStore()
    worker = build_worker(tmp_path, store)
    observed: list[bool] = []
    original = worker.state.save

    def watched(path):
        observed.append(worker.state_lock._is_owned())  # noqa: SLF001
        return original(path)

    worker.state.save = watched
    run_boundary(worker, past_target())
    assert observed and all(observed)


# -- isolated before/after timing experiment ----------------------------------
@pytest.mark.parametrize("latency_s", [0.25])
def test_prepared_boundary_removes_the_remote_wait(tmp_path, latency_s):
    """Same worker, same fake backend, with and without preparation.

    The only difference is WHERE the lease round trip happens. The saving is
    whatever that round trip costs — measured here, not promised.
    """
    target = past_target()

    cold_store = FakeStore(latency_s=latency_s)
    cold = build_worker(tmp_path / "cold", cold_store)
    started = time.time_ns()
    run_boundary(cold, target)
    cold_ms = (time.time_ns() - started) / 1_000_000

    warm_store = FakeStore(latency_s=latency_s)
    warm = build_worker(tmp_path / "warm", warm_store)
    asyncio.run(warm.prepare_boundary(target))
    started = time.time_ns()
    run_boundary(warm, target)
    warm_ms = (time.time_ns() - started) / 1_000_000

    saved = cold_ms - warm_ms
    print(f"\ncold={cold_ms:.1f}ms warm={warm_ms:.1f}ms saved={saved:.1f}ms")
    # One lease round trip removed from the critical path.
    assert saved >= latency_s * 1000 * 0.8
