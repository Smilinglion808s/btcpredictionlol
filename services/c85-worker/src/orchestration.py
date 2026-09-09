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
  ``RawPacketUnavailable`` naming the live producers that are still missing. A
  packet source that returns pre-computed leaf output is a *test harness*, not
  live inference, and must be labelled as such by the caller.
* **No catch-up, refitting or history rebuilding happens on this path.**
* **Three separate clocks, defined in ``config`` and never conflated:**

      feature input cutoff   T + FEATURE_INPUT_CUTOFF_MS, half-open [T, T+5s).
                             An immutable MODEL rule transcribed from
                             build_multivenue_features_r1.py's causal contract.
      compute budget         COMPUTE_BUDGET_MS of wall time after the cutoff.
      publication deadline   T + PUBLICATION_DEADLINE_MS. Never extended, never
                             back-dated. A decision past it is EXPIRED and is
                             not dispatched.

  Those two 5000 ms values are structurally incompatible: the last legal input
  may arrive at T+4999.999 ms while publication is already due at T+5000 ms.
  ``CUTOFF_DEADLINE_CONFLICT_MS`` (currently 1200 ms) is a CONFIGURED
  allowance describing that conflict, not a measurement of any run.
  It is surfaced on every outcome and in the readiness reason; it is NOT
  resolved by truncating inputs and NOT by extending the ceiling.

Decision lifecycle, kept distinct in ``status`` (nothing is called published
before the gateway accepts it):

    ABSTAIN / INVALID  -> no directional call
    COMPUTED           -> scored, commit not yet confirmed
    LOGGED             -> durably committed, dispatch suppressed by policy
    EXPIRED            -> deadline passed before dispatch; no outbox
    DISPATCH_FAILED    -> sent, not accepted
    PUBLISHED          -> gateway accepted; only then is published_at stamped
    COMMIT_FAILED      -> not durable; authoritative state left untouched
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Protocol

from .config import (
    COMPUTE_BUDGET_MS,
    CUTOFF_DEADLINE_CONFLICT_MS,
    FEATURE_INPUT_CUTOFF_INCLUSIVE,
    FEATURE_INPUT_CUTOFF_MS,
    PUBLICATION_DEADLINE_MS,
)
from .engine import Decision, evaluate, target_identity
from .scheduler import RunTiming
from .state import C85State

NS = 1_000_000_000


class RawPacketUnavailable(RuntimeError):
    """A live raw-feature producer needed for this target is not implemented."""


def event_admitted(event_ns: int, target_ns: int) -> bool:
    """The original T+5 inclusion rule: T <= ts < T+5s (half-open)."""
    cutoff = target_ns + FEATURE_INPUT_CUTOFF_MS * 1_000_000
    if event_ns < target_ns:
        return False
    return event_ns <= cutoff if FEATURE_INPUT_CUTOFF_INCLUSIVE else event_ns < cutoff


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
    #: Prepared-but-uncommitted advance of the expert chain (fitted
    #: long-context head + positional rank window). The orchestrator commits it
    #: only after the decision is durable, and rolls it back on every other
    #: exit, so head and rank can never end up on different targets.
    pending_update: Any = None



class PacketSource(Protocol):
    def build(self, target_open: datetime, cutoff_ns: int) -> TargetInputs: ...


class UnavailablePacketSource:
    """The production default: fails closed until every live producer exists."""

    def __init__(self, reasons: list[str] | None = None) -> None:
        self.reasons = reasons or [
            "C85_LIVE_LEAF_PRODUCERS_MISSING: src/experts/leaf.py::LeafExperts.evaluate "
            "only passes through already-computed upstream fields; the fitted live "
            "inference for the nine leaf outputs is unimplemented."
        ]

    def build(self, target_open: datetime, cutoff_ns: int) -> TargetInputs:
        raise RawPacketUnavailable("; ".join(self.reasons))


