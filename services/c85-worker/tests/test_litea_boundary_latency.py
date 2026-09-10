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

from src.litea.heads import HeadUnavailable
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
            head_for=lambda target: (_ for _ in ()).throw(HeadUnavailable('no head in this suite')),
            inventory=lambda: {},
            latest_cutoff=lambda: None,
        ),
        state=_state(),
        state_path=tmp_path / "state.json",
        training_path=tmp_path / "training.parquet",
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
    # Nothing is written over the real owner's interval: a process that has
    # just been told it is not the writer records no row at all.
    assert store.missed == []


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
    # Prepared, then acquired on the boundary, then re-checked before the
    # commit: an unevidenced lease is never trusted, at any of the three points.
    assert store.lease_calls == 3


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


# -- state ownership: the decision is ONE critical section --------------------
def test_settlement_cannot_land_between_engine_and_guard(tmp_path):
    """The real settlement path, run concurrently with a real decision.

    The engine's rank advance and the guard's reservation are two mutations of
    one position in the sequence. This runs `apply_settlements` in a second
    thread, continuously, while a deliberately slow decision is in flight, and
    asserts that not one settlement was applied in between.
    """
    store = FakeStore()
    worker = build_worker(tmp_path, store)
    target = past_target()

    settled: list[int] = []
    original_settle = worker.state.engine.settle

    def counting_settle(*args, **kwargs):
        settled.append(1)
        return original_settle(*args, **kwargs)

    worker.state.engine.settle = counting_settle

    seen: dict[str, int] = {}
    original_decide = worker.state.engine.decide

    def slow_decide(**kwargs):
        seen["before"] = len(settled)
        out = original_decide(**kwargs)
        # Scoring is not instantaneous. Anything that can interleave, will.
        time.sleep(0.3)
        seen["after"] = len(settled)
        return out

    worker.state.engine.decide = slow_decide

    stop = False

    def settler() -> None:
        n = 0
        while not stop:
            n += 1
            worker.apply_settlements(
                [
                    {
                        "ticker": f"OTHER-{n}",
                        "target_open_utc": (target - timedelta(days=n)).isoformat(),
                        "label": 1,
                        "settlement_ts": (
                            datetime.now(timezone.utc) - timedelta(seconds=30)
                        ).isoformat(),
                    }
                ]
            )
            time.sleep(0.01)

    import threading

    thread = threading.Thread(target=settler, daemon=True)
    thread.start()
    time.sleep(0.05)
    outcome = run_boundary(worker, target)
    stop = True
    thread.join(timeout=2)

    assert outcome.status != "MISSED"
    # Settlements DID run concurrently...
    assert len(settled) > 0
    # ...but none of them landed inside the engine/guard critical section.
    assert seen["before"] == seen["after"]
    # And the pair still describes one coherent position.
    worker.state._assert_pair_consistent()  # noqa: SLF001
    assert worker.state.engine.last_target == worker.state.guard.last_target


def test_lease_refusal_leaves_no_rank_or_guard_advance(tmp_path):
    """A refusal after the freeze must cost nothing.

    The prepared lease is about to age out, so the boundary renews it before
    scoring. The renewal is refused. Nothing may have advanced: no rank, no
    guard reservation, no durable row, no row over the owner's interval.
    """
    store = FakeStore()
    worker = build_worker(tmp_path, store)
    target = past_target()

    asyncio.run(worker.prepare_boundary(target))
    worker.prepared["lease"]["expires_at"] = iso(1)  # inside the safety margin
    store.lease_response = {"granted": False, "owner_id": "other-worker"}

    before = worker.state.snapshot()["sha256"]
    outcome = run_boundary(worker, target)

    assert outcome.status == "MISSED"
    assert "other-worker" in (outcome.reason or "")
    assert worker.state.engine.last_target is None
    assert worker.state.guard.last_target is None
    assert worker.state.guard.pending == {}
    assert worker.state.snapshot()["sha256"] == before
    assert store.commits == [] and store.missed == []
    assert worker.pending_targets() == []


def test_no_network_call_happens_while_the_state_lock_is_held(tmp_path):
    """A slow backend must not stall settlements or the heartbeat snapshot."""
    store = FakeStore(latency_s=0.3)
    worker = build_worker(tmp_path, store)
    held: list[bool] = []

    original_commit = store.commit

    def watched_commit(row, checkpoint=None, outbox=None):
        held.append(worker.state_lock._is_owned())  # noqa: SLF001
        return original_commit(row, checkpoint, outbox)

    store.commit = watched_commit
    run_boundary(worker, past_target())
    assert held and not any(held)


