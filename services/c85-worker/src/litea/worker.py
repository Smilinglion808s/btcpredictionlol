"""Version 1 boundary path: sourced packet -> engine -> guard -> durable log.

Independent of the C85 worker's readiness. The only things Version 1 needs are

  * fresh feeds for the direction stage,
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
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from ..scheduler import RunTiming, next_boundary
from .heads import DailyHeadStore, HeadUnavailable
from .identity import MODEL_ID
from .packet import Direction60Source
from .state import LiteAState
from .store import LiteAStore, checkpoint_payload, target_row

NS = 1_000_000_000
CUTOFF_MS = 5_000


@dataclass
class BoundaryOutcome:
    target: datetime
    status: str
    reason: str | None = None
    engine_output: dict[str, Any] | None = None
    guard_output: dict[str, Any] | None = None
    committed: bool = False
    timing: dict[str, Any] = field(default_factory=dict)


class LiteAWorker:
    """One target at a time, in observed-time order, durable before anything else."""

    def __init__(
        self,
        *,
        packet_source: Any,
        store: LiteAStore,
        heads: DailyHeadStore,
        state: LiteAState,
        state_path: Path,
        ticker_resolver: Any,
        feeds: Any,
        lease_ttl_seconds: int = 60,
    ) -> None:
        self.direction = Direction60Source(packet_source)
        self.store = store
        self.heads = heads
        self.state = state
        self.state_path = Path(state_path)
        self.ticker_resolver = ticker_resolver
        self.feeds = feeds
        self.lease_ttl_seconds = lease_ttl_seconds
        self.readiness = "WARMING"
        self.blocking_reason: str | None = None

    # -- readiness -------------------------------------------------------------
    def evaluate_readiness(self, at: datetime | None = None) -> tuple[str, str | None]:
        target = at or next_boundary()
        missing = self.feeds.missing() if hasattr(self.feeds, "missing") else []
        if missing:
            return "BLOCKED", f"LITEA_FEEDS_STALE: {', '.join(missing)}"
        packet_reasons = self.direction.blocking_reasons(time.time_ns())
        if packet_reasons:
            return "BLOCKED", "LITEA_SOURCE_UNAVAILABLE :: " + " || ".join(packet_reasons)
        try:
            self.heads.head_for(target)
        except HeadUnavailable as exc:
            return "BLOCKED", str(exc)
        return "LOGGING_READY", None

    def dispatch_status(self) -> str:
        """Structurally absent, not merely disabled."""
        return "NONE"

    def snapshot(self) -> dict[str, Any]:
        status, reason = self.evaluate_readiness()
        return {
            "model_version": MODEL_ID,
            "readiness": status,
            "blocking_reason": reason,
            "dispatch": self.dispatch_status(),
            "execution_enabled": False,
            "heads": self.heads.inventory(),
            "state_sha256": self.state.snapshot()["sha256"],
            "cursors": self.state.cursors.as_dict(),
            "next_target_utc": next_boundary().isoformat(),
            "at": datetime.now(timezone.utc).isoformat(),
        }

    # -- settlement ------------------------------------------------------------
    def apply_settlements(self, settlements: list[dict[str, Any]]) -> int:
        """Feed settled outcomes to BOTH members, exactly once each.

        A late settlement keeps its original entry day because the guard's own
        pending record carries that day; nothing here re-dates it.
        """
        applied = 0
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
            consumed.add(key)
            applied += 1
        self.state.cursors.consumed_settlements = sorted(consumed)
        return applied

    # -- boundary --------------------------------------------------------------
    async def on_boundary(self, target: datetime, timing: RunTiming) -> BoundaryOutcome:
        target = target.astimezone(timezone.utc)
        target_ns = int(target.timestamp() * NS)
        cutoff_ns = target_ns + CUTOFF_MS * 1_000_000
        label = self.ticker_resolver.unverified_label(target)

        status, reason = self.evaluate_readiness(target)
        if status != "LOGGING_READY" and "NO_APPLICABLE_HEAD" not in (reason or ""):
            # A sourcing/feed failure means there is no packet at all.
            self.store.mark_missed(label, target, reason or "not_ready")
            return BoundaryOutcome(target, "MISSED", reason)

        lease = self.store.acquire_lease(self.lease_ttl_seconds)
        if not lease.get("granted"):
            owner = lease.get("owner_id", "other")
            self.store.mark_missed(label, target, f"LITEA_LEASE_HELD_BY:{owner}")
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
        }

        row = target_row(
            target_open=target,
            ticker=ticker or label,
            engine_output=engine_output,
            guard_output=guard_output,
            packet=packet,
            timing=measured,
        )

        # Local paired state first, then the durable transaction. A retry after
        # a transport failure replays the SAME decision: the engine and guard
        # both return their recorded output for an already decided target, so
        # neither the rank queue nor the floor exposure can advance twice.
        self.state.cursors.source_watermarks = packet.source.get("feed_watermarks") or {}
        self.state.save(self.state_path)
        checkpoint = checkpoint_payload(self.state, next_target=next_boundary(target))
        result = self.store.commit(row, checkpoint)
        committed = bool(result.get("ok", True))
        if committed:
            self.state.cursors.last_committed_target = target.isoformat()
            self.state.save(self.state_path)

        return BoundaryOutcome(
            target=target,
            status=row["status"],
            reason=row["status_reason"],
            engine_output=engine_output,
            guard_output=guard_output,
            committed=committed,
            timing=measured,
        )
