"""Version 1 boundary path: sourced packet -> engine -> guard -> durable log.

Independent of the C85 worker's readiness. The only things Version 1 needs are

  * the feeds the 60 direction inputs are actually built from,
  * a daily head whose own validity window covers the next target,
  * restored paired state.

An unported C85 ancestor is NOT a Version 1 blocker, and Version 1 never forces
the C85 readiness flags true.

Execution is hard-off: no gateway client is constructed, no outbox row is ever
written, and the supplied modules stamp `execution_enabled: False` on every
record they return.
"""
from __future__ import annotations

import asyncio
import json
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from ..scheduler import RunTiming, next_boundary
from .dispatch import prepare_outbox
from .heads import DailyHeadStore, HeadUnavailable
from .identity import MODEL_ID
from .packet import Direction60Source
from .stage import REQUIRED_FEEDS
from .state import LiteAState
from .store import LiteAStore, checkpoint_payload, target_row
from .training import TrainingFrame

NS = 1_000_000_000
CUTOFF_MS = 5_000

#: A prepared lease is only reused while it still covers the whole decision,
#: with this much slack left. Anything tighter is treated as expired and
#: re-acquired, so sole-writer validity is never assumed.
LEASE_SAFETY_MS = 5_000


def _lease_expiry_ns(lease: dict[str, Any]) -> int | None:
    """Wall-clock expiry of a granted lease, in local ns, or None if unknown."""
    raw = lease.get("expires_at")
    if not raw:
        return None
    text = str(raw).replace("Z", "+00:00")
    try:
        moment = datetime.fromisoformat(text)
    except ValueError:
        return None
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return int(moment.timestamp() * NS)

#: `REQUIRED_FEEDS` is imported from the Version 1 stage so there is one
#: definition of what this model actually consumes. The C85 aggregate readiness
#: (market Q1, auxiliary bundles, ancestor experts) is NOT consulted, and
#: neither are the BTCUSDC / COIN-M aggregate-trade streams: they are not
#: Version 1 inputs.


@dataclass
class BoundaryOutcome:
    target: datetime
    status: str
    reason: str | None = None
    engine_output: dict[str, Any] | None = None
    guard_output: dict[str, Any] | None = None
    committed: bool = False
    timing: dict[str, Any] = field(default_factory=dict)


class CommitUnreconciled(RuntimeError):
    """A previous decision is not durable yet. Version 1 fails closed."""