def test_fit_runs_outside_the_lock_on_a_coherent_snapshot(tmp_path):
    """The frame is copied under the lock; the fit itself is not locked."""
    store = FakeStore()
    worker = build_worker(tmp_path, store)
    worker.training.append(
        [
            {
                "ts": past_target(),
                "ticker": "X",
                "input_valid": True,
                "label": float("nan"),
                "settlement_ts": None,
            }
        ]
    )
    snapshot = worker.training_snapshot()
    rows_at_snapshot = snapshot.rows

    # The live frame moves on while the "fit" is running on the copy.
    worker.training.append(
        [
            {
                "ts": past_target() + timedelta(minutes=15),
                "ticker": "Y",
                "input_valid": True,
                "label": float("nan"),
                "settlement_ts": None,
            }
        ]
    )
    assert snapshot.rows == rows_at_snapshot
    assert worker.training.rows == rows_at_snapshot + 1

    # The fit's input is recorded as such; the live cursors keep up with the
    # live frame (covered in detail by the cursor-identity test below).
    worker.install_fit_cursors(snapshot)
    assert worker.state.cursors.fit_input_rows == rows_at_snapshot
    assert worker.state.cursors.fit_input_sha256 == snapshot.sha256
    assert worker.state.cursors.training_rows == worker.training.rows


# -- durable diagnostics -------------------------------------------------------
def test_timing_diagnostics_ride_in_the_private_features_payload(tmp_path):
    store = FakeStore()
    worker = build_worker(tmp_path, store)
    target = past_target()
    asyncio.run(worker.prepare_boundary(target))
    run_boundary(worker, target)

    committed = store.commits[0]
    diagnostics = committed["features"]["timing_diagnostics"]
    assert diagnostics["lease_reused"] is True
    assert diagnostics["lease_status"] == "USABLE"
    assert "prepare_ms" in diagnostics and "freeze_offset_ms" in diagnostics
    # No new public column was introduced for any of it.
    assert "timing_diagnostics" not in committed
    assert "lease_status" not in committed
    # The amending write carries the acknowledged latency too.
    amended = store.commits[-1]["features"]["timing_diagnostics"]
    assert "commit_latency_ms" in amended and "durable_ack_offset_ms" in amended


def test_unevidenced_lease_never_reaches_the_decision(tmp_path):
    store = FakeStore(lease={"granted": True, "owner_id": "me"})
    worker = build_worker(tmp_path, store)
    before = worker.state.snapshot()["sha256"]
    outcome = run_boundary(worker, past_target())
    # Granted, but with nothing to evidence it: never treated as ownership.
    assert outcome.status == "MISSED"
    assert "unevidenced" in (outcome.reason or "")
    assert worker.state.snapshot()["sha256"] == before
    assert store.commits == [] and store.missed == []


# -- the ACTUAL service loops --------------------------------------------------
def test_actual_heartbeat_loop_does_not_stall_the_collector():
    """`LiteAService.heartbeat_loop` itself, with a genuinely slow backend.

    Not a stand-in sleep: the real method is bound to a stub service whose
    store blocks for 400ms per heartbeat, and a collector coroutine must keep
    ticking throughout.
    """
    from src.litea.main import LiteAService

    calls: list[int] = []

    def slow_heartbeat(**kwargs):
        time.sleep(0.4)
        calls.append(1)

    service = SimpleNamespace(
        snapshot=lambda: {"readiness": "RECORDING_ONLY", "blocking_reason": None},
        scheduler=SimpleNamespace(_task=object(), start=lambda: None),
        store=SimpleNamespace(heartbeat=slow_heartbeat),
        feeds=SimpleNamespace(watermarks=lambda: {}),
        settings=SimpleNamespace(heartbeat_seconds=0.01, build_sha="test"),
    )

    async def scenario() -> int:
        ticks = 0

        async def collector() -> None:
            nonlocal ticks
            while True:
                await asyncio.sleep(0.01)
                ticks += 1

        feed = asyncio.create_task(collector())
        beat = asyncio.create_task(LiteAService.heartbeat_loop(service))
        await asyncio.sleep(0.9)
        beat.cancel()
        feed.cancel()
        return ticks

    ticks = asyncio.run(scenario())
    assert calls, "the real heartbeat did not run"
    # Two ~400ms heartbeats elapsed; a blocked loop would show almost no ticks.
    assert ticks > 40


def test_actual_settlement_loop_keeps_the_loop_responsive(tmp_path):
    """`LiteAService.settlement_loop` with a blocking poll, checkpoint and save."""
    from src.litea.main import LiteAService

    store = FakeStore()
    worker = build_worker(tmp_path, store)
    appended: list[dict] = []

    def slow_drain() -> int:
        time.sleep(0.3)
        return 1

    service = SimpleNamespace(
        worker=worker,
        state=worker.state,
        state_path=worker.state_path,
        drain_settlements=slow_drain,
        _settlement_checkpoint=lambda: LiteAService._settlement_checkpoint(
            SimpleNamespace(worker=worker, state=worker.state, state_path=worker.state_path)
        ),
        backend=SimpleNamespace(
            call=lambda op, **kw: (time.sleep(0.3), appended.append(kw))[0]
        ),
        _catch_up_fits=lambda: [],
    )

    async def scenario() -> int:
        ticks = 0

        async def collector() -> None:
            nonlocal ticks
            while True:
                await asyncio.sleep(0.01)
                ticks += 1

        feed = asyncio.create_task(collector())
        loop = asyncio.create_task(LiteAService.settlement_loop(service))
        await asyncio.sleep(0.8)
        loop.cancel()
        feed.cancel()
        return ticks

    ticks = asyncio.run(scenario())
    assert appended, "the real checkpoint append did not run"
    assert ticks > 40