class TickerResolver(Protocol):
    def resolve(self, target_open: datetime) -> str: ...


@dataclass
class BoundaryOutcome:
    ticker: str | None
    target_open: datetime
    status: str
    decision: Decision | None = None
    dispatched: bool = False
    accepted: bool = False
    dispatch_result: dict[str, Any] | None = None
    blocker: str | None = None
    settlements_consumed: list[str] = field(default_factory=list)
    committed: bool = False
    state_promoted: bool = False
    checkpoint_seq: int | None = None
    cutoff_conflict_ms: int = CUTOFF_DEADLINE_CONFLICT_MS

    def as_dict(self) -> dict[str, Any]:
        return {
            "ticker": self.ticker,
            "target_open_utc": self.target_open.astimezone(timezone.utc).isoformat(),
            "status": self.status,
            "dispatched": self.dispatched,
            "accepted": self.accepted,
            "blocker": self.blocker,
            "final_side": None if self.decision is None else self.decision.final_side,
            "settlements_consumed": len(self.settlements_consumed),
            "committed": self.committed,
            "state_promoted": self.state_promoted,
            "checkpoint_seq": self.checkpoint_seq,
            "cutoff_conflict_ms": self.cutoff_conflict_ms,
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
        """Exclusive upper bound of the model's feature window (T+5s)."""
        return target_open_ns + FEATURE_INPUT_CUTOFF_MS * 1_000_000

    @staticmethod
    def compute_budget_ns() -> int:
        return COMPUTE_BUDGET_MS * 1_000_000

    @staticmethod
    def publication_deadline_ns(target_open_ns: int) -> int:
        return target_open_ns + PUBLICATION_DEADLINE_MS * 1_000_000

    @staticmethod
    def cutoff_conflict_ms() -> int:
        """>0 means full inputs and on-time publication cannot both hold."""
        return CUTOFF_DEADLINE_CONFLICT_MS

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

    @staticmethod
    def _stamp_timing(
        decision: Decision,
        timing: RunTiming,
        cutoff_ns: int,
        source: dict[str, Any] | None,
    ) -> None:
        """(Re)derive the persisted timing from the CURRENT measurements.

        Called again after dispatch so publication_offset_ms / deadline_met
        reflect the real gateway acknowledgement instead of a pre-send guess.
        `c85_targets` has no column for the build/send/ack instants and the
        commit function rejects unknown keys, so the full measured set is kept
        in the existing `feed_watermarks` jsonb under "measured".
        """
        measured = timing.as_dict()
        watermarks = dict((source or {}).get("feed_watermarks") or {})
        watermarks["measured"] = measured
        watermarks["model_input_cutoff_ns"] = str(cutoff_ns)
        # A configured constant, NOT a measurement of this run.
        watermarks["configured_cutoff_deadline_conflict_ms"] = CUTOFF_DEADLINE_CONFLICT_MS
        decision.timing = {
            **measured,
            **{k: v for k, v in (source or {}).items() if k != "feed_watermarks"},
            "feed_watermarks": watermarks,
            "feature_input_cutoff_ns": str(cutoff_ns),
            "configured_cutoff_deadline_conflict_ms": CUTOFF_DEADLINE_CONFLICT_MS,
        }


    def _reconcile_commit(self, candidate: C85State, target_open: datetime) -> dict[str, Any] | None:
        """Resolve an ambiguous commit by reading committed identity.

        A lost response is NOT retried blindly: the durable checkpoint is read
        back and every mandatory field must match before the candidate may be
        promoted — the advanced `last_processed_target_utc`, a present and
        exactly equal `state_sha256`, and a usable `checkpoint_seq`. A row that
        omits the hash is treated as unconfirmed, never as success.
        """
        try:
            row = self.store.committed_identity()
        except Exception:  # noqa: BLE001 - still ambiguous; caller keeps state
            return None
        if not isinstance(row, dict) or not row:
            return None
        last = row.get("last_processed_target_utc")
        want = target_open.astimezone(timezone.utc).isoformat()
        if last != want:
            return None
        committed_hash = row.get("state_sha256")
        if not committed_hash or committed_hash != candidate.sha256():
            return None
        seq = row.get("checkpoint_seq")
        if seq is None:
            return None
        try:
            if int(seq) <= 0:
                return None
        except (TypeError, ValueError):
            return None
        return row


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

        # 0. duplicate / retry suppression against the authoritative state only.
        if self.already_processed(state, target_open):
            return BoundaryOutcome(
                ticker=None, target_open=target_open, status="DUPLICATE",
                blocker="C85_TARGET_ALREADY_PROCESSED",
            )

        # 1. ticker resolution against real market metadata (fails closed).
        try:
            ticker = self.ticker_resolver.resolve(target_open)
        except Exception as exc:  # noqa: BLE001
            label = getattr(self.ticker_resolver, "unverified_label", lambda t: "UNVERIFIED")(
                target_open
            )
            reason = f"C85_TICKER_UNRESOLVED (unverified candidate {label}): {exc}"
            self.store.mark_missed(label, target_open, reason)
            return BoundaryOutcome(label, target_open, "MISSED", blocker=reason)

        # 2. raw packet, cut at the MODEL's own input cutoff (T+5s exclusive).
        #    `cutoff_ns` is the immutable model rule. `packet_freeze_ns` is a
        #    MEASUREMENT of when the packet was actually frozen; the scheduler
        #    sets it when it blocks to the cutoff, and it is never overwritten
        #    with the theoretical value.
        cutoff_ns = self.input_cutoff_ns(target_ns)
        timing.model_input_cutoff_ns = cutoff_ns
        if timing.compute_started_ns is None:
            timing.compute_started_ns = self.clock_ns()
        timing.packet_build_started_ns = self.clock_ns()
        if timing.packet_freeze_ns is None:
            timing.packet_freeze_ns = timing.packet_build_started_ns
        try:
            inputs = self.packet_source.build(target_open, cutoff_ns)
        except RawPacketUnavailable as exc:
            timing.packet_build_complete_ns = self.clock_ns()
            reason = f"C85_RAW_PACKET_UNAVAILABLE: {exc}"
            self.store.mark_missed(ticker, target_open, reason)
            return BoundaryOutcome(ticker, target_open, "MISSED", blocker=reason)
        timing.packet_build_complete_ns = self.clock_ns()
        source_receipt = (inputs.source or {}).get("last_receipt_ns")
        if source_receipt is not None and timing.last_receipt_ns is None:
            timing.last_receipt_ns = int(source_receipt)


        # 3. evaluate against an ISOLATED CANDIDATE state. A failed commit must
        #    not advance last_processed / ranks / deterioration.
        candidate = state.clone()
        self._load_pending_settlements(candidate)
        consumed_before = len(candidate.deterioration.consumed)

        direction_head, meta_head = self._fits(target_open)
        decision = evaluate(
            candidate,
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
        newly_consumed = candidate.deterioration.consumed[consumed_before:]

        decision.fits = {
            "direction_fit_id": None if direction_head is None else str(direction_head.as_of),
            "meta_fit_id": None if meta_head is None else str(meta_head.as_of),
            "aux_fit_month": inputs.aux_fit_month,
            "feature_order_sha256": getattr(self.artifacts, "feature_order_sha256", None),
        }
        decision.features = {**inputs.auxiliary_outputs}
        timing.compute_complete_ns = self.clock_ns()

        # 4. publication deadline. Never extended, never back-dated.
        deadline_ns = self.publication_deadline_ns(target_ns)
        expired = self.clock_ns() >= deadline_ns
        directional = decision.is_directional
        dispatchable = directional and self.allow_dispatch and not expired

        if directional:
            if expired:
                decision.status = "EXPIRED"
                decision.status_reason = (
                    f"C85_PUBLICATION_DEADLINE_MISSED_BY_MS:"
                    f"{(self.clock_ns() - deadline_ns) / 1e6:.1f}"
                    + (
                        f" (structural: input cutoff T+{FEATURE_INPUT_CUTOFF_MS}ms vs "
                        f"publication T+{PUBLICATION_DEADLINE_MS}ms leaves "
                        f"{CUTOFF_DEADLINE_CONFLICT_MS}ms of unavoidable overrun)"
                        if CUTOFF_DEADLINE_CONFLICT_MS > 0
                        else ""
                    )
                )
                decision.gate_reasons.append("publication_deadline_missed")
            elif not self.allow_dispatch:
                decision.status = "LOGGED"
                decision.status_reason = "C85_DISPATCH_SUPPRESSED"
            else:
                decision.status = "COMPUTED"

        self._stamp_timing(decision, timing, cutoff_ns, inputs.source)


        # 5. ownership re-check, then durable commit. An expired or suppressed
        #    decision enqueues NO outbox row, so nothing stale is dispatchable.
        lease_check = getattr(self.store, "verify_lease", None)
        if run_mode == "LIVE" and lease_check is not None:
            try:
                verdict = lease_check()
            except Exception as exc:  # noqa: BLE001
                verdict = {"ok": False, "lease": {"error": str(exc)}}
            if not verdict.get("ok"):
                if inputs.pending_update is not None:
                    inputs.pending_update.rollback()
                return BoundaryOutcome(
                    ticker, target_open, "LEASE_LOST",
                    decision=decision,
                    blocker="C85_LEASE_LOST_BEFORE_COMMIT",
                )


        outbox = None
        if dispatchable:
            outbox = {
                "dedupe_key": f"C85:{decision.identity}",
                "payload": {
                    "identity": decision.identity,
                    "ticker": ticker,
                    "target_open_utc": target_open.isoformat(),
                    "side": decision.final_side,
                    "probability_yes": decision.probability_yes,
                    "probability_correct": decision.probability_correct,
                },
                # Expiry is the publication ceiling itself: a row that survives
                # a crash cannot be dispatched late.
                "expires_at": (
                    target_open + timedelta(milliseconds=PUBLICATION_DEADLINE_MS)
                ).isoformat(),
            }

        commit: dict[str, Any] | None = None
        reconciled_commit = False
        try:
            commit = self.store.commit_decision(
                decision, published_at=None, state=candidate, stage="READY", outbox=outbox
            )
            if not isinstance(commit, dict) or commit.get("ok") is False:
                if inputs.pending_update is not None:
                    inputs.pending_update.rollback()
                return BoundaryOutcome(
                    ticker, target_open, "COMMIT_FAILED", decision=decision,
                    blocker=(
                        f"C85_COMMIT_REJECTED:{commit.get('error')}"
                        if isinstance(commit, dict)
                        else f"C85_COMMIT_MALFORMED_RESPONSE:{commit!r}"
                    ),
                )
        except Exception as exc:  # noqa: BLE001 - ambiguous: may or may not have landed
            reconciled = self._reconcile_commit(candidate, target_open)
            if reconciled is None:
                if inputs.pending_update is not None:
                    inputs.pending_update.rollback()
                return BoundaryOutcome(
                    ticker, target_open, "COMMIT_FAILED", decision=decision,
                    blocker=f"C85_COMMIT_UNCONFIRMED:{type(exc).__name__}: {exc}",
                )
            reconciled_commit = True
            commit = {
                "ok": True,
                "target_id": reconciled.get("target_id"),
                "checkpoint": {"checkpoint_seq": reconciled.get("checkpoint_seq")},
                "reconciled": True,
            }

        # The decision is durable: the expert chain may now advance, exactly
        # once, head and rank window together.
        if inputs.pending_update is not None:
            try:
                inputs.pending_update.commit()
            except Exception as exc:  # noqa: BLE001 - recorded, never silently dropped
                candidate.expert_state["chain_commit_error"] = f"{type(exc).__name__}: {exc}"


        # 6. only now is the candidate authoritative.
        state.adopt(candidate)
        timing.decision_durable_ns = self.clock_ns()
        seq_raw = ((commit or {}).get("checkpoint") or {}).get("checkpoint_seq")
        seq = None if seq_raw is None else int(seq_raw)
        if seq is not None:
            # The store adopts this itself on a normal commit; a reconciled
            # commit must land the read-back sequence too, or the next write
            # sends a stale expected_parent_seq and is rejected outright.
            state.checkpoint_seq = seq
            if reconciled_commit and hasattr(self.store, "_last_seq"):
                self.store._last_seq = seq  # noqa: SLF001 - documented recovery path
        self._stamp_timing(decision, timing, cutoff_ns, inputs.source)

        if newly_consumed:
            try:
                self.store.consume_settlements(newly_consumed, state=state)
                seq = state.checkpoint_seq or seq
            except Exception as exc:  # noqa: BLE001 - already folded in durably
                state.expert_state["settlement_consume_error"] = f"{type(exc).__name__}: {exc}"

        # 7. dispatch, only inside the ceiling and only when enabled. published_at
        #    is written only after the gateway ACCEPTS — never on send.
        dispatched = accepted = False
        result = None
        if dispatchable and self.gateway is not None and self.clock_ns() < deadline_ns:
            timing.dispatch_started_ns = self.clock_ns()
            try:
                result = await self.gateway.publish(
                    dict(outbox["payload"], target_id=(commit or {}).get("target_id"))
                )
                timing.dispatch_ack_ns = self.clock_ns()
            except Exception as exc:  # noqa: BLE001 - send failed, nothing accepted
                timing.dispatch_ack_ns = self.clock_ns()
                result = {"ok": False, "status": f"{type(exc).__name__}: {exc}"}
            timing.dispatch_ns = timing.dispatch_started_ns
            dispatched = True
            accepted = bool(result and result.get("ok"))
            if accepted and timing.dispatch_ack_ns >= deadline_ns:
                # Accepted after the ceiling: honest status, no back-dating.
                accepted = False
                decision.status = "EXPIRED"
                decision.status_reason = (
                    "C85_GATEWAY_ACCEPTED_AFTER_DEADLINE_BY_MS:"
                    f"{(timing.dispatch_ack_ns - deadline_ns) / 1e6:.1f}"
                )
            else:
                decision.status = "PUBLISHED" if accepted else "DISPATCH_FAILED"
                if not accepted:
                    decision.status_reason = f"C85_GATEWAY_REJECTED:{(result or {}).get('status')}"
            self._stamp_timing(decision, timing, cutoff_ns, inputs.source)
            try:
                self.store.commit_dispatch_result(
                    decision,
                    published_at=datetime.now(timezone.utc).isoformat() if accepted else None,
                )
            except Exception as exc:  # noqa: BLE001 - decision itself is durable
                state.expert_state["dispatch_record_error"] = f"{type(exc).__name__}: {exc}"
        elif dispatchable:
            decision.status = "EXPIRED"
            decision.status_reason = "C85_DEADLINE_PASSED_BEFORE_DISPATCH"
            self._stamp_timing(decision, timing, cutoff_ns, inputs.source)
            try:
                self.store.commit_dispatch_result(decision, published_at=None)
            except Exception as exc:  # noqa: BLE001
                state.expert_state["dispatch_record_error"] = f"{type(exc).__name__}: {exc}"

        return BoundaryOutcome(
            ticker=ticker,
            target_open=target_open,
            status=decision.status,
            decision=decision,
            dispatched=dispatched,
            accepted=accepted,
            dispatch_result=result,
            settlements_consumed=list(newly_consumed),
            committed=True,
            state_promoted=True,
            checkpoint_seq=None if seq is None else int(seq),

        )