class LiteAWorker:
    """One target at a time, in observed-time order, durable before anything else."""

    def __init__(
        self,
        *,
        store: LiteAStore,
        heads: DailyHeadStore,
        state: LiteAState,
        state_path: Path,
        ticker_resolver: Any,
        feeds: Any,
        packet_source: Any = None,  # unused; Version 1 sources its own stage
        training: TrainingFrame | None = None,
        training_path: Path | None = None,
        lease_ttl_seconds: int = 60,
        state_lock: Any = None,
    ) -> None:
        self.direction = Direction60Source(feeds)
        self.store = store
        self.heads = heads
        self.state = state
        self.state_path = Path(state_path)
        self.ticker_resolver = ticker_resolver
        self.feeds = feeds
        self.training = training if training is not None else TrainingFrame.empty()
        self.training_path = Path(training_path) if training_path else None
        self.pending_dir = self.state_path.with_name("pending")
        self.lease_ttl_seconds = lease_ttl_seconds
        self.readiness = "WARMING"
        # Background loops now do their network I/O off the collector event
        # loop, in worker threads. Every mutation of the paired state and every
        # snapshot taken of it is serialised through this reentrant lock, so a
        # heartbeat or settlement thread can never read a half-written pair or
        # interleave with a boundary commit.
        self.state_lock = state_lock or threading.RLock()
        # Why the last commit did or did not carry a dispatch request. Default
        # OFF: with no execution control set this stays EXECUTION_DISABLED.
        self.last_dispatch_reason = "EXECUTION_DISABLED"
        self.blocking_reason: str | None = None
        #: Result of the pre-boundary preparation for ONE target: the granted
        #: lease and the pending-drain outcome, both obtained before T so the
        #: cutoff path has no avoidable remote wait left.
        self.prepared: dict[str, Any] | None = None
        # Set by the startup bridge when a gap between the restored checkpoint
        # and launch could NOT be recovered. Recording continues; scoring does
        # not, because the rank window would contain a hole.
        self.external_scoring_block: str | None = None
        # One-time migration from the single-slot pending file.
        legacy = self.state_path.with_name("pending_commit.json")
        if legacy.exists():
            saved = json.loads(legacy.read_text())
            self._remember_pending(saved["target"], saved.get("checkpoint") or {})
            legacy.unlink()

    # -- readiness -------------------------------------------------------------
    def stale_feeds(self, at_ns: int | None = None) -> list[str]:
        at_ns = at_ns or time.time_ns()
        return self.direction.stage.stale_feeds(at_ns)

    def recording_blockers(self) -> list[str]:
        """What stops the target being RECORDED at all — normally nothing.

        A stale feed, an unbuildable packet or a missing head does NOT stop
        recording: the opportunity is written with its honest status. This is
        what keeps the ledger continuous, and it is what lets the next
        UTC-midnight row exist so a new daily head can ever be fitted.
        """
        return []

    def scoring_readiness(self, at: datetime | None = None) -> tuple[str, str | None]:
        """Whether the NEXT target can be scored by a valid head.

        Separate from scheduling. When this says BLOCKED the boundary still
        runs and records the opportunity as unscored.
        """
        target = at or next_boundary()
        if self.external_scoring_block:
            return "BLOCKED", self.external_scoring_block
        stale = self.stale_feeds()
        if stale:
            return "BLOCKED", f"LITEA_FEEDS_STALE: {', '.join(stale)}"
        packet_reasons = self.direction.blocking_reasons(time.time_ns())
        if packet_reasons:
            return "BLOCKED", "LITEA_SOURCE_UNAVAILABLE :: " + " || ".join(packet_reasons)
        try:
            self.heads.head_for(target)
        except HeadUnavailable as exc:
            return "BLOCKED", str(exc)
        return "LOGGING_READY", None

    def evaluate_readiness(self, at: datetime | None = None) -> tuple[str, str | None]:
        """Scheduling readiness: recording is the floor, scoring is the ceiling.

        The scheduler is armed for RECORDING_ONLY too. An expired head used to
        stop the scheduler, which stopped the midnight row being recorded,
        which meant the next head could never be fitted — a permanent, silent
        stall. Recording now continues through that gap.
        """
        blocked = self.recording_blockers()
        if blocked:
            return "BLOCKED", "LITEA_RECORDING_BLOCKED :: " + " || ".join(blocked)
        status, reason = self.scoring_readiness(at)
        if status == "LOGGING_READY":
            return status, None
        return "RECORDING_ONLY", reason

    def dispatch_status(self) -> str:
        """Structurally absent, not merely disabled."""
        return "NONE"

    def snapshot(self) -> dict[str, Any]:
        """A COHERENT view of the paired state, never a half-written one.

        Read under the same lock that serialises mutations, so a heartbeat
        thread reporting the digest cannot observe an engine that has advanced
        past its guard.
        """
        status, reason = self.evaluate_readiness()
        scoring, scoring_reason = self.scoring_readiness()
        pending = self.pending_targets()
        with self.state_lock:
            state_sha = self.state.snapshot()["sha256"]
            cursors = self.state.cursors.as_dict()
            training_rows = self.training.rows
            training_last = self.training.last_target
        return {
            "model_version": MODEL_ID,
            "readiness": status,
            "blocking_reason": reason,
            "scoring": scoring,
            "scoring_blocked_reason": scoring_reason,
            "dispatch": self.dispatch_status(),
            "execution_enabled": False,
            "heads": self.heads.inventory(),
            "state_sha256": state_sha,
            "cursors": cursors,
            "pending_commits": [p.name for p in pending],
            "training_rows": training_rows,
            "training_last_target": training_last,
            "next_target_utc": next_boundary().isoformat(),
            "at": datetime.now(timezone.utc).isoformat(),
        }


    # -- settlement ------------------------------------------------------------
    def apply_settlements(self, settlements: list[dict[str, Any]]) -> int:
        """Feed settled outcomes to BOTH members and the training frame, once.

        A late settlement keeps its original entry day because the guard's own
        pending record carries that day; nothing here re-dates it. The training
        label is attached idempotently to the row that was actually recorded at
        that target, with the settlement's own observed availability.
        """
        applied = 0
        with self.state_lock:
            consumed = set(self.state.cursors.consumed_settlements)
            rows = sorted(
                (s for s in settlements if s.get("settlement_ts")),
                key=lambda s: str(s["settlement_ts"]),
            )
            now = datetime.now(timezone.utc)
            for row in rows:
                key = f"{row.get('ticker')}@{row.get('target_open_utc')}"
                if key in consumed:
                    continue
                label = row.get("label")
                if label not in (-1, 1):
                    continue
                available = row["settlement_ts"]
                self.state.engine.settle(
                    row["ticker"], int(label), available_at=available, observed_at=now
                )
                self.state.guard.settle(
                    row["ticker"], int(label), available_at=available, observed_at=now
                )
                if row.get("target_open_utc"):
                    self.training.apply_label(row["target_open_utc"], int(label), available)
                consumed.add(key)
                applied += 1
            self.state.cursors.consumed_settlements = sorted(consumed)
            if applied and self.training_path:
                self.state.cursors.training_sha256 = self.training.save(self.training_path)
                self.state.cursors.training_rows = self.training.rows
                self.state.cursors.training_last_target = self.training.last_target
        return applied

    # -- durable commit --------------------------------------------------------
    def _pending_file(self, target_open_utc: str) -> Path:
        safe = target_open_utc.replace(":", "").replace("+", "_")
        return self.pending_dir / f"{safe}.json"

    def pending_targets(self) -> list[Path]:
        if not self.pending_dir.exists():
            return []
        return sorted(self.pending_dir.glob("*.json"))

    def _remember_pending(self, row: dict[str, Any], checkpoint: dict[str, Any]) -> None:
        """A queue, not a single slot.

        One transport failure must not stop the next target from being
        recorded: the undelivered decision stays queued in target order and is
        retried off the boundary path until the backend accepts it.
        """
        self.pending_dir.mkdir(parents=True, exist_ok=True)
        self._pending_file(str(row["target_open_utc"])).write_text(
            json.dumps({"target": row, "checkpoint": checkpoint}, default=str)
        )

    def _commit(self, row: dict[str, Any], checkpoint: dict[str, Any] | None) -> dict[str, Any]:
        """Durable or queued — never optimistically 'probably fine'.

        The backend answers `ok: true` on success and `ok: false` with an error
        on refusal, so an ABSENT `ok` is treated as a failure rather than as
        consent.

        Dispatch eligibility is evaluated HERE, on every attempt including
        retries, against the wall clock at that attempt. So a queued decision
        that ages past the Version-1 transport ceiling — or one whose execution
        control was switched off meanwhile — is still committed durably, just
        with no outbox request attached. Historical and shadow rows can never
        acquire one on a later replay.
        """
        self._remember_pending(row, checkpoint or {})
        outbox, dispatch_reason = prepare_outbox(row, now_ms=time.time() * 1000.0)
        self.last_dispatch_reason = dispatch_reason
        started = time.time_ns()
        try:
            result = (
                self.store.commit(row, checkpoint)
                if outbox is None
                else self.store.commit(row, checkpoint, outbox)
            )
        except Exception as exc:  # noqa: BLE001 - transport/refusal both stay queued
            return {"ok": False, "error": str(exc), "ack_ns": None}
        acked = time.time_ns()
        if result.get("ok") is not True:
            return {"ok": False, "error": str(result.get("error") or result), "ack_ns": None}
        self._pending_file(str(row["target_open_utc"])).unlink(missing_ok=True)
        return {
            "ok": True,
            "ack_ns": acked,
            "ack_latency_ms": (acked - started) / 1_000_000,
            "dispatch": result.get("dispatch") or dispatch_reason,
        }


    def reconcile_pending(self) -> dict[str, Any] | None:
        """Re-submit undelivered decisions in target order.

        Called off the boundary path by the recovery loop and by the
        pre-boundary preparation, so a transport outage drains by itself.
        Delivery stops at the first still-failing target: the ledger stays in
        order.

        The lock is NEVER held across the network round trip. Each delivery
        happens outside it, and only the cursor advance that follows a
        successful delivery is serialised — otherwise a slow backend would
        block the settlement thread, the heartbeat snapshot and the boundary
        for the whole request.
        """
        outcomes: list[dict[str, Any]] = []
        for path in self.pending_targets():
            saved = json.loads(path.read_text())
            outcome = self._commit(saved["target"], saved["checkpoint"] or None)
            outcomes.append({"target": saved["target"]["target_open_utc"], **outcome})
            if not outcome["ok"]:
                break
            committed = str(saved["target"]["target_open_utc"])
            with self.state_lock:
                # The cursor only ever moves forward: a late delivery of an older
                # target must not rewind the committed position.
                if (self.state.cursors.last_committed_target or "") < committed:
                    self.state.cursors.last_committed_target = committed
                    self.state.save(self.state_path)
        if not outcomes:
            return None
        failed = [o for o in outcomes if not o["ok"]]
        return {
            "ok": not failed,
            "delivered": len(outcomes) - len(failed),
            "error": failed[0]["error"] if failed else None,
        }

    # -- training snapshot -------------------------------------------------------
    def training_snapshot(self) -> TrainingFrame:
        """An IMMUTABLE copy of the rolling frame, taken coherently.

        A daily fit reads thousands of rows and takes seconds. Reading the live
        frame while a boundary appends to it, or a settlement labels a row in
        it, would fit a frame that never existed at any instant. The copy is
        taken under the lock; the fit itself runs outside it.
        """
        with self.state_lock:
            return TrainingFrame(self.training.frame.copy(deep=True))

    def install_fit_cursors(self, training: TrainingFrame, last: Any = None) -> None:
        """Record what the fit actually consumed, coherently.

        The FITTED FRAME's identity is installed — not the live frame's, which
        may already have moved on. The cursors then describe a frame that
        genuinely produced these heads.
        """
        with self.state_lock:
            if last is not None:
                self.state.cursors.last_fit_cutoff = last.cutoff
                self.state.cursors.last_fit_result = (
                    "FITTED" if last.fitted else (last.reason or "")
                )
            self.state.cursors.training_sha256 = training.sha256
            self.state.cursors.training_rows = training.rows
            self.state.cursors.training_last_target = training.last_target
            self.state.save(self.state_path)

    # -- pre-boundary ----------------------------------------------------------
    def lease_state(self, lease: dict[str, Any] | None, at_ns: int) -> str:
        """How this lease stands at `at_ns` — never a bare 'probably ours'.

        `USABLE`      granted, with a reported expiry that still covers the
                      decision with the safety margin.
        `UNEVIDENCED` granted, but with no parsable `expires_at`. The lease RPC
                      does return `expires_at` and `fence`, so this is an
                      unexpected response shape, not a normal case: it is never
                      treated as evidence of ownership and never reused.
        `EXPIRED`     granted once, but no longer covers the decision.
        `DENIED`      another owner holds the boundary, or nothing was granted.
        """
        lease = lease or {}
        if not lease.get("granted"):
            return "DENIED"
        expiry = _lease_expiry_ns(lease)
        if expiry is None:
            return "UNEVIDENCED"
        return "USABLE" if expiry > at_ns + LEASE_SAFETY_MS * 1_000_000 else "EXPIRED"

    def _lease_usable(self, prepared: dict[str, Any] | None, at_ns: int) -> bool:
        """A prepared lease is only reused while it still covers the decision."""
        if not prepared:
            return False
        return self.lease_state(prepared.get("lease"), at_ns) == "USABLE"

    async def prepare_boundary(self, target: datetime) -> dict[str, Any]:
        """Do the remote work BEFORE T, never between the wake and the freeze.

        Two things used to sit on the critical path between the scheduler's
        T+5s wake and the actual packet freeze: draining the undelivered queue
        and acquiring the sole-writer lease. Both are network round trips, and
        both are now done at the prepare lead, in a worker thread, before the
        target even opens.

        Nothing about the model moves earlier. No feed is read, no packet is
        frozen and no decision is taken here: the input window is still exactly
        [T, T+5s).
        """
        target = target.astimezone(timezone.utc)
        started = time.time_ns()
        reconciled = None
        try:
            reconciled = await asyncio.to_thread(self.reconcile_pending)
        except Exception as exc:  # noqa: BLE001 — retried by the recovery loop
            reconciled = {"ok": False, "error": f"{type(exc).__name__}: {exc}"}
        try:
            lease = await asyncio.to_thread(self.store.acquire_lease, self.lease_ttl_seconds)
        except Exception as exc:  # noqa: BLE001 — re-acquired on the boundary path
            lease = {"granted": False, "error": f"{type(exc).__name__}: {exc}"}
        prepared = {
            "target": target.isoformat(),
            "lease": lease or {},
            "reconciled": reconciled,
            "prepared_ns": started,
            "prepare_ms": (time.time_ns() - started) / 1_000_000,
        }
        self.prepared = prepared
        return prepared

    # -- boundary --------------------------------------------------------------
    async def on_boundary(self, target: datetime, timing: RunTiming) -> BoundaryOutcome:
        target = target.astimezone(timezone.utc)
        target_ns = int(target.timestamp() * NS)
        cutoff_ns = target_ns + CUTOFF_MS * 1_000_000
        label = self.ticker_resolver.unverified_label(target)

        prepared = self.prepared
        if prepared is not None and prepared.get("target") != target.isoformat():
            prepared = None
        self.prepared = None

        # A lease that was prepared for THIS target and still covers the whole
        # decision is reused; anything else is re-acquired. Either way the
        # decision only proceeds while this process demonstrably owns the
        # boundary — the wait is what moved, not the guarantee.
        #
        # A refusal writes NOTHING. The interval belongs to whoever holds the
        # lease, and a process that has just been told it is not the writer
        # must not stamp a MISSED row over the owner's row.
        lease_wait_ns = 0
        prepared_lease = (prepared or {}).get("lease") or {}
        if prepared is not None and self.lease_state(prepared_lease, 0) == "DENIED" and (
            prepared_lease.get("owner_id")
        ):
            owner = prepared_lease.get("owner_id", "other")
            return BoundaryOutcome(target, "MISSED", f"lease held by {owner}")

        # Judged against the LATER of the cutoff and now: a boundary that is
        # already running late needs a lease valid for the real decision time,
        # not for a cutoff that has passed.
        reused = self._lease_usable(prepared, max(cutoff_ns, time.time_ns()))
        lease = prepared_lease
        if not reused:
            lease_started = time.time_ns()
            lease = self.store.acquire_lease(self.lease_ttl_seconds)
            lease_wait_ns = time.time_ns() - lease_started
            if not lease.get("granted"):
                owner = lease.get("owner_id", "other")
                return BoundaryOutcome(target, "MISSED", f"lease held by {owner}")

        # The full [T, T+5s) window is used. The packet freezes at the model's
        # own cutoff; if the scheduler is late, the measured lateness is
        # recorded and nothing is backdated.
        wait_s = (cutoff_ns - time.time_ns()) / NS
        if wait_s > 0:
            await asyncio.sleep(wait_s)
        freeze_ns = max(cutoff_ns, time.time_ns())

        ticker = None
        try:
            ticker = self.ticker_resolver.resolve(target)
        except Exception:  # noqa: BLE001 - resolution failure is a packet blocker
            ticker = None

        timing.packet_freeze_ns = freeze_ns
        timing.compute_started_ns = time.time_ns()
        # A stale feed does not skip the target: the packet is built anyway and
        # fails closed, so the opportunity is RECORDED as INPUT_UNAVAILABLE
        # rather than silently vanishing from the ledger.
        packet = self.direction.build(target, cutoff_ns, freeze_ns, ticker=ticker or label)
        timing.last_receipt_ns = packet.source.get("last_receipt_ns")

        head = None
        try:
            head = self.heads.head_for(target)
        except HeadUnavailable:
            head = None

        observed = datetime.now(timezone.utc)
        if observed < target + timedelta(seconds=5):
            observed = target + timedelta(seconds=5)

        engine_output = self.state.engine.decide(
            target=target,
            ticker=ticker or label,
            features=packet.as_engine_features(),
            input_valid=packet.input_valid,
            head=head,
            observed_at=observed,
        )
        guard_output = self.state.guard.decide(
            target=target,
            ticker=ticker or label,
            candidate=int(engine_output["candidate"]),
            rank=engine_output["rank"],
            observed_at=observed,
        )
        timing.compute_complete_ns = time.time_ns()

        measured = {
            "target_open_ns": target_ns,
            "packet_freeze_ns": freeze_ns,
            "last_receipt_ns": packet.source.get("last_receipt_ns"),
            "compute_started_ns": timing.compute_started_ns,
            "compute_complete_ns": timing.compute_complete_ns,
            "publication_offset_ms": (timing.compute_complete_ns - target_ns) / 1_000_000,
            # Measured against the configured T+5 ceiling. Never extended.
            "deadline_met": timing.compute_complete_ns < target_ns + CUTOFF_MS * 1_000_000,
            # Where the boundary's remote waits actually went. `lease_reused`
            # means the round trip happened before T instead of after the wake.
            "lease_reused": bool(reused),
            "lease_wait_ms": lease_wait_ns / 1_000_000,
            "prepare_ms": (prepared or {}).get("prepare_ms"),
            "freeze_offset_ms": (freeze_ns - target_ns) / 1_000_000,
        }

        row = target_row(
            target_open=target,
            ticker=ticker or label,
            engine_output=engine_output,
            guard_output=guard_output,
            packet=packet,
            timing=measured,
        )

        # Sole-writer validity must hold at the COMMIT, not merely at the wake.
        # A lease that has aged out since it was prepared is renewed here, and a
        # refusal fails closed: the row is not written by a process that no
        # longer owns the boundary.
        if not self._lease_usable({"lease": lease}, time.time_ns()):
            renewed = self.store.acquire_lease(self.lease_ttl_seconds)
            if not renewed.get("granted"):
                owner = renewed.get("owner_id", "other")
                self.store.mark_missed(label, target, f"LITEA_LEASE_LOST_TO:{owner}")
                return BoundaryOutcome(target, "MISSED", f"lease lost to {owner}")
            lease = renewed

        # Local paired state first, then the durable transaction. A retry after
        # a transport failure replays the SAME decision: the engine and guard
        # both return their recorded output for an already decided target, so
        # neither the rank queue nor the floor exposure can advance twice.
        with self.state_lock:
            self.state.cursors.source_watermarks = packet.source.get("feed_watermarks") or {}
            self.state.save(self.state_path)
            checkpoint = checkpoint_payload(self.state, next_target=next_boundary(target))
            outcome = self._commit(row, checkpoint)
        if outcome["ok"]:
            # Durable acknowledgement is its own measurement; compute completion
            # is not a publication guarantee. The committed row is amended with
            # the measured ACK instant in a second, IDEMPOTENT write of the same
            # decision — same identity, same sides, so nothing advances twice.
            measured["durable_ack_ns"] = outcome["ack_ns"]
            measured["durable_ack_offset_ms"] = (outcome["ack_ns"] - target_ns) / 1_000_000
            measured["commit_latency_ms"] = outcome["ack_latency_ms"]
            with self.state_lock:
                self.state.cursors.last_committed_target = target.isoformat()
                self.state.save(self.state_path)
            try:
                self.store.commit({**row, "decision_durable_ns": str(outcome["ack_ns"])}, None)
            except Exception:  # noqa: BLE001 - the decision itself is already durable
                pass


        # The recorded opportunity enters the rolling training frame with the
        # features that were ACTUALLY frozen at this target's own cutoff, valid
        # or not, unlabelled until its settlement arrives. Kept off the timed
        # path: it runs after the durable commit.
        with self.state_lock:
            self._record_training_row(target, ticker or label, packet)

        return BoundaryOutcome(
            target=target,
            status=row["status"],
            reason=row["status_reason"],
            engine_output=engine_output,
            guard_output=guard_output,
            committed=bool(outcome["ok"]),
            timing=measured,
        )

    def _record_training_row(self, target: datetime, ticker: str, packet: Any) -> None:
        features = packet.as_engine_features()
        self.training.append(
            [
                {
                    "ts": target,
                    "ticker": ticker,
                    "input_valid": bool(packet.input_valid),
                    "label": float("nan"),
                    "settlement_ts": None,
                    **features,
                }
            ]
        )
        if self.training_path:
            self.state.cursors.training_sha256 = self.training.save(self.training_path)
            self.state.cursors.training_rows = self.training.rows
            self.state.cursors.training_last_target = self.training.last_target