# -- a grant is not evidence of ownership -------------------------------------
@pytest.mark.parametrize(
    ("renewed", "expected"),
    [
        ({"granted": True, "owner_id": "me"}, "unevidenced"),
        ({"granted": True, "owner_id": "me", "expires_at": "not-a-timestamp"}, "unevidenced"),
        ({"granted": True, "owner_id": "me", "expires_at": iso(-30)}, "expired"),
        ({"granted": True, "owner_id": "me", "expires_at": iso(0.2)}, "expired"),
    ],
)
def test_renewed_grant_without_real_evidence_leaves_the_pair_untouched(
    tmp_path, renewed, expected
):
    """Granted, but unprovable: the decision must not proceed anyway."""
    store = FakeStore()
    worker = build_worker(tmp_path, store)
    target = past_target()

    asyncio.run(worker.prepare_boundary(target))
    worker.prepared["lease"]["expires_at"] = iso(1)  # forces the renewal
    store.lease_response = renewed

    before = worker.state.snapshot()["sha256"]
    outcome = run_boundary(worker, target)

    assert outcome.status == "MISSED"
    assert expected in (outcome.reason or "")
    assert worker.state.engine.last_target is None
    assert worker.state.guard.last_target is None
    assert worker.state.guard.pending == {}
    assert worker.state.snapshot()["sha256"] == before
    assert store.commits == [] and store.missed == []
    assert worker.pending_targets() == []


def test_settlement_during_a_slow_renewal_does_not_strand_the_decision(tmp_path):
    """The decision's observation is taken after whatever settled first.

    A settlement lands while the lease renewal is deliberately slow, advancing
    the pair's clock. Because the observation is captured inside the serialized
    section rather than before the renewal, the decision still records rather
    than being refused as out of order.
    """
    store = FakeStore()
    worker = build_worker(tmp_path, store)
    target = past_target()

    asyncio.run(worker.prepare_boundary(target))
    worker.prepared["lease"]["expires_at"] = iso(1)  # forces the renewal

    import threading

    settled = threading.Event()
    original_acquire = store.acquire_lease

    def slow_acquire(ttl_seconds: int) -> dict:
        # A real settlement, concurrently, while the renewal is in flight.
        def settle() -> None:
            worker.apply_settlements(
                [
                    {
                        "ticker": "OTHER",
                        "target_open_utc": (target - timedelta(hours=1)).isoformat(),
                        "label": 1,
                        "settlement_ts": datetime.now(timezone.utc).isoformat(),
                    }
                ]
            )
            settled.set()

        thread = threading.Thread(target=settle, daemon=True)
        thread.start()
        time.sleep(0.4)
        thread.join(timeout=2)
        return original_acquire(ttl_seconds)

    store.acquire_lease = slow_acquire
    outcome = run_boundary(worker, target)

    assert settled.is_set()
    assert outcome.status != "MISSED"
    assert store.commits, "the decision was not recorded"
    assert worker.state.engine.last_target is not None
    worker.state._assert_pair_consistent()  # noqa: SLF001


# -- live training identity is never regressed to a fitted copy ---------------
def test_installing_fit_cursors_keeps_the_live_training_identity(tmp_path):
    """A fit consumes a copy; the live cursors must still describe the file.

    Those cursors are what a restart verifies its restored frame against, so
    rewriting them with an older snapshot's identity would make a perfectly
    good restore look wrong.
    """
    store = FakeStore()
    worker = build_worker(tmp_path, store)
    rows = [
        {
            "ts": past_target() + timedelta(minutes=15 * i),
            "ticker": f"T{i}",
            "input_valid": True,
            "label": float("nan"),
            "settlement_ts": None,
        }
        for i in range(3)
    ]
    worker.training.append(rows[:2])
    worker.state.cursors.training_sha256 = worker.training.save(worker.training_path)
    worker.state.cursors.training_rows = worker.training.rows
    worker.state.cursors.training_last_target = worker.training.last_target

    snapshot = worker.training_snapshot()

    # A row arrives while the fit is running on the copy.
    worker.training.append(rows[2:])
    live_sha = worker.training.save(worker.training_path)
    worker.state.cursors.training_sha256 = live_sha

    worker.install_fit_cursors(snapshot, SimpleNamespace(cutoff="2026-09-10", fitted=True, reason=None))

    cursors = worker.state.cursors
    # Live identity still describes the frame on disk...
    assert cursors.training_rows == worker.training.rows == 3
    assert cursors.training_sha256 == live_sha
    assert cursors.training_last_target == worker.training.last_target
    # ...and the fit's input is recorded distinctly.
    assert cursors.fit_input_rows == snapshot.rows == 2
    assert cursors.fit_input_sha256 == snapshot.sha256
    assert cursors.fit_input_sha256 != cursors.training_sha256
    assert cursors.last_fit_cutoff == "2026-09-10"
