"""Shared one-target inference orchestration for unchanged C85.

This module owns the *sequence* of a single boundary, nothing else. Every model
rule stays where it already lives:

    features/experts -> supplied by a ``PacketSource`` (raw live producers)
    chain arithmetic -> ``engine.evaluate`` (unchanged order of operations)
    rank + deterioration state -> ``state.C85State``
    durability -> ``store.C85Store`` (decision + checkpoint + outbox in one
                  backend transaction, leases, exactly-once settlements)
    dispatch -> ``gateway.GatewayClient``

Deliberate boundaries, so nothing here can quietly become the model:

* **Raw packet production is an explicit dependency that fails closed.** The
  default ``PacketSource`` is ``UnavailablePacketSource``: it raises
  ``RawPacketUnavailable`` naming the live producers that are still missing
  (``src/experts/leaf.py::LeafExperts.evaluate`` passes through already-computed
  upstream fields and has no live ``directional_matrix`` producer). A packet
  source that returns pre-computed leaf output is a *test harness*, not live
  inference, and must be labelled as such by the caller.
* **No catch-up, refitting or history rebuilding happens on this path.** The
  orchestrator selects an already-fitted head or abstains with
  ``C85_NO_APPLICABLE_FIT``; it never fits.
* **Three distinct clocks, taken from the existing configuration, never
  redefined here**:
      input cutoff    T + (PUBLICATION_DEADLINE_MS - COMPUTE_BUDGET_MS)
                      = the packet freeze the scheduler already performs
      computation     COMPUTE_BUDGET_MS after the freeze
      publication     T + PUBLICATION_DEADLINE_MS, checked immediately before
                      dispatch; a decision that misses it is recorded EXPIRED
                      and never back-dated or dispatched late.
  The settlement consumption cutoff is the original decision instant
  (T+5s) implemented inside ``engine.evaluate``; it is not the dispatch clock.
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Protocol

from .config import COMPUTE_BUDGET_MS, PUBLICATION_DEADLINE_MS
from .engine import Decision, evaluate, target_identity
from .scheduler import RunTiming
from .state import C85State

NS = 1_000_000_000


class RawPacketUnavailable(RuntimeError):
    """A live raw-feature producer needed for this target is not implemented."""


@dataclass(frozen=True)
class TargetInputs:
    """Everything one target needs, produced from raw sources by a PacketSource."""

    direction_features: dict[str, float | None]
    meta_features_without_aux: dict[str, float | None]
    auxiliary_outputs: dict[str, float | None]
    validity: dict[str, bool]
    c54_prediction: int
    market_q1: bool
    last_yes_price: float | None
    aux_fit_month: str | None = None
    source: dict[str, Any] = field(default_factory=dict)


class PacketSource(Protocol):
    def build(self, target_open: datetime, freeze_ns: int) -> TargetInputs: ...


class UnavailablePacketSource:
    """The production default: fails closed until every live producer exists.

    ``reasons`` is the concrete, per-dependency blocker list — the same list the
    readiness endpoint reports — so a missed target says exactly what is absent.
    """

    def __init__(self, reasons: list[str] | None = None) -> None:
        self.reasons = reasons or [
            "C85_LIVE_LEAF_PRODUCERS_MISSING: src/experts/leaf.py::LeafExperts.evaluate "
            "only passes through already-computed upstream fields; directional_matrix "
            "and the fitted live inference for the nine leaf outputs are unimplemented."
        ]

    def build(self, target_open: datetime, freeze_ns: int) -> TargetInputs:
        raise RawPacketUnavailable("; ".join(self.reasons))


class TickerResolver(Protocol):
    def resolve(self, target_open: datetime) -> str: ...


@dataclass
class BoundaryOutcome:
    ticker: str | None
    target_open: datetime
    status: str                     # PUBLISHED | ABSTAIN | INVALID | EXPIRED |
                                    # MISSED | DUPLICATE | LEASE_LOST
    decision: Decision | None = None
    dispatched: bool = False
    dispatch_result: dict[str, Any] | None = None
    blocker: str | None = None
    settlements_consumed: list[str] = field(default_factory=list)
    committed: bool = False

    def as_dict(self) -> dict[str, Any]:
        return {
            "ticker": self.ticker,
            "target_open_utc": self.target_open.astimezone(timezone.utc).isoformat(),
            "status": self.status,
            "dispatched": self.dispatched,
            "blocker": self.blocker,
            "final_side": None if self.decision is None else self.decision.final_side,
            "settlements_consumed": len(self.settlements_consumed),
            "committed": self.committed,
        }


class BoundaryOrchestrator:
    """One target, one pass, restart-safe. Used by the live scheduler and by
    chronological historical replays alike, so both take the identical path."""

    def __init__(
        self,
        *,
        artifacts: Any,
        store: Any,
        gateway: Any | None,
        packet_source: PacketSource,
        ticker_resolver: TickerResolver,
        allow_dispatch: bool = False,
        clock_ns: Any = time.time_ns,
    ) -> None:
        self.artifacts = artifacts
        self.store = store
        self.gateway = gateway
        self.packet_source = packet_source
        self.ticker_resolver = ticker_resolver
        self.allow_dispatch = allow_dispatch
        self.clock_ns = clock_ns

    # -- clocks ---------------------------------------------------------------
    @staticmethod
    def input_cutoff_ns(target_open_ns: int) -> int:
        return target_open_ns + (PUBLICATION_DEADLINE_MS - COMPUTE_BUDGET_MS) * 1_000_000

    @staticmethod
    def publication_deadline_ns(target_open_ns: int) -> int:
        return target_open_ns + PUBLICATION_DEADLINE_MS * 1_000_000

    # -- helpers --------------------------------------------------------------
    @staticmethod
    def already_processed(state: C85State, target_open: datetime) -> bool:
        last = state.last_processed_target_utc
        if not last:
            return False
        try:
            return datetime.fromisoformat(last) >= target_open.astimezone(timezone.utc)
        except ValueError:
            return False

    def _load_pending_settlements(self, state: C85State) -> None:
        """Attach official settlements to their pending base calls.

        Nothing is folded into the deterioration EWMAs here: ``engine.evaluate``
        consumes only those strictly before the original decision instant.
        """
        try:
            rows = self.store.unconsumed_settlements()
        except Exception as exc:  # noqa: BLE001 - a settlement feed outage must not
            state.expert_state["settlement_feed_error"] = f"{type(exc).__name__}: {exc}"
            return
        for row in rows or []:
            identity = row.get("identity") or target_identity(
                row.get("ticker", ""), datetime.fromisoformat(row["target_open_utc"])
            )
            settlement_ns = row.get("settlement_ns")
            state.deterioration.attach_settlement(
                identity,
                row.get("label"),
                None if settlement_ns is None else int(settlement_ns),
            )

    def _fits(self, target_open: datetime) -> tuple[Any, Any]:
        return (
            self.artifacts.head_for("C71_DIRECTION", target_open),
            self.artifacts.head_for("C85_META", target_open),
        )

    # -- the single pass ------------------------------------------------------
    async def run_target(
        self,
        state: C85State,
        target_open: datetime,
        timing: RunTiming,
        *,
        run_mode: str = "LIVE",
    ) -> BoundaryOutcome:
        target_open = target_open.astimezone(timezone.utc)
        target_ns = int(target_open.timestamp() * NS)

        # 0. duplicate / retry suppression. State is not mutated twice for the
        #    same target; the backend row is idempotent on its natural key.
        if self.already_processed(state, target_open):
            return BoundaryOutcome(
                ticker=None, target_open=target_open, status="DUPLICATE",
                blocker="C85_TARGET_ALREADY_PROCESSED",
            )

        # 1. ticker resolution against real market metadata (fails closed).
        try:
            ticker = self.ticker_resolver.resolve(target_open)
        except Exception as exc:  # noqa: BLE001
            reason = f"C85_TICKER_UNRESOLVED: {exc}"
            self.store.mark_missed(None, target_open, reason)
            return BoundaryOutcome(None, target_open, "MISSED", blocker=reason)

        # 2. raw packet. Explicit dependency: no fixture, no fabrication.
        freeze_ns = timing.packet_freeze_ns or self.input_cutoff_ns(target_ns)
        timing.packet_freeze_ns = freeze_ns
        try:
            inputs = self.packet_source.build(target_open, freeze_ns)
        except RawPacketUnavailable as exc:
            reason = f"C85_RAW_PACKET_UNAVAILABLE: {exc}"
            self.store.mark_missed(ticker, target_open, reason)
            return BoundaryOutcome(ticker, target_open, "MISSED", blocker=reason)

        if timing.compute_started_ns is None:
            timing.compute_started_ns = self.clock_ns()

        # 3. settlements strictly before the decision cutoff, then the chain in
        #    its original order (direction -> validity -> meta+aux -> ranks ->
        #    extension -> deterioration -> filter).
        self._load_pending_settlements(state)
        consumed_before = len(state.deterioration.consumed)

        direction_head, meta_head = self._fits(target_open)
        decision = evaluate(
            state,
            ticker=ticker,
            target_open=target_open,
            direction_bundle=None if direction_head is None else direction_head.bundle,
            meta_bundle=None if meta_head is None else meta_head.bundle,
            direction_features=inputs.direction_features,
            meta_features_without_aux=inputs.meta_features_without_aux,
            auxiliary_outputs=inputs.auxiliary_outputs,
            validity=inputs.validity,
            c54_prediction=inputs.c54_prediction,
            market_q1=inputs.market_q1,
            last_yes_price=inputs.last_yes_price,
            run_mode=run_mode,
        )
        newly_consumed = state.deterioration.consumed[consumed_before:]

        decision.fits = {
            "direction_fit_id": None if direction_head is None else str(direction_head.as_of),
            "meta_fit_id": None if meta_head is None else str(meta_head.as_of),
            "aux_fit_month": inputs.aux_fit_month,
            "feature_order_sha256": getattr(self.artifacts, "feature_order_sha256", None),
        }
        decision.features = {**inputs.auxiliary_outputs}
        timing.compute_complete_ns = self.clock_ns()

        # 4. publication deadline, re-checked immediately before dispatch. Never
        #    extended, never back-dated.
        deadline_ns = self.publication_deadline_ns(target_ns)
        expired = self.clock_ns() >= deadline_ns
        publish = decision.is_directional and self.allow_dispatch and not expired
        if expired and decision.is_directional:
            decision.status = "EXPIRED"
            decision.status_reason = (
                f"C85_PUBLICATION_DEADLINE_MISSED_BY_MS:"
                f"{(self.clock_ns() - deadline_ns) / 1e6:.1f}"
            )
            decision.gate_reasons.append("publication_deadline_missed")

        decision.timing = {
            **timing.as_dict(),
            **{k: v for k, v in (inputs.source or {}).items()},
        }

        # 5. durable commit: decision row + checkpoint + outbox, one transaction.
        outbox = None
        if publish:
            outbox = {
                "identity": decision.identity,
                "ticker": ticker,
                "target_open_utc": target_open.isoformat(),
                "side": decision.final_side,
            }
        commit = self.store.commit_decision(
            decision, published=publish, state=state, stage="READY", outbox=outbox
        )
        timing.decision_durable_ns = self.clock_ns()
        decision.timing["decision_durable_ns"] = str(timing.decision_durable_ns)

        if newly_consumed:
            try:
                self.store.consume_settlements(newly_consumed, state=state)
            except Exception as exc:  # noqa: BLE001 - already folded in durably
                state.expert_state["settlement_consume_error"] = f"{type(exc).__name__}: {exc}"

        # 6. dispatch, only inside the ceiling and only when enabled.
        dispatched, result = False, None
        if publish and self.gateway is not None and self.clock_ns() < deadline_ns:
            result = await self.gateway.publish(
                {
                    "identity": decision.identity,
                    "ticker": ticker,
                    "target_open_utc": target_open.isoformat(),
                    "side": decision.final_side,
                    "probability_yes": decision.probability_yes,
                    "probability_correct": decision.probability_correct,
                    "target_id": (commit or {}).get("target_id"),
                }
            )
            timing.dispatch_ns = self.clock_ns()
            dispatched = bool(result.get("ok"))

        return BoundaryOutcome(
            ticker=ticker,
            target_open=target_open,
            status=decision.status,
            decision=decision,
            dispatched=dispatched,
            dispatch_result=result,
            settlements_consumed=list(newly_consumed),
            committed=True,
        )
